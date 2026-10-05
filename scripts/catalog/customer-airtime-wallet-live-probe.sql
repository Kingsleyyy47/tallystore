-- Caller: BEGIN ISOLATION LEVEL REPEATABLE READ; pending migration280; probe;
-- inspect fixed booleans/counts; ROLLBACK. No usable keys or provider requests.
-- Actual wallet engine and existing financial/security triggers remain active.
SAVEPOINT customer_airtime_wallet_probe;
CREATE TEMP TABLE customer_airtime_wallet_probe_results (
 passed boolean, zero_and_low_wallet_denied boolean, exact_quote_binding boolean,
 one_creation_claim boolean, one_payment_claim boolean, exact_single_debit boolean,
 definitive_prepaid_release boolean, unknown_hold_preserved boolean,
 own_history_only boolean, browser_denied boolean, private_binding_immutable boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
 buyer uuid := '9a280000-0000-4000-8000-000000000101';
 other_user uuid := '9a280000-0000-4000-8000-000000000102';
 receipt uuid := '9a280000-0000-4000-8000-000000000111';
 q jsonb := '{"product_id":"test-airtime","product_name":"Test airtime","operator_id":"test-operator","operator_name":"Test operator","country_code":"GB","recipient_phone":"+447700900123","package_id":"test-operator<&>10","unit_value":10,"currency":"GBP","amount_ngn":40}'::jsonb;
 good jsonb; result jsonb; oid uuid; rejected_order uuid; unknown_order uuid;
 rid uuid; denied integer := 0; browser_denied integer := 0; immutable_denied boolean := false;
 before_other_balance numeric; after_other_balance numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id IN (buyer,other_user) OR email IN ('airtime-probe-buyer@example.invalid','airtime-probe-other@example.invalid'))
 OR EXISTS(SELECT 1 FROM public.crypto_transactions WHERE id=receipt OR nowpayments_payment_id='999280000000009' OR payment_reference='TEST-FUNDING-AIRTIME-280')
 THEN RAISE EXCEPTION 'airtime_probe_fixture_collision'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role,created_at,updated_at) VALUES
 (buyer,'airtime-probe-buyer@example.invalid','{"full_name":"Synthetic Airtime Buyer"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb,'authenticated','authenticated',clock_timestamp(),clock_timestamp()),
 (other_user,'airtime-probe-other@example.invalid','{"full_name":"Synthetic Airtime Other"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb,'authenticated','authenticated',clock_timestamp(),clock_timestamp());
 IF (SELECT count(*) FROM public.profiles WHERE id IN (buyer,other_user) AND wallet_balance=0 AND is_staff IS FALSE AND is_admin IS DISTINCT FROM true AND account_suspended IS FALSE)<>2
 THEN RAISE EXCEPTION 'airtime_probe_profile_fixture_invalid'; END IF;
 SELECT wallet_balance INTO before_other_balance FROM public.profiles WHERE id=other_user;
 INSERT INTO public.crypto_transactions(id,user_id,crypto_type,crypto_amount,naira_amount,exchange_rate,deposit_address,status,payment_provider,nowpayments_payment_id,payment_reference,
 outcome_amount,outcome_currency,nowpayments_pay_address,created_at,expires_at)
 VALUES(receipt,buyer,'usdttrc20',1,500,500,'TEST_ONLY_NOT_A_CHAIN_ADDRESS_280','pending','nowpayments','999280000000009','TEST-FUNDING-AIRTIME-280',
 1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_280',clock_timestamp(),clock_timestamp()+interval '30 minutes');
 result:=public.register_nowpayments_wallet_quote(receipt,buyer,'999280000000009','TEST-FUNDING-AIRTIME-280',500,1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_280');
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'airtime_probe_funding_quote_failed'; END IF;
 result:=public.settle_nowpayments_wallet_quote('999280000000009','TEST-FUNDING-AIRTIME-280',1.05,'usdttrc20','TEST_ONLY_NOT_A_CHAIN_ADDRESS_280',1.05,'finished',repeat('a',64),repeat('b',64));
 IF result->>'success' IS DISTINCT FROM 'true' OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>500
 THEN RAISE EXCEPTION 'airtime_probe_verified_funding_failed'; END IF;
 IF (public.authorize_customer_airtime_purchase(other_user,'airtime-probe-zero',q,40))->>'success'='false' THEN denied:=denied+1; END IF;
 result:=public.authorize_customer_airtime_purchase(buyer,'airtime-probe-purchase',q,40);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'airtime_probe_authorize_failed'; END IF;
 oid:=(result->>'order_id')::uuid; rid:=(result->>'reservation_id')::uuid;
 IF (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>500
 OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>460
 OR (public.authorize_customer_airtime_purchase(buyer,'airtime-probe-purchase',q,40))->>'idempotent_replay' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'airtime_probe_hold_or_replay_failed'; END IF;
 IF (public.authorize_customer_airtime_purchase(buyer,'airtime-probe-low',q||'{"amount_ngn":461}'::jsonb,461))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.authorize_customer_airtime_purchase(buyer,'airtime-probe-purchase',q||'{"recipient_phone":"+447700900124"}'::jsonb,40))->>'code'='IDEMPOTENCY_REQUEST_CONFLICT' THEN denied:=denied+1; END IF;
 IF (public.claim_customer_airtime_dispatch(other_user,oid))->>'code'='ORDER_NOT_FOUND' THEN denied:=denied+1; END IF;
 IF (public.claim_customer_airtime_dispatch(buyer,oid))->>'send_allowed' IS DISTINCT FROM 'true'
 OR (public.claim_customer_airtime_dispatch(buyer,oid))->>'send_allowed' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'airtime_probe_creation_claim_failed'; END IF;
 IF (public.bind_customer_airtime_invoice(buyer,oid,'TEST-AIRTIME-INVOICE-280',q,'complete'))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.bind_customer_airtime_invoice(buyer,oid,'TEST-AIRTIME-INVOICE-280',q||'{"operator_id":"foreign"}'::jsonb,'unpaid'))->>'success'='false' THEN denied:=denied+1; END IF;
 IF (public.bind_customer_airtime_invoice(buyer,oid,'TEST-AIRTIME-INVOICE-280',q,'unpaid'))->>'bound' IS DISTINCT FROM 'true'
 OR (public.bind_customer_airtime_invoice(buyer,oid,'TEST-AIRTIME-INVOICE-280',q,'unpaid'))->>'idempotent_replay' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'airtime_probe_invoice_bind_failed'; END IF;
 IF (public.claim_customer_airtime_payment(buyer,oid,'FOREIGN-INVOICE'))->>'pay_allowed'='false' THEN denied:=denied+1; END IF;
 IF (public.claim_customer_airtime_payment(buyer,oid,'TEST-AIRTIME-INVOICE-280'))->>'pay_allowed' IS DISTINCT FROM 'true'
 OR (public.claim_customer_airtime_payment(buyer,oid,'TEST-AIRTIME-INVOICE-280'))->>'pay_allowed' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'airtime_probe_payment_claim_failed'; END IF;
 good:=jsonb_build_object('invoice_id','TEST-AIRTIME-INVOICE-280','product_id',q->'product_id','operator_id',q->'operator_id','recipient_phone',q->'recipient_phone',
 'package_id',q->'package_id','unit_value',q->'unit_value','currency',q->'currency','quantity',1,'provider_order_id','TEST-AIRTIME-UNIT-280','provider_status','complete');
 IF (public.record_customer_airtime_outcome(buyer,oid,'completed',good||'{"recipient_phone":"+447700900124"}'::jsonb))->>'success'='false' THEN denied:=denied+1; END IF;
 result:=public.record_customer_airtime_outcome(buyer,oid,'completed',good);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'airtime_probe_capture_failed: %',result->>'code'; END IF;
 result:=public.record_customer_airtime_outcome(buyer,oid,'completed',good);
 IF result->>'idempotent_replay' IS DISTINCT FROM 'true'
 OR (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>460
 OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>460
 OR (SELECT count(*) FROM public.transactions WHERE user_id=buyer AND type='purchase')<>1
 OR NOT EXISTS(SELECT 1 FROM public.transactions WHERE user_id=buyer AND type='purchase' AND amount=-40
  AND status='completed' AND idempotency_key='airtime:capture:'||oid::text AND metadata->>'wallet_reservation_id'=rid::text)
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=rid AND status='captured')
 THEN RAISE EXCEPTION 'airtime_probe_single_capture_failed'; END IF;
 result:=public.authorize_customer_airtime_purchase(buyer,'airtime-probe-rejected',q,40);
 rejected_order:=(result->>'order_id')::uuid;
 IF result->>'success' IS DISTINCT FROM 'true'
 OR (public.record_customer_airtime_outcome(buyer,rejected_order,'rejected','{"reason_code":"NO_STOCK"}'::jsonb))->>'success' IS DISTINCT FROM 'true'
 OR (public.record_customer_airtime_outcome(buyer,rejected_order,'rejected','{"reason_code":"NO_STOCK"}'::jsonb))->>'idempotent_replay' IS DISTINCT FROM 'true'
 OR (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>460
 OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>460
 THEN RAISE EXCEPTION 'airtime_probe_prepaid_release_failed'; END IF;
 result:=public.authorize_customer_airtime_purchase(buyer,'airtime-probe-unknown',q,40);
 unknown_order:=(result->>'order_id')::uuid;
 IF result->>'success' IS DISTINCT FROM 'true'
 OR (public.claim_customer_airtime_dispatch(buyer,unknown_order))->>'send_allowed' IS DISTINCT FROM 'true'
 OR (public.bind_customer_airtime_invoice(buyer,unknown_order,'TEST-AIRTIME-UNKNOWN-280',q,'unpaid'))->>'bound' IS DISTINCT FROM 'true'
 OR (public.claim_customer_airtime_payment(buyer,unknown_order,'TEST-AIRTIME-UNKNOWN-280'))->>'pay_allowed' IS DISTINCT FROM 'true'
 OR (public.record_customer_airtime_outcome(buyer,unknown_order,'unknown','{}'::jsonb))->>'funds_held' IS DISTINCT FROM 'true'
 OR (public.record_customer_airtime_outcome(buyer,unknown_order,'rejected','{"reason_code":"INSUFFICIENT_BALANCE"}'::jsonb))->>'code' IS DISTINCT FROM 'PAID_OUTCOME_REQUIRES_REVIEW'
 OR (public.claim_customer_airtime_payment(buyer,unknown_order,'TEST-AIRTIME-UNKNOWN-280'))->>'pay_allowed' IS DISTINCT FROM 'false'
 OR (SELECT wallet_balance FROM public.profiles WHERE id=buyer)<>460
 OR (public.wallet_financial_truth_internal(buyer)->>'confirmed_spendable')::numeric<>420
 OR (SELECT count(*) FROM public.transactions WHERE user_id=buyer AND type='purchase')<>1
 THEN RAISE EXCEPTION 'airtime_probe_unknown_hold_failed'; END IF;
 BEGIN UPDATE private.customer_airtime_dispatch SET quote=quote||'{"recipient_phone":"+447700900124"}'::jsonb WHERE order_id=oid;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'customer_airtime_binding_immutable' THEN RAISE; END IF; immutable_denied:=true; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
 IF (SELECT count(*) FROM public.customer_airtime_orders)<>3 THEN RAISE EXCEPTION 'airtime_probe_own_history_failed'; END IF;
 BEGIN PERFORM public.authorize_customer_airtime_purchase(buyer,'browser-probe-airtime',q,40);
 EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN PERFORM public.claim_customer_airtime_payment(buyer,oid,'TEST-AIRTIME-INVOICE-280');
 EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN PERFORM 1 FROM private.customer_airtime_dispatch;
 EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 BEGIN UPDATE public.customer_airtime_orders SET amount_ngn=1;
 EXCEPTION WHEN insufficient_privilege THEN browser_denied:=browser_denied+1; END;
 PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.customer_airtime_orders) THEN RAISE EXCEPTION 'airtime_probe_foreign_history_visible'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT wallet_balance INTO after_other_balance FROM public.profiles WHERE id=other_user;
 IF denied<>8 OR browser_denied<>4 OR NOT immutable_denied OR before_other_balance IS DISTINCT FROM after_other_balance
 THEN RAISE EXCEPTION 'airtime_probe_denial_or_scope_failed'; END IF;
 INSERT INTO customer_airtime_wallet_probe_results VALUES(true,true,true,true,true,true,true,true,true,true,true);
END;
$probe$;
SELECT * FROM customer_airtime_wallet_probe_results;
ROLLBACK TO SAVEPOINT customer_airtime_wallet_probe;
RELEASE SAVEPOINT customer_airtime_wallet_probe;
