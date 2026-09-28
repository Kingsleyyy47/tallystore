import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const debit = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
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
      user_id uuid, amount numeric, status text, transaction_reference text,
      ercas_reference text
    );
    CREATE TABLE public.pocketfi_webhook_logs (
      id uuid PRIMARY KEY, matched_user_id uuid, processed boolean,
      verified_amount_ngn numeric, verified_reference text
    );
    CREATE TABLE public.wallet_reservations (
      id uuid, user_id uuid, amount numeric, currency text DEFAULT 'NGN',
      status text, order_id uuid, order_table text
    );
    GRANT USAGE ON SCHEMA public TO service_role;
    INSERT INTO public.profiles(id, wallet_balance, is_admin)
      VALUES ('${admin}', 0, true), ('${customer}', 70, false);
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, created_at)
      VALUES
      ('11111111-1111-4111-8111-111111111111', '${customer}',
       'admin_credit', 'completed', 100, 0, 100,
       '{"source":"admin-adjust-balance","approval_type":"direct_admin_adjustment","approved_by":"${admin}","approval_reference":"approved-1","reason":"Owner approved credit"}',
       '${admin}', '2026-09-20 00:00:00+00'),
      ('${debit}', '${customer}', 'purchase', 'completed', -30, 100, 70,
       '{"trusted_principal_authorized":"true","trusted_principal_debit_amount":"30"}',
       NULL, '2026-09-20 00:01:00+00');
  `)
  await db.exec(migration('20260919015000_enforce_trusted_principal_transaction_guard.sql'))
  await db.exec(migration('20260924006000_wallet_financial_truth.sql'))
  await db.exec(migration('20260924009000_use_financial_truth_in_purchase_trigger.sql'))
  await db.exec(migration('20260924023000_preserve_recorded_admin_credit_approval.sql'))
  await db.exec(migration('20260924024000_use_financial_truth_for_refund_capacity.sql'))

  await db.exec(`UPDATE public.profiles SET is_admin = false WHERE id = '${admin}'`)
  const before = (await db.query(
    'SELECT public.wallet_financial_truth_internal($1::uuid) AS truth', [customer]
  )).rows[0].truth
  assert.equal(Number(before.approved_admin_credits), 100)
  assert.equal(Number(before.confirmed_spendable), 70)

  await db.exec(`SET app.tally_wallet_engine_authorized = 'true'`)
  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_at)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${customer}',
        'refund', 'completed', 30, 70, 100,
        '{"source_debit_transaction_id":"${debit}"}',
        '2026-09-20 00:02:00+00');
    UPDATE public.profiles SET wallet_balance = 100 WHERE id = '${customer}';
  `)
  const after = (await db.query(
    'SELECT public.wallet_financial_truth_internal($1::uuid) AS truth', [customer]
  )).rows[0].truth
  assert.equal(Number(after.eligible_refunds), 30)
  assert.equal(Number(after.confirmed_spendable), 100)

  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, created_at)
      VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${customer}',
        'admin_credit', 'completed', 10, 100, 110,
        '{"source":"unreviewed-route","approval_type":"direct_admin_adjustment","approved_by":"${admin}","approval_reference":"claimed-1","reason":"Not an approved posting route"}',
        '${admin}', '2026-09-20 00:03:00+00');
    UPDATE public.profiles SET wallet_balance = 110 WHERE id = '${customer}';
  `)
  const unreviewed = (await db.query(
    'SELECT public.wallet_financial_truth_internal($1::uuid) AS truth', [customer]
  )).rows[0].truth
  assert.equal(Number(unreviewed.approved_admin_credits), 100)
  assert.equal(Number(unreviewed.confirmed_spendable), 100)
  assert.equal(Number(unreviewed.quarantined_excess), 10)
  await db.exec(`
    INSERT INTO public.transactions
      (id, user_id, type, status, amount, balance_before, balance_after,
       metadata, created_by, created_at)
      VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', '${customer}',
        'admin_credit', 'completed', 5, 110, 115,
        '{"approved_by":"${admin}","approval_reference":"claimed-2","reason":"No posting source"}',
        '${admin}', '2026-09-20 00:04:00+00');
  `)
  const queryPack = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
  const query46Start = queryPack.lastIndexOf('-- 46.')
  const query47Start = queryPack.indexOf('-- 47.', query46Start)
  assert(query46Start >= 0 && query47Start > query46Start, 'read-only query 46 boundary missing')
  const query46 = queryPack.slice(query46Start, query47Start)
  const candidates = await db.query(query46)
  assert.deepEqual(candidates.rows.map((row) => row.transaction_id),
    ['ffffffff-ffff-4fff-8fff-ffffffffffff', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'])
  console.log('Admin demotion leaves an approved credit and linked refund spendable under the real trigger.')
} finally {
  await db.close()
}
