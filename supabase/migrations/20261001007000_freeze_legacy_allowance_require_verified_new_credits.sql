-- Preserve the purchase capacity already available to existing customers, but
-- allow subsequent increases only from provider-verified Ercas/PocketFi funds.
-- This records a baseline; it does not change a profile balance or suspension.
CREATE TABLE public.wallet_legacy_spend_allowance_snapshot (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  baseline_available numeric NOT NULL CHECK (baseline_available >= 0),
  gateway_deposits_at_snapshot numeric NOT NULL CHECK (gateway_deposits_at_snapshot >= 0),
  completed_debits_at_snapshot numeric NOT NULL CHECK (completed_debits_at_snapshot >= 0),
  eligible_refunds_at_snapshot numeric NOT NULL CHECK (eligible_refunds_at_snapshot >= 0),
  stored_balance_at_snapshot numeric NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_legacy_spend_allowance_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_legacy_spend_allowance_snapshot
  FROM PUBLIC, anon, authenticated, service_role;

-- Block wallet writes while the baseline is captured. A concurrent top-up or
-- purchase cannot fall between the snapshot and the new authorization rule.
LOCK TABLE public.profiles, public.transactions, public.wallet_reservations
  IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.wallet_legacy_spend_allowance_snapshot (
  user_id, baseline_available, gateway_deposits_at_snapshot,
  completed_debits_at_snapshot, eligible_refunds_at_snapshot,
  stored_balance_at_snapshot
)
WITH candidates AS MATERIALIZED (
  SELECT p.id FROM public.profiles p
  WHERE p.wallet_balance <> 0
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.user_id = p.id)
)
SELECT p.id,
  (f.truth->>'trusted_available_before_holds')::numeric,
  (f.truth->>'verified_gateway_deposits')::numeric,
  (f.truth->>'completed_debits')::numeric,
  (f.truth->>'eligible_refunds')::numeric,
  (f.truth->>'stored_wallet_balance')::numeric
FROM candidates p
CROSS JOIN LATERAL (
  SELECT public.wallet_financial_truth_internal(p.id) AS truth
) f;

DO $patch$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
  v_new text := $replacement$  -- Existing available funds are preserved once. New capacity must come
  -- from verified Ercas/PocketFi evidence already included in canonical truth.
  SELECT COALESCE(p.wallet_review_required, false)
      AND p.wallet_reviewed_by IS NOT NULL
    INTO v_manual_review
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT LEAST(
      GREATEST((v_truth->>'stored_wallet_balance')::numeric, 0),
      GREATEST(LEAST(
        s.baseline_available
          + (v_truth->>'verified_gateway_deposits')::numeric
          - s.gateway_deposits_at_snapshot,
        s.baseline_available
          + (v_truth->>'verified_gateway_deposits')::numeric
          - s.gateway_deposits_at_snapshot
          - ((v_truth->>'completed_debits')::numeric
             - s.completed_debits_at_snapshot)
          + ((v_truth->>'eligible_refunds')::numeric
             - s.eligible_refunds_at_snapshot)
      ), 0)
    ) INTO v_policy_available
  FROM public.wallet_legacy_spend_allowance_snapshot s
  WHERE s.user_id = p_user_id;

  IF NOT FOUND THEN
    -- Accounts with no existing allowance start at zero. A later verified
    -- deposit can be used even if older unverified spending exhausted a
    -- separate historical balance.
    v_policy_available := LEAST(
      GREATEST((v_truth->>'stored_wallet_balance')::numeric, 0),
      GREATEST(LEAST(
        (v_truth->>'verified_gateway_deposits')::numeric,
        (v_truth->>'verified_gateway_deposits')::numeric
          - (v_truth->>'completed_debits')::numeric
          + (v_truth->>'eligible_refunds')::numeric
      ), 0)
    );
  END IF;

  v_truth := v_truth || jsonb_build_object(
    'trusted_available_before_holds', v_policy_available,
    'confirmed_spendable', GREATEST(
      v_policy_available - (v_truth->>'active_reservations')::numeric, 0
    ),
    'authorization_basis', CASE
      WHEN v_policy_available > 0 THEN 'legacy_snapshot_or_verified_gateway'
      ELSE 'verified_gateway_required'
    END
  );

$replacement$;
BEGIN
  SELECT replace(pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ), E'\r\n', E'\n') INTO v_definition;
  v_start := pg_catalog.strpos(v_definition,
    '  -- legacy_purchase_policy_20260928: do not auto-hold established customers');
  v_end := pg_catalog.strpos(v_definition,
    '  -- Automatic fraud flags are not customer holds.');
  IF v_start = 0 OR v_end <= v_start
    OR pg_catalog.strpos(v_definition,
      'legacy_snapshot_or_verified_gateway') > 0
  THEN
    RAISE EXCEPTION 'Unexpected deployed wallet truth; review before purchase policy change';
  END IF;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || v_new || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;
END;
$patch$;

-- The wallet engine is the only authorized writer of committed wallet
-- movements. Keep ledger-only repair notes separate from spendable credit.
DO $patch$
DECLARE
  v_definition text;
  v_anchor text := $anchor$  IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN$anchor$;
  v_guard text := $guard$  IF v_balance_type = 'wallet' AND v_type IN (
    'admin_credit', 'staff_credit', 'referral_withdrawal',
    'referral_credit', 'promotion_credit', 'correction_credit'
  ) THEN
    RETURN jsonb_build_object(
      'success', false, 'code', 'VERIFIED_GATEWAY_REQUIRED',
      'error', 'Wallet credits require verified Ercas or PocketFi payment'
    );
  END IF;

$guard$;
BEGIN
  SELECT replace(pg_catalog.pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  ), E'\r\n', E'\n') INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_anchor) = 0
    OR pg_catalog.strpos(v_definition, 'VERIFIED_GATEWAY_REQUIRED') > 0
  THEN
    RAISE EXCEPTION 'Unexpected wallet engine; review before disabling unverified credits';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_guard || v_anchor);
END;
$patch$;

-- Customer UI reads the same amount that the purchase gate will authorize.
CREATE FUNCTION public.get_my_wallet_available()
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_truth jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_truth := public.wallet_financial_truth_internal(v_user_id);
  IF COALESCE((v_truth->>'spending_blocked')::boolean, true) THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(COALESCE((v_truth->>'confirmed_spendable')::numeric, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_wallet_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_available() TO authenticated;
