-- A retained admin or staff flag must never override account suspension.
DO $guard$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_profile()') IS NULL
     OR to_regprocedure('public.can_read_wallet_legacy_funding()') IS NULL
     OR to_regprocedure('public.get_customer_sales_stats()') IS NULL THEN
    RAISE EXCEPTION 'Expected privilege helper is missing';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin_profile();
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_wallet_legacy_funding()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin_profile();
$$;

REVOKE ALL ON FUNCTION public.can_read_wallet_legacy_funding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_wallet_legacy_funding() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_sales_stats()
RETURNS TABLE(total_sales bigint, total_revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND NOT COALESCE(p.account_suspended, false)
      AND (
        COALESCE(p.is_admin, false)
        OR (
          COALESCE(p.is_staff, false)
          AND EXISTS (
            SELECT 1 FROM public.staff_permissions sp
            WHERE sp.user_id = p.id
              AND sp.permission_key = 'view_stats'
              AND COALESCE(sp.is_enabled, false)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'sales_stats_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT COUNT(o.id)::bigint, COALESCE(SUM(o.amount), 0)::numeric
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.user_id
  WHERE lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
    AND COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_sales_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_sales_stats() TO authenticated;
