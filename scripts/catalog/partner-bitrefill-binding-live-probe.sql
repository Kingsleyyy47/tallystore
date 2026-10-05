-- Caller: BEGIN; apply pending migration 260; run this transaction-only probe;
-- inspect guard checks; ROLLBACK. The savepoint removes only its synthetic
-- fixtures. There are no provider requests or usable API tokens.
SAVEPOINT partner_bitrefill_binding_probe;
CREATE TEMP TABLE partner_bitrefill_binding_probe_results (
  passed boolean, unpaid_claim_only boolean, one_use_pay_authorization boolean,
  owner_read_bound_id boolean, mismatched_receipt_denied boolean,
  no_money_write boolean, browser_denied boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
  v_partner uuid := '9a260000-0000-4000-8000-000000000001';
  v_key uuid := '9a260000-0000-4000-8000-000000000011';
  v_owner uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
  v_fingerprint text := repeat('d',64);
  v_order uuid;
  v_result jsonb;
  v_balance numeric;
  v_events integer;
  v_wallet_before text;
  v_wallet_after text;
  v_wrong_denied boolean := false;
  v_financial_denied boolean := false;
  v_browser_denied boolean := false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_owner
      AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true)
    OR EXISTS(SELECT 1 FROM public.api_partners WHERE id=v_partner)
    OR EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=v_key OR key_hash=repeat('d',64))
    OR EXISTS(SELECT 1 FROM private.api_partner_bitrefill_invoice_bindings
      WHERE invoice_id='TEST-INVOICE-260-LIVE') THEN
    RAISE EXCEPTION 'bitrefill_binding_probe_precondition_failed';
  END IF;
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_before FROM public.profiles;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,
    markup_percent,balance_ngn,unlimited_credit,owner_reviewed_at)
  VALUES(v_partner,'Synthetic Bitrefill Binding Probe','binding-probe@example.invalid',
    true,ARRAY['giftcards'],0,100,false,clock_timestamp());
  INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
  VALUES(v_key,v_partner,'Synthetic binding key','test_only',repeat('d',64),ARRAY['orders:create']);
  v_result:=public.reserve_api_partner_external_order(v_key,'giftcards','giftcards',
    'test-card','Test card',2,40,40,'bitrefill-binding-probe-001',v_fingerprint,
    '{"product_id":"test-card","quantity":2,"value":10}'::jsonb,NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'binding_probe_reserve_failed'; END IF;
  v_order:=(v_result->>'order_id')::uuid;
  v_result:=public.bind_api_partner_bitrefill_invoice(v_order,v_partner,
    'TEST-INVOICE-260-LIVE','unpaid','test-card',2,40);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCH_NOT_ELIGIBLE'
  THEN RAISE EXCEPTION 'binding_probe_prepared_admitted'; END IF;
  IF (public.claim_api_partner_external_dispatch(v_order,v_key))->>'send_allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'binding_probe_claim_failed'; END IF;
  v_balance:=(SELECT balance_ngn FROM public.api_partners WHERE id=v_partner);
  v_events:=(SELECT count(*) FROM public.api_partner_external_events WHERE order_id=v_order);
  v_result:=public.bind_api_partner_bitrefill_invoice(v_order,v_partner,
    'TEST-INVOICE-260-LIVE','complete','test-card',2,40);
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_INVOICE'
  THEN RAISE EXCEPTION 'binding_probe_paid_creation_admitted'; END IF;
  v_result:=public.bind_api_partner_bitrefill_invoice(v_order,v_partner,
    'TEST-INVOICE-260-LIVE','unpaid','test-card',2,40);
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR v_result->>'pay_allowed' IS DISTINCT FROM 'true'
    OR v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'binding_probe_first_bind_failed'; END IF;
  v_result:=public.bind_api_partner_bitrefill_invoice(v_order,v_partner,
    'TEST-INVOICE-260-LIVE','unpaid','test-card',2,40);
  IF v_result->>'pay_allowed' IS DISTINCT FROM 'false'
    OR v_result->>'idempotent_replay' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'binding_probe_second_pay_allowed'; END IF;
  v_result:=public.get_api_partner_bitrefill_bound_invoice(v_order,v_owner);
  IF v_result->>'bound' IS DISTINCT FROM 'true'
    OR v_result->>'invoice_id' IS DISTINCT FROM 'TEST-INVOICE-260-LIVE'
    OR (public.get_api_partner_bitrefill_bound_invoice(v_order,
      '00000000-0000-4000-8000-000000000001'::uuid))->>'code'
        IS DISTINCT FROM 'OWNER_DENIED'
  THEN RAISE EXCEPTION 'binding_probe_owner_read_failed'; END IF;
  v_result:=public.get_api_partner_bitrefill_bound_invoices(v_owner,ARRAY[v_order,v_order]);
  IF v_result->'cases' IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
      'order_id',v_order,'invoice_id','TEST-INVOICE-260-LIVE'))
    OR (public.get_api_partner_bitrefill_bound_invoices(v_owner,
      array_fill(v_order,ARRAY[51])))->>'code' IS DISTINCT FROM 'INVALID_REQUEST'
  THEN RAISE EXCEPTION 'binding_probe_batch_scope_failed'; END IF;
  BEGIN
    PERFORM public.record_api_partner_external_outcome(v_order,'accepted',
      'bitrefill','TEST-INVOICE-260-LIVE',
      '{"invoice_id":"TEST-INVOICE-260-LIVE"}'::jsonb,'processing',NULL);
    RAISE EXCEPTION 'binding_probe_receiptless_financial_outcome_admitted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'bitrefill_invoice_receipt_required' THEN RAISE; END IF;
    v_financial_denied:=true;
  END;
  BEGIN
    PERFORM public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
      v_fingerprint,40,'accepted','bitrefill','WRONG-INVOICE','processing',NULL,
      '{"invoice_id":"WRONG-INVOICE"}'::jsonb);
    RAISE EXCEPTION 'binding_probe_foreign_receipt_admitted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'bitrefill_invoice_binding_required' THEN RAISE; END IF;
    v_wrong_denied:=true;
  END;
  v_result:=public.record_api_partner_dispatch_receipt(v_order,v_key,v_partner,
    v_fingerprint,40,'accepted','bitrefill','TEST-INVOICE-260-LIVE','processing',NULL,
    '{"invoice_id":"TEST-INVOICE-260-LIVE","provider_order_id":null}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_partner)<>v_balance
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=v_order)<>v_events
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=v_order)
  THEN RAISE EXCEPTION 'binding_probe_money_or_receipt_failed'; END IF;
  -- The new binding guard must also admit the already-reviewed owner recovery
  -- path, without a second debit, and preserve its exact replay after a status
  -- update. These synthetic financial records are all rolled back below.
  v_result:=public.reconcile_api_partner_dispatch_receipt(v_order,v_owner,v_result->>'proof_hash');
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_partner)<>v_balance
    OR (SELECT count(*) FROM public.api_partner_external_events
      WHERE order_id=v_order AND event_type='capture')<>1
    OR (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=v_order)<>1
  THEN RAISE EXCEPTION 'binding_probe_owner_capture_failed'; END IF;
  UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read'] WHERE id=v_key;
  v_result:=public.update_api_partner_external_status(v_key,v_order,'bitrefill',
    'TEST-INVOICE-260-LIVE','processing','{"provider_status":"pending"}'::jsonb);
  IF v_result->>'success' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'binding_probe_status_update_failed'; END IF;
  v_result:=public.reconcile_api_partner_dispatch_receipt(v_order,v_owner,
    (SELECT proof_hash FROM private.api_partner_dispatch_receipts WHERE order_id=v_order));
  IF v_result->>'idempotent_replay' IS DISTINCT FROM 'true'
    OR (SELECT count(*) FROM public.api_partner_external_events
      WHERE order_id=v_order AND event_type='capture')<>1
  THEN RAISE EXCEPTION 'binding_probe_owner_replay_failed'; END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.bind_api_partner_bitrefill_invoice(v_order,v_partner,
      'OTHER','unpaid','test-card',2,40);
    RAISE EXCEPTION 'binding_probe_browser_bound';
  EXCEPTION WHEN insufficient_privilege THEN v_browser_denied:=true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_after FROM public.profiles;
  IF v_wallet_before IS DISTINCT FROM v_wallet_after OR NOT v_wrong_denied
    OR NOT v_financial_denied OR NOT v_browser_denied
  THEN RAISE EXCEPTION 'binding_probe_isolation_failed'; END IF;
  INSERT INTO partner_bitrefill_binding_probe_results
    VALUES(true,true,true,true,v_wrong_denied,true,v_browser_denied);
END;
$probe$;
SELECT * FROM partner_bitrefill_binding_probe_results;
ROLLBACK TO SAVEPOINT partner_bitrefill_binding_probe;
RELEASE SAVEPOINT partner_bitrefill_binding_probe;
