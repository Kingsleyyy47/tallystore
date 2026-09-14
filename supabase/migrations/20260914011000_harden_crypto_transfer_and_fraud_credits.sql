-- Treat completed crypto-sale credits as legitimate customer funding in fraud
-- checks, and make crypto-to-wallet transfers server-authoritative.

ALTER TABLE IF EXISTS public.crypto_transactions
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check CHECK (
    type IN (
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'wallet_deposit',
      'purchase',
      'refund',
      'admin_credit',
      'admin_debit',
      'staff_credit',
      'referral_withdrawal',
      'crypto_transfer'
    )
  );

CREATE OR REPLACE FUNCTION public.transfer_crypto_to_wallet(
  p_user_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row record;
  transfer_amount numeric := round(p_amount::numeric, 2);
  next_crypto_balance numeric;
  next_wallet_balance numeric;
  transfer_reference text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized to transfer this balance';
  END IF;

  IF transfer_amount IS NULL OR transfer_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  SELECT id, crypto_balance, wallet_balance, account_suspended
    INTO profile_row
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;

  IF COALESCE(profile_row.account_suspended, false) THEN
    RAISE EXCEPTION 'Account is suspended';
  END IF;

  IF COALESCE(profile_row.crypto_balance, 0) < transfer_amount THEN
    RAISE EXCEPTION 'Insufficient crypto balance';
  END IF;

  next_crypto_balance := COALESCE(profile_row.crypto_balance, 0) - transfer_amount;
  next_wallet_balance := COALESCE(profile_row.wallet_balance, 0) + transfer_amount;
  transfer_reference := 'CRYPTO-TRANSFER-' || upper(substr(md5(p_user_id::text || clock_timestamp()::text || random()::text), 1, 24));

  INSERT INTO public.transactions (
    user_id,
    type,
    amount,
    status,
    balance_after,
    description,
    reference
  ) VALUES (
    p_user_id,
    'crypto_transfer',
    transfer_amount,
    'completed',
    next_wallet_balance,
    'Crypto balance transfer to wallet',
    transfer_reference
  );

  UPDATE public.profiles
    SET crypto_balance = next_crypto_balance,
        wallet_balance = next_wallet_balance,
        updated_at = now()
    WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'amount', transfer_amount,
    'crypto_balance', next_crypto_balance,
    'wallet_balance', next_wallet_balance,
    'reference', transfer_reference
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_crypto_to_wallet(uuid, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transfer_crypto_to_wallet(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension(
  target_user_id uuid,
  tolerance_ngn numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row record;
  trusted_credits numeric := 0;
  crypto_credits numeric := 0;
  completed_spend numeric := 0;
  completed_refunds numeric := 0;
  net_spend numeric := 0;
  should_suspend boolean := false;
  reason_text text;
BEGIN
  SELECT id, is_admin, is_staff, account_suspended, suspension_reason
    INTO profile_row
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF COALESCE(profile_row.is_admin, false) OR COALESCE(profile_row.is_staff, false) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'staff_or_admin');
  END IF;

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO trusted_credits
  FROM public.transactions
  WHERE user_id = target_user_id
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    AND lower(COALESCE(type, '')) IN (
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'wallet_deposit',
      'deposit',
      'credit',
      'admin_credit',
      'staff_credit',
      'referral_withdrawal'
    );

  SELECT COALESCE(SUM(ABS(naira_amount)), 0)
    INTO crypto_credits
  FROM public.crypto_transactions
  WHERE user_id = target_user_id
    AND credited_at IS NOT NULL
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'credited', 'paid', 'finished')
    AND lower(COALESCE(transaction_type, 'sell')) IN ('sell', 'crypto_sell', 'deposit', 'crypto_deposit');

  trusted_credits := trusted_credits + crypto_credits;

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO completed_spend
  FROM public.transactions
  WHERE user_id = target_user_id
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'success', 'successful', 'complete', 'paid', 'finished')
    AND lower(COALESCE(type, '')) = 'purchase';

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO completed_refunds
  FROM public.transactions
  WHERE user_id = target_user_id
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    AND lower(COALESCE(type, '')) = 'refund';

  net_spend := GREATEST(completed_spend - completed_refunds, 0);
  should_suspend := net_spend > trusted_credits + tolerance_ngn;

  IF should_suspend THEN
    reason_text := format(
      'Auto-suspended: completed wallet spend %s exceeds trusted credits %s by %s',
      net_spend,
      trusted_credits,
      net_spend - trusted_credits
    );

    UPDATE public.profiles
      SET account_suspended = true,
          suspension_reason = reason_text,
          suspended_at = COALESCE(suspended_at, now()),
          suspended_by = NULL,
          updated_at = now()
      WHERE id = target_user_id
        AND COALESCE(account_suspended, false) = false;
  ELSIF COALESCE(profile_row.account_suspended, false)
        AND COALESCE(profile_row.suspension_reason, '') LIKE 'Auto-suspended:%' THEN
    UPDATE public.profiles
      SET account_suspended = false,
          suspension_reason = NULL,
          suspension_reinstated_at = now(),
          reinstated_by = NULL,
          updated_at = now()
      WHERE id = target_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'suspended', should_suspend,
    'trusted_credits', trusted_credits,
    'crypto_credits', crypto_credits,
    'completed_spend', completed_spend,
    'completed_refunds', completed_refunds,
    'net_spend', net_spend
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension_from_crypto_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NEW.credited_at IS NOT NULL
     AND lower(COALESCE(NEW.transaction_type, 'sell')) IN ('sell', 'crypto_sell', 'deposit', 'crypto_deposit') THEN
    PERFORM public.evaluate_customer_ledger_suspension(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evaluate_customer_ledger_suspension_crypto ON public.crypto_transactions;
CREATE TRIGGER trg_evaluate_customer_ledger_suspension_crypto
AFTER INSERT OR UPDATE OF status, credited_at, naira_amount ON public.crypto_transactions
FOR EACH ROW
EXECUTE FUNCTION public.evaluate_customer_ledger_suspension_from_crypto_transaction();

DO $$
DECLARE
  customer record;
BEGIN
  FOR customer IN
    SELECT id
    FROM public.profiles
    WHERE COALESCE(is_admin, false) = false
      AND COALESCE(is_staff, false) = false
  LOOP
    PERFORM public.evaluate_customer_ledger_suspension(customer.id);
  END LOOP;
END $$;
