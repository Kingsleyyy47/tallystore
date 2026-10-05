-- Tally Circle qualification is based on posted, provider-verified deposits.
-- Historical referral earnings stay in the referral ledger for owner review.
-- No caller can supply a customer id to the browser-facing status function.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('referral_commission_pct', '0', now())
ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = now();

CREATE OR REPLACE FUNCTION public.tally_circle_qualified_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH referred AS (
    SELECT p.id
    FROM public.profiles p
    WHERE p.referred_by = p_user_id::text
      AND p.id <> p_user_id
  ),
  verified AS (
    SELECT t.user_id, SUM(t.amount) AS funded_ngn
    FROM public.transactions t
    JOIN referred r ON r.id = t.user_id
    WHERE t.type = 'topup'
      AND t.status = 'completed'
      AND t.amount > 0
      AND t.created_at >= public.wallet_legacy_funding_cutoff()
      AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
      AND COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
      AND CASE
        WHEN COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
        THEN round((t.metadata->>'verified_amount_ngn')::numeric, 2) = round(t.amount, 2)
        ELSE false
      END
      AND (
        (
          lower(COALESCE(t.metadata->>'provider', '')) IN ('ercaspay', 'ercas')
          AND EXISTS (
            SELECT 1 FROM public.pending_payments pp
            WHERE pp.user_id = t.user_id
              AND round(pp.amount, 2) = round(t.amount, 2)
              AND lower(COALESCE(pp.status, 'pending')) = 'credited'
              AND (
                pp.transaction_reference = NULLIF(btrim(COALESCE(t.reference, '')), '')
                OR pp.transaction_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                OR pp.ercas_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
              )
          )
        )
        OR (
          lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
          AND COALESCE(t.metadata->>'webhook_log_id', '') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND EXISTS (
            SELECT 1 FROM public.pocketfi_webhook_logs pwl
            WHERE pwl.id = CASE
              WHEN COALESCE(t.metadata->>'webhook_log_id', '') ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (t.metadata->>'webhook_log_id')::uuid
              ELSE NULL
            END
              AND pwl.matched_user_id = t.user_id
              AND COALESCE(pwl.processed, false)
              AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
              AND NULLIF(btrim(COALESCE(pwl.verified_reference, '')), '') IN (
                NULLIF(btrim(COALESCE(t.reference, '')), ''),
                NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
              )
          )
        )
      )
    GROUP BY t.user_id
  )
  SELECT count(*)::integer
  FROM verified
  WHERE funded_ngn >= 1000;
$$;

REVOKE ALL ON FUNCTION public.tally_circle_qualified_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tally_circle_qualified_count(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_tally_circle_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_total integer;
  v_qualified integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.referral_code INTO v_code
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.profiles p
  WHERE p.referred_by = v_user_id::text
    AND p.id <> v_user_id;

  v_qualified := public.tally_circle_qualified_count(v_user_id);
  RETURN jsonb_build_object(
    'referral_code', v_code,
    'total_referred', v_total,
    'qualified_referrals', v_qualified,
    'required_referrals', 5,
    'minimum_verified_topup_ngn', 1000,
    'discount_percent', 3,
    'is_member', v_qualified >= 5
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_tally_circle_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tally_circle_status() TO authenticated, service_role;
