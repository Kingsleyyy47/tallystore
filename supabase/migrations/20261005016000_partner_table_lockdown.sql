-- The original partner schema gave every authenticated admin direct table writes.
-- Those grants bypass owner review, credit decisions, and order journals.
-- Partner administration now runs through service-role Edge functions and
-- owner-checked RPCs only. The Edge admin list returns redacted records.
REVOKE ALL ON TABLE public.api_partners FROM authenticated;
REVOKE ALL ON TABLE public.api_partner_keys FROM authenticated;
REVOKE ALL ON TABLE public.api_partner_orders FROM authenticated;
REVOKE ALL ON TABLE public.api_partner_logs FROM authenticated;

DROP POLICY IF EXISTS "api_partners_admin_all" ON public.api_partners;
DROP POLICY IF EXISTS "api_partner_keys_admin_all" ON public.api_partner_keys;
DROP POLICY IF EXISTS "api_partner_orders_admin_all" ON public.api_partner_orders;
DROP POLICY IF EXISTS "api_partner_logs_admin_all" ON public.api_partner_logs;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_partners TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_partner_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_partner_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_partner_logs TO service_role;
