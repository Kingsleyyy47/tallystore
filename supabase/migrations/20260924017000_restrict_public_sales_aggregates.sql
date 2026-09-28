-- Public storefront counters need counts and rankings, not exact revenue or
-- per-product units sold. Keep the old revenue signature for authorized staff.
DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
    OR to_regprocedure('public.get_customer_sales_stats()') IS NULL
    OR to_regprocedure('public.get_customer_top_product_groups(integer)') IS NULL
  THEN
    RAISE EXCEPTION 'Required sales aggregate object missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_permissions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_permissions TO service_role;

CREATE OR REPLACE FUNCTION public.get_customer_sales_stats()
RETURNS TABLE (total_sales bigint, total_revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
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
$function$;

REVOKE ALL ON FUNCTION public.get_customer_sales_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_sales_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_customer_order_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COUNT(o.id)::bigint
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.user_id
  WHERE lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
    AND COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false
$function$;

REVOKE ALL ON FUNCTION public.get_public_customer_order_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_customer_order_count() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_top_product_group_ids(p_limit integer DEFAULT 8)
RETURNS TABLE (product_group_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.product_group_id
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.user_id
  WHERE o.product_group_id IS NOT NULL
    AND lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
    AND COALESCE(p.is_staff, false) = false
    AND COALESCE(p.is_admin, false) = false
  GROUP BY o.product_group_id
  ORDER BY COALESCE(SUM(
    CASE
      WHEN jsonb_typeof(o.account_details::jsonb -> 'quantity') = 'number'
        THEN GREATEST((o.account_details::jsonb ->> 'quantity')::numeric, 1)
      ELSE 1
    END
  ), 0) DESC, o.product_group_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 12)
$function$;

REVOKE ALL ON FUNCTION public.get_public_top_product_group_ids(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_top_product_group_ids(integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_customer_top_product_groups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_top_product_groups(integer) TO service_role;
