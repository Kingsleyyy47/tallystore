import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const sql = readFileSync(new URL('../supabase/migrations/20260924006000_wallet_financial_truth.sql', import.meta.url), 'utf8')
const neutralEvidencePatch = readFileSync(new URL('../supabase/migrations/20260924016000_ignore_balance_neutral_ledger_evidence.sql', import.meta.url), 'utf8')
const stableAdminApprovalPatch = readFileSync(new URL('../supabase/migrations/20260924023000_preserve_recorded_admin_credit_approval.sql', import.meta.url), 'utf8')
const reusedEvidencePatch = readFileSync(new URL('../supabase/migrations/20260924030000_detect_reused_gateway_evidence.sql', import.meta.url), 'utf8')
const refundCyclePatch = readFileSync(new URL('../supabase/migrations/20260925000000_restore_refunds_across_spend_cycles.sql', import.meta.url), 'utf8')
const exactGatewayAmountsPatch = readFileSync(new URL('../supabase/migrations/20260925001000_require_exact_gateway_evidence_amounts.sql', import.meta.url), 'utf8')
const adminEmailFallbackPatch = readFileSync(new URL('../supabase/migrations/20260925002000_admin_fraud_auth_email_fallback.sql', import.meta.url), 'utf8')
const crossWalletReferencePatch = readFileSync(new URL('../supabase/migrations/20260925003000_review_cross_wallet_gateway_reference_reuse.sql', import.meta.url), 'utf8')
const legacyChronologyPatch = readFileSync(new URL('../supabase/migrations/20260925011000_surface_legacy_funding_chronology.sql', import.meta.url), 'utf8')
const ownerQueryPack = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')

const zero = '11111111-1111-4111-8111-111111111111'
const funded = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const credited = '44444444-4444-4444-8444-444444444444'
const purchase = '55555555-5555-4555-8555-555555555555'
const refund = '66666666-6666-4666-8666-666666666666'
const adminFunded = '77777777-7777-4777-8777-777777777777'
const auditAdmin = '88888888-8888-4888-8888-888888888888'

async function truth(userId) {
  const result = await db.query('SELECT public.wallet_financial_truth_internal($1::uuid) AS truth', [userId])
  return result.rows[0].truth
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, wallet_balance numeric NOT NULL DEFAULT 0,
      account_suspended boolean DEFAULT false, wallet_review_required boolean DEFAULT false,
      wallet_review_reason text, wallet_reviewed_by uuid,
      financial_security_version integer DEFAULT 1, is_admin boolean DEFAULT false,
      email text, full_name text, is_staff boolean DEFAULT false,
      suspension_reason text, suspended_at timestamptz
    );
    CREATE TABLE public.wallet_legacy_funding (
      user_id uuid PRIMARY KEY, grandfathered_principal numeric NOT NULL
    );
    CREATE TABLE public.transactions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, balance_type text DEFAULT 'wallet',
      type text, status text, amount numeric, balance_before numeric,
      balance_after numeric, currency text DEFAULT 'NGN', metadata jsonb DEFAULT '{}'::jsonb,
      external_payment_id text, reference text, created_at timestamptz DEFAULT now(),
      created_by uuid, idempotency_key text
    );
    CREATE TABLE public.pending_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid, amount numeric, status text, transaction_reference text,
      ercas_reference text
    );
    CREATE TABLE public.pocketfi_webhook_logs (
      id uuid PRIMARY KEY, matched_user_id uuid, processed boolean,
      verified_amount_ngn numeric, verified_reference text
    );
    CREATE TABLE public.wallet_reservations (
      user_id uuid, amount numeric, currency text DEFAULT 'NGN', status text
    );
    GRANT USAGE ON SCHEMA public TO service_role;
    INSERT INTO public.profiles(id, wallet_balance, is_admin) VALUES
      ('${zero}', 500000, false), ('${funded}', 100000, false),
      ('${admin}', 20000, true), ('${adminFunded}', 15000, false),
      ('${auditAdmin}', 0, true);
    INSERT INTO auth.users(id, email) VALUES
      ('${zero}', 'zero-auth@example.test'),
      ('${funded}', 'funded-auth@example.test');
    INSERT INTO public.pending_payments(user_id, amount, status, transaction_reference, ercas_reference) VALUES
      ('${funded}', 70000, 'credited', 'payment-1', 'gateway-1');
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, external_payment_id, reference, created_at)
      VALUES ('${credited}', '${funded}', 'topup', 'completed', 70000, 0, 70000,
        '{"provider":"ercas","verified_amount_ngn":"70000"}',
        'gateway-1', 'payment-1', '2026-09-20 00:00:00+00');
  `)
  await db.exec(sql)
  await db.exec(neutralEvidencePatch)
  await db.exec(stableAdminApprovalPatch)

  const unfunded = await truth(zero)
  assert.equal(Number(unfunded.trusted_principal), 0)
  assert.equal(Number(unfunded.confirmed_spendable), 0)
  assert.equal(Number(unfunded.unexplained_difference), 500000)
  assert.equal(unfunded.integrity_status, 'quarantined_excess')

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, external_payment_id, reference, created_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '${zero}',
        'topup', 'completed', 500000, 0, 500000,
        '{"provider":"ercas","verified_amount_ngn":"500000"}',
        'unverified-gateway-1', 'unverified-payment-1', '2026-09-20 00:00:00+00');
  `)
  const unverifiedTopup = await truth(zero)
  assert.equal(Number(unverifiedTopup.expected_ledger_balance), 500000)
  assert.equal(Number(unverifiedTopup.unexplained_difference), 0)
  assert.equal(Number(unverifiedTopup.verified_gateway_deposits), 0)
  assert.equal(Number(unverifiedTopup.trusted_principal), 0)
  assert.equal(Number(unverifiedTopup.confirmed_spendable), 0)
  assert.equal(Number(unverifiedTopup.explained_difference), 500000)

  const backed = await truth(funded)
  assert.equal(Number(backed.verified_gateway_deposits), 70000)
  assert.equal(Number(backed.trusted_principal), 70000)
  assert.equal(Number(backed.expected_ledger_balance), 70000)
  assert.equal(Number(backed.unexplained_difference), 30000)
  assert.equal(Number(backed.confirmed_spendable), 70000)
  assert.equal(backed.spending_blocked, false)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES ('${purchase}', '${funded}', 'purchase', 'completed', -30000,
        70000, 40000,
        '{"trusted_principal_authorized":"true","trusted_principal_debit_amount":"30000"}',
        'order-1', '2026-09-20 00:01:00+00');
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES ('${refund}', '${funded}', 'refund', 'completed', 30000,
        40000, 70000, '{"source_debit_transaction_id":"${purchase}"}',
        'refund-1', '2026-09-20 00:02:00+00');
    INSERT INTO public.wallet_reservations(user_id, amount, status)
      VALUES ('${funded}', 10000, 'active');
  `)
  const restored = await truth(funded)
  assert.equal(Number(restored.trusted_principal), 70000)
  assert.equal(Number(restored.completed_debits), 30000)
  assert.equal(Number(restored.eligible_refunds), 30000)
  assert.equal(Number(restored.active_reservations), 10000)
  assert.equal(Number(restored.confirmed_spendable), 60000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', '${funded}', 'purchase', 'completed', -70000,
       70000, 0,
       '{"trusted_principal_authorized":"true","trusted_principal_debit_amount":"70000"}',
       'order-2', '2026-09-20 00:03:00+00'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', '${funded}', 'refund', 'completed', 70000,
       0, 70000,
       '{"source_debit_transaction_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac"}',
       'refund-2', '2026-09-20 00:04:00+00');
  `)
  const cappedTwice = await truth(funded)
  assert.equal(Number(cappedTwice.trusted_principal), 70000)
  assert.equal(Number(cappedTwice.completed_debits), 100000)
  assert.equal(Number(cappedTwice.eligible_refunds), 70000)
  assert.equal(Number(cappedTwice.confirmed_spendable), 30000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, reference, created_at)
      VALUES ('88888888-8888-4888-8888-888888888888', '${adminFunded}',
        'admin_credit', 'completed', 15000, 0, 15000,
        '{"source":"admin-adjust-balance","approval_type":"direct_admin_adjustment","approved_by":"${admin}","approval_reference":"approval-1","reason":"Owner approved credit"}',
        '${admin}', 'admin-credit-1', '2026-09-20 00:00:00+00');
  `)
  const approved = await truth(adminFunded)
  assert.equal(Number(approved.approved_admin_credits), 15000)
  assert.equal(Number(approved.confirmed_spendable), 15000)

  await db.exec(`UPDATE public.profiles SET is_admin = false WHERE id = '${admin}'`)
  const afterAdminDemotion = await truth(adminFunded)
  assert.equal(Number(afterAdminDemotion.approved_admin_credits), 15000)
  assert.equal(Number(afterAdminDemotion.confirmed_spendable), 15000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, reference, created_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${adminFunded}',
        'admin_credit', 'completed', 5000, 15000, 15000,
        '{"source":"admin-ledger-repair","balance_unchanged":"true","requires_owner_evidence":"true"}',
        '${admin}', 'neutral-repair-1', '2026-09-20 00:01:00+00');
  `)
  const withRepairEvidence = await truth(adminFunded)
  assert.equal(Number(withRepairEvidence.trusted_principal), 15000)
  assert.equal(Number(withRepairEvidence.expected_ledger_balance), 15000)
  assert.equal(Number(withRepairEvidence.unexplained_difference), 0)
  assert.equal(Number(withRepairEvidence.confirmed_spendable), 15000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, reference, created_at)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${adminFunded}',
        'admin_credit', 'completed', 1000, 15000, 16000,
        '{"source":"admin-ledger-repair","balance_unchanged":"true","requires_owner_evidence":"true"}',
        '${admin}', 'mismarked-repair-1', '2026-09-20 00:02:00+00');
  `)
  const changedSnapshot = await truth(adminFunded)
  assert.equal(Number(changedSnapshot.expected_ledger_balance), 16000)
  assert.equal(Number(changedSnapshot.trusted_principal), 15000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES ('99999999-9999-4999-8999-999999999999', '${zero}',
        'refund', 'completed', 10000, 500000, 510000,
        '{}', 'unlinked-refund', '2026-09-20 00:00:00+00');
    UPDATE public.profiles SET wallet_balance = 510000 WHERE id = '${zero}';
  `)
  const unlinked = await truth(zero)
  assert.equal(Number(unlinked.completed_refunds), 10000)
  assert.equal(Number(unlinked.eligible_refunds), 0)
  assert.equal(Number(unlinked.trusted_principal), 0)
  assert.equal(Number(unlinked.confirmed_spendable), 0)

  const ercasReuseUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'
  const pocketfiReuseUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const pocketfiLog = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const pocketfiFundedUser = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const pocketfiFundedLog = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  await db.exec(`
    INSERT INTO public.profiles(id, wallet_balance) VALUES
      ('${ercasReuseUser}', 200), ('${pocketfiReuseUser}', 200),
      ('${pocketfiFundedUser}', 100);
    INSERT INTO public.pending_payments(user_id, amount, status, transaction_reference, ercas_reference)
      VALUES ('${ercasReuseUser}', 100, 'credited', 'shared-checkout', 'gateway-first');
    INSERT INTO public.pocketfi_webhook_logs(id, matched_user_id, processed, verified_amount_ngn, verified_reference)
      VALUES ('${pocketfiLog}', '${pocketfiReuseUser}', true, 100, 'shared-transfer'),
        ('${pocketfiFundedLog}', '${pocketfiFundedUser}', true, 100, 'valid-transfer');
    INSERT INTO public.transactions(id, user_id, type, status, amount, metadata,
      external_payment_id, reference, created_at) VALUES
      ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${ercasReuseUser}', 'topup', 'completed', 100,
        '{"provider":"ercas","verified_amount_ngn":"100"}',
        'gateway-first', 'shared-checkout', '2026-09-20 00:00:00+00'),
      ('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${ercasReuseUser}', 'topup', 'completed', 100,
        '{"provider":"ercas","verified_amount_ngn":"100"}',
        'gateway-second', 'shared-checkout', '2026-09-20 00:01:00+00'),
      ('33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${pocketfiReuseUser}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100","webhook_log_id":"${pocketfiLog}"}',
        'transfer-first', 'shared-transfer', '2026-09-20 00:00:00+00'),
      ('44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${pocketfiReuseUser}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100","webhook_log_id":"${pocketfiLog}"}',
        'transfer-second', 'shared-transfer', '2026-09-20 00:01:00+00'),
      ('55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${pocketfiFundedUser}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100","webhook_log_id":"${pocketfiFundedLog}"}',
        'valid-transfer', 'valid-transfer', '2026-09-20 00:00:00+00');
  `)
  const ercasBefore = await truth(ercasReuseUser)
  assert.equal(Number(ercasBefore.trusted_principal), 200)
  assert.equal(Number(ercasBefore.confirmed_spendable), 200)
  assert.equal(Number(ercasBefore.duplicate_payment_identities), 0)
  assert.equal(Number((await truth(pocketfiFundedUser)).trusted_principal), 0)
  assert.equal(Number((await truth(pocketfiReuseUser)).trusted_principal), 0)

  await db.exec(reusedEvidencePatch)
  const pocketfiFunded = await truth(pocketfiFundedUser)
  assert.equal(Number(pocketfiFunded.verified_gateway_deposits), 100)
  assert.equal(Number(pocketfiFunded.confirmed_spendable), 100)
  assert.equal(pocketfiFunded.spending_blocked, false)
  for (const userId of [ercasReuseUser, pocketfiReuseUser]) {
    const after = await truth(userId)
    assert.equal(Number(after.verified_gateway_deposits), 200)
    assert.ok(Number(after.duplicate_payment_identities) > 0)
    assert.equal(after.integrity_status, 'payment_identity_conflict')
    assert.equal(after.evidence_complete, false)
    assert.equal(Number(after.confirmed_spendable), 0)
    assert.equal(after.spending_blocked, true)
  }
  const crossWalletOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'
  const crossWalletTwo = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf'
  const unverifiedOther = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
  const crossLogOne = 'dddddddd-dddd-4ddd-8ddd-ddddddddddde'
  const crossLogTwo = 'dddddddd-dddd-4ddd-8ddd-dddddddddddf'
  await db.exec(`
    INSERT INTO public.profiles(id, wallet_balance) VALUES
      ('${crossWalletOne}', 100), ('${crossWalletTwo}', 100),
      ('${unverifiedOther}', 100);
    INSERT INTO public.pocketfi_webhook_logs(id, matched_user_id, processed, verified_amount_ngn, verified_reference)
      VALUES ('${crossLogOne}', '${crossWalletOne}', true, 100, 'same-provider-payment'),
        ('${crossLogTwo}', '${crossWalletTwo}', true, 100, 'same-provider-payment');
    INSERT INTO public.transactions(id, user_id, type, status, amount, metadata,
      external_payment_id, reference, created_at) VALUES
      ('aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaae', '${crossWalletOne}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100","webhook_log_id":"${crossLogOne}"}',
        'gateway-alias-one', 'same-provider-payment', '2026-09-20 00:00:00+00'),
      ('aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaf', '${crossWalletTwo}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100","webhook_log_id":"${crossLogTwo}"}',
        'gateway-alias-two', 'same-provider-payment', '2026-09-20 00:01:00+00'),
      ('aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaac', '${unverifiedOther}', 'topup', 'completed', 100,
        '{"provider":"pocketfi","verified_amount_ngn":"100"}',
        'unverified-alias', 'valid-transfer', '2026-09-20 00:01:00+00');
  `)
  for (const userId of [crossWalletOne, crossWalletTwo]) {
    const before = await truth(userId)
    assert.equal(Number(before.duplicate_payment_identities), 0)
    assert.equal(Number(before.confirmed_spendable), 100)
  }
  await db.exec(crossWalletReferencePatch)
  for (const userId of [crossWalletOne, crossWalletTwo]) {
    const after = await truth(userId)
    assert.equal(Number(after.duplicate_payment_identities), 1)
    assert.equal(Number(after.confirmed_spendable), 0)
    assert.equal(after.integrity_status, 'payment_identity_conflict')
    assert.equal(after.spending_blocked, true)
    assert.equal(after.account_suspended, false)
  }
  assert.equal(Number((await truth(pocketfiFundedUser)).confirmed_spendable), 100)
  assert.equal(Number((await truth(unverifiedOther)).confirmed_spendable), 0)
  const query36 = ownerQueryPack.slice(
    ownerQueryPack.indexOf('-- 36. Canonical gateway evidence'),
    ownerQueryPack.indexOf('-- 37. Public product-catalog supplier configuration exposure'),
  )
  const ownerAudit = await db.exec(query36)
  assert.equal(ownerAudit[0].rows[0].pocketfi_uuid_check_fixed, true)
  assert.equal(ownerAudit[0].rows[0].reused_gateway_evidence_check_installed, true)
  assert.deepEqual(ownerAudit[1].rows.map((row) => [row.provider, Number(row.reused_evidence_records)]), [
    ['ercas', 1], ['pocketfi', 1],
  ])

  await db.exec(`
    CREATE TABLE public.refund_probe (user_id uuid, amount numeric);
    CREATE FUNCTION public.guard_trusted_principal_transaction()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      v_financial_truth jsonb;
      v_refundable_remaining numeric;
    BEGIN
      v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);
  v_refundable_remaining := GREATEST(
    LEAST(
      (v_financial_truth->>'completed_debits')::numeric,
      (v_financial_truth->>'trusted_principal')::numeric
    ) - (v_financial_truth->>'eligible_refunds')::numeric,
    0
  );
      IF NEW.amount > v_refundable_remaining THEN
        RAISE EXCEPTION 'refund_capacity_exceeded';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER refund_probe_guard BEFORE INSERT ON public.refund_probe
      FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_principal_transaction();
    CREATE FUNCTION public.apply_wallet_transaction(
      p_user_id uuid, p_type text, p_amount numeric, p_reference text,
      p_description text, p_idempotency_key text, p_metadata jsonb,
      p_currency text, p_balance_type text, p_external_payment_id text,
      p_created_by uuid
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE
      v_financial_truth jsonb;
      v_trusted_debit_capacity numeric := 70000;
      v_completed_refunds numeric := 100000;
      v_refundable_remaining numeric;
    BEGIN
    v_refundable_remaining := GREATEST(v_trusted_debit_capacity - v_completed_refunds, 0);
      RETURN jsonb_build_object('remaining', v_refundable_remaining);
    END;
    $$;
  `)
  await db.exec(refundCyclePatch)
  const query40 = ownerQueryPack.slice(
    ownerQueryPack.indexOf('-- 40. After migration 20260925000000'),
    ownerQueryPack.indexOf('-- 41. After migration 20260925001000'),
  )
  const deployedCycleShape = await db.query(query40)
  assert.deepEqual(deployedCycleShape.rows[0], {
    canonical_refund_cycle_fixed: true,
    refund_guard_cycle_fixed: true,
    wallet_engine_cycle_fixed: true,
  })
  const restoredTwice = await truth(funded)
  assert.equal(Number(restoredTwice.eligible_refunds), 100000)
  assert.equal(Number(restoredTwice.trusted_book_balance), 70000)
  assert.equal(Number(restoredTwice.confirmed_spendable), 60000)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', '${funded}',
        'purchase', 'completed', -70000, 70000, 0,
        '{"trusted_principal_authorized":"true","trusted_principal_debit_amount":"70000"}',
        'order-3', '2026-09-20 00:05:00+00');
  `)
  const engineCapacity = await db.query(`
    SELECT public.apply_wallet_transaction('${funded}', 'refund', 70000,
      NULL, NULL, NULL, '{}'::jsonb, 'NGN', 'wallet', NULL, NULL) AS result
  `)
  assert.equal(Number(engineCapacity.rows[0].result.remaining), 70000)
  await db.exec(`INSERT INTO public.refund_probe VALUES ('${funded}', 70000)`)
  await assert.rejects(
    () => db.exec(`INSERT INTO public.refund_probe VALUES ('${funded}', 70001)`),
    /refund_capacity_exceeded/,
  )
  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, reference, created_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf', '${funded}',
        'refund', 'completed', 70000, 0, 70000,
        '{"source_debit_transaction_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae"}',
        'refund-3', '2026-09-20 00:06:00+00');
  `)
  assert.equal(Number((await truth(funded)).confirmed_spendable), 60000)

  const precision = '99999999-9999-4999-8999-999999999999'
  await db.exec(`
    INSERT INTO public.profiles(id, wallet_balance) VALUES ('${precision}', 50000);
    INSERT INTO public.pending_payments(user_id, amount, status, transaction_reference, ercas_reference)
      VALUES ('${precision}', 50000.004, 'credited', 'precision-ref', 'precision-payment');
    INSERT INTO public.pocketfi_webhook_logs
      (id, matched_user_id, processed, verified_amount_ngn, verified_reference)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${precision}', true, 50000.004, 'precision-ref');
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, external_payment_id, reference, created_at)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${precision}',
        'topup', 'completed', 50000, 0, 50000,
        '{"provider":"ercas","verified_amount_ngn":"50000"}',
        'precision-payment', 'precision-ref', '2026-09-20 00:00:00+00');
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, metadata, created_at)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${precision}',
        'topup', 'failed', 50000.004, '{"verified_amount_ngn":"50000"}',
        '2026-09-20 00:01:00+00');
  `)
  assert.equal(Number((await truth(precision)).verified_gateway_deposits), 50000)

  await db.exec(`
    CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
      p_user_id uuid, p_type text, p_amount numeric, p_reference text,
      p_description text, p_idempotency_key text, p_metadata jsonb,
      p_currency text, p_balance_type text, p_external_payment_id text,
      p_created_by uuid
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE
      v_amount numeric := p_amount;
      v_pending boolean;
      v_pocketfi boolean;
      v_ledger_metadata boolean;
      v_ledger_pending boolean;
      v_ledger_pocketfi boolean;
    BEGIN
      IF round((COALESCE(p_metadata, '{}'::jsonb)->>'verified_amount_ngn')::numeric, 2) <> round(v_amount, 2) THEN
        RETURN jsonb_build_object('metadata_mismatch', true);
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM public.pending_payments pp
        WHERE pp.user_id = p_user_id AND round(pp.amount, 2) = round(v_amount, 2)
      ) INTO v_pending;
      SELECT EXISTS (
        SELECT 1 FROM public.pocketfi_webhook_logs pwl
        WHERE pwl.matched_user_id = p_user_id
          AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(v_amount, 2)
      ) INTO v_pocketfi;
      SELECT EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
          AND round((t.metadata->>'verified_amount_ngn')::numeric, 2) = round(t.amount, 2)
      ) INTO v_ledger_metadata;
      SELECT EXISTS (
        SELECT 1 FROM public.transactions t JOIN public.pending_payments pp ON pp.user_id = t.user_id
        WHERE t.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
          AND round(pp.amount, 2) = round(t.amount, 2)
      ) INTO v_ledger_pending;
      SELECT EXISTS (
        SELECT 1 FROM public.transactions t JOIN public.pocketfi_webhook_logs pwl ON pwl.matched_user_id = t.user_id
        WHERE t.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
          AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
      ) INTO v_ledger_pocketfi;
      RETURN jsonb_build_object(
        'pending', v_pending, 'pocketfi', v_pocketfi,
        'ledger_metadata', v_ledger_metadata,
        'ledger_pending', v_ledger_pending,
        'ledger_pocketfi', v_ledger_pocketfi
      );
    END;
    $$;
  `)
  const precisionProbe = async () => (await db.query(`
    SELECT public.apply_wallet_transaction('${precision}', 'topup', 50000,
      'precision-ref', NULL, NULL, '{"verified_amount_ngn":"50000"}'::jsonb,
      'NGN', 'wallet', 'precision-payment', NULL) AS result
  `)).rows[0].result
  const beforeExactPatch = await precisionProbe()
  for (const value of Object.values(beforeExactPatch)) assert.equal(value, true)
  await db.exec(exactGatewayAmountsPatch)
  const query41 = ownerQueryPack.slice(
    ownerQueryPack.indexOf('-- 41. After migration 20260925001000'),
    ownerQueryPack.indexOf('-- 42. Fraud Review')
  )
  const deployedExactShape = await db.query(query41)
  assert.deepEqual(deployedExactShape.rows[0], {
    canonical_exact_gateway_amounts: true,
    writer_exact_gateway_amounts: true,
  })
  const afterExactPatch = await precisionProbe()
  for (const value of Object.values(afterExactPatch)) assert.equal(value, false)
  const precisionTruth = await truth(precision)
  assert.equal(Number(precisionTruth.verified_gateway_deposits), 0)
  assert.equal(Number(precisionTruth.confirmed_spendable), 0)
  assert.equal(precisionTruth.integrity_status, 'quarantined_excess')

  await db.exec(`SET request.jwt.claim.sub = '${auditAdmin}'`)
  const beforeEmailFallback = await db.query(`
    SELECT email FROM public.get_admin_wallet_financial_truth_page(NULL, 100)
    WHERE user_id = '${zero}'
  `)
  assert.equal(beforeEmailFallback.rows[0].email, null)
  await db.exec(adminEmailFallbackPatch)
  const query42 = ownerQueryPack.slice(
    ownerQueryPack.indexOf('-- 42. Fraud Review'),
    ownerQueryPack.indexOf('-- 43. Before migration'),
  )
  const deployedEmailShape = await db.query(query42)
  assert.deepEqual(deployedEmailShape.rows[0], {
    admin_page_reads_auth_identity: true,
    admin_page_checks_current_role: true,
    anon_can_execute: false,
    authenticated_can_execute: true,
  })
  await db.exec('GRANT USAGE ON SCHEMA public TO authenticated')
  await db.exec('SET ROLE authenticated')
  const afterEmailFallback = await db.query(`
    SELECT email FROM public.get_admin_wallet_financial_truth_page(NULL, 100)
    WHERE user_id = '${zero}'
  `)
  assert.equal(afterEmailFallback.rows[0].email, 'zero-auth@example.test')
  await db.exec(`SET request.jwt.claim.sub = '${zero}'`)
  await assert.rejects(() => db.query(`
    SELECT email FROM public.get_admin_wallet_financial_truth_page(NULL, 100)
    WHERE user_id = '${funded}'
  `), (error) => error.code === '42501')
  await db.exec('RESET ROLE')

  await db.exec(legacyChronologyPatch)
  await db.exec(`
    INSERT INTO public.profiles (id, wallet_balance) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 4000),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 4000),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 0);
    INSERT INTO public.wallet_legacy_funding (user_id, grandfathered_principal) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 5000),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 5000);
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, created_at) VALUES
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba1',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'topup', 'completed', 5000,
        '2026-09-01 00:00:00+00'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba2',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'purchase', 'completed', -1000,
        '2026-09-02 00:00:00+00'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba3',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'purchase', 'completed', -1000,
        '2026-09-01 00:00:00+00'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba4',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'topup', 'completed', 5000,
        '2026-09-02 00:00:00+00'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba5',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'purchase', 'completed', -1000,
        '2026-09-01 00:00:00+00');
  `)
  const ordinaryLegacy = await truth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  const earlySpend = await truth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
  const noRecordedFunding = await truth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')
  assert.equal(ordinaryLegacy.legacy_spend_before_recorded_funding, false)
  assert.equal(earlySpend.legacy_spend_before_recorded_funding, true)
  assert.equal(earlySpend.legacy_first_recorded_debit_at, '2026-09-01T00:00:00+00:00')
  assert.equal(earlySpend.legacy_first_recorded_funding_at, '2026-09-02T00:00:00+00:00')
  assert.equal(noRecordedFunding.legacy_spend_before_recorded_funding, true)
  assert.equal(Number(noRecordedFunding.confirmed_spendable), 0)
  assert.equal(earlySpend.spending_blocked, false)
  const chronologyQuery = ownerQueryPack.slice(
    ownerQueryPack.indexOf('-- 50.'), ownerQueryPack.indexOf('-- 51.')
  )
  const chronologyRows = await db.query(chronologyQuery)
  assert.deepEqual(chronologyRows.rows.map((row) => row.user_id), [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  ])

  await db.query('SET ROLE authenticated')
  await assert.rejects(() => truth(funded), (error) => error.code === '42501')
  await db.query('RESET ROLE')

  await db.exec('DROP TABLE public.pending_payments')
  await assert.rejects(() => truth(funded), /pending_payments/)

  console.log('Canonical financial truth SQL passed isolated PostgreSQL execution scenarios (not Supabase staging).')
} finally {
  await db.close()
}
