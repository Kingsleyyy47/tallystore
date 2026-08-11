-- Auto-restock cron setup via pg_cron + pg_net
-- Run this once in the Supabase SQL editor.
--
-- BEFORE RUNNING: replace the two placeholders below.
--   1. <YOUR_PROJECT_REF> - found in Supabase dashboard URL or Settings > General
--      (e.g. if your dashboard URL is https://supabase.com/dashboard/project/abcxyz123,
--      your ref is "abcxyz123")
--   2. <YOUR_AUTO_RESTOCK_SECRET> - the same random string you set as the
--      AUTO_RESTOCK_SECRET edge function secret
--
-- This runs auto-restock every 4 hours. Adjust the schedule string if you
-- want a different interval (cron syntax: minute hour day month weekday).

-- 1. Enable the required extensions (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remove any previous job with the same name, so re-running this is safe
SELECT cron.unschedule('auto-restock-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-restock-job');

-- 3. Schedule it - every 4 hours, on the hour
SELECT cron.schedule(
  'auto-restock-job',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/auto-restock',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '7B9wK4xP2vM8yN5qR1zC6jL3tB9fH2mX'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 4. Verify it's scheduled
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'auto-restock-job';
