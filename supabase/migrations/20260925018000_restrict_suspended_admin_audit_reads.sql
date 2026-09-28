-- A suspended administrator must not retain cross-customer financial audit
-- or SMS history access through an already-issued authenticated session.
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.is_admin_profile()') IS NULL THEN
    RAISE EXCEPTION 'active_admin_reader_missing';
  END IF;

  SELECT string_agg(required.table_name || '.' || required.policy_name, ', ')
    INTO v_missing
  FROM (VALUES
    ('transaction_ledger_blocked_attempts', 'Admins can read transaction ledger blocked attempts'),
    ('wallet_security_events', 'Admins can read wallet security events'),
    ('sms_orders', 'sms_orders_customer_admin_read_limit'),
    ('sms_orders', 'sms_orders_customer_admin_read')
  ) required(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = required.table_name
      AND p.policyname = required.policy_name
      AND p.cmd = 'SELECT'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'active_admin_audit_policy_missing: %', v_missing;
  END IF;
END;
$preflight$;

ALTER POLICY "Admins can read transaction ledger blocked attempts"
  ON public.transaction_ledger_blocked_attempts
  USING (public.is_admin_profile());

ALTER POLICY "Admins can read wallet security events"
  ON public.wallet_security_events
  USING (public.is_admin_profile());

ALTER POLICY sms_orders_customer_admin_read_limit ON public.sms_orders
  USING (user_id = auth.uid() OR public.is_admin_profile());

ALTER POLICY sms_orders_customer_admin_read ON public.sms_orders
  USING (user_id = auth.uid() OR public.is_admin_profile());
