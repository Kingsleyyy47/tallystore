-- Contract phase: deploy with the browser build that selects only safe SMS
-- history columns. Keep provider payloads and historical raw errors server-only.
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.sms_orders') IS NULL THEN
    RAISE EXCEPTION 'sms_order_privacy_required_table_missing';
  END IF;

  SELECT string_agg(required.name, ', ')
  INTO v_missing
  FROM unnest(ARRAY[
    'id', 'user_id', 'reference', 'order_type', 'service_id',
    'service_name', 'phone_number', 'country_code', 'price_ngn',
    'status', 'messages', 'created_at', 'completed_at', 'cancelled_at',
    'refunded_at', 'refund_amount_ngn'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.sms_orders'::regclass
      AND a.attname = required.name AND a.attnum > 0 AND NOT a.attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'sms_order_privacy_required_columns_missing: %', v_missing;
  END IF;
END;
$preflight$;

ALTER TABLE public.sms_orders ENABLE ROW LEVEL SECURITY;

-- An existing permissive policy cannot widen the authenticated read scope.
DROP POLICY IF EXISTS sms_orders_customer_admin_read_limit ON public.sms_orders;
CREATE POLICY sms_orders_customer_admin_read_limit ON public.sms_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

DROP POLICY IF EXISTS sms_orders_customer_admin_read ON public.sms_orders;
CREATE POLICY sms_orders_customer_admin_read ON public.sms_orders
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

REVOKE ALL ON TABLE public.sms_orders FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.sms_orders'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL (%I) ON TABLE public.sms_orders FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$columns$;

GRANT SELECT (
  id, user_id, reference, order_type, service_id, service_name,
  phone_number, country_code, price_ngn, status, messages,
  created_at, completed_at, cancelled_at, refunded_at, refund_amount_ngn
) ON TABLE public.sms_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sms_orders TO service_role;
