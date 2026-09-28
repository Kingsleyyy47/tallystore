-- An existing admin session must lose fraud-alert reads and acknowledgements
-- when that account is suspended. A restrictive policy bounds any additional
-- permissive SELECT/UPDATE policy present on this table.
DO $preflight$
DECLARE
  v_missing text;
  v_policy_count integer;
BEGIN
  IF to_regclass('public.admin_alerts') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'admin_alert_active_reader_dependency_missing';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'admin_alerts';
  IF v_policy_count = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = 'public.admin_alerts'::regclass AND relrowsecurity
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = 'public.is_admin_profile()'::regprocedure
        AND prosecdef
        AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(oid),
          'NOT COALESCE(p.account_suspended, false)') > 0
        AND EXISTS (
          SELECT 1 FROM unnest(proconfig) AS setting
          WHERE setting IN ('search_path=', 'search_path=""')
        )
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.admin_alerts'::regclass
        AND tgname = 'trg_guard_admin_alert_acknowledgement'
        AND NOT tgisinternal
    ) OR has_table_privilege('authenticated', 'public.admin_alerts', 'UPDATE')
      OR NOT has_column_privilege('authenticated', 'public.admin_alerts', 'acknowledged', 'UPDATE')
    THEN
      RAISE EXCEPTION 'zero-policy admin alerts requires RLS, active-admin helper, and acknowledgement-only guard';
    END IF;
    RETURN;
  END IF;

  SELECT string_agg(required.policy_name, ', ')
    INTO v_missing
  FROM (VALUES
    ('Admins can view all alerts', 'SELECT'),
    ('Admins can update alerts', 'UPDATE')
  ) required(policy_name, policy_command)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'admin_alerts'
      AND p.policyname = required.policy_name
      AND p.cmd = required.policy_command
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'admin_alert_active_policy_missing: %', v_missing;
  END IF;
END;
$preflight$;

DO $policies$
DECLARE
  v_policy_count integer;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'admin_alerts';
  IF v_policy_count = 0 THEN
    EXECUTE 'CREATE POLICY "Admins can view all alerts" ON public.admin_alerts '
      || 'FOR SELECT TO authenticated USING (public.is_admin_profile())';
    EXECUTE 'CREATE POLICY "Admins can update alerts" ON public.admin_alerts '
      || 'FOR UPDATE TO authenticated USING (public.is_admin_profile()) '
      || 'WITH CHECK (public.is_admin_profile())';
  ELSE
    EXECUTE 'ALTER POLICY "Admins can view all alerts" ON public.admin_alerts '
      || 'USING (public.is_admin_profile())';
    EXECUTE 'ALTER POLICY "Admins can update alerts" ON public.admin_alerts '
      || 'USING (public.is_admin_profile()) '
      || 'WITH CHECK (public.is_admin_profile())';
  END IF;

  EXECUTE 'REVOKE SELECT ON TABLE public.admin_alerts FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON TABLE public.admin_alerts TO authenticated';
  EXECUTE 'DROP POLICY IF EXISTS admin_alerts_active_admin_limit ON public.admin_alerts';
  EXECUTE 'CREATE POLICY admin_alerts_active_admin_limit ON public.admin_alerts '
    || 'AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile())';
END;
$policies$;
