-- Balance movement must be performed by database functions/edge functions.
-- Browser clients should not be able to forge transfer-log rows.

DO $$
BEGIN
  IF to_regclass('public.balance_transfers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.balance_transfers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.balance_transfers FROM anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own balance transfers" ON public.balance_transfers';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert balance transfers" ON public.balance_transfers';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert balance transfers" ON public.balance_transfers';
  END IF;
END $$;
