-- Automatically suspend customer accounts when completed wallet spending exceeds
-- trusted wallet credits. Admin/staff accounts are excluded; only an admin action
-- should reinstate a suspended account.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid,
  ADD COLUMN IF NOT EXISTS suspension_reinstated_at timestamptz,
  ADD COLUMN IF NOT EXISTS reinstated_by uuid;

REVOKE UPDATE (
  account_suspended,
  suspension_reason,
  suspended_at,
  suspended_by,
  suspension_reinstated_at,
  reinstated_by
) ON TABLE public.profiles FROM anon, authenticated;

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
  completed_spend numeric := 0;
  completed_refunds numeric := 0;
  net_spend numeric := 0;
  should_suspend boolean := false;
  reason_text text;
BEGIN
  SELECT id, is_admin, is_staff, account_suspended
    INTO profile_row
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF COALESCE(profile_row.is_admin, false) OR COALESCE(profile_row.is_staff, false) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'staff_or_admin');
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO trusted_credits
  FROM public.transactions
  WHERE user_id = target_user_id
    AND COALESCE(status, 'completed') = 'completed'
    AND type IN ('topup', 'admin_credit', 'staff_credit', 'referral_withdrawal');

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO completed_spend
  FROM public.transactions
  WHERE user_id = target_user_id
    AND COALESCE(status, 'completed') = 'completed'
    AND type = 'purchase';

  SELECT COALESCE(SUM(amount), 0)
    INTO completed_refunds
  FROM public.transactions
  WHERE user_id = target_user_id
    AND COALESCE(status, 'completed') = 'completed'
    AND type = 'refund';

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
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'suspended', should_suspend,
    'trusted_credits', trusted_credits,
    'completed_spend', completed_spend,
    'completed_refunds', completed_refunds,
    'net_spend', net_spend
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.status, 'completed') = 'completed'
     AND NEW.type IN ('topup', 'admin_credit', 'staff_credit', 'referral_withdrawal', 'purchase', 'refund') THEN
    PERFORM public.evaluate_customer_ledger_suspension(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evaluate_customer_ledger_suspension_insert ON public.transactions;
CREATE TRIGGER trg_evaluate_customer_ledger_suspension_insert
AFTER INSERT ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.evaluate_customer_ledger_suspension_from_transaction();

DROP TRIGGER IF EXISTS trg_evaluate_customer_ledger_suspension_update ON public.transactions;
CREATE TRIGGER trg_evaluate_customer_ledger_suspension_update
AFTER UPDATE OF status, type, amount ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.evaluate_customer_ledger_suspension_from_transaction();

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
