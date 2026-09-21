-- Fraud ledger convention:
-- - purchases are spend
-- - deposits/admin credits/staff credits/referral withdrawals/credited crypto are trusted external credits
-- - refunds are not external credits; they offset matching purchase spend

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

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO completed_refunds
  FROM public.transactions
  WHERE user_id = target_user_id
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    AND lower(COALESCE(type, '')) IN ('refund', 'purchase_refund', 'auto_refund');

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

  net_spend := GREATEST(completed_spend - completed_refunds, 0);
  should_suspend := net_spend > trusted_credits + tolerance_ngn;

  IF should_suspend THEN
    reason_text := format(
      'Auto-suspended: net completed wallet spend %s exceeds trusted external credits %s by %s',
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
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'suspended', should_suspend,
    'trusted_credits', trusted_credits,
    'crypto_credits', crypto_credits,
    'completed_refunds', completed_refunds,
    'completed_spend', completed_spend,
    'net_spend', net_spend
  );
END;
$$;

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
