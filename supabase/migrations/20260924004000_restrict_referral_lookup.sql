-- A public SELECT on referral_lookup reveals the complete referral graph.
-- The customer UI needs only the current signed-in user's count.
DROP POLICY IF EXISTS "Anyone can read referral lookup" ON public.referral_lookup;
REVOKE SELECT ON public.referral_lookup FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_referral_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.referral_lookup
  WHERE referred_by = auth.uid()::text;
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_referral_count() TO authenticated;
