-- Independent live-schema verification, never a migration or a payment request.
-- Caller must run BEGIN; migration 20261005022000; this probe in one connection.
-- SAVEPOINT refuses an accidental standalone invocation. Final ROLLBACK also
-- rolls back the migration, both synthetic users, receipts, ledger and evidence.
-- No provider calls, password/login, real account IDs, or private data output.
SAVEPOINT nowpayments_wallet_live_probe;
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE nowpayments_probe_results (
  passed boolean,
  exact_wallet_credit boolean,
  exact_canonical_credit boolean,
  registration_replay boolean,
  settlement_replay boolean,
  ledger_rows integer,
  proof_rows integer,
  invalid_deliveries_rejected integer,
  revoked_spendable_zero boolean,
  revocation_replay boolean,
  revocation_rows integer,
  no_refund_ledger_debit boolean,
  no_account_suspension boolean,
  precredit_refund_zero_money boolean,
  precredit_refund_blocks_finished boolean,
  authenticated_denials integer,
  authenticated_attempts_changed_nothing boolean
) ON COMMIT DROP;

DO $probe$
DECLARE
  v_user uuid := '9a220000-0000-4000-8000-000000000001';
  v_other uuid := '9a220000-0000-4000-8000-000000000002';
  v_receipt uuid := '9a220000-0000-4000-8000-000000000011';
  v_unpaid_receipt uuid := '9a220000-0000-4000-8000-000000000013';
  v_payment text := '999220000000001';
  v_reference text := 'NP-TRANSACTION-PROBE-220-A';
  v_unpaid_payment text := '999220000000002';
  v_unpaid_reference text := 'NP-TRANSACTION-PROBE-220-B';
  v_address text := 'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_220';
  v_amount numeric := 123.45;
  v_pay numeric := 1.05;
  v_signature text := repeat('a',64);
  v_verification text := repeat('b',64);
  v_result jsonb;
  v_truth jsonb;
  v_registered jsonb;
  v_case jsonb;
  v_rejected integer := 0;
  v_denied integer := 0;
  v_reg_replay boolean := false;
  v_settle_replay boolean := false;
  v_revoke_replay boolean := false;
  v_ledger_count integer;
  v_proof_count integer;
  v_revoke_count integer;
BEGIN
  -- Collision refusal protects all existing users/receipts; no ON CONFLICT
  -- update can turn a pre-existing account into a synthetic fixture.
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_user,v_other)
    OR email IN ('nowpayments-probe-a@example.invalid','nowpayments-probe-b@example.invalid'))
    OR EXISTS (SELECT 1 FROM public.crypto_transactions WHERE id IN (v_receipt,v_unpaid_receipt)
      OR nowpayments_payment_id IN (v_payment,v_unpaid_payment)
      OR payment_reference IN (v_reference,v_unpaid_reference))
  THEN RAISE EXCEPTION 'nowpayments_probe_fixture_collision'; END IF;

  IF NOT EXISTS (SELECT 1 FROM private.nowpayments_wallet_launch WHERE singleton)
  THEN RAISE EXCEPTION 'nowpayments_probe_migration_missing'; END IF;

  -- The inspected auth INSERT trigger creates profiles and has no HTTP/net call.
  -- Do not disable financial/ledger/crypto triggers: these must be exercised.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role,created_at,updated_at)
  VALUES
    (v_user,'nowpayments-probe-a@example.invalid','{"full_name":"Synthetic Payment Probe A"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,'authenticated','authenticated',clock_timestamp(),clock_timestamp()),
    (v_other,'nowpayments-probe-b@example.invalid','{"full_name":"Synthetic Payment Probe B"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,'authenticated','authenticated',clock_timestamp(),clock_timestamp());
  IF (SELECT count(*) FROM public.profiles WHERE id IN (v_user,v_other)
    AND wallet_balance=0 AND is_staff IS FALSE AND is_admin IS DISTINCT FROM true
    AND account_suspended IS FALSE) <> 2
  THEN RAISE EXCEPTION 'nowpayments_probe_customer_fixture_invalid'; END IF;

  INSERT INTO public.crypto_transactions(id,user_id,crypto_type,crypto_amount,naira_amount,
    exchange_rate,deposit_address,status,payment_provider,nowpayments_payment_id,
    payment_reference,outcome_amount,outcome_currency,nowpayments_pay_address,created_at,expires_at)
  VALUES (v_receipt,v_user,'usdttrc20',1,v_amount,v_amount,v_address,'pending','nowpayments',
    v_payment,v_reference,v_pay,'usdttrc20',v_address,clock_timestamp(),clock_timestamp()+interval '30 minutes');
  IF NOT EXISTS (SELECT 1 FROM public.crypto_transactions c
    CROSS JOIN private.nowpayments_wallet_launch l WHERE c.id=v_receipt AND c.created_at>=l.started_at)
  THEN RAISE EXCEPTION 'nowpayments_probe_quote_before_launch'; END IF;

  -- Role claims are deliberately explicit immediately before trusted RPC calls.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_result := public.register_nowpayments_wallet_quote(v_receipt,v_other,v_payment,
    v_reference,v_amount,v_pay,'usdttrc20',v_address);
  IF v_result->>'success' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'nowpayments_probe_wrong_customer_registered'; END IF;
  v_registered := public.register_nowpayments_wallet_quote(v_receipt,v_user,v_payment,
    v_reference,v_amount,v_pay,'usdttrc20',v_address);
  IF v_registered->>'success' IS DISTINCT FROM 'true'
    OR v_registered->>'idempotency_hit' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'nowpayments_probe_registration_failed'; END IF;
  v_result := public.register_nowpayments_wallet_quote(v_receipt,v_user,v_payment,
    v_reference,v_amount,v_pay,'usdttrc20',v_address);
  v_reg_replay := v_result->>'success'='true' AND v_result->>'idempotency_hit'='true'
    AND v_result->>'quote_id'=v_registered->>'quote_id';
  IF v_reg_replay IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'nowpayments_probe_registration_replay_failed'; END IF;

  -- Each invalid delivery is evaluated while the registered quote is unsettled.
  -- No case can piggyback on a previous successful settlement.
  FOR v_case IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('payment','999220000000099'),
    jsonb_build_object('reference','NP-WRONG-TRANSACTION-PROBE'),
    jsonb_build_object('pay_amount',1.00),
    jsonb_build_object('currency','btc'),
    jsonb_build_object('address','TEST_ONLY_WRONG_CHAIN_ADDRESS'),
    jsonb_build_object('actual',NULL),
    jsonb_build_object('actual',1.04),
    jsonb_build_object('status','partially_paid'),
    jsonb_build_object('signature',NULL),
    jsonb_build_object('verification','not-a-sha256-hash')
  )) LOOP
    v_result := public.settle_nowpayments_wallet_quote(
      CASE WHEN v_case ? 'payment' THEN v_case->>'payment' ELSE v_payment END,
      CASE WHEN v_case ? 'reference' THEN v_case->>'reference' ELSE v_reference END,
      CASE WHEN v_case ? 'pay_amount' THEN (v_case->>'pay_amount')::numeric ELSE v_pay END,
      CASE WHEN v_case ? 'currency' THEN v_case->>'currency' ELSE 'usdttrc20' END,
      CASE WHEN v_case ? 'address' THEN v_case->>'address' ELSE v_address END,
      CASE WHEN v_case ? 'actual' THEN (v_case->>'actual')::numeric ELSE v_pay END,
      CASE WHEN v_case ? 'status' THEN v_case->>'status' ELSE 'finished' END,
      CASE WHEN v_case ? 'signature' THEN v_case->>'signature' ELSE v_signature END,
      CASE WHEN v_case ? 'verification' THEN v_case->>'verification' ELSE v_verification END);
    IF v_result->>'success' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION 'nowpayments_probe_invalid_delivery_accepted'; END IF;
    v_rejected := v_rejected+1;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE user_id IN (v_user,v_other))
      OR EXISTS (SELECT 1 FROM private.nowpayments_wallet_proofs WHERE payment_id=v_payment)
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_user,v_other) AND wallet_balance<>0)
    THEN RAISE EXCEPTION 'nowpayments_probe_invalid_delivery_moved_money'; END IF;
  END LOOP;
  v_truth := public.wallet_financial_truth_internal(v_user);
  IF (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM 0
  THEN RAISE EXCEPTION 'nowpayments_probe_invalid_delivery_created_capacity'; END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_result := public.settle_nowpayments_wallet_quote(v_payment,v_reference,v_pay,
    'usdttrc20',v_address,v_pay,'finished',v_signature,v_verification);
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'idempotency_hit' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'nowpayments_probe_settlement_failed'; END IF;
  v_truth := public.wallet_financial_truth_internal(v_user);
  IF (SELECT wallet_balance FROM public.profiles WHERE id=v_user) IS DISTINCT FROM v_amount
    OR (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM v_amount
    OR (v_truth->>'verified_gateway_deposits')::numeric IS DISTINCT FROM v_amount
  THEN RAISE EXCEPTION 'nowpayments_probe_credit_not_exact_or_not_spendable'; END IF;
  v_result := public.settle_nowpayments_wallet_quote(v_payment,v_reference,v_pay,
    'usdttrc20',v_address,v_pay,'finished',v_signature,v_verification);
  v_settle_replay := v_result->>'success'='true' AND v_result->>'idempotency_hit'='true';
  SELECT count(*) INTO v_ledger_count FROM public.transactions WHERE user_id=v_user;
  SELECT count(*) INTO v_proof_count FROM private.nowpayments_wallet_proofs WHERE payment_id=v_payment;
  IF v_settle_replay IS DISTINCT FROM true OR v_ledger_count<>1 OR v_proof_count<>1
    OR NOT EXISTS (SELECT 1 FROM public.transactions WHERE user_id=v_user AND amount=v_amount
      AND type='topup' AND status='completed' AND balance_before=0 AND balance_after=v_amount
      AND idempotency_key='nowpayments:wallet:'||v_payment AND external_payment_id='nowpayments:'||v_payment
      AND reference=v_reference AND metadata->>'crypto_quote_id'=v_registered->>'quote_id')
  THEN RAISE EXCEPTION 'nowpayments_probe_duplicate_credit_or_missing_ledger'; END IF;

  -- Provider-confirmed refund withdraws trusted capacity; it must not invent a
  -- second money movement or suspend this customer.
  v_result := public.revoke_nowpayments_wallet_quote(v_payment,v_reference,v_pay,
    'usdttrc20',v_address,v_pay,'refunded',v_signature,v_verification);
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'idempotency_hit' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'nowpayments_probe_revocation_failed'; END IF;
  v_result := public.revoke_nowpayments_wallet_quote(v_payment,v_reference,v_pay,
    'usdttrc20',v_address,v_pay,'refunded',v_signature,v_verification);
  v_revoke_replay := v_result->>'success'='true' AND v_result->>'idempotency_hit'='true';
  v_truth := public.wallet_financial_truth_internal(v_user);
  SELECT count(*) INTO v_revoke_count FROM private.nowpayments_wallet_revocations WHERE payment_id=v_payment;
  IF v_revoke_replay IS DISTINCT FROM true OR v_revoke_count<>1
    OR (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM 0
    OR (v_truth->>'verified_gateway_deposits')::numeric IS DISTINCT FROM 0
    OR (SELECT wallet_balance FROM public.profiles WHERE id=v_user) IS DISTINCT FROM v_amount
    OR (SELECT count(*) FROM public.transactions WHERE user_id=v_user)<>1
    OR EXISTS (SELECT 1 FROM public.transactions WHERE user_id=v_user AND amount<0)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_user,v_other) AND account_suspended)
  THEN RAISE EXCEPTION 'nowpayments_probe_revocation_changed_money_or_suspended'; END IF;
  v_result := public.settle_nowpayments_wallet_quote(v_payment,v_reference,v_pay,
    'usdttrc20',v_address,v_pay,'finished',v_signature,v_verification);
  IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'PAYMENT_REVOKED'
  THEN RAISE EXCEPTION 'nowpayments_probe_revoked_payment_recredited'; END IF;

  -- A refund received before the finished event leaves an immutable tombstone.
  -- A later or reordered finished event must not create any money or suspension.
  INSERT INTO public.crypto_transactions(id,user_id,crypto_type,crypto_amount,naira_amount,
    exchange_rate,deposit_address,status,payment_provider,nowpayments_payment_id,
    payment_reference,outcome_amount,outcome_currency,nowpayments_pay_address,created_at,expires_at)
  VALUES (v_unpaid_receipt,v_other,'usdttrc20',1,50,50,v_address,'pending','nowpayments',
    v_unpaid_payment,v_unpaid_reference,v_pay,'usdttrc20',v_address,clock_timestamp(),clock_timestamp()+interval '30 minutes');
  v_result := public.register_nowpayments_wallet_quote(v_unpaid_receipt,v_other,v_unpaid_payment,
    v_unpaid_reference,50,v_pay,'usdttrc20',v_address);
  IF v_result->>'success' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'nowpayments_probe_precredit_refund_registration_failed'; END IF;
  v_result := public.revoke_nowpayments_wallet_quote(v_unpaid_payment,v_unpaid_reference,v_pay,
    'usdttrc20',v_address,NULL,'refunded',v_signature,v_verification);
  IF v_result->>'success' IS DISTINCT FROM 'true'
    OR (SELECT count(*) FROM private.nowpayments_wallet_revocations WHERE payment_id=v_unpaid_payment)<>1
  THEN RAISE EXCEPTION 'nowpayments_probe_precredit_refund_tombstone_missing'; END IF;
  v_result := public.settle_nowpayments_wallet_quote(v_unpaid_payment,v_unpaid_reference,v_pay,
    'usdttrc20',v_address,v_pay,'finished',v_signature,v_verification);
  IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'PAYMENT_REVOKED'
  THEN RAISE EXCEPTION 'nowpayments_probe_precredit_refund_late_finished_credited'; END IF;
  v_truth := public.wallet_financial_truth_internal(v_other);
  IF (SELECT wallet_balance FROM public.profiles WHERE id=v_other) IS DISTINCT FROM 0
    OR (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM 0
    OR EXISTS (SELECT 1 FROM public.transactions WHERE user_id=v_other)
    OR EXISTS (SELECT 1 FROM private.nowpayments_wallet_proofs WHERE payment_id=v_unpaid_payment)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_user,v_other) AND account_suspended)
  THEN RAISE EXCEPTION 'nowpayments_probe_precredit_refund_money_or_suspension'; END IF;

  -- Real SQL role and JWT claims, not merely mocked role checks. Only expected
  -- insufficient_privilege exceptions count; all other errors fail the probe.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_user)::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.register_nowpayments_wallet_quote(v_receipt,v_user,v_payment,v_reference,v_amount,v_pay,'usdttrc20',v_address);
    RAISE EXCEPTION 'nowpayments_probe_authenticated_registration_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    PERFORM public.settle_nowpayments_wallet_quote(v_payment,v_reference,v_pay,'usdttrc20',v_address,v_pay,'finished',v_signature,v_verification);
    RAISE EXCEPTION 'nowpayments_probe_authenticated_settlement_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    PERFORM public.revoke_nowpayments_wallet_quote(v_payment,v_reference,v_pay,'usdttrc20',v_address,v_pay,'refunded',v_signature,v_verification);
    RAISE EXCEPTION 'nowpayments_probe_authenticated_revocation_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    PERFORM public.get_registered_nowpayments_wallet_quote(v_receipt);
    RAISE EXCEPTION 'nowpayments_probe_authenticated_private_quote_read_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    PERFORM 1 FROM private.nowpayments_wallet_proofs;
    RAISE EXCEPTION 'nowpayments_probe_authenticated_proof_read_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    INSERT INTO public.crypto_transactions(id,user_id,crypto_type,crypto_amount,naira_amount,deposit_address)
    VALUES ('9a220000-0000-4000-8000-000000000012',v_user,'usdttrc20',1,v_amount,v_address);
    RAISE EXCEPTION 'nowpayments_probe_authenticated_crypto_insert_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    UPDATE public.crypto_transactions SET status='completed' WHERE id=v_receipt;
    RAISE EXCEPTION 'nowpayments_probe_authenticated_crypto_update_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  BEGIN
    DELETE FROM public.crypto_transactions WHERE id=v_receipt;
    RAISE EXCEPTION 'nowpayments_probe_authenticated_crypto_delete_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=v_denied+1; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF v_denied<>8
    OR (SELECT count(*) FROM public.transactions WHERE user_id=v_user)<>1
    OR (SELECT count(*) FROM private.nowpayments_wallet_proofs WHERE payment_id=v_payment)<>1
    OR (SELECT count(*) FROM private.nowpayments_wallet_revocations WHERE payment_id=v_payment)<>1
    OR (SELECT wallet_balance FROM public.profiles WHERE id=v_user) IS DISTINCT FROM v_amount
    OR (SELECT wallet_balance FROM public.profiles WHERE id=v_other) IS DISTINCT FROM 0
    OR (SELECT status FROM public.crypto_transactions WHERE id=v_receipt) IS DISTINCT FROM 'refunded'
  THEN RAISE EXCEPTION 'nowpayments_probe_authenticated_attempt_changed_state'; END IF;

  INSERT INTO nowpayments_probe_results VALUES
    (true,true,true,v_reg_replay,v_settle_replay,v_ledger_count,v_proof_count,v_rejected,
      true,v_revoke_replay,v_revoke_count,true,true,true,true,v_denied,true);
END;
$probe$;

SELECT * FROM nowpayments_probe_results;
ROLLBACK;
