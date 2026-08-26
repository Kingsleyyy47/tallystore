-- Several older migrations attempted to create "service role only" policies
-- using USING (true). In PostgREST/Supabase RLS, that is not service-role-only;
-- it is a permissive policy. The service role bypasses RLS without these.

DO $$
BEGIN
  IF to_regclass('public.pocketfi_webhook_logs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pocketfi_webhook_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON public.pocketfi_webhook_logs FROM anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "Service role has full access" ON public.pocketfi_webhook_logs';
  END IF;

  IF to_regclass('public.bitrefill_orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bitrefill_orders ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.bitrefill_orders FROM anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "Service role has full access to bitrefill orders" ON public.bitrefill_orders';
  END IF;
END $$;
