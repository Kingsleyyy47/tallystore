-- Emergency purchase policy: preserve ordinary balance and funding checks,
-- but do not turn incomplete historical accounting into a customer hold.
-- Historical customers with recorded principal use the stored wallet balance;
-- this is a legacy policy exception, not proof that every old credit was verified.
DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  IF to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL
    OR to_regprocedure('public.evaluate_customer_ledger_suspension(uuid,numeric)') IS NULL
    OR to_regprocedure('public.wallet_legacy_funding_cutoff()') IS NULL
  THEN
    RAISE EXCEPTION 'Emergency purchase policy prerequisites are missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'legacy_purchase_policy_20260928') = 0 THEN
    v_old := '  v_truth jsonb;';
    v_new := $replacement$  v_truth jsonb;
  v_legacy_customer boolean := false;
  v_has_recorded_funding boolean := false;
  v_manual_review boolean := false;
  v_policy_available numeric := 0;$replacement$;
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'Canonical truth declaration changed; inspect before patching';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := '  RETURN v_truth;';
    v_new := $replacement$  -- legacy_purchase_policy_20260928: do not auto-hold established customers
  SELECT p.created_at < public.wallet_legacy_funding_cutoff()
      OR EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = p_user_id
          AND COALESCE(t.balance_type, 'wallet') = 'wallet'
          AND t.created_at < public.wallet_legacy_funding_cutoff()
      )
      OR EXISTS (
        SELECT 1 FROM public.wallet_legacy_funding l
        WHERE l.user_id = p_user_id
          AND l.grandfathered_principal > 0
      ),
      COALESCE(p.wallet_review_required, false)
        AND p.wallet_reviewed_by IS NOT NULL
    INTO v_legacy_customer, v_manual_review
  FROM public.profiles p
  WHERE p.id = p_user_id;

  v_has_recorded_funding := (v_truth->>'trusted_principal')::numeric > 0;
  IF v_legacy_customer AND v_has_recorded_funding THEN
    v_policy_available := GREATEST(
      (v_truth->>'stored_wallet_balance')::numeric
      - (v_truth->>'active_reservations')::numeric, 0
    );
    v_truth := v_truth || jsonb_build_object(
      'trusted_available_before_holds', GREATEST(
        (v_truth->>'stored_wallet_balance')::numeric, 0
      ),
      'confirmed_spendable', v_policy_available,
      'authorization_basis', 'legacy_recorded_funding_stored_balance'
    );
  ELSIF NOT v_has_recorded_funding THEN
    v_truth := v_truth || jsonb_build_object(
      'trusted_available_before_holds', 0,
      'confirmed_spendable', 0,
      'authorization_basis', 'no_recorded_funding'
    );
  ELSE
    v_truth := v_truth || jsonb_build_object(
      'authorization_basis', 'confirmed_funding'
    );
  END IF;

  -- Automatic fraud flags are not customer holds. Deliberate reviewer-set
  -- holds and account suspensions remain enforceable.
  v_truth := v_truth || jsonb_build_object(
    'spending_blocked', (v_truth->>'account_suspended')::boolean OR v_manual_review
  );
  RETURN v_truth;$replacement$;
    IF pg_catalog.strpos(v_definition, v_old) = 0
      OR pg_catalog.strpos(v_definition, 'wallet_financial_truth_profile_not_found') = 0
      OR pg_catalog.strpos(v_definition, '''confirmed_spendable''') = 0
    THEN
      RAISE EXCEPTION 'Canonical truth return changed; inspect before patching';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END IF;
END;
$patch$;

-- Existing transaction triggers and any scheduled caller may still invoke
-- this RPC. Keep its JSON contract but remove the profile-writing side effect.
CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension(
  target_user_id uuid, tolerance_ngn numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_truth jsonb;
BEGIN
  v_truth := public.wallet_financial_truth_internal(target_user_id);
  RETURN v_truth || jsonb_build_object(
    'success', true,
    'suspended', (v_truth->>'spending_blocked')::boolean,
    'review_required', (v_truth->>'wallet_review_required')::boolean
      AND (v_truth->>'spending_blocked')::boolean,
    'trusted_credits', (v_truth->>'trusted_principal')::numeric,
    'completed_spend', (v_truth->>'completed_debits')::numeric,
    'trusted_consumed_spend', (v_truth->>'net_consumed_spend')::numeric,
    'trusted_available', (v_truth->>'trusted_available_before_holds')::numeric,
    'net_spend', (v_truth->>'net_consumed_spend')::numeric,
    'displayed_balance_exposure', (v_truth->>'quarantined_excess')::numeric
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_customer_ledger_suspension(uuid,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_customer_ledger_suspension(uuid,numeric)
  TO service_role;

-- Remove only automatic historical fraud holds. Keep manual suspensions,
-- financial history, incident evidence, and wallet balances untouched.
DO $release$
BEGIN
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET wallet_review_required = false,
         wallet_review_reason = NULL,
         wallet_reviewed_at = now(),
         updated_at = now()
   WHERE wallet_review_required = true
     AND wallet_reviewed_by IS NULL
     AND (
       wallet_review_reason LIKE 'Auto-suspended:%'
       OR wallet_review_reason LIKE 'Wallet frozen:%'
       OR wallet_review_reason LIKE 'Wallet financial review:%'
       OR wallet_review_reason LIKE 'Wallet integrity review:%'
     );

  UPDATE public.profiles
     SET account_suspended = false,
         suspension_reason = NULL,
         suspension_reinstated_at = now(),
         updated_at = now()
   WHERE account_suspended = true
     AND (
       lower(COALESCE(suspension_reason, '')) LIKE 'auto-suspended:%'
       OR lower(COALESCE(suspension_reason, '')) LIKE 'wallet frozen:%'
       OR lower(COALESCE(suspension_reason, '')) LIKE
         'wallet integrity could not be verified%'
     );

  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$release$;
