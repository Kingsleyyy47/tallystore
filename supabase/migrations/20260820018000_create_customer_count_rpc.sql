-- Customer-only profile counter for public/admin summary cards.

CREATE OR REPLACE FUNCTION public.get_customer_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COUNT(*)::bigint
  FROM public.profiles p
  WHERE COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false
$$;

REVOKE ALL ON FUNCTION public.get_customer_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_count() TO anon, authenticated;
