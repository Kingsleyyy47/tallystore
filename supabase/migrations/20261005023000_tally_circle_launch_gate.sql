-- Tally Circle can accumulate verified referral progress before its launch,
-- but it cannot change a customer price until a trusted migration enables it.
-- This private flag is not an editable storefront or staff setting.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
CREATE TABLE IF NOT EXISTS private.tally_circle_launch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.tally_circle_launch(singleton,enabled) VALUES (true,false)
ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON private.tally_circle_launch FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tally_circle_launch_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT enabled FROM private.tally_circle_launch WHERE singleton), false);
$$;
REVOKE ALL ON FUNCTION public.tally_circle_launch_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tally_circle_launch_enabled() TO service_role;

-- NOWPayments wallet credits use the same immutable, unrevoked evidence that
-- authorizes trusted wallet principal. They count once per referred person.
CREATE OR REPLACE FUNCTION public.tally_circle_qualified_count(p_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH referred AS (
    SELECT p.id FROM public.profiles p
    WHERE p.referred_by = p_user_id::text AND p.id <> p_user_id
  ), verified AS (
    SELECT t.user_id, SUM(t.amount) AS funded_ngn
    FROM public.transactions t JOIN referred r ON r.id = t.user_id
    WHERE t.type = 'topup' AND t.status = 'completed' AND t.amount > 0
      AND t.created_at >= public.wallet_legacy_funding_cutoff()
      AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
      AND COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
      AND CASE WHEN COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
        THEN (t.metadata->>'verified_amount_ngn')::numeric = t.amount ELSE false END
      AND (
        (lower(COALESCE(t.metadata->>'provider', '')) IN ('ercaspay','ercas')
          AND EXISTS (SELECT 1 FROM public.pending_payments pp
            WHERE pp.user_id = t.user_id AND pp.amount = t.amount
              AND lower(COALESCE(pp.status,'pending')) = 'credited'
              AND (pp.transaction_reference = t.reference
                OR pp.transaction_reference = t.external_payment_id
                OR pp.ercas_reference = t.external_payment_id)))
        OR (lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
          AND COALESCE(t.metadata->>'webhook_log_id','') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND EXISTS (SELECT 1 FROM public.pocketfi_webhook_logs pwl
            WHERE pwl.id = (t.metadata->>'webhook_log_id')::uuid
              AND pwl.matched_user_id = t.user_id AND COALESCE(pwl.processed,false)
              AND pwl.verified_amount_ngn = t.amount
              AND pwl.verified_reference IN (t.reference,t.external_payment_id)))
        OR (lower(COALESCE(t.metadata->>'provider', '')) = 'nowpayments'
          AND public.is_verified_nowpayments_wallet_credit(
            t.user_id,t.amount,t.reference,t.external_payment_id,t.metadata))
      )
    GROUP BY t.user_id
  )
  SELECT count(*)::integer FROM verified WHERE funded_ngn >= 1000;
$$;
REVOKE ALL ON FUNCTION public.tally_circle_qualified_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tally_circle_qualified_count(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tally_circle_purchase_status(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile record;
  v_enabled boolean;
  v_qualified integer := 0;
  v_active boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Customer required'; END IF;
  SELECT id, COALESCE(is_staff,false) AS is_staff,
    COALESCE(is_admin,false) AS is_admin,
    COALESCE(account_suspended,false) AS account_suspended
  INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  v_enabled := public.tally_circle_launch_enabled();
  IF v_enabled AND NOT v_profile.is_staff AND NOT v_profile.is_admin
    AND NOT v_profile.account_suspended THEN
    v_qualified := public.tally_circle_qualified_count(p_user_id);
    v_active := v_qualified >= 5;
  END IF;
  RETURN jsonb_build_object('enabled',v_enabled,'is_member',v_active,
    'qualified_referrals',v_qualified,'discount_percent',CASE WHEN v_active THEN 3 ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tally_circle_purchase_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tally_circle_purchase_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_tally_circle_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_total integer;
  v_qualified integer;
  v_enabled boolean;
  v_active boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT referral_code,COALESCE(is_staff,false) AS is_staff,
    COALESCE(is_admin,false) AS is_admin,
    COALESCE(account_suspended,false) AS account_suspended
  INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  SELECT count(*)::integer INTO v_total FROM public.profiles p
    WHERE p.referred_by = v_user_id::text AND p.id <> v_user_id;
  v_enabled := public.tally_circle_launch_enabled();
  v_qualified := CASE WHEN v_enabled THEN public.tally_circle_qualified_count(v_user_id) ELSE 0 END;
  v_active := v_enabled AND v_qualified >= 5 AND NOT v_profile.is_staff
    AND NOT v_profile.is_admin AND NOT v_profile.account_suspended;
  RETURN jsonb_build_object('referral_code',v_profile.referral_code,
    'total_referred',v_total,'qualified_referrals',v_qualified,
    'required_referrals',5,'minimum_verified_topup_ngn',1000,
    'enabled',v_enabled,'is_member',v_active,
    'discount_active',v_active,'discount_percent',CASE WHEN v_active THEN 3 ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_tally_circle_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tally_circle_status() TO authenticated, service_role;
