-- Contract phase: apply only after the matching browser and Edge builds are live.
-- Table-level grants and existing column grants must both be removed.
DO $preflight$
BEGIN
  IF to_regclass('public.smm_services') IS NULL THEN
    RAISE EXCEPTION 'smm_catalog_security_required_table_missing';
  END IF;
END;
$preflight$;

REVOKE ALL ON TABLE public.smm_services FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.smm_services'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL (%I) ON TABLE public.smm_services FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$columns$;

GRANT SELECT (
  id, name, category, platform, service_type, price_ngn,
  min_quantity, max_quantity, has_refill, has_cancel, is_active
) ON TABLE public.smm_services TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smm_services TO service_role;
