-- Caller: BEGIN; apply pending migration 250; run this transaction-only probe;
-- perform wrapper checks; ROLLBACK. This savepoint removes its own synthetic
-- partners, keys, orders, receipts and decisions but leaves migration 250 in
-- the outer transaction. No provider call or usable key is made.
SAVEPOINT partner_receipt_recovery_probe;
CREATE TEMP TABLE partner_receipt_recovery_probe_results (
  passed boolean, accepted_capture boolean, rejected_release boolean,
  unlimited_capture boolean, unknown_held boolean, owner_denied boolean,
  proof_denied boolean, replay_exact boolean, audit_immutable boolean,
  browser_denied boolean, customer_wallets_unchanged boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
  v_owner uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
  v_partner uuid := '9a250000-0000-4000-8000-000000000001';
  v_unlimited uuid := '9a250000-0000-4000-8000-000000000002';
  v_key uuid := '9a250000-0000-4000-8000-000000000011';
  v_unlimited_key uuid := '9a250000-0000-4000-8000-000000000012';
  v_fingerprint text := repeat('b',64);
  v_accepted uuid;
  v_rejected uuid;
  v_unknown uuid;
  v_credit uuid;
  v_hash text;
  v_result jsonb;
  v_balance numeric;
  v_wallet_before text;
  v_wallet_after text;
  v_immutable boolean := false;
  v_browser_denied boolean := false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_owner
      AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true)
    OR EXISTS(SELECT 1 FROM public.api_partners WHERE id IN(v_partner,v_unlimited))
    OR EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id IN(v_key,v_unlimited_key)
      OR key_hash IN(repeat('e',64),repeat('f',64))) THEN
    RAISE EXCEPTION 'receipt_recovery_probe_precondition_failed';
  END IF;
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_before FROM public.profiles;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,
    markup_percent,balance_ngn,unlimited_credit,owner_reviewed_at)
  VALUES(v_partner,'Synthetic Prepaid Recovery Probe','recovery-prepaid@example.invalid',
      true,ARRAY['sms'],0,100,false,clock_timestamp()),
    (v_unlimited,'Synthetic Unlimited Recovery Probe','recovery-unlimited@example.invalid',
      true,ARRAY['sms'],0,0,true,clock_timestamp());
  INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
  VALUES(v_key,v_partner,'Synthetic prepaid key','test_only',repeat('e',64),ARRAY['orders:create']),
    (v_unlimited_key,v_unlimited,'Synthetic unlimited key','test_only',repeat('f',64),ARRAY['orders:create']);

  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,10,10,'receipt-recovery-accepted-001',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'recovery_probe_reserve_accepted'; END IF;
  v_accepted:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_accepted,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'recovery_probe_claim_accepted'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_accepted,v_key,v_partner,
    v_fingerprint,10,'accepted','daisy','TEST-RECOVERY-250-A','active',NULL,
    '{"provider_order_id":"TEST-RECOVERY-250-A"}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'recovery_probe_receipt_accepted'; END IF;
  v_hash:=v_result->>'proof_hash';
  v_result:=public.get_api_partner_dispatch_receipt_review(v_owner,ARRAY[v_accepted]);
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR v_result->'cases' IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
      'order_id',v_accepted,'receipt_outcome','accepted','receipt_proof_hash',v_hash))
  THEN RAISE EXCEPTION 'recovery_probe_review_redaction_failed'; END IF;
  IF (public.get_api_partner_dispatch_receipt_review(
    '00000000-0000-4000-8000-000000000001'::uuid,ARRAY[v_accepted]))->>'code'
      IS DISTINCT FROM 'OWNER_DENIED'
  THEN RAISE EXCEPTION 'recovery_probe_review_owner_admitted'; END IF;
  IF (public.reconcile_api_partner_dispatch_receipt(v_accepted,v_owner,repeat('c',64)))->>'code'
      IS DISTINCT FROM 'BINDING_MISMATCH'
    OR (public.reconcile_api_partner_dispatch_receipt(v_accepted,
      '00000000-0000-4000-8000-000000000001'::uuid,v_hash))->>'code'
      IS DISTINCT FROM 'OWNER_DENIED'
  THEN RAISE EXCEPTION 'recovery_probe_owner_or_proof_admitted'; END IF;
  UPDATE public.api_partners SET is_active=false,owner_reviewed_at=NULL WHERE id=v_partner;
  UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=v_key;
  v_result:=public.reconcile_api_partner_dispatch_receipt(v_accepted,v_owner,v_hash);
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
    OR (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=v_accepted)<>1
    OR (SELECT count(*) FROM public.api_partner_external_events
      WHERE order_id=v_accepted AND event_type='capture')<>1
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_partner)<>90
  THEN RAISE EXCEPTION 'recovery_probe_accepted_capture_failed'; END IF;
  IF (public.reconcile_api_partner_dispatch_receipt(v_accepted,v_owner,v_hash))->>'idempotent_replay'
      IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'recovery_probe_accepted_replay_failed'; END IF;
  IF (public.get_api_partner_dispatch_receipt_review(v_owner,ARRAY[v_accepted]))->'cases'
      IS DISTINCT FROM '[]'::jsonb
  THEN RAISE EXCEPTION 'recovery_probe_settled_review_still_listed'; END IF;
  BEGIN
    UPDATE private.api_partner_receipt_reconciliation_decisions
      SET decision='rejected' WHERE order_id=v_accepted;
    RAISE EXCEPTION 'recovery_probe_audit_mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'partner_dispatch_receipt_immutable'
    THEN RAISE; END IF;
    v_immutable:=true;
  END;
  UPDATE public.api_partners SET is_active=true,owner_reviewed_at=clock_timestamp()
    WHERE id=v_partner;
  UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=v_key;

  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,20,20,'receipt-recovery-rejected-002',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  v_rejected:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_rejected,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'recovery_probe_claim_rejected'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_rejected,v_key,v_partner,
    v_fingerprint,20,'rejected',NULL,NULL,'failed','NO_STOCK','{}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'recovery_probe_receipt_rejected'; END IF;
  v_balance:=(SELECT balance_ngn FROM public.api_partners WHERE id=v_partner);
  v_result:=public.reconcile_api_partner_dispatch_receipt(v_rejected,v_owner,v_result->>'proof_hash');
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_partner)<>v_balance+20
    OR (SELECT count(*) FROM public.api_partner_external_events
      WHERE order_id=v_rejected AND event_type='release')<>1
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=v_rejected)
  THEN RAISE EXCEPTION 'recovery_probe_rejected_release_failed'; END IF;

  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture',
    'Fixture SMS',1,5,5,'receipt-recovery-unknown-003',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  v_unknown:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_unknown,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'recovery_probe_claim_unknown'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_unknown,v_key,v_partner,
    v_fingerprint,5,'unknown',NULL,NULL,'processing',NULL,'{}'::jsonb);
  IF (public.reconcile_api_partner_dispatch_receipt(v_unknown,v_owner,v_result->>'proof_hash'))->>'code'
      IS DISTINCT FROM 'UNKNOWN_REQUIRES_REVIEW'
    OR (SELECT state FROM public.api_partner_external_orders WHERE order_id=v_unknown)<>'sending'
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events
      WHERE order_id=v_unknown AND event_type IN('capture','release'))
  THEN RAISE EXCEPTION 'recovery_probe_unknown_settled'; END IF;

  v_result:=public.reserve_api_partner_external_order(v_unlimited_key,'sms','sms','fixture',
    'Fixture SMS',1,200,200,'receipt-recovery-unlimited-004',v_fingerprint,
    '{}'::jsonb,NULL,NULL,NULL);
  v_credit:=(v_result->>'order_id')::uuid;
  IF (public.claim_api_partner_external_dispatch(v_credit,v_unlimited_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'recovery_probe_claim_unlimited'; END IF;
  v_result:=public.record_api_partner_dispatch_receipt(v_credit,v_unlimited_key,v_unlimited,
    v_fingerprint,200,'accepted','daisy','TEST-RECOVERY-250-C','active',NULL,
    '{"provider_order_id":"TEST-RECOVERY-250-C"}'::jsonb);
  v_result:=public.reconcile_api_partner_dispatch_receipt(v_credit,v_owner,v_result->>'proof_hash');
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_unlimited)<>0
    OR (SELECT funding_type FROM public.api_partner_obligations WHERE order_id=v_credit)
      IS DISTINCT FROM 'unlimited_credit'
  THEN RAISE EXCEPTION 'recovery_probe_unlimited_capture_failed'; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.reconcile_api_partner_dispatch_receipt(v_accepted,v_owner,v_hash);
    RAISE EXCEPTION 'recovery_probe_browser_settled';
  EXCEPTION WHEN insufficient_privilege THEN v_browser_denied:=true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_after FROM public.profiles;
  IF v_wallet_before IS DISTINCT FROM v_wallet_after OR NOT v_browser_denied OR NOT v_immutable
  THEN RAISE EXCEPTION 'recovery_probe_isolation_failed'; END IF;
  INSERT INTO partner_receipt_recovery_probe_results
    VALUES(true,true,true,true,true,true,true,true,v_immutable,v_browser_denied,true);
END;
$probe$;
SELECT * FROM partner_receipt_recovery_probe_results;
ROLLBACK TO SAVEPOINT partner_receipt_recovery_probe;
RELEASE SAVEPOINT partner_receipt_recovery_probe;
