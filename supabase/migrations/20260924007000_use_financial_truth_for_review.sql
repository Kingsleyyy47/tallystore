-- Keep the historical RPC signatures, but make their financial numbers come
-- from the same full-history snapshot used by authorization and admin review.
CREATE OR REPLACE FUNCTION public.trusted_principal_for_user(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (public.wallet_financial_truth_internal(p_user_id)->>'trusted_principal')::numeric;
$$;

REVOKE ALL ON FUNCTION public.trusted_principal_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trusted_principal_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension(
  target_user_id uuid,
  tolerance_ngn numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_truth jsonb;
  v_status text;
  v_blocking_review boolean;
  v_new_hold boolean := false;
  v_updated_rows bigint := 0;
  v_is_staff boolean;
BEGIN
  -- The legacy tolerance parameter remains for old callers, but no amount of
  -- unexplained money is authorized by a monetary tolerance.
  v_truth := public.wallet_financial_truth_internal(target_user_id);
  v_status := v_truth->>'integrity_status';

  SELECT COALESCE(p.is_staff, false) OR COALESCE(p.is_admin, false)
    INTO v_is_staff
  FROM public.profiles p
  WHERE p.id = target_user_id;

  IF NOT v_is_staff AND v_status IN (
    'payment_identity_conflict', 'unsupported_wallet_currency',
    'unclassified_ledger_movement',
    'backed_funds_exhausted', 'stored_balance_deficit'
  ) THEN
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
    UPDATE public.profiles
       SET wallet_review_required = true,
           wallet_review_reason = COALESCE(
             wallet_review_reason,
             'Wallet integrity review: ' || v_status
           ),
           wallet_reviewed_at = NULL,
           wallet_reviewed_by = NULL,
           updated_at = now()
     WHERE id = target_user_id
       AND COALESCE(wallet_review_required, false) = false;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    v_new_hold := v_updated_rows > 0;
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
  END IF;

  v_blocking_review := COALESCE((v_truth->>'spending_blocked')::boolean, true)
    OR v_new_hold;

  RETURN v_truth || jsonb_build_object(
    'success', true,
    'suspended', v_blocking_review,
    'review_required', v_blocking_review,
    'trusted_credits', (v_truth->>'trusted_principal')::numeric,
    'completed_spend', (v_truth->>'completed_debits')::numeric,
    'trusted_consumed_spend', (v_truth->>'net_consumed_spend')::numeric,
    'trusted_available', (v_truth->>'trusted_available_before_holds')::numeric,
    'net_spend', (v_truth->>'net_consumed_spend')::numeric,
    'displayed_balance_exposure', (v_truth->>'quarantined_excess')::numeric
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_customer_ledger_suspension(uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_customer_ledger_suspension(uuid, numeric)
  TO service_role;
