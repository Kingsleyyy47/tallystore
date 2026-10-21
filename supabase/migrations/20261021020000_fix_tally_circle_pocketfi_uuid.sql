-- PocketFi log IDs use all five UUID groups. Keep every funding-evidence check.
DO $circle_uuid$
DECLARE
  v_definition text;
  v_body text;
  v_old text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_new text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT v_definition,v_body
  FROM pg_proc p WHERE p.oid='public.tally_circle_qualified_count(uuid)'::regprocedure;
  IF strpos(v_body,v_old)=0 THEN
    IF strpos(v_body,v_new)>0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Unexpected Tally Circle funding definition';
  END IF;
  IF (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'Unexpected number of PocketFi UUID checks';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$circle_uuid$;
