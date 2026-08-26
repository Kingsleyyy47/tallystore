-- ============================================================
-- Fix: RLS policies for revenue_events and cro_interventions
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. revenue_events: add UPDATE policy to match the INSERT policy ──────────
-- The hardening migration (021000) added a FOR INSERT policy but forgot UPDATE.
-- Upserts (ON CONFLICT DO UPDATE) require both INSERT and UPDATE policies.

DROP POLICY IF EXISTS "Clients can update non-financial revenue events" ON public.revenue_events;

CREATE POLICY "Clients can update non-financial revenue events"
ON public.revenue_events
FOR UPDATE
USING (user_id IS NULL OR auth.uid() = user_id)
WITH CHECK (
  (user_id IS NULL OR auth.uid() = user_id)
  AND coalesce(metadata->>'authoritative', 'false') <> 'true'
  AND coalesce(metadata->>'server_authoritative', 'false') <> 'true'
  AND event_type NOT IN (
    'PAYMENT_STARTED',
    'PAYMENT_ATTEMPTED',
    'PAYMENT_COMPLETED',
    'PRODUCT_PURCHASED',
    'PRODUCT_PURCHASE_REVERSED',
    'SMS_ORDER_CANCELLED',
    'SMS_ORDER_COMPLETED',
    'SMS_ORDER_REFUNDED'
  )
);

-- ── 2. cro_interventions: add client INSERT + UPDATE policies ─────────────────
-- The table was created with RLS enabled but no policies for browser clients.
-- createCroIntervention / markInterventionViewed / etc. need INSERT + UPDATE.

DROP POLICY IF EXISTS "Clients can insert own cro interventions" ON public.cro_interventions;
DROP POLICY IF EXISTS "Clients can update own cro interventions" ON public.cro_interventions;

CREATE POLICY "Clients can insert own cro interventions"
ON public.cro_interventions
FOR INSERT
WITH CHECK (
  customer_id IS NULL OR auth.uid() = customer_id
);

CREATE POLICY "Clients can update own cro interventions"
ON public.cro_interventions
FOR UPDATE
USING (customer_id IS NULL OR auth.uid() = customer_id)
WITH CHECK (customer_id IS NULL OR auth.uid() = customer_id);

-- Allow clients to read their own interventions (needed for attribution lookups)
DROP POLICY IF EXISTS "Clients can read own cro interventions" ON public.cro_interventions;

CREATE POLICY "Clients can read own cro interventions"
ON public.cro_interventions
FOR SELECT
USING (customer_id IS NULL OR auth.uid() = customer_id);
