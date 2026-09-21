-- Enforce exact, bounded wallet money values for new financial writes.
--
-- These constraints are NOT VALID so historical incident evidence remains
-- queryable until it is reviewed. PostgreSQL still enforces NOT VALID CHECK
-- constraints for new and updated rows.

DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.transactions'::regclass
        AND conname = 'transactions_amount_money_bounds'
    ) THEN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_amount_money_bounds
        CHECK (
          amount IS NOT NULL
          AND amount::text <> 'NaN'
          AND amount <> 0
          AND amount = round(amount, 2)
          AND abs(amount) <= 1000000000
        ) NOT VALID;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.transactions'::regclass
        AND conname = 'transactions_balance_snapshot_money_bounds'
    ) THEN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_balance_snapshot_money_bounds
        CHECK (
          (balance_before IS NULL OR (
            balance_before::text <> 'NaN'
            AND balance_before = round(balance_before, 2)
            AND abs(balance_before) <= 1000000000
          ))
          AND
          (balance_after IS NULL OR (
            balance_after::text <> 'NaN'
            AND balance_after = round(balance_after, 2)
            AND abs(balance_after) <= 1000000000
          ))
        ) NOT VALID;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.transactions'::regclass
        AND conname = 'transactions_currency_code_bounds'
    ) THEN
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_currency_code_bounds
        CHECK (
          currency IS NOT NULL
          AND currency = upper(currency)
          AND currency ~ '^[A-Z]{3,8}$'
        ) NOT VALID;
    END IF;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_balance_money_bounds'
    ) THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_balance_money_bounds
        CHECK (
          (wallet_balance IS NULL OR (
            wallet_balance::text <> 'NaN'
            AND wallet_balance = round(wallet_balance, 2)
            AND abs(wallet_balance) <= 1000000000
          ))
          AND
          (crypto_balance IS NULL OR (
            crypto_balance::text <> 'NaN'
            AND crypto_balance = round(crypto_balance, 2)
            AND abs(crypto_balance) <= 1000000000
          ))
          AND
          (referral_balance IS NULL OR (
            referral_balance::text <> 'NaN'
            AND referral_balance = round(referral_balance, 2)
            AND abs(referral_balance) <= 1000000000
          ))
        ) NOT VALID;
    END IF;
  END IF;
END $$;
