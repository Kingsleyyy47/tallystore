-- Customers may create/update harmless profile fields, but they must never be
-- able to grant themselves roles, clear security holds, or attach payment
-- account metadata by writing profiles directly.

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');
  privileged_context boolean :=
    request_role = 'service_role'
    OR current_setting('app.tally_profile_privileged_authorized', true) = 'true';
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
    NEW.pocketfi_account_number := NULL;
    NEW.pocketfi_account_name := NULL;
    NEW.pocketfi_bank := NULL;
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  NEW.is_staff := OLD.is_staff;
  NEW.account_suspended := OLD.account_suspended;
  NEW.suspension_reason := OLD.suspension_reason;
  NEW.suspended_at := OLD.suspended_at;
  NEW.pocketfi_account_number := OLD.pocketfi_account_number;
  NEW.pocketfi_account_name := OLD.pocketfi_account_name;
  NEW.pocketfi_bank := OLD.pocketfi_bank;
  NEW.referral_balance := OLD.referral_balance;
  NEW.wallet_balance := OLD.wallet_balance;
  NEW.crypto_balance := OLD.crypto_balance;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_code := OLD.referral_code;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_fields_insert ON public.profiles;
CREATE TRIGGER guard_profile_privileged_fields_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_privileged_fields();

DROP TRIGGER IF EXISTS guard_profile_privileged_fields_update ON public.profiles;
CREATE TRIGGER guard_profile_privileged_fields_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_privileged_fields();

REVOKE ALL ON FUNCTION public.guard_profile_privileged_fields() FROM public, anon, authenticated;
