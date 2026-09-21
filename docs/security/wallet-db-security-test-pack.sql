-- Wallet incident staging DB security test pack.
--
-- Run only after applying the wallet-security migrations in a staging or
-- owner-controlled database. Do not run this against an ordinary customer.
--
-- Required setup:
-- 1. Create or choose one ordinary non-admin, non-staff test profile.
-- 2. Create or choose one current admin profile for the approval-evidence test.
-- 3. Replace both UUIDs below with those fixture ids.
-- 4. Run the full file in the Supabase SQL editor.
--
-- The script runs inside one transaction and ends with ROLLBACK.
-- It intentionally attempts forbidden writes and wallet operations.

BEGIN;

-- Replace this value before running.
SELECT set_config('app.wallet_security_test_user_id', '00000000-0000-0000-0000-000000000000', false);
SELECT set_config('app.wallet_security_test_admin_id', '00000000-0000-0000-0000-000000000000', false);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id', true)::uuid;
  v_profile record;
BEGIN
  IF v_user = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Replace app.wallet_security_test_user_id with an owner-controlled ordinary test profile id before running.';
  END IF;

  SELECT id, is_admin, is_staff
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test profile % does not exist in public.profiles.', v_user;
  END IF;

  IF COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
    RAISE EXCEPTION 'Test profile % must be an ordinary customer, not admin/staff.', v_user;
  END IF;
END $$;

DO $$
DECLARE
  v_admin uuid := current_setting('app.wallet_security_test_admin_id', true)::uuid;
  v_profile record;
BEGIN
  IF v_admin = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Replace app.wallet_security_test_admin_id with an owner-controlled admin profile id before running.';
  END IF;

  SELECT id, is_admin, is_staff
    INTO v_profile
  FROM public.profiles
  WHERE id = v_admin;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin test profile % does not exist in public.profiles.', v_admin;
  END IF;

  IF NOT COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
    RAISE EXCEPTION 'Admin test profile % must be a current admin and not staff.', v_admin;
  END IF;
END $$;

-- Use a harmless snapshot point so every destructive-looking attempt is undone.
SAVEPOINT wallet_security_test_start;

-- Reset the fixture into a known state inside the rollback transaction. This is
-- an owner-side test setup action; the tested browser-role attempts below must
-- still fail or be neutralized.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       crypto_balance = 0,
       referral_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       suspended_at = null,
       is_admin = false,
       is_staff = false,
       pocketfi_account_number = null,
       pocketfi_account_name = null,
       pocketfi_bank = null,
       referred_by = null,
       referral_code = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.pending_payments
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND transaction_reference LIKE 'wallet-db-security-test-%';

DELETE FROM public.pending_payments
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND transaction_reference LIKE 'wallet-db-security-test-%';

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

-- T01/T02/T03/T06/T07: browser-role profile writes cannot create balances or
-- privileged account state, even when the request claims its own user id.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('app.wallet_security_test_user_id'),
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', current_setting('app.wallet_security_test_user_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
       SET wallet_balance = 500000,
           crypto_balance = 250000,
           referral_balance = 125000,
           is_admin = true,
           is_staff = true,
           account_suspended = false
     WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

RESET ROLE;

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_profile record;
BEGIN
  SELECT wallet_balance, crypto_balance, referral_balance, is_admin, is_staff
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> 0
    OR COALESCE(v_profile.crypto_balance, 0) <> 0
    OR COALESCE(v_profile.referral_balance, 0) <> 0
    OR COALESCE(v_profile.is_admin, false)
    OR COALESCE(v_profile.is_staff, false)
  THEN
    RAISE EXCEPTION 'FAILED: authenticated profile mutation changed protected financial/role fields: %', row_to_json(v_profile);
  END IF;
END $$;

-- T04/T06/T10/T65: direct service-role profile writes must not be enough to
-- mutate protected profile fields. Legitimate service paths must use narrow
-- RPCs, not broad profiles.update() calls.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
BEGIN
  UPDATE public.profiles
     SET wallet_balance = 999999,
         crypto_balance = 888888,
         referral_balance = 777777,
         is_staff = true,
         account_suspended = true,
         suspension_reason = 'direct service-role profile write should be neutralized',
         pocketfi_account_number = '9999999999',
         pocketfi_account_name = 'Blocked Service Role',
         pocketfi_bank = 'blocked',
         referred_by = gen_random_uuid(),
         referral_code = 'BLOCKED'
   WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;
END $$;

RESET ROLE;

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_profile record;
BEGIN
  SELECT wallet_balance,
         crypto_balance,
         referral_balance,
         is_staff,
         account_suspended,
         suspension_reason,
         pocketfi_account_number,
         pocketfi_account_name,
         pocketfi_bank,
         referred_by,
         referral_code
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> 0
    OR COALESCE(v_profile.crypto_balance, 0) <> 0
    OR COALESCE(v_profile.referral_balance, 0) <> 0
    OR COALESCE(v_profile.is_staff, false)
    OR COALESCE(v_profile.account_suspended, false)
    OR v_profile.suspension_reason IS NOT NULL
    OR v_profile.pocketfi_account_number IS NOT NULL
    OR v_profile.pocketfi_account_name IS NOT NULL
    OR v_profile.pocketfi_bank IS NOT NULL
    OR v_profile.referred_by IS NOT NULL
    OR COALESCE(v_profile.referral_code, '') = 'BLOCKED'
  THEN
    RAISE EXCEPTION 'FAILED: direct service-role profile update changed protected fields: %', row_to_json(v_profile);
  END IF;
END $$;

-- Approved narrow profile RPCs should still be able to update only their own
-- protected fields.
DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_profile record;
  v_referral jsonb;
BEGIN
  PERFORM public.set_customer_pocketfi_account(
    v_user,
    '1234567890',
    'Wallet Security Test',
    'kuda'
  );

  SELECT public.apply_profile_referral_attribution(v_user, NULL) INTO v_referral;

  IF COALESCE((v_referral->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: referral attribution RPC did not return success: %', v_referral;
  END IF;

  SELECT wallet_balance,
         crypto_balance,
         referral_balance,
         is_staff,
         account_suspended,
         pocketfi_account_number,
         pocketfi_account_name,
         pocketfi_bank,
         referral_code
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF v_profile.pocketfi_account_number IS DISTINCT FROM '1234567890'
    OR v_profile.pocketfi_account_name IS DISTINCT FROM 'Wallet Security Test'
    OR v_profile.pocketfi_bank IS DISTINCT FROM 'kuda'
    OR v_profile.referral_code IS NULL
    OR COALESCE(v_profile.wallet_balance, 0) <> 0
    OR COALESCE(v_profile.crypto_balance, 0) <> 0
    OR COALESCE(v_profile.referral_balance, 0) <> 0
    OR COALESCE(v_profile.is_staff, false)
    OR COALESCE(v_profile.account_suspended, false)
  THEN
    RAISE EXCEPTION 'FAILED: narrow profile RPCs changed unexpected fields or failed to update expected fields: %', row_to_json(v_profile);
  END IF;
END $$;

-- Unauthorized callers must not be able to use the suspension or staff-role
-- RPCs as privilege-escalation tools.
DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_profile record;
BEGIN
  BEGIN
    PERFORM public.set_customer_suspension_state(
      v_user,
      true,
      'non-admin actor should not suspend',
      v_user
    );
    RAISE EXCEPTION 'FAILED: non-admin actor changed suspension state through narrow RPC.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%profile_admin_actor_required%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.set_staff_role(v_user, true, v_user);
    RAISE EXCEPTION 'FAILED: non-admin actor changed staff role through narrow RPC.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%profile_admin_actor_required%' THEN
        RAISE;
      END IF;
  END;

  SELECT is_staff, account_suspended, suspension_reason
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.is_staff, false)
    OR COALESCE(v_profile.account_suspended, false)
    OR v_profile.suspension_reason IS NOT NULL
  THEN
    RAISE EXCEPTION 'FAILED: unauthorized narrow RPC attempt changed profile state: %', row_to_json(v_profile);
  END IF;
END $$;

-- T09/T10/T11: browser roles must not execute the wallet engine directly.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('app.wallet_security_test_user_id'),
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', current_setting('app.wallet_security_test_user_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_result jsonb;
BEGIN
  BEGIN
    SELECT public.apply_wallet_transaction(
      v_user,
      'credit',
      100000,
      'wallet-db-security-test',
      'Forbidden browser-role wallet credit',
      'wallet-db-security-test:browser-rpc',
      jsonb_build_object('source', 'wallet-db-security-test-pack'),
      'NGN',
      'wallet',
      null,
      null
    )
    INTO v_result;

    RAISE EXCEPTION 'FAILED: authenticated role executed apply_wallet_transaction and got %', v_result;
  EXCEPTION
    WHEN insufficient_privilege OR undefined_function THEN
      NULL;
  END;
END $$;

RESET ROLE;

-- Legacy balance RPCs must also be unavailable to browser roles.
DO $$
DECLARE
  fn_name text;
  fn regprocedure;
  v_can_execute boolean;
BEGIN
  FOREACH fn_name IN ARRAY ARRAY[
    'public.update_wallet_balance(uuid,numeric,text,text,text)',
    'public.credit_crypto_balance(uuid,numeric)',
    'public.deduct_crypto_balance(uuid,numeric)',
    'public.transfer_crypto_to_wallet(uuid,numeric)',
    'public.withdraw_referral_balance_to_wallet(uuid)'
  ]
  LOOP
    fn := to_regprocedure(fn_name);
    IF fn IS NOT NULL THEN
      SELECT has_function_privilege('anon', fn, 'EXECUTE')
          OR has_function_privilege('authenticated', fn, 'EXECUTE')
        INTO v_can_execute;

      IF v_can_execute THEN
        RAISE EXCEPTION 'FAILED: legacy balance RPC % is executable by anon/authenticated.', fn_name;
      END IF;
    END IF;
  END LOOP;
END $$;

-- T04/T73: direct ledger writes outside the wallet engine are skipped/audited
-- and must not produce a spendable transaction row.
INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'credit',
  999999,
  'completed',
  0,
  999999,
  'NGN',
  'wallet-db-security-test-direct-ledger',
  'Forbidden direct ledger write',
  'wallet-db-security-test:direct-ledger',
  jsonb_build_object('source', 'wallet-db-security-test-pack'),
  'wallet'
);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_rows integer;
  v_audit_rows integer;
  v_event_rows integer;
BEGIN
  SELECT count(*)
    INTO v_rows
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key = 'wallet-db-security-test:direct-ledger';

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAILED: direct transaction insert created % ledger row(s).', v_rows;
  END IF;

  SELECT count(*)
    INTO v_audit_rows
  FROM public.transaction_ledger_blocked_attempts
  WHERE row_user_id = v_user
    AND row_reference = 'wallet-db-security-test-direct-ledger';

  IF v_audit_rows < 1 THEN
    RAISE EXCEPTION 'FAILED: direct transaction insert was not audited.';
  END IF;

  SELECT count(*)
    INTO v_event_rows
  FROM public.wallet_security_events
  WHERE wallet_user_id = v_user
    AND event_type = 'DIRECT_LEDGER_WRITE_BLOCKED'
    AND denial_code = 'DIRECT_LEDGER_WRITE_BLOCKED'
    AND operation_reference = 'wallet-db-security-test-direct-ledger';

  IF v_event_rows < 1 THEN
    RAISE EXCEPTION 'FAILED: direct transaction insert did not create wallet_security_events forensic row.';
  END IF;
END $$;

-- T25/T26/T27/T28/T41: fabricated stored wallet balances with no trusted
-- backing must be denied and frozen before any purchase can be authorized.
DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_fabricated_balance numeric;
  v_result jsonb;
  v_profile record;
  v_event_rows integer;
BEGIN
  FOREACH v_fabricated_balance IN ARRAY ARRAY[500000, 450000, 789292, 1]
  LOOP
    PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

    UPDATE public.profiles
       SET wallet_balance = v_fabricated_balance,
           account_suspended = false,
           suspension_reason = null,
           updated_at = now()
     WHERE id = v_user;

    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

    SELECT public.apply_wallet_transaction(
      v_user,
      'purchase',
      1,
      'wallet-db-security-test-purchase-' || v_fabricated_balance::text,
      'Unbacked purchase denial test',
      'wallet-db-security-test:unbacked-purchase:' || v_fabricated_balance::text,
      jsonb_build_object('source', 'wallet-db-security-test-pack', 'fabricated_balance', v_fabricated_balance),
      'NGN',
      'wallet',
      null,
      null
    )
    INTO v_result;

    IF v_result->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
      RAISE EXCEPTION 'FAILED: fabricated balance % was not denied with WALLET_UNBACKED_FUNDS. Result: %', v_fabricated_balance, v_result;
    END IF;

    SELECT wallet_balance, account_suspended, suspension_reason
      INTO v_profile
    FROM public.profiles
    WHERE id = v_user;

    IF NOT COALESCE(v_profile.account_suspended, false) THEN
      RAISE EXCEPTION 'FAILED: fabricated balance % did not freeze/suspend wallet. Profile: %', v_fabricated_balance, row_to_json(v_profile);
    END IF;

    IF COALESCE(v_profile.wallet_balance, 0) <> v_fabricated_balance THEN
      RAISE EXCEPTION 'FAILED: denied unbacked purchase changed stored balance %. Profile: %', v_fabricated_balance, row_to_json(v_profile);
    END IF;

    SELECT count(*)
      INTO v_event_rows
    FROM public.wallet_security_events
    WHERE wallet_user_id = v_user
      AND event_type = 'WALLET_FINANCIAL_FREEZE'
      AND denial_code = 'WALLET_UNBACKED_FUNDS'
      AND financial_snapshot->>'suspension_reason' ILIKE '%backed available%';

    IF v_event_rows < 1 THEN
      RAISE EXCEPTION 'FAILED: unbacked purchase freeze did not create wallet_security_events forensic row. Result: %', v_result;
    END IF;
  END LOOP;
END $$;

-- Wallet engine/profile-trigger contract: the wallet engine itself must set the
-- guarded profile-write context for balance updates and debit signing. This
-- catches migrations that insert ledger rows but leave profiles.wallet_balance
-- unchanged because profile privileged-field guards are stricter.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_topup jsonb;
  v_purchase jsonb;
  v_profile record;
  v_purchase_row record;
  v_pending_status text;
BEGIN
  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES (
    v_user,
    'wallet-db-security-test-engine-profile-topup',
    'wallet-db-security-test-provider-topup',
    1000,
    'pending'
  );

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    1000,
    'wallet-db-security-test-engine-profile-topup',
    'Wallet engine profile update contract topup',
    'wallet-db-security-test:engine-profile:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 1000),
    'NGN',
    'wallet',
    'wallet-db-security-test-provider-topup',
    null
  )
  INTO v_topup;

  IF COALESCE((v_topup->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: wallet-engine topup did not post. Result: %', v_topup;
  END IF;

  SELECT status
    INTO v_pending_status
  FROM public.pending_payments
  WHERE user_id = v_user
    AND transaction_reference = 'wallet-db-security-test-engine-profile-topup';

  IF lower(COALESCE(v_pending_status, '')) <> 'credited' THEN
    RAISE EXCEPTION 'FAILED: wallet-engine topup did not consume pending payment evidence. Status: %', v_pending_status;
  END IF;

  SELECT wallet_balance, account_suspended
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> 1000 THEN
    RAISE EXCEPTION 'FAILED: wallet-engine topup did not update profile balance. Profile: %', row_to_json(v_profile);
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    400,
    'wallet-db-security-test-engine-profile-purchase',
    'Wallet engine profile update contract purchase',
    'wallet-db-security-test:engine-profile:purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_purchase;

  IF COALESCE((v_purchase->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: wallet-engine purchase did not post. Result: %', v_purchase;
  END IF;

  SELECT wallet_balance, account_suspended
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> 600 THEN
    RAISE EXCEPTION 'FAILED: wallet-engine purchase did not update profile balance to 600. Profile: %', row_to_json(v_profile);
  END IF;

  SELECT amount, balance_before, balance_after
    INTO v_purchase_row
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key = 'wallet-db-security-test:engine-profile:purchase'
  LIMIT 1;

  IF COALESCE(v_purchase_row.amount, 0) <> -400
    OR COALESCE(v_purchase_row.balance_before, 0) <> 1000
    OR COALESCE(v_purchase_row.balance_after, 0) <> 600
  THEN
    RAISE EXCEPTION 'FAILED: wallet-engine purchase row was not signed/snapshotted correctly. Row: %', row_to_json(v_purchase_row);
  END IF;
END $$;

-- T29/T32/T59/T62: business credits without an approving actor must not enter
-- the ledger as trusted principal.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_credit jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}'::text, true);

  SELECT public.apply_wallet_transaction(
    v_user,
    'admin_credit',
    10000,
    'wallet-db-security-test-unapproved-admin-credit',
    'Unapproved admin credit should not be trusted backing',
    'wallet-db-security-test:unapproved-admin-credit',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_backing', false),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_credit;

  IF v_credit->>'code' IS DISTINCT FROM 'ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED' THEN
    RAISE EXCEPTION 'FAILED: admin_credit without approving actor was not rejected. Result: %', v_credit;
  END IF;
END $$;

-- An admin_credit with a non-admin creator is not approved admin funding. This
-- protects against callers passing an arbitrary customer/staff UUID as
-- created_by and accidentally creating trusted principal.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_credit jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'admin_credit',
    10000,
    'wallet-db-security-test-non-admin-admin-credit',
    'Admin credit with non-admin actor should not be trusted backing',
    'wallet-db-security-test:non-admin-admin-credit',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_backing', false),
    'NGN',
    'wallet',
    null,
    v_user
  )
  INTO v_credit;

  IF v_credit->>'code' IS DISTINCT FROM 'ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED' THEN
    RAISE EXCEPTION 'FAILED: non-admin admin_credit was not rejected at write time. Result: %', v_credit;
  END IF;
END $$;

-- A current admin actor is still insufficient without explicit approval
-- metadata. A complete approved admin credit with explicit approval metadata
-- is accepted and is rolled back
-- with the rest of this test pack.
DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_admin uuid := current_setting('app.wallet_security_test_admin_id')::uuid;
  v_credit jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'admin_credit',
    10000,
    'wallet-db-security-test-admin-credit-missing-evidence',
    'Admin credit missing explicit approval evidence',
    'wallet-db-security-test:admin-credit-missing-evidence',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    v_admin
  )
  INTO v_credit;

  IF v_credit->>'code' IS DISTINCT FROM 'ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED' THEN
    RAISE EXCEPTION 'FAILED: admin_credit with admin actor but missing approval evidence was accepted. Result: %', v_credit;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'admin_credit',
    10000,
    'wallet-db-security-test-approved-admin-credit',
    'Approved admin credit with explicit approval metadata',
    'wallet-db-security-test:approved-admin-credit',
    jsonb_build_object(
      'source', 'wallet-db-security-test-pack',
      'approved_by', v_admin::text,
      'approval_type', 'staging_security_test',
      'approval_reference', 'wallet-db-security-test-approval-1',
      'reason', 'approved staging security fixture'
    ),
    'NGN',
    'wallet',
    null,
    v_admin
  )
  INTO v_credit;

  IF COALESCE((v_credit->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: approved admin_credit with complete evidence was rejected. Result: %', v_credit;
  END IF;
END $$;

-- Spoofed balance-neutral admin repair/evidence rows are not allowed unless
-- created_by is a real admin. They must be skipped, audited, and must not
-- create trusted spendable principal.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 10000,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_rows integer := 0;
  v_blocked_rows integer := 0;
  v_purchase jsonb;
BEGIN
  INSERT INTO public.transactions (
    user_id,
    type,
    amount,
    status,
    balance_type,
    balance_before,
    balance_after,
    description,
    reference,
    idempotency_key,
    metadata,
    created_by
  )
  VALUES (
    v_user,
    'admin_credit',
    10000,
    'completed',
    'wallet',
    0,
    0,
    'Balance-neutral admin repair evidence should not be trusted backing',
    'wallet-db-security-test-admin-repair',
    'wallet-db-security-test:admin-repair-neutral',
    jsonb_build_object(
      'source', 'admin-ledger-repair',
      'balance_unchanged', true,
      'requires_owner_evidence', true,
      'expected_trusted_backing', false
    ),
    v_user
  );

  SELECT count(*)
    INTO v_rows
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key = 'wallet-db-security-test:admin-repair-neutral';

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAILED: non-admin balance-neutral admin repair row was inserted.';
  END IF;

  SELECT count(*)
    INTO v_blocked_rows
  FROM public.transaction_ledger_blocked_attempts
  WHERE row_user_id = v_user
    AND row_reference = 'wallet-db-security-test-admin-repair'
    AND row_type = 'admin_credit';

  IF v_blocked_rows = 0 THEN
    RAISE EXCEPTION 'FAILED: non-admin balance-neutral admin repair row was not audited as a blocked direct ledger attempt.';
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-admin-repair-purchase',
    'Purchase backed only by balance-neutral admin repair evidence',
    'wallet-db-security-test:admin-repair-purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_purchase;

  IF v_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: balance-neutral admin repair evidence authorized spend. Purchase: %', v_purchase;
  END IF;
END $$;

-- Staff/promotion/correction credits are historical/display evidence only for
-- this incident model. Even with a creator recorded, they must not become
-- trusted product-spend principal; approved business funding must use
-- admin_credit.
DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_type text;
  v_credit jsonb;
  v_purchase jsonb;
BEGIN
  FOREACH v_type IN ARRAY ARRAY['staff_credit', 'promotion_credit', 'correction_credit']
  LOOP
    PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

    UPDATE public.profiles
       SET wallet_balance = 0,
           account_suspended = false,
           suspension_reason = null,
           updated_at = now()
     WHERE id = v_user;

    DELETE FROM public.transactions
     WHERE user_id = v_user;

    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

    SELECT public.apply_wallet_transaction(
      v_user,
      v_type,
      10000,
      'wallet-db-security-test-untrusted-' || v_type,
      v_type || ' should not be trusted principal',
      'wallet-db-security-test:untrusted:' || v_type,
      jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_backing', false),
      'NGN',
      'wallet',
      null,
      v_user
    )
    INTO v_credit;

    IF COALESCE((v_credit->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FAILED: setup % did not post. Result: %', v_type, v_credit;
    END IF;

    SELECT public.apply_wallet_transaction(
      v_user,
      'purchase',
      1,
      'wallet-db-security-test-untrusted-' || v_type || '-purchase',
      'Purchase backed only by ' || v_type,
      'wallet-db-security-test:untrusted:' || v_type || ':purchase',
      jsonb_build_object('source', 'wallet-db-security-test-pack'),
      'NGN',
      'wallet',
      null,
      null
    )
    INTO v_purchase;

    IF v_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
      RAISE EXCEPTION 'FAILED: % authorized spend. Credit: %, Purchase: %', v_type, v_credit, v_purchase;
    END IF;
  END LOOP;
END $$;

-- Internal balance movement such as referral withdrawal may change the displayed
-- wallet balance, but it must not become trusted product-spend principal.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_internal_credit jsonb;
  v_purchase jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'referral_withdrawal',
    5000,
    'wallet-db-security-test-referral-withdrawal',
    'Internal/referral movement should not become trusted product-spend principal',
    'wallet-db-security-test:referral-withdrawal',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_backing', false),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_internal_credit;

  IF COALESCE((v_internal_credit->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: setup referral_withdrawal did not post. Result: %', v_internal_credit;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-referral-withdrawal-purchase',
    'Purchase backed only by internal/referral movement',
    'wallet-db-security-test:referral-withdrawal:purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_purchase;

  IF v_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: internal/referral movement authorized spend. Credit: %, Purchase: %', v_internal_credit, v_purchase;
  END IF;
END $$;

-- T56/T59/T61/T62: refunds must restore only backed prior debits. Over-refunds,
-- pending refund snapshots, and refunds of seeded unbacked legacy purchases must
-- not become freely spendable value.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_topup jsonb;
  v_purchase jsonb;
  v_missing_original_refund jsonb;
  v_over_refund jsonb;
  v_valid_refund jsonb;
  v_allowed_repurchase jsonb;
  v_extra_purchase jsonb;
BEGIN
  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES (
    v_user,
    'wallet-db-security-test-refund-cap-topup',
    'wallet-db-security-test-refund-cap-provider-id',
    100,
    'pending'
  );

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    100,
    'wallet-db-security-test-refund-cap-topup',
    'Verified top-up for refund cap test',
    'wallet-db-security-test:refund-cap:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 100),
    'NGN',
    'wallet',
    'wallet-db-security-test-refund-cap-provider-id',
    null
  )
  INTO v_topup;

  IF COALESCE((v_topup->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: refund cap setup top-up did not post. Result: %', v_topup;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    100,
    'wallet-db-security-test-refund-cap-purchase',
    'Backed purchase for refund cap test',
    'wallet-db-security-test:refund-cap:purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_purchase;

  IF COALESCE((v_purchase->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: refund cap setup purchase did not post. Result: %', v_purchase;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'refund',
    1,
    'wallet-db-security-test-refund-cap-no-original',
    'Refund without original debit evidence should not restore trusted spend',
    'wallet-db-security-test:refund-cap:no-original',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_original_debit_required', true),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_missing_original_refund;

  IF v_missing_original_refund->>'code' IS DISTINCT FROM 'REFUND_ORIGINAL_DEBIT_REQUIRED' THEN
    RAISE EXCEPTION 'FAILED: refund without original debit link was not rejected. Result: %', v_missing_original_refund;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'refund',
    500,
    'wallet-db-security-test-refund-cap-over-refund',
    'Intentional over-refund should not create extra trusted spend',
    'wallet-db-security-test:refund-cap:over-refund',
    jsonb_build_object(
      'source', 'wallet-db-security-test-pack',
      'source_debit_idempotency_key', 'wallet-db-security-test:refund-cap:purchase',
      'expected_extra_trusted_backing', false
    ),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_over_refund;

  IF v_over_refund->>'code' IS DISTINCT FROM 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT' THEN
    RAISE EXCEPTION 'FAILED: over-refund was not rejected at the wallet engine. Result: %', v_over_refund;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'refund',
    100,
    'wallet-db-security-test-refund-cap-valid-refund',
    'Valid refund restores only the original backed debit',
    'wallet-db-security-test:refund-cap:valid-refund',
    jsonb_build_object(
      'source', 'wallet-db-security-test-pack',
      'source_debit_idempotency_key', 'wallet-db-security-test:refund-cap:purchase'
    ),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_valid_refund;

  IF COALESCE((v_valid_refund->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: valid refund did not post. Result: %', v_valid_refund;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    100,
    'wallet-db-security-test-refund-cap-allowed-repurchase',
    'Only original backed debit may be restored by refund',
    'wallet-db-security-test:refund-cap:allowed-repurchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_allowed_repurchase;

  IF COALESCE((v_allowed_repurchase->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: eligible refund amount did not restore the original backed debit. Result: %', v_allowed_repurchase;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-refund-cap-extra-purchase',
    'Over-refund excess must not authorize extra spend',
    'wallet-db-security-test:refund-cap:extra-purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_extra_purchase;

  IF v_extra_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: extra spend after fully consumed refund was authorized. Result: %', v_extra_purchase;
  END IF;
END $$;

-- Seeded legacy loose refunds must not restore trusted spend even when the row
-- is completed and positive. Only refunds linked to an original
-- trusted-principal-authorized debit can restore availability.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 999999,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert;

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'refund',
  999999,
  'completed',
  0,
  999999,
  'NGN',
  'wallet-db-security-test-loose-completed-refund',
  'Seeded completed refund without original debit must not restore trusted backing',
  'wallet-db-security-test:loose-refund:completed',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'loose_refund_without_original_debit', true),
  'wallet'
);

ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_loose_refund_purchase jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-loose-refund-purchase',
    'Completed loose refund row must not authorize spend',
    'wallet-db-security-test:loose-refund:purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_loose_refund_purchase;

  IF v_loose_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: completed loose refund without original debit became spendable. Result: %', v_loose_refund_purchase;
  END IF;
END $$;

SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_topup jsonb;
  v_fake_provider_topup jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    p_user_id := v_user,
    p_type := 'topup',
    p_amount := 10000,
    p_reference := 'wallet-db-security-test-missing-provider-evidence',
    p_description := 'Deposit-looking row without provider evidence must not create trusted principal',
    p_idempotency_key := 'wallet-db-security-test:deposit-without-provider-evidence',
    p_metadata := jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_principal', false),
    p_currency := 'NGN',
    p_balance_type := 'wallet',
    p_external_payment_id := null,
    p_created_by := null
  )
  INTO v_topup;

  IF COALESCE((v_topup->>'success')::boolean, true) IS NOT FALSE
    OR v_topup->>'code' IS DISTINCT FROM 'PAYMENT_EVIDENCE_REQUIRED'
  THEN
    RAISE EXCEPTION 'FAILED: deposit without provider evidence was accepted. Result: %', v_topup;
  END IF;

  SELECT public.apply_wallet_transaction(
    p_user_id := v_user,
    p_type := 'topup',
    p_amount := 10000,
    p_reference := 'wallet-db-security-test-fake-provider-evidence',
    p_description := 'Deposit-looking row with fake provider identity must not create trusted principal',
    p_idempotency_key := 'wallet-db-security-test:deposit-with-fake-provider-evidence',
    p_metadata := jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'expected_trusted_principal', false),
    p_currency := 'NGN',
    p_balance_type := 'wallet',
    p_external_payment_id := 'wallet-db-security-test-fake-provider-id',
    p_created_by := null
  )
  INTO v_fake_provider_topup;

  IF COALESCE((v_fake_provider_topup->>'success')::boolean, true) IS NOT FALSE
    OR v_fake_provider_topup->>'code' IS DISTINCT FROM 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED'
  THEN
    RAISE EXCEPTION 'FAILED: deposit with fake provider identity was accepted. Result: %', v_fake_provider_topup;
  END IF;
END $$;

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'refund',
  56620,
  'pending',
  895350,
  0,
  'NGN',
  'wallet-db-security-test-pending-refund-zero-snapshot',
  'Seeded pending refund with invalid zero snapshot must not become trusted backing',
  'wallet-db-security-test:pending-refund:zero-snapshot',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'riley_shape', true),
  'wallet'
);

UPDATE public.profiles
   SET wallet_balance = 56620,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_pending_refund_purchase jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-pending-refund-purchase',
    'Pending refund row must not authorize spend',
    'wallet-db-security-test:pending-refund:purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_pending_refund_purchase;

  IF v_pending_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: pending refund with invalid snapshot became spendable. Result: %', v_pending_refund_purchase;
  END IF;
END $$;

SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 1000,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

-- Seed historical malformed evidence that could exist before this hardening.
-- The runtime trusted-principal trigger must stay strict for new writes, so this
-- rollback-only staging fixture disables it temporarily to insert legacy rows.
ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert;

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES
(
  current_setting('app.wallet_security_test_user_id')::uuid,
  'purchase',
  -1000,
  'completed',
  1000,
  0,
  'NGN',
  'wallet-db-security-test-unbacked-legacy-purchase',
  'Seeded unbacked legacy purchase',
  'wallet-db-security-test:unbacked-legacy-refund:purchase',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'trusted_backing', false),
  'wallet'
),
(
  current_setting('app.wallet_security_test_user_id')::uuid,
  'refund',
  1000,
  'completed',
  0,
  1000,
  'NGN',
  'wallet-db-security-test-unbacked-legacy-refund',
  'Refund of unbacked legacy purchase must not become trusted backing',
  'wallet-db-security-test:unbacked-legacy-refund:refund',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'trusted_backing', false),
  'wallet'
);

ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert;

UPDATE public.profiles
   SET wallet_balance = 1000,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_legacy_refund_purchase jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-unbacked-legacy-refund-purchase',
    'Refund of unbacked legacy purchase must not authorize spend',
    'wallet-db-security-test:unbacked-legacy-refund:attempted-purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_legacy_refund_purchase;

  IF v_legacy_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: refund of unbacked legacy purchase became spendable. Result: %', v_legacy_refund_purchase;
  END IF;
END $$;

-- A historical debit row with forged trusted_principal_authorized metadata still
-- must not create refundable trusted capacity when no verified deposit or
-- approved admin credit backed it.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 1000,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert;

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES
(
  current_setting('app.wallet_security_test_user_id')::uuid,
  'purchase',
  -1000,
  'completed',
  1000,
  0,
  'NGN',
  'wallet-db-security-test-fake-trusted-metadata-purchase',
  'Seeded unbacked legacy purchase with forged trusted-principal metadata',
  'wallet-db-security-test:fake-trusted-metadata:purchase',
  jsonb_build_object(
    'source', 'wallet-db-security-test-pack',
    'trusted_backing', false,
    'trusted_principal_authorized', true,
    'forged_legacy_metadata', true
  ),
  'wallet'
),
(
  current_setting('app.wallet_security_test_user_id')::uuid,
  'refund',
  1000,
  'completed',
  0,
  1000,
  'NGN',
  'wallet-db-security-test-fake-trusted-metadata-refund',
  'Refund of forged trusted metadata debit must not become trusted backing',
  'wallet-db-security-test:fake-trusted-metadata:refund',
  jsonb_build_object(
    'source', 'wallet-db-security-test-pack',
    'trusted_backing', false,
    'source_debit_idempotency_key', 'wallet-db-security-test:fake-trusted-metadata:purchase',
    'forged_legacy_metadata', true
  ),
  'wallet'
);

ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_fake_metadata_purchase jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    1,
    'wallet-db-security-test-fake-trusted-metadata-purchase-attempt',
    'Forged trusted-principal metadata must not authorize spend',
    'wallet-db-security-test:fake-trusted-metadata:attempted-purchase',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_fake_metadata_purchase;

  IF v_fake_metadata_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: forged trusted-principal metadata became spendable. Result: %', v_fake_metadata_purchase;
  END IF;
END $$;

-- Even if a malformed historical debit falsely claims trusted metadata, a new
-- refund posted through the wallet engine must still be rejected because the
-- original debit consumed zero real trusted principal.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert;

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'purchase',
  -1000,
  'completed',
  1000,
  0,
  'NGN',
  'wallet-db-security-test-fake-trusted-refund-source',
  'Seeded unbacked legacy purchase with forged trusted metadata for refund rejection',
  'wallet-db-security-test:fake-trusted-refund-source:purchase',
  jsonb_build_object(
    'source', 'wallet-db-security-test-pack',
    'trusted_backing', false,
    'trusted_principal_authorized', true,
    'forged_legacy_metadata', true
  ),
  'wallet'
);

ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_fake_metadata_refund jsonb;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'refund',
    1,
    'wallet-db-security-test-fake-trusted-refund-attempt',
    'Refund against forged trusted-principal metadata must be rejected',
    'wallet-db-security-test:fake-trusted-refund-source:refund-attempt',
    jsonb_build_object(
      'source', 'wallet-db-security-test-pack',
      'source_debit_idempotency_key', 'wallet-db-security-test:fake-trusted-refund-source:purchase'
    ),
    'NGN',
    'wallet',
    null,
    null
  )
  INTO v_fake_metadata_refund;

  IF v_fake_metadata_refund->>'code' IS DISTINCT FROM 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED' THEN
    RAISE EXCEPTION 'FAILED: refund against forged trusted metadata was not rejected. Result: %', v_fake_metadata_refund;
  END IF;
END $$;

-- T63: chargebacks are debt/accounting events. They must be recorded even
-- when they push the posted wallet balance negative, and they must freeze the
-- wallet so no new paid delivery can occur.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:chargeback:%';

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_chargeback jsonb;
  v_profile record;
BEGIN
  SELECT public.apply_wallet_transaction(
    v_user,
    'chargeback',
    500,
    'wallet-db-security-test-chargeback-debt',
    'Chargeback debt must be recorded and frozen',
    'wallet-db-security-test:chargeback:debt',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    'wallet',
    'wallet-db-security-test-chargeback-provider-id',
    null
  )
  INTO v_chargeback;

  IF COALESCE((v_chargeback->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: chargeback debt did not post. Result: %', v_chargeback;
  END IF;

  IF COALESCE((v_chargeback->>'balance_after')::numeric, 0) <> -500 THEN
    RAISE EXCEPTION 'FAILED: chargeback debt did not preserve negative balance. Result: %', v_chargeback;
  END IF;

  SELECT wallet_balance, account_suspended, suspension_reason
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> -500
    OR COALESCE(v_profile.account_suspended, false) IS NOT TRUE
    OR COALESCE(v_profile.suspension_reason, '') NOT LIKE 'Wallet frozen: chargeback posted a debt balance%'
  THEN
    RAISE EXCEPTION 'FAILED: chargeback debt did not freeze wallet with debt preserved. Profile: %', row_to_json(v_profile);
  END IF;
END $$;

-- T20/T21/T39: idempotent replay is allowed only for the same financial shape;
-- conflicting reuse must return IDEMPOTENCY_CONFLICT.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
BEGIN
  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES (
    v_user,
    'wallet-db-security-test-topup',
    'wallet-db-security-test-provider-id',
    10000,
    'pending'
  );

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    10000,
    'wallet-db-security-test-topup',
    'Verified top-up idempotency test',
    'wallet-db-security-test:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 10000),
    'NGN',
    'wallet',
    'wallet-db-security-test-provider-id',
    null
  )
  INTO v_first;

  IF COALESCE((v_first->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: first top-up did not succeed. Result: %', v_first;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    10000,
    'wallet-db-security-test-topup',
    'Verified top-up idempotency test',
    'wallet-db-security-test:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 10000),
    'NGN',
    'wallet',
    'wallet-db-security-test-provider-id',
    null
  )
  INTO v_replay;

  IF COALESCE((v_replay->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: exact idempotent replay was not detected. Result: %', v_replay;
  END IF;

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    20000,
    'wallet-db-security-test-topup',
    'Conflicting top-up idempotency test',
    'wallet-db-security-test:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 20000),
    'NGN',
    'wallet',
    'wallet-db-security-test-provider-id',
    null
  )
  INTO v_conflict;

  IF v_conflict->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'FAILED: conflicting idempotency reuse did not return IDEMPOTENCY_CONFLICT. Result: %', v_conflict;
  END IF;
END $$;

-- T68/T69 and partner containment: partners should be inactive after the
-- incident pause migration, and browser roles should have no direct partner
-- table access while audit access goes through the service-role Edge function.
DO $$
DECLARE
  v_active_count integer := 0;
  v_unsafe_partner_grants integer := 0;
  v_unsafe_pending_payment_grants integer := 0;
BEGIN
  IF to_regclass('public.api_partners') IS NOT NULL THEN
    SELECT count(*) INTO v_active_count FROM public.api_partners WHERE is_active = true;
    IF v_active_count > 0 THEN
      RAISE EXCEPTION 'FAILED: % api_partners row(s) are still active during incident pause.', v_active_count;
    END IF;
  END IF;

  SELECT count(*)
    INTO v_unsafe_partner_grants
  FROM unnest(array[
    'api_partners',
    'api_partner_keys',
    'api_partner_orders',
    'api_partner_logs',
    'api_partner_customers',
    'api_partner_webhook_deliveries'
  ]) AS table_name
  WHERE to_regclass('public.' || table_name) IS NOT NULL
    AND (
      has_table_privilege('anon', 'public.' || table_name, 'INSERT')
      OR has_table_privilege('anon', 'public.' || table_name, 'SELECT')
      OR has_table_privilege('anon', 'public.' || table_name, 'UPDATE')
      OR has_table_privilege('anon', 'public.' || table_name, 'DELETE')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'INSERT')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'DELETE')
    );

  IF v_unsafe_partner_grants > 0 THEN
    RAISE EXCEPTION 'FAILED: % partner table(s) still have anon/authenticated direct read/write privileges.', v_unsafe_partner_grants;
  END IF;

  IF to_regclass('public.pending_payments') IS NOT NULL THEN
    SELECT
      (CASE WHEN has_table_privilege('anon', 'public.pending_payments', 'INSERT') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('anon', 'public.pending_payments', 'UPDATE') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('anon', 'public.pending_payments', 'DELETE') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('anon', 'public.pending_payments', 'TRUNCATE') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('authenticated', 'public.pending_payments', 'INSERT') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('authenticated', 'public.pending_payments', 'UPDATE') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('authenticated', 'public.pending_payments', 'DELETE') THEN 1 ELSE 0 END) +
      (CASE WHEN has_table_privilege('authenticated', 'public.pending_payments', 'TRUNCATE') THEN 1 ELSE 0 END)
      INTO v_unsafe_pending_payment_grants;

    IF v_unsafe_pending_payment_grants > 0 THEN
      RAISE EXCEPTION 'FAILED: pending_payments still has % anon/authenticated write privilege(s).', v_unsafe_pending_payment_grants;
    END IF;
  END IF;
END $$;

-- T73/T78: account or partner deletion must not erase incident evidence
-- through cascading foreign keys after the evidence-preservation migrations.
DO $$
DECLARE
  v_auth_cascades integer := 0;
  v_partner_cascades integer := 0;
BEGIN
  SELECT count(*)
    INTO v_auth_cascades
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class refrel ON refrel.oid = con.confrelid
  JOIN pg_namespace refnsp ON refnsp.oid = refrel.relnamespace
  WHERE con.contype = 'f'
    AND nsp.nspname = 'public'
    AND refnsp.nspname = 'auth'
    AND refrel.relname = 'users'
    AND con.confdeltype = 'c';

  IF v_auth_cascades > 0 THEN
    RAISE EXCEPTION 'FAILED: % public auth.users foreign key(s) still use ON DELETE CASCADE.', v_auth_cascades;
  END IF;

  SELECT count(*)
    INTO v_partner_cascades
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class refrel ON refrel.oid = con.confrelid
  JOIN pg_namespace refnsp ON refnsp.oid = refrel.relnamespace
  WHERE con.contype = 'f'
    AND nsp.nspname = 'public'
    AND refnsp.nspname = 'public'
    AND refrel.relname IN (
      'api_partners',
      'api_partner_keys',
      'api_partner_orders',
      'api_partner_logs',
      'api_partner_customers',
      'api_partner_webhook_deliveries'
    )
    AND con.confdeltype = 'c';

  IF v_partner_cascades > 0 THEN
    RAISE EXCEPTION 'FAILED: % partner/API evidence foreign key(s) still use ON DELETE CASCADE.', v_partner_cascades;
  END IF;
END $$;

-- T37/T49/T50/T78: reserve-first hold and durable-dispatch foundation must be
-- service-role-only in the deployed schema. These checks do not prove active
-- routes have been migrated to reserve-first processing; they prove the new
-- database objects are not browser-writable and keep their core integrity
-- constraints after migrations run.
DO $$
DECLARE
  v_missing_tables integer := 0;
  v_missing_constraints integer := 0;
  v_missing_indexes integer := 0;
  v_browser_privileges integer := 0;
  v_browser_policies integer := 0;
  v_service_role_missing_privileges integer := 0;
  v_browser_function_privileges integer := 0;
  v_service_role_missing_function_privileges integer := 0;
  v_rls_disabled integer := 0;
BEGIN
  SELECT count(*)
    INTO v_missing_tables
  FROM unnest(array[
    'wallet_reservations',
    'fulfillment_dispatch_outbox'
  ]) AS required_table
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class rel
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = required_table
      AND rel.relkind = 'r'
  );

  IF v_missing_tables > 0 THEN
    RAISE EXCEPTION 'FAILED: % reserve/outbox table(s) missing.', v_missing_tables;
  END IF;

  SELECT count(*)
    INTO v_rls_disabled
  FROM pg_class rel
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname IN ('wallet_reservations', 'fulfillment_dispatch_outbox')
    AND rel.relrowsecurity IS NOT TRUE;

  IF v_rls_disabled > 0 THEN
    RAISE EXCEPTION 'FAILED: % reserve/outbox table(s) do not have RLS enabled.', v_rls_disabled;
  END IF;

  SELECT count(*)
    INTO v_browser_privileges
  FROM unnest(array[
    'wallet_reservations',
    'fulfillment_dispatch_outbox'
  ]) AS table_name
  CROSS JOIN unnest(array['anon', 'authenticated', 'public']) AS role_name
  CROSS JOIN unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS privilege_name
  WHERE has_table_privilege(role_name, 'public.' || table_name, privilege_name);

  IF v_browser_privileges > 0 THEN
    RAISE EXCEPTION 'FAILED: reserve/outbox tables expose % browser-role table privilege(s).', v_browser_privileges;
  END IF;

  SELECT count(*)
    INTO v_browser_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('wallet_reservations', 'fulfillment_dispatch_outbox')
    AND array_to_string(roles, ',') ~ '(^|,)(anon|authenticated|public)(,|$)';

  IF v_browser_policies > 0 THEN
    RAISE EXCEPTION 'FAILED: reserve/outbox tables expose % browser-role RLS policy/policies.', v_browser_policies;
  END IF;

  SELECT count(*)
    INTO v_service_role_missing_privileges
  FROM unnest(array[
    'wallet_reservations',
    'fulfillment_dispatch_outbox'
  ]) AS table_name
  CROSS JOIN unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege_name
  WHERE has_table_privilege('service_role', 'public.' || table_name, privilege_name) IS NOT TRUE;

  IF v_service_role_missing_privileges > 0 THEN
    RAISE EXCEPTION 'FAILED: service_role is missing % reserve/outbox privilege(s).', v_service_role_missing_privileges;
  END IF;

  SELECT count(*)
    INTO v_browser_function_privileges
  FROM unnest(array[
    'public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer)',
    'public.claim_fulfillment_dispatch(text, text, integer)',
    'public.finish_fulfillment_dispatch(uuid, text, text, text)',
    'public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz)',
    'public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid)',
    'public.release_wallet_reservation(uuid, text, text)',
    'public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer)',
    'public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid)'
  ]) AS function_signature
  CROSS JOIN unnest(array['anon', 'authenticated', 'public']) AS role_name
  WHERE has_function_privilege(role_name, function_signature, 'EXECUTE');

  IF v_browser_function_privileges > 0 THEN
    RAISE EXCEPTION 'FAILED: reserve/outbox RPCs expose % browser-role EXECUTE privilege(s).', v_browser_function_privileges;
  END IF;

  SELECT count(*)
    INTO v_service_role_missing_function_privileges
  FROM unnest(array[
    'public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer)',
    'public.claim_fulfillment_dispatch(text, text, integer)',
    'public.finish_fulfillment_dispatch(uuid, text, text, text)',
    'public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz)',
    'public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid)',
    'public.release_wallet_reservation(uuid, text, text)',
    'public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer)',
    'public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid)'
  ]) AS function_signature
  WHERE has_function_privilege('service_role', function_signature, 'EXECUTE') IS NOT TRUE;

  IF v_service_role_missing_function_privileges > 0 THEN
    RAISE EXCEPTION 'FAILED: service_role is missing % reserve/outbox RPC EXECUTE privilege(s).', v_service_role_missing_function_privileges;
  END IF;

  SELECT count(*)
    INTO v_missing_constraints
  FROM unnest(array[
    'wallet_reservations_amount_positive',
    'wallet_reservations_currency_bounds',
    'wallet_reservations_status_valid',
    'wallet_reservations_terminal_timestamp',
    'fulfillment_dispatch_route_not_blank',
    'fulfillment_dispatch_order_table_not_blank',
    'fulfillment_dispatch_status_valid',
    'fulfillment_dispatch_attempts_nonnegative',
    'fulfillment_dispatch_claim_consistency'
  ]) AS required_constraint
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = required_constraint
      AND conrelid IN (
        'public.wallet_reservations'::regclass,
        'public.fulfillment_dispatch_outbox'::regclass
      )
  );

  IF v_missing_constraints > 0 THEN
    RAISE EXCEPTION 'FAILED: % reserve/outbox constraint(s) missing.', v_missing_constraints;
  END IF;

  SELECT count(*)
    INTO v_missing_indexes
  FROM unnest(array[
    'idx_wallet_reservations_idempotency_key_unique',
    'idx_fulfillment_dispatch_outbox_idempotency_unique',
    'idx_wallet_reservations_user_status',
    'idx_fulfillment_dispatch_outbox_pending'
  ]) AS required_index
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
    WHERE nsp.nspname = 'public'
      AND idx.relname = required_index
      AND idx.relkind = 'i'
  );

  IF v_missing_indexes > 0 THEN
    RAISE EXCEPTION 'FAILED: % reserve/outbox index(es) missing.', v_missing_indexes;
  END IF;
END $$;

-- Reserve-first route migration columns must exist on every order table that
-- exists in the target database. This is schema proof only; local product
-- reserve/capture is covered by migration 280, while provider-backed routes
-- remain paused until route-specific migration and deployed tests finish.
DO $$
DECLARE
  table_name text;
  column_name text;
  missing_columns integer := 0;
  missing_constraints integer := 0;
  missing_indexes integer := 0;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'orders',
    'smm_orders',
    'sms_orders',
    'telegram_orders',
    'bitrefill_orders',
    'bills_transactions',
    'api_partner_orders'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH column_name IN ARRAY ARRAY[
      'wallet_reservation_id',
      'fulfillment_outbox_id',
      'financial_authorization_status',
      'financial_security_version',
      'financial_authorization_reference'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = format('public.%I', table_name)::regclass
          AND attname = column_name
          AND NOT attisdropped
      ) THEN
        missing_columns := missing_columns + 1;
      END IF;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('public.%I', table_name)::regclass
        AND conname = table_name || '_financial_authorization_status_check'
    ) THEN
      missing_constraints := missing_constraints + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class idx
      JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
      WHERE nsp.nspname = 'public'
        AND idx.relkind = 'i'
        AND idx.relname = 'idx_' || table_name || '_wallet_reservation_id'
    ) THEN
      missing_indexes := missing_indexes + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class idx
      JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
      WHERE nsp.nspname = 'public'
        AND idx.relkind = 'i'
        AND idx.relname = 'idx_' || table_name || '_fulfillment_outbox_id'
    ) THEN
      missing_indexes := missing_indexes + 1;
    END IF;
  END LOOP;

  IF missing_columns > 0 THEN
    RAISE EXCEPTION 'FAILED: % financial authorization order-table column(s) missing.', missing_columns;
  END IF;

  IF missing_constraints > 0 THEN
    RAISE EXCEPTION 'FAILED: % financial authorization status constraint(s) missing.', missing_constraints;
  END IF;

  IF missing_indexes > 0 THEN
    RAISE EXCEPTION 'FAILED: % financial authorization index(es) missing.', missing_indexes;
  END IF;
END $$;

-- The financial-security epoch is a database-owned authorization boundary.
-- This is schema evidence; the outbox block below also proves that suspension
-- and reinstatement changes advance the epoch and invalidate old dispatch.
DO $$
DECLARE
  v_column_exists boolean;
  v_constraint_exists boolean;
  v_trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'financial_security_version'
      AND NOT attisdropped
  )
  INTO v_column_exists;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_financial_security_version_positive'
  )
  INTO v_constraint_exists;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'trg_bump_financial_security_version'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  )
  INTO v_trigger_exists;

  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'FAILED: profiles.financial_security_version is missing.';
  END IF;

  IF NOT v_constraint_exists THEN
    RAISE EXCEPTION 'FAILED: profiles_financial_security_version_positive is missing.';
  END IF;

  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'FAILED: trg_bump_financial_security_version is missing or disabled.';
  END IF;
END $$;

-- T39/T47/T49/T50: outbox RPCs must be idempotent, service-controlled, and
-- able to block stale or frozen-wallet dispatch before any worker sends a
-- supplier request. This exercises the service-role RPC behavior inside the
-- rollback transaction; it still does not contact a supplier.
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET account_suspended = false,
       suspension_reason = null,
       suspended_at = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.fulfillment_dispatch_outbox
 WHERE idempotency_key LIKE 'wallet-db-security-test:outbox:%';

DELETE FROM public.wallet_reservations
 WHERE idempotency_key LIKE 'wallet-db-security-test:reservation:%';

SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_order_id uuid := gen_random_uuid();
  v_conflict_order_id uuid := gen_random_uuid();
  v_frozen_order_id uuid := gen_random_uuid();
  v_stale_order_id uuid := gen_random_uuid();
  v_security_version integer;
  v_stale_security_version integer;
  v_reservation_id uuid;
  v_frozen_reservation_id uuid;
  v_stale_reservation_id uuid;
  v_missing_reservation jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_payload_conflict jsonb;
  v_claim jsonb;
  v_wrong_finish jsonb;
  v_right_finish jsonb;
  v_frozen_enqueue jsonb;
  v_frozen_claim jsonb;
  v_stale_enqueue jsonb;
  v_stale_claim jsonb;
BEGIN
  SELECT GREATEST(COALESCE(financial_security_version, 1), 1)
    INTO v_security_version
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  IF v_security_version IS NULL THEN
    RAISE EXCEPTION 'FAILED: security-test profile has no financial security version.';
  END IF;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_order_id,
    v_user,
    NULL,
    'wallet-db-security-test:outbox:missing-reservation',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    v_security_version
  )
  INTO v_missing_reservation;

  IF v_missing_reservation->>'code' IS DISTINCT FROM 'FULFILLMENT_RESERVATION_REQUIRED' THEN
    RAISE EXCEPTION 'FAILED: outbox enqueue without a reservation was not denied. Result: %', v_missing_reservation;
  END IF;

  INSERT INTO public.wallet_reservations (
    user_id,
    amount,
    currency,
    status,
    order_table,
    order_id,
    idempotency_key,
    financial_security_version,
    metadata
  )
  VALUES (
    v_user,
    100,
    'NGN',
    'active',
    'wallet_db_security_orders',
    v_order_id,
    'wallet-db-security-test:reservation:outbox-primary',
    v_security_version,
    jsonb_build_object('source', 'wallet-db-security-test-pack')
  )
  RETURNING id
  INTO v_reservation_id;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_order_id,
    v_user,
    v_reservation_id,
    'wallet-db-security-test:outbox:primary',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    v_security_version
  )
  INTO v_first;

  IF COALESCE((v_first->>'success')::boolean, false) IS NOT TRUE
    OR COALESCE((v_first->>'idempotent_replay')::boolean, true) IS NOT FALSE
  THEN
    RAISE EXCEPTION 'FAILED: first outbox enqueue did not create a pending message. Result: %', v_first;
  END IF;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_order_id,
    v_user,
    v_reservation_id,
    'wallet-db-security-test:outbox:primary',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    v_security_version
  )
  INTO v_replay;

  IF COALESCE((v_replay->>'success')::boolean, false) IS NOT TRUE
    OR COALESCE((v_replay->>'idempotent_replay')::boolean, false) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'FAILED: exact outbox enqueue replay was not idempotent. Result: %', v_replay;
  END IF;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_order_id,
    v_user,
    v_reservation_id,
    'wallet-db-security-test:outbox:primary',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'changed_payload_must_conflict', true),
    v_security_version
  )
  INTO v_payload_conflict;

  IF v_payload_conflict->>'code' IS DISTINCT FROM 'FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'FAILED: changed outbox idempotency payload did not conflict. Result: %', v_payload_conflict;
  END IF;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_conflict_order_id,
    v_user,
    v_reservation_id,
    'wallet-db-security-test:outbox:primary',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_conflict', true),
    v_security_version
  )
  INTO v_conflict;

  IF v_conflict->>'code' IS DISTINCT FROM 'FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'FAILED: changed outbox idempotency target did not conflict. Result: %', v_conflict;
  END IF;

  SELECT public.claim_fulfillment_dispatch('wallet-db-security-worker-a', 'wallet-db-security-test-route', 60)
    INTO v_claim;

  IF v_claim->>'code' IS DISTINCT FROM 'FULFILLMENT_DISPATCH_CLAIMED' THEN
    RAISE EXCEPTION 'FAILED: outbox message was not claimed. Result: %', v_claim;
  END IF;

  SELECT public.finish_fulfillment_dispatch(
    (v_claim->>'outbox_id')::uuid,
    'wallet-db-security-worker-b',
    'sent',
    null
  )
  INTO v_wrong_finish;

  IF v_wrong_finish->>'code' IS DISTINCT FROM 'OUTBOX_CLAIM_INVALID' THEN
    RAISE EXCEPTION 'FAILED: non-claiming worker finished outbox dispatch. Result: %', v_wrong_finish;
  END IF;

  SELECT public.finish_fulfillment_dispatch(
    (v_claim->>'outbox_id')::uuid,
    'wallet-db-security-worker-a',
    'sent',
    null
  )
  INTO v_right_finish;

  IF v_right_finish->>'code' IS DISTINCT FROM 'FULFILLMENT_DISPATCH_FINISHED'
    OR v_right_finish->>'status' IS DISTINCT FROM 'sent'
  THEN
    RAISE EXCEPTION 'FAILED: claiming worker could not finish outbox dispatch. Result: %', v_right_finish;
  END IF;

  INSERT INTO public.wallet_reservations (
    user_id,
    amount,
    currency,
    status,
    order_table,
    order_id,
    idempotency_key,
    financial_security_version,
    metadata
  )
  VALUES (
    v_user,
    100,
    'NGN',
    'active',
    'wallet_db_security_orders',
    v_frozen_order_id,
    'wallet-db-security-test:reservation:outbox-frozen',
    v_security_version,
    jsonb_build_object('source', 'wallet-db-security-test-pack')
  )
  RETURNING id
  INTO v_frozen_reservation_id;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_frozen_order_id,
    v_user,
    v_frozen_reservation_id,
    'wallet-db-security-test:outbox:frozen',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_claim_block', 'WALLET_NOT_ACTIVE'),
    v_security_version
  )
  INTO v_frozen_enqueue;

  IF COALESCE((v_frozen_enqueue->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: frozen-wallet outbox fixture could not be enqueued. Result: %', v_frozen_enqueue;
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET account_suspended = true,
         suspension_reason = 'wallet-db-security-test frozen outbox claim',
         suspended_at = now(),
         updated_at = now()
   WHERE id = v_user;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  SELECT public.claim_fulfillment_dispatch('wallet-db-security-worker-a', 'wallet-db-security-test-route', 60)
    INTO v_frozen_claim;

  IF v_frozen_claim->>'code' IS DISTINCT FROM 'WALLET_NOT_ACTIVE' THEN
    RAISE EXCEPTION 'FAILED: suspended wallet outbox claim was not blocked. Result: %', v_frozen_claim;
  END IF;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET account_suspended = false,
         suspension_reason = null,
         suspended_at = null,
         updated_at = now()
   WHERE id = v_user;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  SELECT GREATEST(COALESCE(financial_security_version, 1), 1)
    INTO v_security_version
  FROM public.profiles
  WHERE id = v_user;

  INSERT INTO public.wallet_reservations (
    user_id,
    amount,
    currency,
    status,
    order_table,
    order_id,
    idempotency_key,
    financial_security_version,
    metadata
  )
  VALUES (
    v_user,
    100,
    'NGN',
    'active',
    'wallet_db_security_orders',
    v_stale_order_id,
    'wallet-db-security-test:reservation:outbox-stale',
    v_security_version,
    jsonb_build_object('source', 'wallet-db-security-test-pack')
  )
  RETURNING id
  INTO v_stale_reservation_id;

  SELECT public.enqueue_fulfillment_dispatch(
    'wallet-db-security-test-route',
    'wallet_db_security_orders',
    v_stale_order_id,
    v_user,
    v_stale_reservation_id,
    'wallet-db-security-test:outbox:stale',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_claim_block', 'ORDER_AUTHORIZATION_STALE'),
    v_security_version
  )
  INTO v_stale_enqueue;

  IF COALESCE((v_stale_enqueue->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: stale-reservation outbox fixture could not be enqueued. Result: %', v_stale_enqueue;
  END IF;

  SELECT GREATEST(COALESCE(financial_security_version, 1), 1)
    INTO v_stale_security_version
  FROM public.profiles
  WHERE id = v_user;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
     SET account_suspended = true,
         suspension_reason = 'wallet-db-security-test stale authorization',
         suspended_at = now(),
         updated_at = now()
   WHERE id = v_user;

  UPDATE public.profiles
     SET account_suspended = false,
         suspension_reason = null,
         suspended_at = null,
         updated_at = now()
   WHERE id = v_user;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  UPDATE public.wallet_reservations
     SET status = 'released',
         released_at = now(),
         updated_at = now()
   WHERE id = v_stale_reservation_id;

  SELECT public.claim_fulfillment_dispatch('wallet-db-security-worker-a', 'wallet-db-security-test-route', 60)
    INTO v_stale_claim;

  IF v_stale_claim->>'code' IS DISTINCT FROM 'ORDER_AUTHORIZATION_STALE' THEN
    RAISE EXCEPTION 'FAILED: stale-reservation outbox claim was not blocked (fulfillment_dispatch_security_version_stale). Result: %', v_stale_claim;
  END IF;

  IF v_stale_security_version IS NULL
    OR v_stale_security_version >= (
      SELECT GREATEST(COALESCE(financial_security_version, 1), 1)
      FROM public.profiles
      WHERE id = v_user
    )
  THEN
    RAISE EXCEPTION 'FAILED: suspension state changes did not advance the financial security version.';
  END IF;
END $$;

RESET ROLE;

-- T37/T54/T60: reservation RPCs must hold only trusted available funds,
-- capture through the wallet engine, and release without creating refund
-- credit. This is rollback-only staging evidence for the reserve-first
-- database boundary; active routes still need integration tests.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 0,
       account_suspended = false,
       suspension_reason = null,
       suspended_at = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:reservation-rpc:%';

DELETE FROM public.pending_payments
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND transaction_reference LIKE 'wallet-db-security-test-reservation-rpc-%';

DELETE FROM public.fulfillment_dispatch_outbox
 WHERE idempotency_key LIKE 'wallet-db-security-test:outbox:reservation-rpc:%';

DELETE FROM public.wallet_reservations
 WHERE idempotency_key LIKE 'wallet-db-security-test:reservation-rpc:%';

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_order_id uuid := gen_random_uuid();
  v_release_order_id uuid := gen_random_uuid();
  v_topup jsonb;
  v_reserve jsonb;
  v_reserve_replay jsonb;
  v_stale_reserve jsonb;
  v_over_reserve jsonb;
  v_capture jsonb;
  v_capture_replay jsonb;
  v_release_captured jsonb;
  v_release_reserve jsonb;
  v_release jsonb;
  v_release_replay jsonb;
  v_profile record;
  v_current_security_version integer;
  v_capture_transaction_count integer;
  v_release_transaction_count integer;
BEGIN
  SELECT COALESCE(v_profile.financial_security_version, 1)
    INTO v_current_security_version
  FROM public.profiles AS v_profile
  WHERE v_profile.id = v_user;

  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES (
    v_user,
    'wallet-db-security-test-reservation-rpc-topup',
    'wallet-db-security-test-reservation-rpc-provider-id',
    1000,
    'pending'
  );

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    1000,
    'wallet-db-security-test-reservation-rpc-topup',
    'Verified topup backing reservation RPC test',
    'wallet-db-security-test:reservation-rpc:topup',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 1000),
    'NGN',
    'wallet',
    'wallet-db-security-test-reservation-rpc-provider-id',
    null
  )
  INTO v_topup;

  IF COALESCE((v_topup->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: reservation RPC setup topup did not post. Result: %', v_topup;
  END IF;

  SELECT public.create_wallet_reservation(
    v_user,
    600,
    'wallet_db_security_orders',
    v_order_id,
    'wallet-db-security-test:reservation-rpc:hold',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    1,
    null
  )
  INTO v_reserve;

  IF COALESCE((v_reserve->>'success')::boolean, false) IS NOT TRUE
    OR COALESCE((v_reserve->>'idempotent_replay')::boolean, true) IS NOT FALSE
  THEN
    RAISE EXCEPTION 'FAILED: trusted reservation was not created. Result: %', v_reserve;
  END IF;

  SELECT public.create_wallet_reservation(
    v_user,
    600,
    'wallet_db_security_orders',
    v_order_id,
    'wallet-db-security-test:reservation-rpc:hold',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    'NGN',
    1,
    null
  )
  INTO v_reserve_replay;

  IF COALESCE((v_reserve_replay->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: exact reservation replay was not idempotent. Result: %', v_reserve_replay;
  END IF;

  SELECT public.create_wallet_reservation(
    v_user,
    1,
    'wallet_db_security_orders',
    gen_random_uuid(),
    'wallet-db-security-test:reservation-rpc:stale-epoch',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected', 'stale_epoch_rejected'),
    'NGN',
    GREATEST(v_current_security_version - 1, 0),
    null
  )
  INTO v_stale_reserve;

  IF v_stale_reserve->>'code' IS DISTINCT FROM 'WALLET_SECURITY_VERSION_STALE' THEN
    RAISE EXCEPTION 'FAILED: stale financial-security epoch was accepted. Result: %', v_stale_reserve;
  END IF;

  SELECT public.create_wallet_reservation(
    v_user,
    500,
    'wallet_db_security_orders',
    gen_random_uuid(),
    'wallet-db-security-test:reservation-rpc:over-reserve',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected', 'insufficient_after_active_hold'),
    'NGN',
    1,
    null
  )
  INTO v_over_reserve;

  IF v_over_reserve->>'code' IS DISTINCT FROM 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS' THEN
    RAISE EXCEPTION 'FAILED: active hold did not reduce trusted available funds. Result: %', v_over_reserve;
  END IF;

  SELECT public.capture_wallet_reservation(
    (v_reserve->>'reservation_id')::uuid,
    'wallet-db-security-test-reservation-rpc-capture',
    'Capture reservation through wallet engine',
    'wallet-db-security-test:reservation-rpc:capture',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    null
  )
  INTO v_capture;

  IF COALESCE((v_capture->>'success')::boolean, false) IS NOT TRUE
    OR v_capture->>'reservation_status' IS DISTINCT FROM 'captured'
  THEN
    RAISE EXCEPTION 'FAILED: reservation capture did not post through wallet engine. Result: %', v_capture;
  END IF;

  SELECT public.capture_wallet_reservation(
    (v_reserve->>'reservation_id')::uuid,
    'wallet-db-security-test-reservation-rpc-capture',
    'Capture reservation through wallet engine',
    'wallet-db-security-test:reservation-rpc:capture',
    jsonb_build_object('source', 'wallet-db-security-test-pack'),
    null
  )
  INTO v_capture_replay;

  IF COALESCE((v_capture_replay->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: reservation capture replay was not idempotent. Result: %', v_capture_replay;
  END IF;

  SELECT wallet_balance
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.wallet_balance, 0) <> 400 THEN
    RAISE EXCEPTION 'FAILED: reservation capture did not leave expected wallet balance. Profile: %', row_to_json(v_profile);
  END IF;

  SELECT count(*)
    INTO v_capture_transaction_count
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key = 'wallet-db-security-test:reservation-rpc:capture'
    AND type = 'purchase'
    AND amount = -600
    AND metadata->>'wallet_reservation_id' = v_reserve->>'reservation_id';

  IF v_capture_transaction_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: reservation capture did not create exactly one wallet-engine purchase row. Count: %', v_capture_transaction_count;
  END IF;

  SELECT public.release_wallet_reservation(
    (v_reserve->>'reservation_id')::uuid,
    'captured reservation cannot be released',
    'wallet-db-security-test:reservation-rpc:release-captured'
  )
  INTO v_release_captured;

  IF v_release_captured->>'code' IS DISTINCT FROM 'WALLET_RESERVATION_ALREADY_CAPTURED' THEN
    RAISE EXCEPTION 'FAILED: captured reservation was released. Result: %', v_release_captured;
  END IF;

  SELECT public.create_wallet_reservation(
    v_user,
    400,
    'wallet_db_security_orders',
    v_release_order_id,
    'wallet-db-security-test:reservation-rpc:release-hold',
    jsonb_build_object('source', 'wallet-db-security-test-pack', 'release_path', true),
    'NGN',
    1,
    null
  )
  INTO v_release_reserve;

  IF COALESCE((v_release_reserve->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: release reservation was not created. Result: %', v_release_reserve;
  END IF;

  SELECT public.release_wallet_reservation(
    (v_release_reserve->>'reservation_id')::uuid,
    'provider failed before capture',
    'wallet-db-security-test:reservation-rpc:release'
  )
  INTO v_release;

  IF COALESCE((v_release->>'success')::boolean, false) IS NOT TRUE
    OR v_release->>'status' IS DISTINCT FROM 'released'
  THEN
    RAISE EXCEPTION 'FAILED: reservation release failed. Result: %', v_release;
  END IF;

  SELECT public.release_wallet_reservation(
    (v_release_reserve->>'reservation_id')::uuid,
    'provider failed before capture',
    'wallet-db-security-test:reservation-rpc:release'
  )
  INTO v_release_replay;

  IF COALESCE((v_release_replay->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: reservation release replay was not idempotent. Result: %', v_release_replay;
  END IF;

  SELECT count(*)
    INTO v_release_transaction_count
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key LIKE 'wallet-db-security-test:reservation-rpc:release%'
    AND amount > 0;

  IF v_release_transaction_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: reservation release created refund/credit transaction rows. Count: %', v_release_transaction_count;
  END IF;
END $$;

RESET ROLE;

-- T25/T29/T41/T67: a legacy/direct generic `credit` row must not become
-- trusted principal, and the scanner must not auto-unsuspend an already
-- auto-suspended wallet even if later evidence appears balanced.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

UPDATE public.profiles
   SET wallet_balance = 10000,
       account_suspended = false,
       suspension_reason = null,
       suspended_at = null,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

DELETE FROM public.transactions
 WHERE user_id = current_setting('app.wallet_security_test_user_id')::uuid
   AND idempotency_key LIKE 'wallet-db-security-test:%';

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'credit',
  10000,
  'completed',
  0,
  10000,
  'NGN',
  'wallet-db-security-test-generic-credit',
  'Generic credit must not become trusted principal',
  'wallet-db-security-test:generic-credit-not-principal',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'expected_trusted_principal', false),
  'wallet'
);

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_scan jsonb;
  v_profile record;
BEGIN
  SELECT public.evaluate_customer_ledger_suspension(v_user, 1)
    INTO v_scan;

  IF COALESCE((v_scan->>'suspended')::boolean, false) IS NOT TRUE
    OR COALESCE((v_scan->>'trusted_credits')::numeric, -1) <> 0
    OR COALESCE((v_scan->>'trusted_available')::numeric, -1) <> 0
    OR COALESCE((v_scan->>'displayed_balance_exposure')::numeric, 0) < 10000
  THEN
    RAISE EXCEPTION 'FAILED: generic credit was trusted or did not trigger review. Scan: %', v_scan;
  END IF;

  SELECT account_suspended, suspension_reason
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.account_suspended, false) IS NOT TRUE
    OR COALESCE(v_profile.suspension_reason, '') NOT LIKE 'Auto-suspended:%'
  THEN
    RAISE EXCEPTION 'FAILED: generic credit scan did not persist auto-suspension. Profile: %', row_to_json(v_profile);
  END IF;
END $$;

SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'true', true);

INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'wallet-db-security-test-no-auto-unsuspend-topup',
  'wallet-db-security-test-no-auto-unsuspend-provider-id',
  10000,
  'credited'
);

INSERT INTO public.transactions (
  user_id,
  type,
  amount,
  status,
  balance_before,
  balance_after,
  currency,
  reference,
  description,
  idempotency_key,
  metadata,
  balance_type,
  external_payment_id,
  provider,
  provider_payment_id
)
VALUES (
  current_setting('app.wallet_security_test_user_id')::uuid,
  'topup',
  10000,
  'completed',
  10000,
  20000,
  'NGN',
  'wallet-db-security-test-no-auto-unsuspend-topup',
  'Later valid topup must not auto-clear existing review',
  'wallet-db-security-test:fraud-scanner-no-auto-unsuspend',
  jsonb_build_object('source', 'wallet-db-security-test-pack', 'provider', 'ercaspay', 'verified_amount_ngn', 10000, 'expected_auto_unsuspend', false),
  'wallet',
  'wallet-db-security-test-no-auto-unsuspend-provider-id',
  'wallet-db-security-test-provider',
  'wallet-db-security-test-no-auto-unsuspend-provider-id'
);

UPDATE public.profiles
   SET wallet_balance = 10000,
       updated_at = now()
 WHERE id = current_setting('app.wallet_security_test_user_id')::uuid;

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);
SELECT set_config('app.tally_profile_privileged_authorized', 'false', true);

DO $$
DECLARE
  v_user uuid := current_setting('app.wallet_security_test_user_id')::uuid;
  v_scan jsonb;
  v_profile record;
BEGIN
  SELECT public.evaluate_customer_ledger_suspension(v_user, 1)
    INTO v_scan;

  SELECT account_suspended, suspension_reason
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE((v_scan->>'review_required')::boolean, false) IS NOT TRUE
    OR COALESCE(v_profile.account_suspended, false) IS NOT TRUE
    OR COALESCE(v_profile.suspension_reason, '') NOT LIKE 'Auto-suspended:%'
  THEN
    RAISE EXCEPTION 'FAILED: fraud scanner auto-unsuspended an existing review. Scan: %, Profile: %', v_scan, row_to_json(v_profile);
  END IF;
END $$;

-- T75: exact money/currency boundaries should exist for new wallet writes.
DO $$
DECLARE
  v_missing_constraints integer := 0;
BEGIN
  SELECT count(*)
    INTO v_missing_constraints
  FROM unnest(array[
    'transactions_amount_money_bounds',
    'transactions_balance_snapshot_money_bounds',
    'transactions_currency_code_bounds',
    'profiles_balance_money_bounds'
  ]) AS required_constraint
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = required_constraint
      AND conrelid IN (
        'public.transactions'::regclass,
        'public.profiles'::regclass
      )
  );

  IF v_missing_constraints > 0 THEN
    RAISE EXCEPTION 'FAILED: % wallet money-bound constraint(s) missing.', v_missing_constraints;
  END IF;
END $$;

SELECT 'wallet-db-security-test-pack passed inside rollback transaction' AS result;

ROLLBACK;
