-- Contract phase: run only after the browser build uses explicit public fields
-- and get_managed_product_group(s). Old select('*') catalog builds will fail.
DO $preflight$
DECLARE
  v_column text;
BEGIN
  IF to_regclass('public.product_groups') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
    OR to_regprocedure('public.get_managed_product_groups()') IS NULL
    OR to_regprocedure('public.get_managed_product_group(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'catalog_privilege_required_object_missing';
  END IF;

  FOREACH v_column IN ARRAY ARRAY[
    'id', 'category_id', 'name', 'description', 'price', 'features',
    'stock_count', 'availability_status', 'is_sellable', 'is_active',
    'created_at', 'quantity_discount_tiers'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.product_groups'::regclass
        AND a.attname = v_column AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'catalog_public_column_missing: %', v_column;
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE SELECT ON TABLE public.product_groups FROM PUBLIC, anon, authenticated;
DO $revoke_columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.product_groups'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.product_groups FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$revoke_columns$;

GRANT SELECT (
  id, category_id, name, description, price, features, stock_count,
  availability_status, is_sellable, is_active, created_at,
  quantity_discount_tiers
) ON TABLE public.product_groups TO anon, authenticated;
