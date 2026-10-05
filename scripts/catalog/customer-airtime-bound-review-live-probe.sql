-- Caller BEGIN; migration281; this metadata-only synthetic probe; ROLLBACK.
-- Fixtures represent an already authorized unpaid invoice/hold. No funds are
-- credited/debited, and no provider call is made. Existing280 wallet tests cover
-- actual authorization and capture; this probe checks only the new review state.
SAVEPOINT customer_airtime_bound_review_probe;
CREATE TEMP TABLE customer_airtime_bound_review_results(passed boolean,public_review_label boolean,hold_preserved boolean,payment_blocked boolean,refund_blocked boolean,wallet_unchanged boolean) ON COMMIT DROP;
DO $probe$
DECLARE
 buyer uuid:='9a281000-0000-4000-8000-000000000001';
 oid uuid:='9a281000-0000-4000-8000-000000000011';
 rid uuid:='9a281000-0000-4000-8000-000000000021';
 q jsonb:='{"product_id":"test-airtime","product_name":"Test airtime","operator_id":"test-operator","operator_name":"Test operator","country_code":"GB","recipient_phone":"+447700900123","package_id":null,"unit_value":10,"currency":"GBP","amount_ngn":1}'::jsonb;
 qhash text; result jsonb; version integer; prior_wallet numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=buyer OR email='bound-review-probe@example.invalid')
 OR EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=rid)
 OR EXISTS(SELECT 1 FROM public.customer_airtime_orders WHERE id=oid)
 THEN RAISE EXCEPTION 'bound_review_probe_fixture_collision'; END IF;
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role,created_at,updated_at)
 VALUES(buyer,'bound-review-probe@example.invalid','{"full_name":"Synthetic Bound Review"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb,'authenticated','authenticated',clock_timestamp(),clock_timestamp());
 SELECT wallet_balance,financial_security_version INTO prior_wallet,version FROM public.profiles WHERE id=buyer;
 qhash:=encode(sha256(convert_to(q::text,'UTF8')),'hex');
 INSERT INTO public.wallet_reservations(id,user_id,amount,currency,status,order_table,order_id,idempotency_key,financial_security_version,metadata)
 VALUES(rid,buyer,1,'NGN','active','customer_airtime_orders',oid,'airtime:synthetic-bound-review-281',version,jsonb_build_object('airtime_quote_hash',qhash));
 INSERT INTO public.customer_airtime_orders(id,user_id,product_id,product_name,operator_id,operator_name,country_code,recipient_phone,unit_value,currency,amount_ngn,status)
 VALUES(oid,buyer,'test-airtime','Test airtime','test-operator','Test operator','GB','+447700900123',10,'GBP',1,'processing');
 INSERT INTO private.customer_airtime_dispatch(order_id,user_id,idempotency_key,quote,quote_hash,reservation_id,financial_security_version,state,invoice_id,creation_claimed_at)
 VALUES(oid,buyer,'synthetic-bound-review-281',q,qhash,rid,version,'bound','TEST-BOUND-REVIEW-INVOICE-281',clock_timestamp());
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.record_customer_airtime_outcome(buyer,oid,'unknown','{}'::jsonb);
 IF result->>'success' IS DISTINCT FROM 'true' OR result->>'funds_held' IS DISTINCT FROM 'true'
 OR NOT EXISTS(SELECT 1 FROM public.customer_airtime_orders WHERE id=oid AND status='review_required')
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=rid AND status='active' AND amount=1)
 OR NOT EXISTS(SELECT 1 FROM private.customer_airtime_dispatch WHERE order_id=oid AND state='unknown' AND payment_claimed_at IS NULL)
 THEN RAISE EXCEPTION 'bound_review_probe_state_failed'; END IF;
 result:=public.claim_customer_airtime_payment(buyer,oid,'TEST-BOUND-REVIEW-INVOICE-281');
 IF result->>'pay_allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'bound_review_probe_payment_admitted'; END IF;
 result:=public.record_customer_airtime_outcome(buyer,oid,'rejected','{"reason_code":"INSUFFICIENT_BALANCE"}'::jsonb);
 IF result->>'code' IS DISTINCT FROM 'PAID_OUTCOME_REQUIRES_REVIEW'
 OR EXISTS(SELECT 1 FROM public.transactions WHERE user_id=buyer)
 OR (SELECT wallet_balance FROM public.profiles WHERE id=buyer) IS DISTINCT FROM prior_wallet
 THEN RAISE EXCEPTION 'bound_review_probe_money_changed'; END IF;
 INSERT INTO customer_airtime_bound_review_results VALUES(true,true,true,true,true,true);
END;
$probe$;
SELECT * FROM customer_airtime_bound_review_results;
ROLLBACK TO SAVEPOINT customer_airtime_bound_review_probe;
RELEASE SAVEPOINT customer_airtime_bound_review_probe;
