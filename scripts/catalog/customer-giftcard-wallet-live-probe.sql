-- Run only in a SOURCE transaction; synthetic receipts never reach a provider.
-- Savepoint restores all financial/auth/order rows before the runner hashes them.
SAVEPOINT customer_giftcard_wallet_probe;
CREATE TEMP TABLE customer_giftcard_probe_results(passed boolean) ON COMMIT DROP;
DO $probe$
DECLARE
 buyer uuid:='9a340000-0000-4000-8000-000000000101';
 other_user uuid:='9a340000-0000-4000-8000-000000000102';
 receipt uuid:='9a340000-0000-4000-8000-000000000111';
 q jsonb:='{"product_id":"test-gift-card","product_name":"Synthetic gift card","package_id":"test-gift-card<&>10","unit_value":10,"currency":"USD","quantity":2,"amount_ngn":40,"provider_price":20,"billing_currency":"USD"}';
 request jsonb:='{"product_id":"test-gift-card","package_id":"test-gift-card<&>10","unit_value":10,"quantity":2,"expected_amount_ngn":40}';
 result jsonb; good jsonb; changed jsonb; oid uuid; rid uuid; rejected uuid; uncertain uuid;
 denied integer:=0; browser_denied integer:=0; immutable_denied boolean:=false;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id IN(buyer,other_user) OR email IN('giftcard-probe-buyer@example.invalid','giftcard-probe-other@example.invalid'))
 OR EXISTS(SELECT 1 FROM public.crypto_transactions WHERE id=receipt OR nowpayments_payment_id='999340000000009' OR payment_reference='TEST-FUNDING-GIFTCARD-340')
 THEN RAISE EXCEPTION 'giftcard_probe_fixture_collision'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role,created_at,updated_at) VALUES
 (buyer,'giftcard-probe-buyer@example.invalid','{"full_name":"Synthetic Gift Buyer"}','{"provider":"email","providers":["email"]}','authenticated','authenticated',clock_timestamp(),clock_timestamp()),
 (other_user,'giftcard-probe-other@example.invalid','{"full_name":"Synthetic Gift Other"}','{"provider":"email","providers":["email"]}','authenticated','authenticated',clock_timestamp(),clock_timestamp());
 IF (SELECT count(*) FROM public.profiles WHERE id IN(buyer,other_user) AND wallet_balance=0 AND is_staff IS FALSE AND is_admin IS DISTINCT FROM true AND account_suspended IS FALSE)<>2
 THEN RAISE EXCEPTION 'giftcard_probe_profile_fixture_invalid'; END IF;
 INSERT INTO public.crypto_transactions(id,user_id,crypto_type,crypto_amount,naira_amount,exchange_rate,deposit_address,status,payment_provider,nowpayments_payment_id,payment_reference,
 outcome_amount,outcome_currency,nowpayments_pay_address,created_at,expires_at)
 VALUES(receipt,buyer,'usdttrc20',1,500,500,'TEST_ONLY_NOT_A_CHAIN_ADDRESS_340','pending','nowpayments','999340000000009','TEST-FUNDING-GIFTCARD-340',
 1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_340',clock_timestamp(),clock_timestamp()+interval '30 minutes');
 result:=public.register_nowpayments_wallet_quote(receipt,buyer,'999340000000009','TEST-FUNDING-GIFTCARD-340',500,1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_340');
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_funding_quote_failed'; END IF;
 result:=public.settle_nowpayments_wallet_quote('999340000000009','TEST-FUNDING-GIFTCARD-340',1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_340',1.05,'finished',repeat('a',64),repeat('b',64));
 IF result->>'success' IS DISTINCT FROM 'true' OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>500
 THEN RAISE EXCEPTION 'giftcard_probe_funding_failed'; END IF;
 IF (public.authorize_customer_giftcard_purchase(other_user,'giftcard-probe-zero',request,q,40))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.authorize_customer_giftcard_purchase(buyer,'giftcard-probe-low',request||'{"expected_amount_ngn":510}',q||'{"amount_ngn":510}',510))->>'success'='false' THEN denied:=denied+1; END IF;
 result:=public.authorize_customer_giftcard_purchase(buyer,'giftcard-probe-purchase',request,q,40);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_authorize_failed'; END IF;
 oid:=(result->>'order_id')::uuid; rid:=(result->>'reservation_id')::uuid;
 IF (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>500 OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>460
 OR (public.get_customer_giftcard_replay(buyer,'giftcard-probe-purchase',request))->>'idempotent_replay' IS DISTINCT FROM 'true'
 OR (public.authorize_customer_giftcard_purchase(buyer,'giftcard-probe-purchase',request,q||'{"provider_price":25}',40))->>'idempotent_replay' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'giftcard_probe_hold_replay_failed'; END IF;
 IF (public.get_customer_giftcard_replay(buyer,'giftcard-probe-purchase',request||'{"quantity":1}'))->>'code'='IDEMPOTENCY_REQUEST_CONFLICT' THEN denied:=denied+1; END IF;
 IF (public.claim_customer_giftcard_dispatch(other_user,oid))->>'code'='ORDER_NOT_FOUND' THEN denied:=denied+1; END IF;
 result:=public.claim_customer_giftcard_dispatch(buyer,oid);
 IF result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_create_claim_failed'; END IF;
 result:=public.claim_customer_giftcard_dispatch(buyer,oid);
 IF result->>'send_allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'giftcard_probe_create_replay_failed'; END IF;
 IF (public.bind_customer_giftcard_invoice(buyer,oid,'TEST-GIFT-INVOICE-340',q,'complete'))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.bind_customer_giftcard_invoice(buyer,oid,'TEST-GIFT-INVOICE-340',q||'{"quantity":1}','unpaid'))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.bind_customer_giftcard_invoice(buyer,oid,'TEST-GIFT-INVOICE-340',q,'unpaid'))->>'bound' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_bind_failed'; END IF;
 IF (public.claim_customer_giftcard_payment(buyer,oid,'FOREIGN-INVOICE'))->>'pay_allowed'='false' THEN denied:=denied+1; END IF;
 result:=public.claim_customer_giftcard_payment(buyer,oid,'TEST-GIFT-INVOICE-340');
 IF result->>'pay_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_pay_claim_failed'; END IF;
 result:=public.claim_customer_giftcard_payment(buyer,oid,'TEST-GIFT-INVOICE-340');
 IF result->>'pay_allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'giftcard_probe_pay_replay_failed'; END IF;
 good:=jsonb_build_object('invoice_id','TEST-GIFT-INVOICE-340','item_id',q->'product_id','package_id',q->'package_id','unit_value',q->'unit_value','currency',q->'currency',
 'quantity',2,'provider_status','complete','redemptions',jsonb_build_array(jsonb_build_object('order_id','TEST-GIFT-UNIT-1','code','SYNTHETIC-CODE-1'),jsonb_build_object('order_id','TEST-GIFT-UNIT-2','link','https://example.invalid/redeem/synthetic')));
 FOREACH changed IN ARRAY ARRAY[
  good||'{"quantity":1}',good||'{"item_id":"foreign"}',good||'{"unit_value":11}',good||'{"currency":"GBP"}',
  good||jsonb_build_object('redemptions',jsonb_build_array(good#>'{redemptions,0}')),
  good||jsonb_build_object('redemptions',jsonb_build_array(good#>'{redemptions,0}',good#>'{redemptions,0}'))
 ] LOOP
  IF (public.record_customer_giftcard_outcome(buyer,oid,'completed',changed))->>'success' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'giftcard_probe_delivery_tamper_accepted'; END IF;
 END LOOP;
 IF public.get_customer_giftcard_order(buyer,oid) ? 'redemptions' THEN RAISE EXCEPTION 'giftcard_probe_premature_secret'; END IF;
 result:=public.record_customer_giftcard_outcome(buyer,oid,'completed',good);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_capture_failed'; END IF;
 result:=public.record_customer_giftcard_outcome(buyer,oid,'completed',good);
 IF result->>'idempotent_replay' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_capture_replay_failed'; END IF;
 IF (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>460 OR (SELECT count(*) FROM public.transactions WHERE user_id=buyer AND type='purchase')<>1
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=rid AND status='captured')
 OR public.get_customer_giftcard_order(buyer,oid)->'redemptions' IS DISTINCT FROM good->'redemptions'
 THEN RAISE EXCEPTION 'giftcard_probe_capture_proof_failed'; END IF;
 result:=public.authorize_customer_giftcard_purchase(buyer,'giftcard-probe-rejected',request,q,40); rejected:=(result->>'order_id')::uuid;
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_prepaid_authorize_failed'; END IF;
 result:=public.record_customer_giftcard_outcome(buyer,rejected,'rejected','{"reason_code":"NO_STOCK"}');
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_prepaid_release_failed'; END IF;
 IF (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>460 THEN RAISE EXCEPTION 'giftcard_probe_prepaid_release_balance_failed'; END IF;
 result:=public.authorize_customer_giftcard_purchase(buyer,'giftcard-probe-unknown',request,q,40); uncertain:=(result->>'order_id')::uuid;
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_unknown_authorize_failed'; END IF;
 result:=public.claim_customer_giftcard_dispatch(buyer,uncertain);
 IF result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_unknown_create_failed'; END IF;
 result:=public.bind_customer_giftcard_invoice(buyer,uncertain,'TEST-GIFT-UNKNOWN-340',q,'unpaid');
 IF result->>'bound' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_unknown_bind_failed'; END IF;
 result:=public.claim_customer_giftcard_payment(buyer,uncertain,'TEST-GIFT-UNKNOWN-340');
 IF result->>'pay_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_unknown_pay_failed'; END IF;
 result:=public.record_customer_giftcard_outcome(buyer,uncertain,'unknown','{}');
 IF result->>'funds_held' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'giftcard_probe_unknown_hold_failed'; END IF;
 result:=public.record_customer_giftcard_outcome(buyer,uncertain,'rejected','{"reason_code":"NO_STOCK"}');
 IF result->>'code' IS DISTINCT FROM 'PAID_OUTCOME_REQUIRES_REVIEW' THEN RAISE EXCEPTION 'giftcard_probe_unknown_release_accepted'; END IF;
 result:=public.claim_customer_giftcard_payment(buyer,uncertain,'TEST-GIFT-UNKNOWN-340');
 IF result->>'pay_allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'giftcard_probe_unknown_repay_accepted'; END IF;
 IF (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>420 THEN RAISE EXCEPTION 'giftcard_probe_unknown_hold_balance_failed'; END IF;
 BEGIN UPDATE private.customer_giftcard_dispatch SET delivery_evidence='{}' WHERE order_id=oid;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'customer_giftcard_binding_immutable' THEN RAISE; END IF; immutable_denied:=true; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
 IF public.get_my_customer_giftcard_order(oid)->'redemptions' IS DISTINCT FROM good->'redemptions'
 OR jsonb_array_length(public.get_my_customer_giftcard_history())<>3
 OR (SELECT count(*) FROM public.customer_giftcard_orders)<>3 THEN RAISE EXCEPTION 'giftcard_probe_own_history_failed'; END IF;
 BEGIN PERFORM public.authorize_customer_giftcard_purchase(buyer,'browser-probe-giftcard',request,q,40); EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN PERFORM public.claim_customer_giftcard_payment(buyer,oid,'TEST-GIFT-INVOICE-340'); EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN PERFORM 1 FROM private.customer_giftcard_dispatch; EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN UPDATE public.customer_giftcard_orders SET amount_ngn=1; EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.customer_giftcard_orders) OR public.get_my_customer_giftcard_order(oid)->>'code' IS DISTINCT FROM 'ORDER_NOT_FOUND'
 OR jsonb_array_length(public.get_my_customer_giftcard_history())<>0 THEN RAISE EXCEPTION 'giftcard_probe_foreign_history_visible'; END IF;
 EXECUTE 'RESET ROLE';
 IF denied<>7 OR browser_denied<>4 OR NOT immutable_denied OR (SELECT wallet_balance FROM public.profiles WHERE id=other_user)<>0
 THEN RAISE EXCEPTION 'giftcard_probe_denial_scope_failed'; END IF;
 INSERT INTO customer_giftcard_probe_results VALUES(true);
END;
$probe$;
SELECT * FROM customer_giftcard_probe_results;
ROLLBACK TO SAVEPOINT customer_giftcard_wallet_probe;
RELEASE SAVEPOINT customer_giftcard_wallet_probe;
