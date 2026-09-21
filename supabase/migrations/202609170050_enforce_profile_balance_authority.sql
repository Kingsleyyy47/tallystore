-- Enforce wallet authority at the database boundary.
--
-- New customer profiles must start with zero balances. Balance changes made
-- directly from Supabase SQL/Table Editor or browser-authenticated clients are
-- neutralized and recorded. TallyStore server paths that run through the
-- service-role API remain allowed so purchases, refunds, verified deposits, and
-- approved admin adjustments continue to work.

ALTER TABLE public.profiles
  ALTER COLUMN wallet_balance SET DEFAULT 0;

ALTER TABLE public.profiles
  ALTER COLUMN crypto_balance SET DEFAULT 0;

ALTER TABLE public.profiles
  ALTER COLUMN referral_balance SET DEFAULT 0;

UPDATE public.profiles
SET
  wallet_balance = COALESCE(wallet_balance, 0),
  crypto_balance = COALESCE(crypto_balance, 0),
  referral_balance = COALESCE(referral_balance, 0)
WHERE wallet_balance IS NULL
   OR crypto_balance IS NULL
   OR referral_balance IS NULL;

CREATE TABLE IF NOT EXISTS public.profile_balance_blocked_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  email text,
  attempted_by uuid,
  attempted_role text,
  database_role text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  old_wallet_balance numeric,
  attempted_wallet_balance numeric,
  old_crypto_balance numeric,
  attempted_crypto_balance numeric,
  old_referral_balance numeric,
  attempted_referral_balance numeric,
  row_snapshot_old jsonb NOT NULL,
  row_snapshot_attempted jsonb NOT NULL
);

ALTER TABLE public.profile_balance_blocked_attempts ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.profile_balance_blocked_attempts FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read blocked profile balance attempts" ON public.profile_balance_blocked_attempts;
CREATE POLICY "Admins can read blocked profile balance attempts"
ON public.profile_balance_blocked_attempts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

ALTER TABLE public.profile_balance_audit
  ADD COLUMN IF NOT EXISTS request_role text,
  ADD COLUMN IF NOT EXISTS database_role text,
  ADD COLUMN IF NOT EXISTS approved_by_tallystore boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_profile_balance_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');
  database_role text := current_user;
  balance_changed boolean;
  is_authorized_server_path boolean;
  block_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.wallet_balance := 0;
    NEW.crypto_balance := 0;
    NEW.referral_balance := 0;
    RETURN NEW;
  END IF;

  balance_changed :=
    COALESCE(OLD.wallet_balance, 0) IS DISTINCT FROM COALESCE(NEW.wallet_balance, 0)
    OR COALESCE(OLD.crypto_balance, 0) IS DISTINCT FROM COALESCE(NEW.crypto_balance, 0)
    OR COALESCE(OLD.referral_balance, 0) IS DISTINCT FROM COALESCE(NEW.referral_balance, 0);

  IF NOT balance_changed THEN
    RETURN NEW;
  END IF;

  is_authorized_server_path :=
    request_role = 'service_role'
    AND database_role = 'authenticator';

  IF NOT is_authorized_server_path THEN
    block_reason := CASE
      WHEN database_role = 'postgres' THEN 'Blocked direct Supabase SQL/Table Editor balance edit. Use TallyStore Admin balance adjustment.'
      WHEN request_role IN ('anon', 'authenticated') THEN 'Blocked browser-authenticated balance edit. Balances are server-authoritative.'
      ELSE format('Blocked unapproved balance edit from database role %s and request role %s.', database_role, COALESCE(NULLIF(request_role, ''), 'none'))
    END;

    INSERT INTO public.profile_balance_blocked_attempts (
      profile_id,
      email,
      attempted_by,
      attempted_role,
      database_role,
      reason,
      old_wallet_balance,
      attempted_wallet_balance,
      old_crypto_balance,
      attempted_crypto_balance,
      old_referral_balance,
      attempted_referral_balance,
      row_snapshot_old,
      row_snapshot_attempted
    )
    VALUES (
      OLD.id,
      OLD.email,
      auth.uid(),
      NULLIF(request_role, ''),
      database_role,
      block_reason,
      OLD.wallet_balance,
      NEW.wallet_balance,
      OLD.crypto_balance,
      NEW.crypto_balance,
      OLD.referral_balance,
      NEW.referral_balance,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );

    NEW.wallet_balance := OLD.wallet_balance;
    NEW.crypto_balance := OLD.crypto_balance;
    NEW.referral_balance := OLD.referral_balance;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_balance_authority() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS guard_profile_balance_insert ON public.profiles;
CREATE TRIGGER guard_profile_balance_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_balance_authority();

DROP TRIGGER IF EXISTS guard_profile_balance_update ON public.profiles;
CREATE TRIGGER guard_profile_balance_update
BEFORE UPDATE OF wallet_balance, crypto_balance, referral_balance ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_balance_authority();

CREATE OR REPLACE FUNCTION public.audit_profile_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF COALESCE(OLD.wallet_balance, 0) IS DISTINCT FROM COALESCE(NEW.wallet_balance, 0)
    OR COALESCE(OLD.crypto_balance, 0) IS DISTINCT FROM COALESCE(NEW.crypto_balance, 0)
    OR COALESCE(OLD.referral_balance, 0) IS DISTINCT FROM COALESCE(NEW.referral_balance, 0)
  THEN
    INSERT INTO public.profile_balance_audit (
      profile_id,
      email,
      changed_by,
      changed_role,
      request_role,
      database_role,
      approved_by_tallystore,
      old_wallet_balance,
      new_wallet_balance,
      old_crypto_balance,
      new_crypto_balance,
      old_referral_balance,
      new_referral_balance,
      row_snapshot_old,
      row_snapshot_new
    )
    VALUES (
      NEW.id,
      NEW.email,
      auth.uid(),
      current_user,
      NULLIF(request_role, ''),
      current_user,
      request_role = 'service_role',
      OLD.wallet_balance,
      NEW.wallet_balance,
      OLD.crypto_balance,
      NEW.crypto_balance,
      OLD.referral_balance,
      NEW.referral_balance,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  RETURN NEW;
END;
$$;

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
