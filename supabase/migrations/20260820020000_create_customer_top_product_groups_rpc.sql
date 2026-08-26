-- Customer-only top product groups for public recommendation surfaces.
-- Keeps staff/admin purchases out of "popular" rankings without exposing
-- profile rows to customer browsers.

CREATE OR REPLACE FUNCTION public.get_customer_top_product_groups(p_limit int DEFAULT 8)
RETURNS TABLE (
  product_group_id uuid,
  units_sold numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.product_group_id,
    COALESCE(SUM(
      CASE
        WHEN jsonb_typeof(o.account_details::jsonb -> 'quantity') = 'number'
          THEN GREATEST((o.account_details::jsonb ->> 'quantity')::numeric, 1)
        ELSE 1
      END
    ), 0)::numeric AS units_sold
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.user_id
  WHERE o.product_group_id IS NOT NULL
    AND lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
    AND COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false
  GROUP BY o.product_group_id
  ORDER BY units_sold DESC, o.product_group_id
  LIMIT GREATEST(COALESCE(p_limit, 8), 0)
$$;

REVOKE ALL ON FUNCTION public.get_customer_top_product_groups(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_top_product_groups(int) TO anon, authenticated;
