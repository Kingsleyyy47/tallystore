-- Keep behavioural telemetry client-writable, but require financial/order
-- outcome events to be written by service-role edge functions.

DROP POLICY IF EXISTS "Anyone can record revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can record own revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can record non-financial revenue events" ON public.revenue_events;

CREATE POLICY "Clients can record non-financial revenue events"
ON public.revenue_events
FOR INSERT
WITH CHECK (
  (user_id IS NULL OR auth.uid() = user_id)
  AND coalesce(metadata->>'authoritative', 'false') <> 'true'
  AND coalesce(metadata->>'server_authoritative', 'false') <> 'true'
  AND
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
