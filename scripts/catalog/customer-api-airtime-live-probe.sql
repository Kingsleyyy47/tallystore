-- Run inside the source migration runner's transaction after migration 330.
-- No provider calls. A temporary API key/access override is attached to one
-- eligible ordinary profile and rolled back before the financial snapshot.
SAVEPOINT customer_api_airtime_probe;
CREATE TEMP TABLE customer_api_airtime_probe_results (
  airtime_key_created boolean, airtime_authorized boolean,
  wrong_section_denied boolean, nonce_once boolean, replay_denied boolean,
  owner_restriction_denied boolean, revoked_denied boolean,
  pocketfi_section_denied boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
  probe_user uuid;
  probe_key uuid;
  probe_hash text := encode(sha256(convert_to('customer-api-airtime-probe:'||gen_random_uuid()::text,'UTF8')),'hex');
  probe_nonce uuid := gen_random_uuid();
  result jsonb;
BEGIN
  SELECT p.id INTO probe_user FROM public.profiles p
  WHERE p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
   AND p.account_suspended IS DISTINCT FROM true
   AND NOT EXISTS(SELECT 1 FROM public.customer_api_access a WHERE a.user_id=p.id)
   AND (SELECT count(*) FROM public.customer_api_keys k WHERE k.user_id=p.id AND k.revoked_at IS NULL)<12
  ORDER BY p.id LIMIT 1;
  IF probe_user IS NULL OR EXISTS(SELECT 1 FROM public.customer_api_keys WHERE key_hash=probe_hash)
  THEN RAISE EXCEPTION 'customer_api_airtime_probe_fixture_unavailable'; END IF;
  result := public.customer_api_create_key(probe_user,'airtime','TESTONLY330',probe_hash,'tlyc_airtime_'||left(probe_hash,8));
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'customer_api_airtime_probe_creation_failed'; END IF;
  probe_key := (result->>'id')::uuid;
  result := public.customer_api_authorize(probe_hash,'airtime',60);
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'key_id' IS DISTINCT FROM probe_key::text
    OR result->>'user_id' IS DISTINCT FROM probe_user::text THEN RAISE EXCEPTION 'customer_api_airtime_probe_authorization_failed'; END IF;
  result := public.customer_api_authorize(probe_hash,'products',60);
  IF result->>'code' IS DISTINCT FROM 'invalid_key' THEN RAISE EXCEPTION 'customer_api_airtime_probe_scope_failed'; END IF;
  IF public.customer_api_consume_capability(probe_key,probe_user,'airtime',probe_nonce) IS DISTINCT FROM true
    OR public.customer_api_consume_capability(probe_key,probe_user,'airtime',probe_nonce) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'customer_api_airtime_probe_replay_failed'; END IF;
  INSERT INTO public.customer_api_access(user_id,allowed_sections,is_active)
    VALUES(probe_user,ARRAY['products']::text[],true);
  result := public.customer_api_authorize(probe_hash,'airtime',60);
  IF result->>'code' IS DISTINCT FROM 'access_disabled'
    OR public.customer_api_consume_capability(probe_key,probe_user,'airtime',gen_random_uuid()) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'customer_api_airtime_probe_restriction_failed'; END IF;
  DELETE FROM public.customer_api_access WHERE user_id=probe_user;
  UPDATE public.customer_api_keys SET revoked_at=clock_timestamp() WHERE id=probe_key;
  result := public.customer_api_authorize(probe_hash,'airtime',60);
  IF result->>'code' IS DISTINCT FROM 'invalid_key'
    OR public.customer_api_consume_capability(probe_key,probe_user,'airtime',gen_random_uuid()) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'customer_api_airtime_probe_revocation_failed'; END IF;
  result := public.customer_api_create_key(probe_user,'pocketfi','TESTONLY330',repeat('b',64),'tlyc_pocketfi_bbbbbbbb');
  IF result->>'code' IS DISTINCT FROM 'INVALID_REQUEST' THEN
    RAISE EXCEPTION 'customer_api_airtime_probe_scope_failed'; END IF;
  INSERT INTO customer_api_airtime_probe_results VALUES(true,true,true,true,true,true,true,true);
END;
$probe$;
SELECT * FROM customer_api_airtime_probe_results;
ROLLBACK TO SAVEPOINT customer_api_airtime_probe;
RELEASE SAVEPOINT customer_api_airtime_probe;
