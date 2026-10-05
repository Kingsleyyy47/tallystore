-- Referral attribution is an onboarding decision. Existing links remain
-- immutable; a new link is accepted only before trusted funding begins.
-- Current canonical apply_wallet_transaction, NOWPayments settlement, and
-- reviewed historical funding paths lock this profile before posting funds.
-- New funding paths must keep that ordering. The source PostgREST
-- authenticator had an eight-second statement/lock deadline at review time;
-- the advisory wait therefore cannot run indefinitely through that API.
CREATE OR REPLACE FUNCTION public.apply_profile_referral_attribution(
  p_user_id uuid,
  p_referral_code_input text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_target record;
  v_own_code text;
  v_clean_code text := upper(btrim(COALESCE(p_referral_code_input, '')));
  v_referrer_id uuid;
  v_truth jsonb;
  v_has_funding boolean := false;
  v_cycle boolean := false;
  v_status text := 'no_referrer';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'profile_user_required'; END IF;
  v_own_code := upper(substr(replace(p_user_id::text, '-', ''), 1, 8));

  -- A single transaction-scoped lock serializes referral chains, including
  -- two customers attempting to refer each other at the same time.
  PERFORM pg_catalog.pg_advisory_xact_lock(723859217, 1);
  SELECT id, referred_by, COALESCE(is_staff,false) AS is_staff,
    COALESCE(is_admin,false) AS is_admin,
    COALESCE(account_suspended,false) AS account_suspended
  INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF v_target.referred_by IS NOT NULL THEN
    v_status := 'already_attributed';
  ELSIF v_clean_code <> '' AND v_clean_code <> v_own_code THEN
    SELECT id INTO v_referrer_id FROM public.profiles
      WHERE referral_code = v_clean_code AND id <> p_user_id LIMIT 1;
    IF v_referrer_id IS NOT NULL THEN
      IF v_target.is_staff OR v_target.is_admin OR v_target.account_suspended THEN
        v_status := 'customer_not_eligible';
        v_referrer_id := NULL;
      ELSE
        -- The canonical ledger truth counts verified payment rows, approved
        -- credits, and legacy funding even when the current balance is zero.
        v_truth := public.wallet_financial_truth_internal(p_user_id);
        IF v_truth IS NULL OR NOT (v_truth ? 'verified_payment_rows')
          OR NOT (v_truth ? 'approved_admin_rows')
          OR NOT (v_truth ? 'trusted_principal')
          OR NOT (v_truth ? 'legacy_first_recorded_funding_at')
        THEN RAISE EXCEPTION 'referral_funding_unavailable'; END IF;
        v_has_funding := COALESCE((v_truth->>'verified_payment_rows')::integer, 0) > 0
          OR COALESCE((v_truth->>'approved_admin_rows')::integer, 0) > 0
          OR COALESCE((v_truth->>'trusted_principal')::numeric, 0) > 0
          OR NULLIF(v_truth->>'legacy_first_recorded_funding_at', '') IS NOT NULL;
        IF v_has_funding THEN
          v_status := 'funded_before_referral';
          v_referrer_id := NULL;
        ELSE
          -- A bounded walk denies self/cycles, including a pre-existing cycle
          -- or a chain longer than the safe bound. No ancestor row locks are
          -- taken; the advisory lock serializes this service RPC.
          WITH RECURSIVE ancestry AS (
            SELECT p.id, p.referred_by, ARRAY[p.id] AS path, 1 AS depth
            FROM public.profiles p WHERE p.id = v_referrer_id
            UNION ALL
            SELECT p.id, p.referred_by, a.path || p.id, a.depth + 1
            FROM ancestry a JOIN public.profiles p
              ON p.id::text = lower(btrim(a.referred_by))
            WHERE a.depth < 64 AND NOT p.id = ANY(a.path)
          )
          SELECT EXISTS (SELECT 1 FROM ancestry WHERE id = p_user_id)
            OR EXISTS (
              SELECT 1 FROM ancestry a JOIN public.profiles p
                ON p.id::text = lower(btrim(a.referred_by))
              WHERE p.id = ANY(a.path) OR a.depth >= 64
            ) INTO v_cycle;
          IF v_cycle THEN
            v_status := 'referral_cycle_denied';
            v_referrer_id := NULL;
          ELSE
            v_status := 'attributed';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
  UPDATE public.profiles SET referral_code = v_own_code,
    referred_by = COALESCE(v_referrer_id::text, v_target.referred_by), updated_at = now()
  WHERE id = p_user_id;
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);

  RETURN jsonb_build_object('success',true,'referralCode',v_own_code,
    'referredBy',COALESCE(v_referrer_id::text,v_target.referred_by),
    'attribution_status',v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_profile_referral_attribution(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_profile_referral_attribution(uuid,text)
  TO service_role;
