-- Contract phase: apply after the matching browser build stops selecting *
-- from smm_orders. The panel response can contain supplier cost and errors.
DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.smm_orders') IS NULL THEN
    RAISE EXCEPTION 'smm_order_privacy_required_table_missing';
  END IF;

  SELECT string_agg(required.name, ', ')
  INTO v_missing
  FROM unnest(ARRAY[
    'id', 'user_id', 'service_id', 'link', 'quantity', 'amount_ngn',
    'status', 'reference', 'external_order_id', 'start_count', 'remains',
    'created_at', 'updated_at', 'completed_at'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.smm_orders'::regclass
      AND a.attname = required.name AND a.attnum > 0 AND NOT a.attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'smm_order_privacy_required_columns_missing: %', v_missing;
  END IF;
END;
$preflight$;

REVOKE ALL ON TABLE public.smm_orders FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.smm_orders'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL (%I) ON TABLE public.smm_orders FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$columns$;

GRANT SELECT (
  id, user_id, service_id, link, quantity, amount_ngn, status,
  reference, external_order_id, start_count, remains,
  created_at, updated_at, completed_at
) ON TABLE public.smm_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smm_orders TO service_role;
