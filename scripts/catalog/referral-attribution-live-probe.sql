-- Exercise the actual source wallet-truth function with a funded customer.
-- The nested savepoint rolls back the profile update before the runner checks
-- a source-wide financial-row snapshot. No identities leave this SQL batch.
SAVEPOINT referral_attribution_probe;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE
  v_target uuid;
  v_referrer_code text;
  v_result jsonb;
BEGIN
  SELECT c.id INTO v_target FROM (
    SELECT DISTINCT p.id FROM public.profiles p
    JOIN public.transactions t ON t.user_id=p.id
    WHERE p.referred_by IS NULL
      AND p.is_staff IS DISTINCT FROM true
      AND p.is_admin IS DISTINCT FROM true
      AND p.account_suspended IS DISTINCT FROM true
      AND t.type='topup' AND t.status='completed' AND t.amount>0
      AND t.created_at>=public.wallet_legacy_funding_cutoff()
    LIMIT 20
  ) c
  WHERE (public.wallet_financial_truth_internal(c.id)->>'verified_payment_rows')::integer>0
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'No source verified funding fixture'; END IF;
  SELECT referral_code INTO v_referrer_code FROM public.profiles
  WHERE id<>v_target AND referral_code IS NOT NULL LIMIT 1;
  IF v_referrer_code IS NULL THEN RAISE EXCEPTION 'No source referrer fixture'; END IF;
  v_result := public.apply_profile_referral_attribution(v_target,v_referrer_code);
  IF v_result->>'attribution_status' <> 'funded_before_referral'
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id=v_target AND referred_by IS NOT NULL)
  THEN RAISE EXCEPTION 'Funded-first attribution was not denied'; END IF;
END $$;
ROLLBACK TO SAVEPOINT referral_attribution_probe;
RELEASE SAVEPOINT referral_attribution_probe;
