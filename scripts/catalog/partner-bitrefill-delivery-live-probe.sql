-- Caller: BEGIN ISOLATION LEVEL REPEATABLE READ; apply pending 270; run probe;
-- inspect only boolean/count results; ROLLBACK. No provider/network requests.
-- Unusable synthetic key hashes and financial fixtures are savepoint-local.
SAVEPOINT partner_bitrefill_delivery_probe;
CREATE TEMP TABLE partner_bitrefill_delivery_probe_results (
 passed boolean, exact_delivery_owner_capture boolean, held_unknown_recovered boolean,
 replay_once boolean, unchanged_balances boolean, invalid_evidence_denied boolean,
 private_proof_immutable boolean, browser_denied boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
 p uuid := '9a270000-0000-4000-8000-000000000001';
 k uuid := '9a270000-0000-4000-8000-000000000011';
 owner_id uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
 v_order_id uuid; result jsonb; proof text; balance numeric;
 wallets_before text; wallets_after text;
 delivery jsonb := '{"item_id":"test-card","quantity":2,"unit_value":10,"currency":"USD","provider_status":"complete","redemptions":[{"order_id":"TEST-270-UNIT-1","code":"SYNTHETIC-270-CODE"},{"order_id":"TEST-270-UNIT-2","link":"https://example.invalid/redeem/test"}]}'::jsonb;
 denied integer := 0; browser_denials integer := 0; immutable_denials integer := 0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true)
 OR EXISTS(SELECT 1 FROM public.api_partners WHERE id=p)
 OR EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=k OR key_hash=repeat('e',64))
 OR EXISTS(SELECT 1 FROM private.api_partner_bitrefill_invoice_bindings WHERE invoice_id='TEST-INVOICE-270-LIVE') THEN
 RAISE EXCEPTION 'delivery_probe_precondition_failed'; END IF;
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(id,wallet_balance) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO wallets_before FROM public.profiles;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,markup_percent,balance_ngn,unlimited_credit,owner_reviewed_at)
 VALUES(p,'Synthetic Delivery Probe','delivery-probe@example.invalid',true,ARRAY['giftcards'],0,100,false,clock_timestamp());
 INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
 VALUES(k,p,'Synthetic delivery key','test_only',repeat('e',64),ARRAY['orders:create']);
 result:=public.reserve_api_partner_external_order(k,'giftcards','giftcards','test-card','Test card',2,40,40,
 'bitrefill-delivery-probe-001',repeat('e',64),'{"product_id":"test-card","quantity":2,"value":10,"provider_currency":"USD"}'::jsonb,NULL,NULL,NULL);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'delivery_probe_reserve_failed'; END IF;
 v_order_id:=(result->>'order_id')::uuid;
 IF (public.claim_api_partner_external_dispatch(v_order_id,k))->>'send_allowed' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'delivery_probe_claim_failed'; END IF;
 IF (public.bind_api_partner_bitrefill_invoice(v_order_id,p,'TEST-INVOICE-270-LIVE','unpaid','test-card',2,40))->>'pay_allowed' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'delivery_probe_bind_failed'; END IF;
 balance:=(SELECT balance_ngn FROM public.api_partners WHERE id=p);
 IF (public.record_api_partner_external_outcome(v_order_id,'unknown',NULL,NULL,'{}'::jsonb,'processing',NULL))->>'success' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'delivery_probe_unknown_failed'; END IF;
 IF (public.reconcile_api_partner_bitrefill_delivery(v_order_id,owner_id,repeat('f',64)))->>'code'='EVIDENCE_MISMATCH' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,'00000000-0000-4000-8000-000000000001','TEST-INVOICE-270-LIVE',delivery))->>'code'='OWNER_DENIED' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'FOREIGN-INVOICE',delivery))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery||'{"extra":true}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery||'{"unit_value":11}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery||'{"quantity":1}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery||'{"redemptions":[{"order_id":"DUPLICATE","code":"TEST"},{"order_id":"DUPLICATE","code":"TEST"}]}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery||'{"redemptions":[{"order_id":"TEST-UNIT","link":"https://user:password@example.invalid/x"},{"order_id":"TEST-UNIT-2","code":"TEST"}]}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 IF denied<>8 OR EXISTS(SELECT 1 FROM private.api_partner_bitrefill_delivery_evidence e WHERE e.order_id=v_order_id)
 OR EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=v_order_id AND event_type IN ('capture','release'))
 OR EXISTS(SELECT 1 FROM public.api_partner_obligations o WHERE o.order_id=v_order_id)
 THEN RAISE EXCEPTION 'delivery_probe_denial_or_hold_failed'; END IF;
 -- Paid holds may recover after key revocation and partner disablement.
 UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=k;
 UPDATE public.api_partners SET is_active=false WHERE id=p;
 result:=public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery);
 proof:=result->>'evidence_proof_hash';
 IF result->>'success' IS DISTINCT FROM 'true' OR proof !~ '^[a-f0-9]{64}$'
 OR result->'quantity' IS DISTINCT FROM '2'::jsonb OR result->'amount_ngn' IS DISTINCT FROM '40'::jsonb
 OR result->>'funding_type' IS DISTINCT FROM 'prepaid'
 OR result ? 'redemptions' OR result::text LIKE '%SYNTHETIC-270-CODE%'
 THEN RAISE EXCEPTION 'delivery_probe_evidence_failed'; END IF;
 IF (public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery))->>'idempotent_replay' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'delivery_probe_evidence_replay_failed'; END IF;
 IF (public.reconcile_api_partner_bitrefill_delivery(v_order_id,owner_id,repeat('f',64)))->>'code' IS DISTINCT FROM 'EVIDENCE_MISMATCH'
 THEN RAISE EXCEPTION 'delivery_probe_foreign_proof_admitted'; END IF;
 result:=public.reconcile_api_partner_bitrefill_delivery(v_order_id,owner_id,proof);
 IF result->>'success' IS DISTINCT FROM 'true' OR result->>'status' IS DISTINCT FROM 'completed' OR result->>'decision' IS DISTINCT FROM 'accepted'
 OR result->>'idempotent_replay' IS DISTINCT FROM 'false'
 OR (public.reconcile_api_partner_bitrefill_delivery(v_order_id,owner_id,proof))->>'idempotent_replay' IS DISTINCT FROM 'true'
 OR (SELECT balance_ngn FROM public.api_partners WHERE id=p)<>balance
 OR (SELECT count(*) FROM public.api_partner_external_events e WHERE e.order_id=v_order_id AND event_type='capture')<>1
 OR (SELECT count(*) FROM public.api_partner_obligations o WHERE o.order_id=v_order_id)<>1
 OR EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=v_order_id AND event_type='release')
 OR NOT EXISTS(SELECT 1 FROM public.api_partner_orders o WHERE o.id=v_order_id AND status='completed'
  AND response_payload->'redemptions'=delivery->'redemptions' AND refunded_at IS NULL AND refund_amount_ngn IS NULL)
 THEN RAISE EXCEPTION 'delivery_probe_capture_replay_or_balance_failed'; END IF;
 BEGIN UPDATE private.api_partner_bitrefill_delivery_evidence e SET evidence_proof_hash=repeat('f',64) WHERE e.order_id=v_order_id;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'partner_dispatch_receipt_immutable' THEN RAISE; END IF; immutable_denials:=immutable_denials+1; END;
 BEGIN DELETE FROM private.api_partner_bitrefill_delivery_decisions d WHERE d.order_id=v_order_id;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'partner_dispatch_receipt_immutable' THEN RAISE; END IF; immutable_denials:=immutable_denials+1; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.record_api_partner_bitrefill_delivery_evidence(v_order_id,owner_id,'TEST-INVOICE-270-LIVE',delivery);
 EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM public.reconcile_api_partner_bitrefill_delivery(v_order_id,owner_id,proof);
 EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM 1 FROM private.api_partner_bitrefill_delivery_evidence;
 EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(id,wallet_balance) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO wallets_after FROM public.profiles;
 IF immutable_denials<>2 OR browser_denials<>3 OR wallets_before IS DISTINCT FROM wallets_after
 THEN RAISE EXCEPTION 'delivery_probe_scope_or_immutability_failed'; END IF;
 INSERT INTO partner_bitrefill_delivery_probe_results VALUES(true,true,true,true,true,true,true,true);
END;
$probe$;
SELECT * FROM partner_bitrefill_delivery_probe_results;
ROLLBACK TO SAVEPOINT partner_bitrefill_delivery_probe;
RELEASE SAVEPOINT partner_bitrefill_delivery_probe;
