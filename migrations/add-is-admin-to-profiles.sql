-- ============================================================
-- Fix: Add is_admin column to profiles + mark the owner account
-- revenue-os-maintenance requireAuthorized checks profiles.is_admin
-- but the column didn't exist, causing every admin "Run now" to 401.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Add column (safe to run even if it already exists)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Owner-controlled manual script only. In the same SQL Editor execution,
-- set app.tally_owner_user_id to the reviewed auth.users UUID first.
DO $owner$
DECLARE
  v_owner_id text := current_setting('app.tally_owner_user_id', true);
BEGIN
  IF v_owner_id IS NULL OR v_owner_id !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'Set app.tally_owner_user_id to the reviewed owner UUID before this script';
  END IF;
  UPDATE public.profiles SET is_admin = true WHERE id = v_owner_id::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewed owner profile was not found';
  END IF;
END;
$owner$;

-- RLS: admins can read their own profile (already covered by existing policies,
-- but we add is_admin to the select so the edge function can see it)
-- No new policy needed — service role key bypasses RLS in edge functions.
