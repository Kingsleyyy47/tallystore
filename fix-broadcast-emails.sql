-- Fix: broadcast / mass-email sending is stuck or failing
--
-- ROOT CAUSE FOUND: the `email` Edge Function (supabase/functions/email/index.ts)
-- reads and writes a `broadcast_jobs` table, and relies on a pg_cron job to call
-- POST /email/process-broadcast every minute to actually send the queued emails.
--
-- Neither of those exists anywhere in this repo's migrations:
--   - No migration creates `broadcast_jobs`  -> creating a broadcast likely errors
--     outright, or if the table happens to exist already from manual SQL editor
--     work, inserts may still succeed but nothing ever processes them.
--   - No migration schedules the `process-broadcast-emails` cron job (unlike
--     auto-restock, which has its own add-auto-restock-cron.sql) -> even if a
--     broadcast job IS created, nothing ever calls /email/process-broadcast, so
--     it sits at status "queued" forever. This is almost certainly why broadcasts
--     get stuck and never complete.
--
-- This file creates the missing table + the missing cron job. Run this once in
-- the Supabase SQL editor (or via the CLI) — I'm not running this myself per your
-- standing rule.
--
-- BEFORE RUNNING: replace <YOUR_SUPABASE_ANON_KEY> below with your project's
-- anon/publishable key (Supabase dashboard -> Settings -> API).
-- Project ref used below (taken from your existing auto-restock-cron.sql): dssvvswvqnxanyzfhixf

-- ─── 1. Create the broadcast_jobs table (safe if it already exists) ──────────
CREATE TABLE IF NOT EXISTS public.broadcast_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  html_body text NOT NULL,
  status text NOT NULL DEFAULT 'queued', -- queued | processing | completed | cancelled | failed
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  current_offset integer NOT NULL DEFAULT 0,
  batch_size integer NOT NULL DEFAULT 50,
  processing_lock timestamptz,
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_processed_at timestamptz
);

ALTER TABLE public.broadcast_jobs ENABLE ROW LEVEL SECURITY;

-- Admins can read/manage jobs (the edge function actually uses the service-role
-- key internally for all of this, so RLS here is just a safety net for any
-- direct client-side queries against this table).
DROP POLICY IF EXISTS "Admins can view broadcast jobs" ON public.broadcast_jobs;
CREATE POLICY "Admins can view broadcast jobs"
  ON public.broadcast_jobs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─── 2. append_jsonb_array RPC (optional, used to log per-batch send failures) ─
-- The edge function calls this and silently ignores failures if it's missing,
-- so this isn't required, but adding it means failed-email details actually get
-- recorded in error_log instead of being dropped.
CREATE OR REPLACE FUNCTION public.append_jsonb_array(
  table_name text,
  row_id uuid,
  column_name text,
  new_elements jsonb
) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'UPDATE public.%I SET %I = %I || $1 WHERE id = $2',
    table_name, column_name, column_name
  ) USING new_elements, row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. Schedule the missing pg_cron job that actually sends the emails ──────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('process-broadcast-emails')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-broadcast-emails');

SELECT cron.schedule(
  'process-broadcast-emails',
  '* * * * *', -- every minute
  $$
  SELECT net.http_post(
    url := 'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/email/process-broadcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
    ),
    body := '{"source": "pg_cron"}'::jsonb
  )
  WHERE EXISTS (
    SELECT 1 FROM public.broadcast_jobs
    WHERE status IN ('queued', 'processing')
  );
  $$
);

-- ─── 4. Verify ────────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'process-broadcast-emails';
