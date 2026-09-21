-- Separate financial review from account access.
--
-- An automatic wallet-integrity hold must stop spending and fulfillment, but
-- it must not hide order history, deposits, wallet activity, or support access.
-- Manual account suspensions remain account_suspended=true and are untouched.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wallet_review_reason text,
  ADD COLUMN IF NOT EXISTS wallet_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS wallet_reviewed_by uuid;

REVOKE UPDATE (
  wallet_review_required,
  wallet_review_reason,
  wallet_reviewed_at,
  wallet_reviewed_by
) ON TABLE public.profiles FROM anon, authenticated;

-- Keep the protected-field trigger aware of the new financial-review fields.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged_context boolean :=
    current_setting('app.tally_profile_privileged_authorized', true) = 'true';
BEGIN
  IF privileged_context THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    NEW.is_staff := false;
    NEW.account_suspended := false;
    NEW.suspension_reason := NULL;
    NEW.suspended_at := NULL;
    NEW.suspended_by := NULL;
    NEW.suspension_reinstated_at := NULL;
    NEW.reinstated_by := NULL;
    NEW.wallet_review_required := false;
    NEW.wallet_review_reason := NULL;
    NEW.wallet_reviewed_at := NULL;
    NEW.wallet_reviewed_by := NULL;
    NEW.pocketfi_account_number := NULL;
    NEW.pocketfi_account_name := NULL;
    NEW.pocketfi_bank := NULL;
    NEW.financial_security_version := 1;
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  NEW.is_staff := OLD.is_staff;
  NEW.account_suspended := OLD.account_suspended;
  NEW.suspension_reason := OLD.suspension_reason;
  NEW.suspended_at := OLD.suspended_at;
  NEW.suspended_by := OLD.suspended_by;
  NEW.suspension_reinstated_at := OLD.suspension_reinstated_at;
  NEW.reinstated_by := OLD.reinstated_by;
  NEW.wallet_review_required := OLD.wallet_review_required;
  NEW.wallet_review_reason := OLD.wallet_review_reason;
  NEW.wallet_reviewed_at := OLD.wallet_reviewed_at;
  NEW.wallet_reviewed_by := OLD.wallet_reviewed_by;
  NEW.pocketfi_account_number := OLD.pocketfi_account_number;
  NEW.pocketfi_account_name := OLD.pocketfi_account_name;
  NEW.pocketfi_bank := OLD.pocketfi_bank;
  NEW.referral_balance := OLD.referral_balance;
  NEW.wallet_balance := OLD.wallet_balance;
  NEW.crypto_balance := OLD.crypto_balance;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_code := OLD.referral_code;
  NEW.financial_security_version := OLD.financial_security_version;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_financial_security_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.account_suspended IS DISTINCT FROM OLD.account_suspended
      OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspension_reinstated_at IS DISTINCT FROM OLD.suspension_reinstated_at
      OR NEW.wallet_review_required IS DISTINCT FROM OLD.wallet_review_required
      OR NEW.wallet_review_reason IS DISTINCT FROM OLD.wallet_review_reason
      OR NEW.wallet_reviewed_at IS DISTINCT FROM OLD.wallet_reviewed_at
      OR NEW.wallet_reviewed_by IS DISTINCT FROM OLD.wallet_reviewed_by
    )
  THEN
    NEW.financial_security_version :=
      GREATEST(COALESCE(OLD.financial_security_version, 1) + 1, 1);
  END IF;

  RETURN NEW;
END;
$$;

-- Existing hardening migrations wrote automatic integrity failures into the
-- account suspension fields. Route those system-generated reasons into the
-- financial hold fields immediately after the write. The original reason is
-- retained in wallet_review_reason for audit; manual suspensions do not match.
CREATE OR REPLACE FUNCTION public.route_automatic_profile_freeze_to_wallet_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reason text := lower(COALESCE(NEW.suspension_reason, ''));
BEGIN
  IF NEW.account_suspended = true
    AND (
      reason LIKE 'auto-suspended:%'
      OR reason LIKE 'wallet frozen:%'
      OR reason LIKE 'wallet integrity could not be verified%'
    )
  THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

    UPDATE public.profiles
       SET account_suspended = false,
           suspension_reason = NULL,
           wallet_review_required = true,
           wallet_review_reason = NEW.suspension_reason,
           wallet_reviewed_at = NULL,
           wallet_reviewed_by = NULL,
           suspension_reinstated_at = COALESCE(suspension_reinstated_at, now()),
           updated_at = now()
     WHERE id = NEW.id
       AND account_suspended = true;

    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.route_automatic_profile_freeze_to_wallet_review() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_route_automatic_profile_freeze_to_wallet_review ON public.profiles;
CREATE TRIGGER trg_route_automatic_profile_freeze_to_wallet_review
AFTER UPDATE OF account_suspended, suspension_reason ON public.profiles
FOR EACH ROW
WHEN (
  NEW.account_suspended = true
  AND (
    lower(COALESCE(NEW.suspension_reason, '')) LIKE 'auto-suspended:%'
    OR lower(COALESCE(NEW.suspension_reason, '')) LIKE 'wallet frozen:%'
    OR lower(COALESCE(NEW.suspension_reason, '')) LIKE 'wallet integrity could not be verified%'
  )
)
EXECUTE FUNCTION public.route_automatic_profile_freeze_to_wallet_review();

-- Migrate only existing system-generated freezes. Manual admin suspensions
-- stay account-suspended and continue to use the existing review workflow.
DO $$
BEGIN
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET account_suspended = false,
         suspension_reason = NULL,
         wallet_review_required = true,
         wallet_review_reason = COALESCE(wallet_review_reason, suspension_reason),
         wallet_reviewed_at = NULL,
         wallet_reviewed_by = NULL,
         suspension_reinstated_at = COALESCE(suspension_reinstated_at, now()),
         updated_at = now()
   WHERE account_suspended = true
     AND (
       lower(COALESCE(suspension_reason, '')) LIKE 'auto-suspended:%'
       OR lower(COALESCE(suspension_reason, '')) LIKE 'wallet frozen:%'
       OR lower(COALESCE(suspension_reason, '')) LIKE 'wallet integrity could not be verified%'
     );

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
END
$$;

COMMENT ON COLUMN public.profiles.wallet_review_required IS
  'Financial hold that blocks spending/fulfillment while preserving read-only account access.';

COMMENT ON COLUMN public.profiles.wallet_review_reason IS
  'Original system-generated integrity reason retained for owner review and audit.';
