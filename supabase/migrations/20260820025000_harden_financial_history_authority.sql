-- Financial history and reward balances are server-authoritative. Keep customer
-- reads through existing RLS policies, but prevent browser clients from
-- creating or mutating rows/columns that affect balances, deposits, or rewards.

DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert transactions" ON public.transactions';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON public.transactions';
  END IF;

  IF to_regclass('public.referral_earnings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.referral_earnings FROM anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own referral earnings" ON public.referral_earnings';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert referral earnings" ON public.referral_earnings';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert referral earnings" ON public.referral_earnings';
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'wallet_balance'
    ) THEN
      EXECUTE 'REVOKE UPDATE (wallet_balance) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'crypto_balance'
    ) THEN
      EXECUTE 'REVOKE UPDATE (crypto_balance) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'referral_balance'
    ) THEN
      EXECUTE 'REVOKE UPDATE (referral_balance) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'referred_by'
    ) THEN
      EXECUTE 'REVOKE UPDATE (referred_by) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_admin'
    ) THEN
      EXECUTE 'REVOKE UPDATE (is_admin) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_staff'
    ) THEN
      EXECUTE 'REVOKE UPDATE (is_staff) ON TABLE public.profiles FROM anon, authenticated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'referral_code'
    ) THEN
      EXECUTE 'REVOKE UPDATE (referral_code) ON TABLE public.profiles FROM anon, authenticated';
    END IF;
  END IF;
END $$;
