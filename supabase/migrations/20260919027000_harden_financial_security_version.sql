-- Database-owned financial authorization epoch.
--
-- A reservation or dispatch message must carry the current profile epoch.
-- Changing the account financial state increments the epoch and invalidates
-- older authorizations, including authorizations created before a freeze and
-- then replayed after an admin review.

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
    )
  THEN
    NEW.financial_security_version :=
      GREATEST(COALESCE(OLD.financial_security_version, 1) + 1, 1);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_financial_security_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bump_financial_security_version ON public.profiles;
CREATE TRIGGER trg_bump_financial_security_version
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.bump_financial_security_version();

COMMENT ON FUNCTION public.bump_financial_security_version() IS
  'Invalidates old wallet reservations and dispatch authorizations whenever financial security state changes.';
