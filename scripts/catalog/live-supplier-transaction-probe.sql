-- Only run in a transaction ending ROLLBACK. No provider HTTP call is made.
-- Exercises the actual production financial truth, reserve, capture and journal.
CREATE TEMP TABLE supplier_transaction_probe (reserved boolean, attached boolean, completed boolean, replayed boolean, captures bigint, confirmed_rejection_released boolean);
DO $$
DECLARE
  v_user uuid;
  v_product public.product_groups%ROWTYPE;
  v_provider text;
  v_provider_product text;
  v_quantity integer;
  v_amount numeric;
  v_key text := 'rollback-verification-'||gen_random_uuid()::text;
  v_auth jsonb;
  v_attempt jsonb;
  v_result jsonb;
  v_attached jsonb;
  v_completion jsonb;
  v_replay jsonb;
  v_ids uuid[];
  v_credentials jsonb;
  v_details jsonb;
BEGIN
  SELECT pg.* INTO v_product FROM public.product_groups pg
  WHERE pg.is_active=true AND pg.is_sellable=true AND pg.auto_fulfill_enabled=true
    AND pg.stock_count BETWEEN 1 AND 98 AND pg.price>0
    AND pg.supplier_fallback_blocked=false
    AND (pg.muabanvia_product_id IS NOT NULL OR pg.shopclone_product_id IS NOT NULL OR pg.shopviaclone_product_id IS NOT NULL)
  ORDER BY pg.price*(pg.stock_count+1) LIMIT 1;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'No mapped stocked fixture'; END IF;
  SELECT count(*)::integer+1 INTO v_quantity FROM public.individual_accounts WHERE product_group_id=v_product.id AND status='available';
  v_amount := v_product.price*v_quantity;
  SELECT p.id INTO v_user FROM public.profiles p
  CROSS JOIN LATERAL public.wallet_financial_truth_internal(p.id) AS ledger(truth)
  WHERE p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
    AND p.account_suspended IS DISTINCT FROM true
    AND (truth->>'spending_blocked')::boolean=false
    AND (truth->>'confirmed_spendable')::numeric>=v_amount+v_product.price
  LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No funded active customer fixture'; END IF;
  SELECT provider,product_id INTO v_provider,v_provider_product FROM (VALUES
    ('muabanvia',v_product.muabanvia_product_id),('shopclone',v_product.shopclone_product_id),
    ('shopviaclone',v_product.shopviaclone_product_id)
  ) mapped(provider,product_id) WHERE NULLIF(btrim(COALESCE(product_id,'')),'') IS NOT NULL LIMIT 1;
  PERFORM public.refresh_supplier_product_availability(v_product.id,true);
  SELECT public.authorize_supplier_product_purchase(v_user,v_product.id,v_quantity,v_amount,v_key,
    jsonb_build_object('source','rollback-verification','supplier_configured_providers',jsonb_build_array(v_provider)),
    (SELECT GREATEST(COALESCE(financial_security_version,1),1) FROM public.profiles WHERE id=v_user)) INTO v_auth;
  IF (v_auth->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Reserve failed: %',v_auth->>'code'; END IF;
  SELECT public.begin_supplier_purchase_attempt((v_auth->>'order_id')::uuid,(v_auth->>'reservation_id')::uuid,
    v_provider,v_provider_product,v_key||':attempt') INTO v_attempt;
  IF (v_attempt->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Begin failed: %',v_attempt->>'code'; END IF;
  SELECT public.mark_supplier_purchase_sending((v_attempt->>'attempt_id')::uuid) INTO v_result;
  IF (v_result->>'send_allowed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Claim failed: %',v_result->>'code'; END IF;
  SELECT jsonb_agg(jsonb_build_object('username','rollback-fixture-'||i,'password','verification-only-do-not-commit'))
    INTO v_credentials FROM generate_series(1,(v_auth->>'supplier_quantity')::integer) i;
  SELECT public.record_supplier_purchase_outcome((v_attempt->>'attempt_id')::uuid,'succeeded',v_key,v_credentials,NULL) INTO v_result;
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Outcome failed: %',v_result->>'code'; END IF;
  SELECT public.attach_supplier_purchase_accounts((v_auth->>'order_id')::uuid,(v_attempt->>'attempt_id')::uuid) INTO v_attached;
  IF (v_attached->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Attach failed: %',v_attached->>'code'; END IF;
  SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_attached->'account_ids') ids(value);
  SELECT jsonb_build_object('quantity',v_quantity,'accounts',jsonb_agg(jsonb_build_object('username',username,'password',password)))
    INTO v_details FROM public.individual_accounts WHERE id=ANY(v_ids);
  SELECT public.complete_product_purchase(v_user,(v_auth->>'order_id')::uuid,(v_auth->>'reservation_id')::uuid,
    v_ids,v_details,'purchase:'||v_key,'PUR-'||left(v_key,24),'Rollback verification',NULL) INTO v_completion;
  IF (v_completion->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Completion failed: %',v_completion->>'code'; END IF;
  SELECT public.complete_product_purchase(v_user,(v_auth->>'order_id')::uuid,(v_auth->>'reservation_id')::uuid,
    v_ids,v_details,'purchase:'||v_key,'PUR-'||left(v_key,24),'Rollback verification',NULL) INTO v_replay;
  INSERT INTO supplier_transaction_probe VALUES(true,true,(v_completion->>'success')::boolean,
    (v_replay->>'idempotent_replay')::boolean,(SELECT count(*) FROM public.transactions WHERE idempotency_key='purchase:'||v_key),false);
  IF (SELECT captures FROM supplier_transaction_probe)<>1 THEN RAISE EXCEPTION 'Capture not exactly once'; END IF;
  PERFORM public.refresh_supplier_product_availability(v_product.id,true);
  SELECT public.authorize_supplier_product_purchase(v_user,v_product.id,1,v_product.price,v_key||':reject',
    jsonb_build_object('source','rollback-verification','supplier_configured_providers',jsonb_build_array(v_provider)),
    (SELECT GREATEST(COALESCE(financial_security_version,1),1) FROM public.profiles WHERE id=v_user)) INTO v_auth;
  IF (v_auth->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Second reserve failed: %',v_auth->>'code'; END IF;
  SELECT public.begin_supplier_purchase_attempt((v_auth->>'order_id')::uuid,(v_auth->>'reservation_id')::uuid,
    v_provider,v_provider_product,v_key||':reject-attempt') INTO v_attempt;
  IF (v_attempt->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Second begin failed: %',v_attempt->>'code'; END IF;
  SELECT public.mark_supplier_purchase_sending((v_attempt->>'attempt_id')::uuid) INTO v_result;
  IF (v_result->>'send_allowed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Second claim failed'; END IF;
  PERFORM public.record_supplier_purchase_outcome((v_attempt->>'attempt_id')::uuid,'rejected',NULL,NULL,'insufficient_balance');
  SELECT public.cancel_exhausted_supplier_purchase((v_auth->>'order_id')::uuid,(v_auth->>'reservation_id')::uuid) INTO v_result;
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmed rejection failed to release: %',v_result->>'code'; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE idempotency_key='purchase:'||v_key||':reject') THEN RAISE EXCEPTION 'Rejected order was charged'; END IF;
  UPDATE supplier_transaction_probe SET confirmed_rejection_released=(SELECT status='released' FROM public.wallet_reservations WHERE id=(v_auth->>'reservation_id')::uuid);
END;
$$;
SELECT * FROM supplier_transaction_probe;
