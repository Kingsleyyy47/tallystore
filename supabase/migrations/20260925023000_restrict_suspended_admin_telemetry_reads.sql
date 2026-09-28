-- Fraud/identity telemetry must not remain readable by a suspended admin's
-- existing JWT. Customer self-link writes are unchanged.
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.is_admin_profile()') IS NULL THEN
    RAISE EXCEPTION 'telemetry_active_admin_helper_missing';
  END IF;

  SELECT string_agg(required.table_name || '.' || required.policy_name, ', ')
    INTO v_missing
  FROM (VALUES
    ('site_visits', 'Admins can read site visits'),
    ('revenue_identity_links', 'Admins can read revenue identity links')
  ) required(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = required.table_name
      AND p.policyname = required.policy_name AND p.cmd = 'SELECT'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'telemetry_admin_read_policy_missing: %', v_missing;
  END IF;
END;
$preflight$;

ALTER POLICY "Admins can read site visits" ON public.site_visits
  USING (public.is_admin_profile());
DROP POLICY IF EXISTS site_visits_active_admin_limit ON public.site_visits;
CREATE POLICY site_visits_active_admin_limit ON public.site_visits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_admin_profile());

ALTER POLICY "Admins can read revenue identity links"
  ON public.revenue_identity_links
  USING (public.is_admin_profile());
DROP POLICY IF EXISTS revenue_identity_links_own_read
  ON public.revenue_identity_links;
CREATE POLICY revenue_identity_links_own_read
  ON public.revenue_identity_links
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS revenue_identity_links_active_admin_limit
  ON public.revenue_identity_links;
CREATE POLICY revenue_identity_links_active_admin_limit
  ON public.revenue_identity_links
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_admin_profile() OR user_id = auth.uid());
