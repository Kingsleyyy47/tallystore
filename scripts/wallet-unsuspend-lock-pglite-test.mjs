import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const oldSql = readFileSync(new URL('../supabase/migrations/20260919016000_restrict_profile_privileged_writes.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20260924021000_recheck_wallet_truth_when_unsuspending.sql', import.meta.url), 'utf8')
const oldStart = oldSql.indexOf('CREATE OR REPLACE FUNCTION public.set_customer_suspension_state(')
const oldEnd = oldSql.indexOf('CREATE OR REPLACE FUNCTION public.set_staff_role(', oldStart)
assert(oldStart >= 0 && oldEnd > oldStart)

const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function suspended() {
  const result = await db.query('SELECT account_suspended FROM public.profiles WHERE id = $1::uuid', [customer])
  return result.rows[0].account_suspended
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean DEFAULT false, is_staff boolean DEFAULT false,
      account_suspended boolean DEFAULT false, suspension_reason text,
      suspended_at timestamptz, suspended_by uuid, suspension_reinstated_at timestamptz,
      reinstated_by uuid, updated_at timestamptz,
      wallet_review_required boolean DEFAULT false, wallet_review_reason text,
      wallet_reviewed_by uuid, test_integrity_status text DEFAULT 'consistent',
      test_evidence_complete boolean DEFAULT true, test_book numeric DEFAULT 0,
      test_exposure numeric DEFAULT 0, test_excess numeric DEFAULT 0
    );
    INSERT INTO public.profiles(id, is_admin) VALUES ('${admin}', true);
    INSERT INTO public.profiles(id, account_suspended, test_integrity_status)
      VALUES ('${customer}', true, 'payment_identity_conflict');
    CREATE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'integrity_status', p.test_integrity_status,
        'evidence_complete', p.test_evidence_complete,
        'trusted_book_balance', p.test_book,
        'spend_exposure', p.test_exposure,
        'quarantined_excess', p.test_excess
      ) FROM public.profiles p WHERE p.id = p_user_id
    $$;
  `)
  await db.exec(oldSql.slice(oldStart, oldEnd))

  // The former RPC can clear an account after the caller's earlier check
  // becomes stale, because it never reads financial truth under its lock.
  await db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin])
  assert.equal(await suspended(), false)

  await db.exec(`UPDATE public.profiles SET account_suspended = true WHERE id = '${customer}'`)
  await db.exec(migration)
  await assert.rejects(
    () => db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin]),
    /wallet_review_required_before_unsuspension/,
  )
  assert.equal(await suspended(), true)

  await db.exec(`UPDATE public.profiles SET test_integrity_status = 'consistent' WHERE id = '${customer}'`)
  await db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin])
  assert.equal(await suspended(), false)

  await db.exec(`
    UPDATE public.profiles SET account_suspended = true,
      wallet_review_required = true,
      wallet_review_reason = 'Wallet financial review: quarantined displayed excess 30',
      test_integrity_status = 'quarantined_excess', test_excess = 30
    WHERE id = '${customer}'
  `)
  await db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin])
  assert.equal(await suspended(), false)
  const review = await db.query('SELECT wallet_review_required FROM public.profiles WHERE id = $1::uuid', [customer])
  assert.equal(review.rows[0].wallet_review_required, true)

  await db.exec(`UPDATE public.profiles SET account_suspended = true,
    wallet_review_reason = 'Manual review required' WHERE id = '${customer}'`)
  await assert.rejects(
    () => db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin]),
    /wallet_review_hold_before_unsuspension/,
  )
  assert.equal(await suspended(), true)

  await db.exec('SET ROLE authenticated')
  await assert.rejects(
    () => db.query('SELECT public.set_customer_suspension_state($1::uuid, false, null, $2::uuid)', [customer, admin]),
    (error) => error.code === '42501',
  )
  await db.exec('RESET ROLE')
  console.log('Unsuspension rechecks canonical truth under the profile lock.')
} finally {
  await db.close()
}
