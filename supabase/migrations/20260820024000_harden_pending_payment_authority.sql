-- Pending payment recovery rows are payment authority data. Browsers can read
-- their own rows for status/recovery, but only service-role edge functions may
-- create or mutate them.

DO $$
BEGIN
  IF to_regclass('public.pending_payments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pending_payments ENABLE ROW LEVEL SECURITY';

    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.pending_payments FROM anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own pending payments" ON public.pending_payments';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own pending payments" ON public.pending_payments';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own pending payments" ON public.pending_payments';
    EXECUTE 'DROP POLICY IF EXISTS "Service role has full access" ON public.pending_payments';
  END IF;
END $$;
