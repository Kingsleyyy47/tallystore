-- Applied 280 is unchanged. A failed read of an already bound unpaid invoice
-- must display review_required while retaining its hold and one-use claims.
DO $patch$
DECLARE v_definition text;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public.record_customer_airtime_outcome(uuid,uuid,text,jsonb)'::regprocedure) INTO v_definition;
 IF pg_catalog.strpos(v_definition,'j.state NOT IN (''creating'',''paying'',''unknown'')')=0 THEN
  RAISE EXCEPTION 'unexpected_airtime_unknown_state_boundary';
 END IF;
 v_definition:=pg_catalog.replace(v_definition,
  'j.state NOT IN (''creating'',''paying'',''unknown'')',
  'j.state NOT IN (''creating'',''bound'',''paying'',''unknown'')');
 EXECUTE v_definition;
END;
$patch$;
