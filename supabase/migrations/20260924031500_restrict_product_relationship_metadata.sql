-- The storefront uses only recommendation edges. Keep behavioral counts,
-- source classification, and metadata out of direct browser table reads.
-- Apply after the matching browser build stops selecting relationship rows '*'.
DO $preflight$
DECLARE
  v_column text;
BEGIN
  IF to_regclass('public.product_relationships') IS NULL THEN
    RAISE EXCEPTION 'product_relationships_required';
  END IF;

  FOREACH v_column IN ARRAY ARRAY[
    'id', 'from_product_group_id', 'to_product_group_id',
    'relationship_type', 'strength', 'confidence', 'created_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.product_relationships'::regclass
        AND a.attname = v_column AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'product_relationships_public_column_missing: %', v_column;
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE SELECT ON TABLE public.product_relationships FROM PUBLIC, anon, authenticated;
DO $revoke_columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.product_relationships'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.product_relationships FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$revoke_columns$;

GRANT SELECT (
  id, from_product_group_id, to_product_group_id,
  relationship_type, strength, confidence, created_at
) ON TABLE public.product_relationships TO anon, authenticated;
