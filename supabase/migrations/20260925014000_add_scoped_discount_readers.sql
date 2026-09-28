-- Expand before removing browser SELECT on discount_codes. The customer RPC
-- validates one supplied code and never returns the code row or its owner.
DO $preflight$
BEGIN
  IF to_regclass('public.discount_codes') IS NULL
    OR to_regclass('public.product_groups') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'discount reader dependencies missing; review deployed schema first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('discount_codes', 'user_id'), ('discount_codes', 'max_order_amount'),
      ('discount_codes', 'max_uses'), ('discount_codes', 'used_count'),
      ('profiles', 'account_suspended'), ('profiles', 'is_staff')
    ) required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = format('public.%I', required.table_name)::regclass
        AND a.attname = required.column_name AND NOT a.attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'discount reader columns missing; review deployed schema first';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.preview_discount_code(
  p_code text, p_product_group_id uuid, p_order_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_code public.discount_codes%ROWTYPE;
  v_category_id uuid;
  v_invalid jsonb := jsonb_build_object('valid', false, 'error', 'Invalid or expired code');
BEGIN
  IF auth.uid() IS NULL
    OR p_product_group_id IS NULL
    OR p_code IS NULL
    OR length(btrim(p_code)) < 1
    OR length(btrim(p_code)) > 120
    OR (p_order_total IS NOT NULL AND (p_order_total < 0 OR p_order_total <> round(p_order_total, 2)))
  THEN
    RETURN v_invalid;
  END IF;

  SELECT pg.category_id INTO v_category_id
  FROM public.product_groups pg WHERE pg.id = p_product_group_id;
  IF NOT FOUND THEN RETURN v_invalid; END IF;

  SELECT dc.* INTO v_code
  FROM public.discount_codes dc
  WHERE dc.code = upper(btrim(p_code)) AND dc.is_active = true;
  IF NOT FOUND
    OR (v_code.expires_at IS NOT NULL AND v_code.expires_at <= now())
    OR (v_code.max_uses IS NOT NULL AND v_code.used_count >= v_code.max_uses)
    OR (v_code.product_group_id IS NOT NULL AND v_code.product_group_id <> p_product_group_id)
    OR (v_code.product_group_id IS NULL AND v_code.category_id IS NOT NULL AND v_code.category_id <> v_category_id)
    OR (v_code.user_id IS NOT NULL AND v_code.user_id <> auth.uid())
    OR (v_code.max_order_amount IS NOT NULL AND p_order_total IS NOT NULL
        AND p_order_total > v_code.max_order_amount)
  THEN
    RETURN v_invalid;
  END IF;

  RETURN jsonb_build_object('valid', true, 'percent_off', v_code.percent_off);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_managed_discount_codes()
RETURNS SETOF public.discount_codes
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
              AND sp.permission_key = 'tab_discount_codes'
              AND COALESCE(sp.is_enabled, false)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'managed_discount_codes_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Staff manage store promotions, not another customer's private reward code.
  RETURN QUERY SELECT dc.* FROM public.discount_codes dc
    WHERE dc.user_id IS NULL OR public.is_admin_profile()
    ORDER BY dc.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_discount_code(text, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_managed_discount_codes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_discount_code(text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_discount_codes() TO authenticated;
