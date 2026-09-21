-- Partner API tables are managed through the admin-only partner-api Edge
-- Function. During the incident pause, browser roles should not be able to
-- read or write partner records, keys, orders, customer mappings, logs, or
-- webhook deliveries directly. Admin audit access goes through the Edge
-- Function service-role path.

DO $$
BEGIN
  IF to_regclass('public.api_partners') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partners FROM anon, authenticated;
  END IF;

  IF to_regclass('public.api_partner_keys') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partner_keys FROM anon, authenticated;
  END IF;

  IF to_regclass('public.api_partner_orders') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partner_orders FROM anon, authenticated;
  END IF;

  IF to_regclass('public.api_partner_logs') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partner_logs FROM anon, authenticated;
  END IF;

  IF to_regclass('public.api_partner_customers') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partner_customers FROM anon, authenticated;
  END IF;

  IF to_regclass('public.api_partner_webhook_deliveries') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partner_webhook_deliveries FROM anon, authenticated;
  END IF;
END $$;
