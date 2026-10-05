-- Exercises the actual partner finance schema without calling a provider.
-- All test partners, holds, orders and events are rolled back.
BEGIN;
DO $probe$
DECLARE
  v_partner uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_one jsonb;
  v_two jsonb;
  v_order uuid;
  v_balance numeric;
BEGIN
  INSERT INTO public.api_partners(id,name,is_active,owner_reviewed_at,
    allowed_sections,balance_ngn,unlimited_credit)
    VALUES(v_partner,'Transaction verification fixture',true,now(),ARRAY['sms'],1200,false);
  INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
    VALUES(v_key,v_partner,'Transaction fixture','tly_probe',
      encode(sha256(convert_to(v_key::text,'UTF8')),'hex'),ARRAY['orders:create']);
  v_one:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,1500,1500,'external-insufficient-fixture',repeat('a',64),'{}'::jsonb);
  IF v_one->>'code'<>'INSUFFICIENT_PARTNER_BALANCE' THEN RAISE EXCEPTION 'insufficient_balance_not_denied'; END IF;
  v_one:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,400,400,'external-accepted-fixture',repeat('a',64),'{}'::jsonb);
  IF (v_one->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'reserve_failed'; END IF;
  v_order:=(v_one->>'order_id')::uuid;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_partner;
  IF v_balance<>800 THEN RAISE EXCEPTION 'hold_amount_incorrect'; END IF;
  v_two:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,400,400,'external-accepted-fixture',repeat('a',64),'{}'::jsonb);
  IF (v_two->>'idempotent_replay')::boolean IS DISTINCT FROM true OR (v_two->>'order_id')::uuid<>v_order THEN
    RAISE EXCEPTION 'reserve_replay_failed'; END IF;
  v_one:=public.claim_api_partner_external_dispatch(v_order,v_key);
  IF (v_one->>'send_allowed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'claim_failed'; END IF;
  v_two:=public.claim_api_partner_external_dispatch(v_order,v_key);
  IF v_two->>'code'<>'DISPATCH_ALREADY_CLAIMED' THEN RAISE EXCEPTION 'duplicate_send_allowed'; END IF;
  v_one:=public.record_api_partner_external_outcome(v_order,'accepted','daisy',v_order::text,
    '{"service_name":"Fixture SMS"}'::jsonb,'active',NULL);
  IF (v_one->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'accept_failed'; END IF;
  v_two:=public.record_api_partner_external_outcome(v_order,'accepted','daisy',v_order::text,
    '{"service_name":"Fixture SMS"}'::jsonb,'active',NULL);
  IF (v_two->>'idempotent_replay')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'accept_replay_failed'; END IF;
  IF (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=v_order)<>1 THEN RAISE EXCEPTION 'capture_count_incorrect'; END IF;
  v_one:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,200,200,'external-rejected-fixture',repeat('b',64),'{}'::jsonb);
  v_order:=(v_one->>'order_id')::uuid;
  PERFORM public.claim_api_partner_external_dispatch(v_order,v_key);
  v_one:=public.record_api_partner_external_outcome(v_order,'rejected',NULL,NULL,'{}'::jsonb,'failed','NO_STOCK');
  IF (v_one->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'release_failed'; END IF;
  v_two:=public.record_api_partner_external_outcome(v_order,'rejected',NULL,NULL,'{}'::jsonb,'failed','NO_STOCK');
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_partner;
  IF v_balance<>800 OR (v_two->>'idempotent_replay')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'release_replay_incorrect'; END IF;
  v_one:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,100,100,'external-unknown-fixture',repeat('c',64),'{}'::jsonb);
  v_order:=(v_one->>'order_id')::uuid;
  PERFORM public.claim_api_partner_external_dispatch(v_order,v_key);
  v_one:=public.record_api_partner_external_outcome(v_order,'unknown',NULL,NULL,'{}'::jsonb,'processing',NULL);
  v_two:=public.record_api_partner_external_outcome(v_order,'rejected',NULL,NULL,'{}'::jsonb,'failed','NO_STOCK');
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_partner;
  IF v_balance<>700 OR v_two->>'code'<>'OUTCOME_CONFLICT' THEN RAISE EXCEPTION 'unknown_hold_not_preserved'; END IF;
  UPDATE public.api_partners SET unlimited_credit=true WHERE id=v_partner;
  v_one:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,2000,2000,'external-unlimited-fixture',repeat('d',64),'{}'::jsonb);
  v_order:=(v_one->>'order_id')::uuid;
  PERFORM public.claim_api_partner_external_dispatch(v_order,v_key);
  v_one:=public.record_api_partner_external_outcome(v_order,'accepted','daisy',v_order::text,'{}'::jsonb,'active',NULL);
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_partner;
  IF v_balance<>700 OR (v_one->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'unlimited_finance_incorrect'; END IF;
END;
$probe$;
SELECT jsonb_build_object('insufficient_denied',true,'hold_once',true,'paid_claim_once',true,
  'capture_once',true,'release_once',true,'unknown_held',true,'unlimited_isolated',true,
  'browser_can_reserve',has_function_privilege('authenticated',
    'public.reserve_api_partner_external_order(uuid,text,text,text,text,integer,numeric,numeric,text,text,jsonb,text,text,text)','EXECUTE'),
  'browser_can_read_journal',has_table_privilege('authenticated','public.api_partner_external_orders','SELECT')) AS evidence;
ROLLBACK;
