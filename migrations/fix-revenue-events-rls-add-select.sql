-- ============================================================
-- Fix: Add SELECT policy to revenue_events
-- PostgREST upsert needs SELECT permission for RETURNING clause.
-- Revenue events are behavioural telemetry (not financial), so it's
-- safe to let each user read events tied to their own account.
-- Run in Supabase SQL Editor.
-- ============================================================

DROP POLICY IF EXISTS "Clients can select own revenue events" ON public.revenue_events;

CREATE POLICY "Clients can select own revenue events"
ON public.revenue_events
FOR SELECT
USING (
  auth.uid() = user_id
  OR user_id IS NULL
);
