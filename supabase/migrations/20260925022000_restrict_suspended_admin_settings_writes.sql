-- A suspended administrator must not write operational/payment or SMS prices
-- directly through PostgREST. Keep the storefront's public key reads intact.
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.is_admin_profile()') IS NULL THEN
    RAISE EXCEPTION 'settings_active_admin_helper_missing';
  END IF;

  SELECT string_agg(required.table_name || '.' || required.policy_name, ', ')
    INTO v_missing
  FROM (VALUES
    ('app_settings', 'app_settings_admin_write', 'ALL'),
    ('sms_product_settings', 'sms_product_settings_admin_select', 'SELECT'),
    ('sms_product_settings', 'sms_product_settings_admin_write', 'ALL')
  ) required(table_name, policy_name, policy_command)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = required.table_name
      AND p.policyname = required.policy_name
      AND p.cmd = required.policy_command
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'settings_admin_policy_missing: %', v_missing;
  END IF;
END;
$preflight$;

ALTER POLICY app_settings_admin_write ON public.app_settings
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

DROP POLICY IF EXISTS app_settings_active_admin_insert ON public.app_settings;
CREATE POLICY app_settings_active_admin_insert ON public.app_settings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_profile());

DROP POLICY IF EXISTS app_settings_active_admin_update ON public.app_settings;
CREATE POLICY app_settings_active_admin_update ON public.app_settings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

ALTER POLICY sms_product_settings_admin_select ON public.sms_product_settings
  USING (public.is_admin_profile());

ALTER POLICY sms_product_settings_admin_write ON public.sms_product_settings
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

DROP POLICY IF EXISTS sms_product_settings_active_admin_limit
  ON public.sms_product_settings;
CREATE POLICY sms_product_settings_active_admin_limit
  ON public.sms_product_settings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());
