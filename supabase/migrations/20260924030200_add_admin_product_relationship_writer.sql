-- Expand phase: let the current administrator save relationship metadata
-- without granting every browser role direct SELECT on that metadata.
DO $preflight$
BEGIN
  IF to_regclass('public.product_relationships') IS NULL
    OR to_regclass('public.profiles') IS NULL
  THEN
    RAISE EXCEPTION 'product_relationship_writer_required_object_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.save_admin_product_relationships(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row jsonb;
  v_from uuid;
  v_to uuid;
  v_metadata jsonb;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_admin, false)
      AND NOT COALESCE(p.account_suspended, false)
  ) THEN
    RAISE EXCEPTION 'product_relationship_admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'product_relationship_rows_must_be_array';
  END IF;
  IF jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'product_relationship_row_count_invalid';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'product_relationship_row_must_be_object';
    END IF;
    v_from := (v_row->>'from_product_group_id')::uuid;
    v_to := (v_row->>'to_product_group_id')::uuid;
    IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
      RAISE EXCEPTION 'product_relationship_product_ids_invalid';
    END IF;
    v_metadata := COALESCE(v_row->'metadata', '{}'::jsonb);
    IF jsonb_typeof(v_metadata) <> 'object' THEN
      RAISE EXCEPTION 'product_relationship_metadata_must_be_object';
    END IF;

    INSERT INTO public.product_relationships (
      from_product_group_id, to_product_group_id, relationship_type,
      strength, confidence, sample_size, source, metadata, last_updated
    ) VALUES (
      v_from, v_to, v_row->>'relationship_type',
      (v_row->>'strength')::numeric, (v_row->>'confidence')::numeric,
      (v_row->>'sample_size')::integer, v_row->>'source', v_metadata, now()
    )
    ON CONFLICT (from_product_group_id, to_product_group_id, relationship_type, source)
    DO UPDATE SET strength = EXCLUDED.strength,
      confidence = EXCLUDED.confidence,
      sample_size = EXCLUDED.sample_size,
      metadata = EXCLUDED.metadata,
      last_updated = EXCLUDED.last_updated;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_admin_product_relationships(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_product_relationships(jsonb)
  TO authenticated;
