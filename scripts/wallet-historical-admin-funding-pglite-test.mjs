import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const base = readFileSync(new URL('../supabase/migrations/20260924006000_wallet_financial_truth.sql', import.meta.url), 'utf8')
const neutralEvidencePatch = readFileSync(new URL('../supabase/migrations/20260924016000_ignore_balance_neutral_ledger_evidence.sql', import.meta.url), 'utf8')
const stableAdminApprovalPatch = readFileSync(new URL('../supabase/migrations/20260924023000_preserve_recorded_admin_credit_approval.sql', import.meta.url), 'utf8')
const legacyChronologyPatch = readFileSync(new URL('../supabase/migrations/20260925011000_surface_legacy_funding_chronology.sql', import.meta.url), 'utf8')
const patch = readFileSync(new URL('../supabase/migrations/20260928000000_record_approved_historical_admin_funding.sql', import.meta.url), 'utf8')
const deficitPatch = readFileSync(new URL('../supabase/migrations/20260928001000_allow_reviewed_historical_wallet_deficits.sql', import.meta.url), 'utf8')
const legacyPurchasePolicyPatch = readFileSync(new URL('../supabase/migrations/20260928002000_stop_automatic_fraud_holds.sql', import.meta.url), 'utf8')
const userId = '11111111-1111-4111-8111-111111111111'
const unfundedId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'
const debitId = '44444444-4444-4444-8444-444444444444'
const deficitId = '66666666-6666-4666-8666-666666666666'

async function truth(id) {
  const { rows } = await db.query('SELECT public.wallet_financial_truth_internal($1::uuid) AS truth', [id])
  return rows[0].truth
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
      account_suspended boolean DEFAULT false,
      wallet_review_required boolean DEFAULT false,
      wallet_review_reason text, wallet_reviewed_by uuid,
      wallet_reviewed_at timestamptz, updated_at timestamptz,
      financial_security_version integer DEFAULT 1, is_admin boolean DEFAULT false,
      email text, full_name text, is_staff boolean DEFAULT false,
      suspension_reason text, suspended_at timestamptz,
      suspension_reinstated_at timestamptz
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
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, amount numeric,
      status text, transaction_reference text, ercas_reference text
    );
    CREATE TABLE public.pocketfi_webhook_logs (
      id uuid PRIMARY KEY, matched_user_id uuid, processed boolean,
      verified_amount_ngn numeric, verified_reference text
    );
    CREATE TABLE public.wallet_reservations (
      user_id uuid, amount numeric, currency text DEFAULT 'NGN', status text
    );
    GRANT USAGE ON SCHEMA public TO service_role;
    INSERT INTO public.profiles
      (id, wallet_balance, wallet_review_required, wallet_review_reason) VALUES
      ('${userId}', 2000, true, 'Auto-suspended: recorded spend exceeds backed funds'),
      ('${unfundedId}', 500000, false, NULL),
      ('${adminId}', 0, false, NULL),
      ('${deficitId}', 5000, true, 'Auto-suspended: recorded spend exceeds backed funds');
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, reference, created_at, metadata) VALUES
      ('${debitId}', '${userId}', 'purchase', 'completed', -8000, 'old-order',
        '2026-09-10 00:00:00+00',
        '{"trusted_principal_authorized":"true","trusted_principal_debit_amount":"8000"}'),
      ('55555555-5555-4555-8555-555555555555', '${userId}', 'refund',
        'completed', 1000, 'unlinked-refund', '2026-09-11 00:00:00+00', '{}'),
      ('77777777-7777-4777-8777-777777777777', '${deficitId}', 'purchase',
        'completed', -5000, 'deficit-order', '2026-09-10 00:00:00+00', '{}');
  `)
  await db.exec(base)
  await db.exec(neutralEvidencePatch)
  await db.exec(stableAdminApprovalPatch)
  await db.exec(legacyChronologyPatch)
  const before = await truth(userId)
  assert.equal(Number(before.approved_admin_credits), 0)
  assert.equal(Number(before.unexplained_difference), 9000)
  assert.equal(Number(before.confirmed_spendable), 0)

  await db.exec(patch)
  await db.exec(patch)
  assert.equal(Number((await truth(userId)).approved_historical_admin_credits), 0)
  await db.exec(`
    INSERT INTO public.wallet_historical_admin_funding
      (user_id, amount, original_credit_at, approved_by,
       approval_reference, evidence_note)
      VALUES ('${userId}', 9000, '2026-09-09 00:00:00+00', '${adminId}',
        'owner-case-001', 'Owner verified an earlier unlogged admin credit');
  `)
  const recovered = await truth(userId)
  assert.equal(Number(recovered.approved_historical_admin_credits), 9000)
  assert.equal(Number(recovered.approved_historical_admin_rows), 1)
  assert.equal(Number(recovered.approved_admin_rows), 1)
  assert.equal(Number(recovered.approved_admin_credits), 9000)
  assert.equal(Number(recovered.trusted_principal), 9000)
  assert.equal(Number(recovered.expected_ledger_balance), 2000)
  assert.equal(Number(recovered.recorded_transaction_balance), -7000)
  assert.equal(Number(recovered.unexplained_difference), 0)
  assert.equal(Number(recovered.eligible_refunds), 0)
  assert.equal(Number(recovered.confirmed_spendable), 1000)
  assert.equal(recovered.spending_blocked, true)
  assert.equal(Number((await truth(unfundedId)).confirmed_spendable), 0)

  await db.exec(`
    INSERT INTO public.wallet_historical_admin_funding
      (user_id, amount, original_credit_at, approved_by,
       approval_reference, evidence_note)
      VALUES ('${deficitId}', 11000, '2026-09-09 00:00:00+00', '${adminId}',
        'owner-case-deficit', 'Owner verified historical credit with remaining debit gap');
  `)
  const deficitBefore = await truth(deficitId)
  assert.equal(deficitBefore.integrity_status, 'stored_balance_deficit')
  assert.equal(Number(deficitBefore.unexplained_difference), -1000)
  assert.equal(Number(deficitBefore.confirmed_spendable), 5000)
  await assert.rejects(() => db.query(`
    SELECT public.resolve_reviewed_historical_admin_funding(
      '${deficitId}', 'owner-case-deficit',
      'Owner approved the credit; negative gap remains under investigation')
  `), /Wallet still has unresolved financial inconsistency/)
  await db.exec(deficitPatch)
  await db.exec(deficitPatch)
  const { rows: recoveryMetadata } = await db.query(`
    SELECT credit_time_basis, first_observed_transaction_id
    FROM public.wallet_historical_admin_funding
    WHERE approval_reference = 'owner-case-deficit'
  `)
  assert.equal(recoveryMetadata[0].credit_time_basis, 'owner_reported')
  assert.equal(recoveryMetadata[0].first_observed_transaction_id, null)
  const { rows: deficitRelease } = await db.query(`
    SELECT public.resolve_reviewed_historical_admin_funding(
      '${deficitId}', 'owner-case-deficit',
      'Owner approved the credit; negative gap remains under investigation') AS truth
  `)
  assert.equal(deficitRelease[0].truth.spending_blocked, false)
  assert.equal(Number(deficitRelease[0].truth.confirmed_spendable), 5000)
  assert.equal(Number(deficitRelease[0].truth.unexplained_difference), -1000)

  await assert.rejects(() => db.exec(`
    INSERT INTO public.wallet_historical_admin_funding
      (user_id, amount, original_credit_at, approved_by, approval_reference, evidence_note)
      VALUES ('${userId}', 1, '2026-09-09 00:00:00+00', '${adminId}',
        'owner-case-001', 'Duplicate historical approval reference')
  `), (error) => error.code === '23505')
  await assert.rejects(() => db.exec(`
    UPDATE public.wallet_historical_admin_funding SET amount = 1
    WHERE approval_reference = 'owner-case-001'
  `), /Historical wallet evidence is append-only/)
  await db.exec('SET ROLE service_role')
  assert.equal(Number((await truth(userId)).approved_historical_admin_credits), 9000)
  await assert.rejects(() => db.exec(`
    INSERT INTO public.wallet_historical_admin_funding
      (user_id, amount, approved_by, approval_reference, evidence_note)
      VALUES ('${userId}', 1, '${adminId}',
        'owner-case-002', 'Service role must not approve historical funding')
  `), (error) => error.code === '42501')
  await assert.rejects(() => db.query(`
    SELECT public.resolve_reviewed_historical_admin_funding(
      '${userId}', 'owner-case-001',
      'Owner checked historical funding and unlinked refunds')
  `), (error) => error.code === '42501')
  await db.exec('RESET ROLE')

  await assert.rejects(() => db.query(`
    SELECT public.resolve_reviewed_historical_admin_funding(
      '${userId}', 'wrong-owner-case',
      'Owner checked historical funding and unlinked refunds')
  `), /No matching owner-approved historical funding/)
  assert.equal((await truth(userId)).spending_blocked, true)
  const { rows: releaseRows } = await db.query(`
    SELECT public.resolve_reviewed_historical_admin_funding(
      '${userId}', 'owner-case-001',
      'Owner checked historical funding and quarantined unlinked refunds') AS truth
  `)
  assert.equal(releaseRows[0].truth.spending_blocked, false)
  assert.equal(Number(releaseRows[0].truth.confirmed_spendable), 1000)
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.wallet_historical_review_resolutions')).rows[0].n), 2)

  await db.exec(`
    ALTER TABLE public.profiles ADD COLUMN created_at timestamptz DEFAULT now();
    CREATE FUNCTION public.evaluate_customer_ledger_suspension(uuid,numeric)
      RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    UPDATE public.profiles
      SET created_at = '2026-09-01 00:00:00+00', wallet_review_required = true,
          wallet_review_reason = 'Auto-suspended: old ledger gap', wallet_reviewed_by = NULL
      WHERE id = '${userId}';
    UPDATE public.profiles
      SET created_at = '2026-09-25 00:00:00+00'
      WHERE id = '${unfundedId}';
    UPDATE public.profiles
      SET created_at = '2026-09-01 00:00:00+00', wallet_balance = 1000,
          account_suspended = true, suspension_reason = 'Manual owner suspension'
      WHERE id = '${adminId}';
    INSERT INTO public.wallet_legacy_funding (user_id, grandfathered_principal)
      VALUES ('${adminId}', 1000);
    INSERT INTO public.profiles (id, created_at, wallet_balance)
      VALUES ('88888888-8888-4888-8888-888888888888',
        '2026-09-01 00:00:00+00', 500000);
    INSERT INTO public.profiles (id, created_at, wallet_balance)
      VALUES ('99999999-9999-4999-8999-999999999999',
        '2026-09-25 00:00:00+00', 100000);
    INSERT INTO public.wallet_historical_admin_funding
      (user_id, amount, original_credit_at, approved_by,
       approval_reference, evidence_note)
      VALUES ('99999999-9999-4999-8999-999999999999', 1000,
        '2026-09-24 00:00:00+00', '${adminId}',
        'owner-case-new-funded', 'Owner approved a controlled test credit');
    INSERT INTO public.profiles (id, created_at, wallet_balance)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '2026-09-25 00:00:00+00', 5000);
    INSERT INTO public.wallet_legacy_funding (user_id, grandfathered_principal)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1000);
    INSERT INTO public.profiles
      (id, created_at, wallet_balance, wallet_review_required,
       wallet_review_reason, wallet_reviewed_by)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '2026-09-01 00:00:00+00', 1000, true,
        'Manual owner wallet hold', '${adminId}');
    INSERT INTO public.wallet_legacy_funding (user_id, grandfathered_principal)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1000);
  `)
  await db.exec(legacyPurchasePolicyPatch)
  await db.exec(legacyPurchasePolicyPatch)
  const legacyFunded = await truth(userId)
  assert.equal(legacyFunded.authorization_basis, 'legacy_recorded_funding_stored_balance')
  assert.equal(Number(legacyFunded.confirmed_spendable), 2000)
  assert.equal(legacyFunded.spending_blocked, false)
  assert.equal(Number((await truth(unfundedId)).confirmed_spendable), 0)
  assert.equal((await truth(unfundedId)).authorization_basis, 'no_recorded_funding')
  assert.equal(Number((await truth('88888888-8888-4888-8888-888888888888')).confirmed_spendable), 0)
  const newFunded = await truth('99999999-9999-4999-8999-999999999999')
  assert.equal(newFunded.authorization_basis, 'confirmed_funding')
  assert.equal(Number(newFunded.confirmed_spendable), 1000)
  const recreatedLegacy = await truth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(recreatedLegacy.authorization_basis, 'legacy_recorded_funding_stored_balance')
  assert.equal(Number(recreatedLegacy.confirmed_spendable), 5000)
  assert.equal((await truth(adminId)).spending_blocked, true)
  assert.equal((await truth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).spending_blocked, true)
  await db.exec(`
    INSERT INTO public.wallet_reservations (user_id, amount, currency, status)
      VALUES ('${userId}', 500, 'NGN', 'active');
  `)
  assert.equal(Number((await truth(userId)).confirmed_spendable), 1500)
  const { rows: scanRows } = await db.query(`
    SELECT public.evaluate_customer_ledger_suspension('${userId}', 0) AS result
  `)
  assert.equal(scanRows[0].result.review_required, false)
  const { rows: unfundedScan } = await db.query(`
    SELECT public.evaluate_customer_ledger_suspension('${unfundedId}', 0) AS result
  `)
  assert.equal(Number(unfundedScan[0].result.confirmed_spendable), 0)
  assert.equal(unfundedScan[0].result.review_required, false)
  const { rows: reviewRows } = await db.query(`
    SELECT wallet_review_required FROM public.profiles WHERE id = '${userId}'
  `)
  assert.equal(reviewRows[0].wallet_review_required, false)
  const { rows: unfundedReview } = await db.query(`
    SELECT wallet_review_required FROM public.profiles WHERE id = '${unfundedId}'
  `)
  assert.equal(unfundedReview[0].wallet_review_required, false)

  console.log('Historical funding and legacy purchase policy passed isolated PostgreSQL checks.')
} finally {
  await db.close()
}
