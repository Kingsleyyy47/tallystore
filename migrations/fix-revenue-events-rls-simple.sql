-- ============================================================
-- Fix: Simplify revenue_events RLS so client events actually record
-- The previous policy was too restrictive (auth.uid() check failed
-- for many valid cases). This replaces it with a simple rule:
-- block payment/financial events from the client, allow all others.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Drop all existing client-side revenue_events policies
DROP POLICY IF EXISTS "Anyone can record revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can record own revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can record non-financial revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can update non-financial revenue events" ON public.revenue_events;

-- Simple INSERT: allow any session (anon or authenticated) to record
-- behavioural telemetry, but block payment/order outcome events which
-- must only be written by server-side edge functions.
CREATE POLICY "Clients can record non-financial revenue events"
ON public.revenue_events
FOR INSERT
WITH CHECK (
  event_type NOT IN (
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

-- UPDATE: needed for upsert ON CONFLICT DO UPDATE paths (ignoreDuplicates=false cases)
CREATE POLICY "Clients can update non-financial revenue events"
ON public.revenue_events
FOR UPDATE
USING (true)
WITH CHECK (
  event_type NOT IN (
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
