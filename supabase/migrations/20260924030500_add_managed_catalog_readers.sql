-- Expand phase: full product configuration remains available only through
-- authenticated admin/product-staff readers. Deploy the browser update before
-- the later column-level SELECT contraction.
DO $preflight$
BEGIN
  IF to_regclass('public.product_groups') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
  THEN
    RAISE EXCEPTION 'managed_catalog_required_object_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_managed_product_groups()
RETURNS SETOF public.product_groups
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
              AND sp.permission_key = 'tab_products'
              AND COALESCE(sp.is_enabled, false)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'managed_catalog_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg.* FROM public.product_groups pg
  WHERE pg.is_active = true
  ORDER BY pg.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_managed_product_group(p_id uuid)
RETURNS SETOF public.product_groups
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
              AND sp.permission_key = 'tab_products'
              AND COALESCE(sp.is_enabled, false)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'managed_catalog_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg.* FROM public.product_groups pg WHERE pg.id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_managed_product_groups()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_managed_product_group(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_product_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_product_group(uuid) TO authenticated;
