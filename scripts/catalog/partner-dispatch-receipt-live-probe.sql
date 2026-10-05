-- Caller starts BEGIN, applies the pending receipt migration, then runs this
-- transaction-only probe. Its savepoint rollback removes only synthetic data;
-- caller owns the final transaction ROLLBACK, including pending migration.
-- There are no provider calls or usable API tokens.
SAVEPOINT partner_dispatch_receipt_probe;
CREATE TEMP TABLE partner_dispatch_receipt_probe_results (
  passed boolean, accepted_saved boolean, rejected_saved boolean,
  unknown_saved boolean, replay_exact boolean, forged_denials integer,
  no_money_writes boolean, authenticated_denied boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
  v_partner uuid := '9a240000-0000-4000-8000-000000000001';
  v_key uuid := '9a240000-0000-4000-8000-000000000002';
  v_fingerprint text := repeat('a',64);
  v_order uuid;
  v_rejected uuid;
  v_unknown uuid;
  v_result jsonb;
  v_denials integer := 0;
  v_balance numeric;
  v_events integer;
  v_wallet_before text;
  v_wallet_after text;
  v_auth_denied boolean := false;
BEGIN
  IF EXISTS(SELECT 1 FROM public.api_partners WHERE id=v_partner)
    OR EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=v_key OR key_hash=repeat('a',64))
  THEN RAISE EXCEPTION 'dispatch_receipt_probe_fixture_collision'; END IF;
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_before FROM public.profiles;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,
    markup_percent,balance_ngn,unlimited_credit,owner_reviewed_at)
  VALUES(v_partner,'Synthetic Dispatch Receipt Probe','partner-probe@example.invalid',
    true,ARRAY['sms'],0,500,false,clock_timestamp());
  INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
  VALUES(v_key,v_partner,'Synthetic receipt key','test_only',repeat('a',64),ARRAY['orders:create']);
  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,10,10,'dispatch-receipt-probe-accepted-001',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_probe_reserve_failed'; END IF;
  v_order:=(v_result->>'order_id')::uuid;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A"}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCH_NOT_CLAIMED'
  THEN RAISE EXCEPTION 'receipt_probe_prepared_admitted'; END IF;
  v_denials:=v_denials+1;
  v_result:=public.claim_api_partner_external_dispatch(v_order,v_key);
  IF v_result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_probe_claim_failed'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,11,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A"}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'RECEIPT_BINDING_MISMATCH'
  THEN RAISE EXCEPTION 'receipt_probe_amount_forgery_admitted'; END IF;
  v_denials:=v_denials+1;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A',NULL,NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A"}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_RECEIPT'
  THEN RAISE EXCEPTION 'receipt_probe_null_status_admitted'; END IF;
  v_denials:=v_denials+1;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"OTHER"}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_RECEIPT'
  THEN RAISE EXCEPTION 'receipt_probe_conflicting_identity_admitted'; END IF;
  v_denials:=v_denials+1;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A","secret":"FORBIDDEN"}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_RECEIPT'
  THEN RAISE EXCEPTION 'receipt_probe_private_payload_admitted'; END IF;
  v_denials:=v_denials+1;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_partner;
  SELECT count(*) INTO v_events FROM public.api_partner_external_events WHERE partner_id=v_partner;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A"}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'receipt_probe_acceptance_failed'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,
    '{"provider_order_id":"TEST-RECEIPT-240-A"}'::jsonb);
  IF v_result->>'idempotent_replay' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'receipt_probe_replay_failed'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,10,'unknown',NULL,NULL,'processing',NULL,'{}'::jsonb);
  IF v_result->>'code' IS DISTINCT FROM 'RECEIPT_CONFLICT'
  THEN RAISE EXCEPTION 'receipt_probe_conflicting_replay_admitted'; END IF;
  v_denials:=v_denials+1;
  IF (SELECT balance_ngn FROM public.api_partners WHERE id=v_partner)<>v_balance
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE partner_id=v_partner)<>v_events
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE partner_id=v_partner)
  THEN RAISE EXCEPTION 'receipt_probe_money_changed'; END IF;
  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,10,10,'dispatch-receipt-probe-rejected-002',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  v_rejected:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_rejected,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'receipt_probe_rejected_claim_failed'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_rejected,v_key,v_partner,
    v_fingerprint,10,'rejected',NULL,NULL,'failed','NO_STOCK','{}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_probe_rejection_failed'; END IF;
  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,10,10,'dispatch-receipt-probe-unknown-003',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  v_unknown:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_unknown,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'receipt_probe_unknown_claim_failed'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_unknown,v_key,v_partner,
    v_fingerprint,10,'unknown',NULL,NULL,'processing',NULL,'{}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_probe_unknown_failed'; END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
      v_fingerprint,10,'accepted','daisy','TEST-RECEIPT-240-A','active',NULL,'{}'::jsonb);
    RAISE EXCEPTION 'receipt_probe_browser_setter_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_auth_denied:=true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_after FROM public.profiles;
  IF v_wallet_before IS DISTINCT FROM v_wallet_after OR NOT v_auth_denied OR v_denials<>6
  THEN RAISE EXCEPTION 'receipt_probe_wallet_or_browser_boundary_failed'; END IF;
  INSERT INTO partner_dispatch_receipt_probe_results VALUES(true,true,true,true,true,
    v_denials,true,v_auth_denied);
END;
$probe$;
SELECT * FROM partner_dispatch_receipt_probe_results;
ROLLBACK TO SAVEPOINT partner_dispatch_receipt_probe;
RELEASE SAVEPOINT partner_dispatch_receipt_probe;
