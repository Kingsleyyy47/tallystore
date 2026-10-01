-- Only the exchange rate is a public SMM setting. Future settings must not
-- become anonymously readable just because they share this table.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'smm_settings'
      AND policyname = 'smm_settings_public_read' AND cmd = 'SELECT'
      AND qual = 'true'
  ) OR EXISTS (
    SELECT 1 FROM public.smm_settings WHERE key <> 'usd_ngn_rate'
  ) THEN
    RAISE EXCEPTION 'Unexpected public SMM settings; review before narrowing';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'revenue_identity_links'
        AND policyname IN (
          'Clients can insert own identity links',
          'Clients can select own identity links',
          'Clients can update own identity links'
        ) AND (COALESCE(qual, '') || COALESCE(with_check, ''))
          LIKE '%user_id IS NULL%') <> 3
  THEN
    RAISE EXCEPTION 'Unexpected nullable identity-link policies';
  END IF;
END;
$guard$;

DROP POLICY smm_settings_public_read ON public.smm_settings;
CREATE POLICY smm_settings_public_read ON public.smm_settings
  FOR SELECT TO anon, authenticated USING (key = 'usd_ngn_rate');
CREATE POLICY smm_settings_active_admin_read ON public.smm_settings
  FOR SELECT TO authenticated USING (public.is_admin_profile());
REVOKE ALL ON TABLE public.smm_settings FROM anon;
GRANT SELECT ON TABLE public.smm_settings TO anon;

DROP POLICY "Clients can insert own identity links" ON public.revenue_identity_links;
DROP POLICY "Clients can select own identity links" ON public.revenue_identity_links;
DROP POLICY "Clients can update own identity links" ON public.revenue_identity_links;
REVOKE ALL ON TABLE public.revenue_identity_links FROM anon;
