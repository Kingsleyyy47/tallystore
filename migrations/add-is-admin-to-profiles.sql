-- ============================================================
-- Fix: Add is_admin column to profiles + mark the owner account
-- revenue-os-maintenance requireAuthorized checks profiles.is_admin
-- but the column didn't exist, causing every admin "Run now" to 401.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Add column (safe to run even if it already exists)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Mark the owner account as admin
UPDATE public.profiles
SET is_admin = true
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'wisdomthedev@gmail.com' LIMIT 1
);

-- RLS: admins can read their own profile (already covered by existing policies,
-- but we add is_admin to the select so the edge function can see it)
-- No new policy needed — service role key bypasses RLS in edge functions.
