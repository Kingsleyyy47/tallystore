-- Real customer sales counters for public/admin summary cards.

CREATE OR REPLACE FUNCTION public.get_customer_sales_stats()
RETURNS TABLE (
  total_sales bigint,
  total_revenue numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    COUNT(o.id)::bigint AS total_sales,
    COALESCE(SUM(o.amount), 0)::numeric AS total_revenue
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.user_id
  WHERE lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
    AND COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false
$$;

REVOKE ALL ON FUNCTION public.get_customer_sales_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_sales_stats() TO anon, authenticated;
