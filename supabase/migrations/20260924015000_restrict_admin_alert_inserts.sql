-- Browser sessions may read/acknowledge alerts as admins, but cannot create
-- purported system or security alerts. Edge Functions use service_role.
DO $preflight$
BEGIN
  IF to_regclass('public.admin_alerts') IS NULL THEN
    RAISE EXCEPTION 'admin_alerts must exist before restricting inserts';
  END IF;
END;
$preflight$;

DROP POLICY IF EXISTS "Allow insert via service role" ON public.admin_alerts;
REVOKE INSERT, DELETE, TRUNCATE ON public.admin_alerts
  FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.admin_alerts TO service_role;
