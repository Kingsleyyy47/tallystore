-- Give customers a precise explanation when an older recorded wallet amount
-- cannot be spent. This only reads the same server-side financial truth used
-- by the purchase gate and never changes a balance or review flag.
CREATE FUNCTION public.my_wallet_funding_needs_review()
RETURNS boolean
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
  RETURN (v_truth->>'stored_wallet_balance')::numeric > 0
    AND (v_truth->>'trusted_available_before_holds')::numeric = 0
    AND (v_truth->>'active_reservations')::numeric = 0
    AND (v_truth->>'authorization_basis') = 'verified_gateway_required'
    AND (v_truth->>'spending_blocked')::boolean IS FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.my_wallet_funding_needs_review()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_wallet_funding_needs_review()
  TO authenticated;
