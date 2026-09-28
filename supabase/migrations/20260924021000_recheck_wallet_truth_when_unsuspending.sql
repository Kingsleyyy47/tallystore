-- The Edge route presents an early review decision. Re-evaluate that decision
-- under the profile lock before clearing account suspension.
DO $preflight$
BEGIN
  IF to_regprocedure('public.set_customer_suspension_state(uuid,boolean,text,uuid)') IS NULL
    OR to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'wallet_unsuspension_required_function_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.set_customer_suspension_state(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_target record;
  v_truth jsonb;
  v_status text;
  v_automatic_excess_review boolean;
  v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_user_required';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'profile_actor_required';
  END IF;

  SELECT id, is_admin INTO v_actor
  FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR NOT COALESCE(v_actor.is_admin, false) THEN
    RAISE EXCEPTION 'profile_admin_actor_required';
  END IF;

  SELECT id, is_staff, is_admin, wallet_review_required,
    wallet_review_reason, wallet_reviewed_by
    INTO v_target
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF COALESCE(v_target.is_staff, false) OR COALESCE(v_target.is_admin, false) THEN
    RAISE EXCEPTION 'profile_customer_required';
  END IF;

  IF COALESCE(p_suspended, false) THEN
    IF length(v_reason) < 3 THEN
      RAISE EXCEPTION 'suspension_reason_required';
    END IF;
  ELSE
    v_truth := public.wallet_financial_truth_internal(p_user_id);
    v_status := COALESCE(v_truth->>'integrity_status', '');
    IF v_truth IS NULL
      OR COALESCE((v_truth->>'evidence_complete')::boolean, false) IS NOT TRUE
      OR v_status NOT IN ('consistent', 'quarantined_excess')
      OR COALESCE((v_truth->>'trusted_book_balance')::numeric, -1) < 0
      OR COALESCE((v_truth->>'spend_exposure')::numeric, 1) > 0
    THEN
      RAISE EXCEPTION 'wallet_review_required_before_unsuspension';
    END IF;

    v_automatic_excess_review :=
      v_status = 'quarantined_excess'
      AND COALESCE((v_truth->>'quarantined_excess')::numeric, 0) > 0
      AND v_target.wallet_reviewed_by IS NULL
      AND (
        v_target.wallet_review_reason LIKE 'Auto-suspended: displayed wallet balance %'
        OR v_target.wallet_review_reason LIKE
          'Wallet frozen: requested purchase % exceeds backed available funds %'
        OR v_target.wallet_review_reason LIKE
          'Wallet financial review: quarantined displayed excess %'
      );
    IF COALESCE(v_target.wallet_review_required, false)
      AND NOT COALESCE(v_automatic_excess_review, false)
    THEN
      RAISE EXCEPTION 'wallet_review_hold_before_unsuspension';
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
  IF COALESCE(p_suspended, false) THEN
    UPDATE public.profiles
       SET account_suspended = true,
           suspension_reason = v_reason,
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
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_suspension_state(uuid, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_suspension_state(uuid, boolean, text, uuid)
  TO service_role;
