-- Provider verification evidence is internal. RLS does not constrain TRUNCATE;
-- an earlier migration revoked row writes but left broader table grants possible.
DO $preflight$
BEGIN
  IF to_regclass('public.pocketfi_webhook_logs') IS NULL THEN
    RAISE EXCEPTION 'pocketfi_webhook_logs_required_for_payment_evidence';
  END IF;
END;
$preflight$;

ALTER TABLE public.pocketfi_webhook_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pocketfi_webhook_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pocketfi_webhook_logs TO service_role;

DROP POLICY IF EXISTS "Service role has full access" ON public.pocketfi_webhook_logs;
