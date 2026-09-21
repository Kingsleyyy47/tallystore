-- Service-role access is not by itself proof that a profile privileged-field
-- mutation is safe. Legitimate protected profile writes must go through one of
-- the narrow functions below, which sets a transaction-local authorization flag
-- before updating the guarded columns.

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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_privileged_fields() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_customer_pocketfi_account(
  p_user_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile record;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_user_required';
  END IF;

  IF NULLIF(trim(COALESCE(p_account_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'pocketfi_account_number_required';
  END IF;

  SELECT id, is_staff, is_admin
    INTO target_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(target_profile.is_staff, false) AND NOT COALESCE(target_profile.is_admin, false) THEN
    RAISE EXCEPTION 'pocketfi_customer_account_required';
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET pocketfi_account_number = trim(p_account_number),
         pocketfi_account_name = NULLIF(trim(COALESCE(p_account_name, '')), ''),
         pocketfi_bank = NULLIF(trim(COALESCE(p_bank, '')), ''),
         updated_at = now()
   WHERE id = p_user_id;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_profile_referral_attribution(
  p_user_id uuid,
  p_referral_code_input text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile record;
  own_code text;
  clean_code text := upper(trim(COALESCE(p_referral_code_input, '')));
  referrer_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_user_required';
  END IF;

  own_code := upper(substr(replace(p_user_id::text, '-', ''), 1, 8));

  SELECT id, referred_by
    INTO target_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF clean_code <> '' AND clean_code <> own_code AND target_profile.referred_by IS NULL THEN
    SELECT id
      INTO referrer_id
    FROM public.profiles
    WHERE referral_code = clean_code
      AND id <> p_user_id
    LIMIT 1;
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET referral_code = own_code,
         referred_by = COALESCE(referrer_id, target_profile.referred_by),
         updated_at = now()
   WHERE id = p_user_id;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'referralCode', own_code,
    'referredBy', COALESCE(referrer_id, target_profile.referred_by)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_customer_suspension_state(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_profile record;
  target_profile record;
  clean_reason text := trim(COALESCE(p_reason, ''));
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_user_required';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'profile_actor_required';
  END IF;

  SELECT id, is_admin
    INTO actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND OR NOT COALESCE(actor_profile.is_admin, false) THEN
    RAISE EXCEPTION 'profile_admin_actor_required';
  END IF;

  SELECT id, is_staff, is_admin
    INTO target_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(target_profile.is_staff, false) OR COALESCE(target_profile.is_admin, false) THEN
    RAISE EXCEPTION 'profile_customer_required';
  END IF;

  IF COALESCE(p_suspended, false) AND length(clean_reason) < 3 THEN
    RAISE EXCEPTION 'suspension_reason_required';
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  IF COALESCE(p_suspended, false) THEN
    UPDATE public.profiles
       SET account_suspended = true,
           suspension_reason = clean_reason,
           suspended_at = now(),
           suspended_by = p_actor_id,
           suspension_reinstated_at = NULL,
           reinstated_by = NULL,
           updated_at = now()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET account_suspended = false,
           suspension_reason = NULL,
           suspension_reinstated_at = now(),
           reinstated_by = p_actor_id,
           updated_at = now()
     WHERE id = p_user_id;
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_role(
  p_target_user_id uuid,
  p_is_staff boolean,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_profile record;
  target_profile record;
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_required';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'profile_actor_required';
  END IF;

  SELECT id, is_admin
    INTO actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND OR NOT COALESCE(actor_profile.is_admin, false) THEN
    RAISE EXCEPTION 'profile_admin_actor_required';
  END IF;

  SELECT id, is_admin
    INTO target_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(target_profile.is_admin, false) THEN
    RAISE EXCEPTION 'cannot_change_admin_staff_role';
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET is_staff = COALESCE(p_is_staff, false),
         updated_at = now()
   WHERE id = p_target_user_id;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_pocketfi_account(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_profile_referral_attribution(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_customer_suspension_state(uuid, boolean, text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_staff_role(uuid, boolean, uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_customer_pocketfi_account(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_profile_referral_attribution(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_customer_suspension_state(uuid, boolean, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_staff_role(uuid, boolean, uuid) TO service_role;
