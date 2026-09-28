-- Browser revenue telemetry must not remain visible across customers after
-- the administrator's account has been suspended.
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
    ('revenue_events', 'Admins can read revenue events'),
    ('cro_decision_audit', 'Admins can read cro decisions')
  ) required(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = required.table_name
      AND p.policyname = required.policy_name
      AND p.cmd = 'SELECT'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'active_admin_revenue_policy_missing: %', v_missing;
  END IF;
END;
$preflight$;

ALTER POLICY "Admins can read revenue events" ON public.revenue_events
  USING (public.is_admin_profile());

DROP POLICY IF EXISTS revenue_events_active_admin_or_owner_limit ON public.revenue_events;
CREATE POLICY revenue_events_active_admin_or_owner_limit ON public.revenue_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

ALTER POLICY "Admins can read cro decisions" ON public.cro_decision_audit
  USING (public.is_admin_profile());

DROP POLICY IF EXISTS cro_decision_audit_active_admin_limit ON public.cro_decision_audit;
CREATE POLICY cro_decision_audit_active_admin_limit ON public.cro_decision_audit
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_admin_profile());

REVOKE SELECT ON public.revenue_events, public.cro_decision_audit
  FROM PUBLIC, anon;
DO $columns$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['revenue_events', 'cro_decision_audit'] LOOP
    FOR v_column IN
      SELECT a.attname
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = format('public.%I', v_table)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I) ON public.%I FROM PUBLIC, anon',
        v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$columns$;
