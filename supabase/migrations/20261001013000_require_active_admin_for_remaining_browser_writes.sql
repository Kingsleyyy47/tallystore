-- Legacy write policies checked the admin flag but ignored suspension.
-- Keep public read policies intact and use the current active-admin predicate
-- for the remaining browser-writable operational and catalog tables.
DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM (VALUES
    ('broadcast_jobs', 'admins_manage_broadcast_jobs', 'ALL'),
    ('categories', 'categories_admin_delete', 'DELETE'),
    ('categories', 'categories_admin_insert', 'INSERT'),
    ('categories', 'categories_admin_update', 'UPDATE'),
    ('crypto_exchange_rates', 'crypto_rates_admin_insert', 'INSERT'),
    ('crypto_exchange_rates', 'crypto_rates_admin_update', 'UPDATE'),
    ('product_suggestions', 'Admin can manage product suggestions', 'ALL'),
    ('smm_settings', 'smm_settings_admin_update', 'UPDATE')
  ) AS expected(tablename, policyname, cmd)
  JOIN pg_policies p ON p.schemaname = 'public'
    AND p.tablename = expected.tablename
    AND p.policyname = expected.policyname
    AND p.cmd = expected.cmd
    AND p.permissive = 'PERMISSIVE'
  WHERE (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
    LIKE '%is_admin = true%';

  IF v_count <> 8 THEN
    RAISE EXCEPTION 'Unexpected legacy admin write policies: % of 8 found', v_count;
  END IF;
END;
$guard$;

DROP POLICY "admins_manage_broadcast_jobs" ON public.broadcast_jobs;
CREATE POLICY "admins_manage_broadcast_jobs" ON public.broadcast_jobs
  FOR ALL TO authenticated
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

DROP POLICY "categories_admin_delete" ON public.categories;
CREATE POLICY "categories_admin_delete" ON public.categories
  FOR DELETE TO authenticated USING (public.is_admin_profile());
DROP POLICY "categories_admin_insert" ON public.categories;
CREATE POLICY "categories_admin_insert" ON public.categories
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_profile());
DROP POLICY "categories_admin_update" ON public.categories;
CREATE POLICY "categories_admin_update" ON public.categories
  FOR UPDATE TO authenticated
  USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile());

DROP POLICY "crypto_rates_admin_insert" ON public.crypto_exchange_rates;
CREATE POLICY "crypto_rates_admin_insert" ON public.crypto_exchange_rates
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_profile());
DROP POLICY "crypto_rates_admin_update" ON public.crypto_exchange_rates;
CREATE POLICY "crypto_rates_admin_update" ON public.crypto_exchange_rates
  FOR UPDATE TO authenticated
  USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile());

DROP POLICY "Admin can manage product suggestions" ON public.product_suggestions;
CREATE POLICY "Admin can manage product suggestions" ON public.product_suggestions
  FOR ALL TO authenticated
  USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile());

DROP POLICY "smm_settings_admin_update" ON public.smm_settings;
CREATE POLICY "smm_settings_admin_update" ON public.smm_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile());
