-- Keep account/device/financial forensics unavailable to a suspended admin's
-- existing JWT, even if an extra permissive SELECT policy exists.
DO $patch$
DECLARE
  v_item record;
  v_missing text;
BEGIN
  IF to_regprocedure('public.is_admin_profile()') IS NULL THEN
    RAISE EXCEPTION 'forensic_active_admin_helper_missing';
  END IF;

  SELECT string_agg(item.table_name || '.' || item.policy_name, ', ')
    INTO v_missing
  FROM (VALUES
    ('fraud_device_bans', 'Admins can read fraud device bans'),
    ('profile_delete_audit', 'Admins can read profile delete audit'),
    ('auth_user_delete_audit', 'Admins can read auth user delete audit'),
    ('profile_balance_audit', 'Admins can read profile balance audit'),
    ('auth_user_identity_audit', 'Admins can read auth user identity audit'),
    ('profile_identity_audit', 'Admins can read profile identity audit'),
    ('profile_balance_blocked_attempts', 'Admins can read blocked profile balance attempts')
  ) item(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = item.table_name
      AND p.policyname = item.policy_name AND p.cmd = 'SELECT'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'forensic_admin_read_policy_missing: %', v_missing;
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('fraud_device_bans', 'Admins can read fraud device bans'),
      ('profile_delete_audit', 'Admins can read profile delete audit'),
      ('auth_user_delete_audit', 'Admins can read auth user delete audit'),
      ('profile_balance_audit', 'Admins can read profile balance audit'),
      ('auth_user_identity_audit', 'Admins can read auth user identity audit'),
      ('profile_identity_audit', 'Admins can read profile identity audit'),
      ('profile_balance_blocked_attempts', 'Admins can read blocked profile balance attempts')
    ) item(table_name, policy_name)
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_admin_profile())',
      v_item.policy_name, v_item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS forensic_active_admin_limit ON public.%I',
      v_item.table_name);
    EXECUTE format(
      'CREATE POLICY forensic_active_admin_limit ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.is_admin_profile())',
      v_item.table_name
    );
  END LOOP;
END;
$patch$;
