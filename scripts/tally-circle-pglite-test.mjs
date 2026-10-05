import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261005000000_tally_circle_verified_referrals.sql', import.meta.url), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const stranger = '10000000-0000-4000-8000-000000000002'
const referredId = index => '20000000-0000-4000-8000-' + String(index).padStart(12, '0')
const logId = index => '30000000-0000-4000-8000-' + String(index).padStart(12, '0')

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, referral_code text, referred_by text);
    CREATE TABLE public.app_settings(key text PRIMARY KEY, value text, updated_at timestamptz);
    CREATE TABLE public.transactions(
      user_id uuid, type text, status text, amount numeric, created_at timestamptz,
      external_payment_id text, reference text, metadata jsonb
    );
    CREATE TABLE public.pending_payments(
      user_id uuid, amount numeric, status text, transaction_reference text, ercas_reference text
    );
    CREATE TABLE public.pocketfi_webhook_logs(
      id uuid PRIMARY KEY, matched_user_id uuid, processed boolean,
      verified_amount_ngn numeric, verified_reference text
    );
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    INSERT INTO public.app_settings VALUES ('referral_commission_pct', '5', now());
    INSERT INTO public.profiles VALUES
      ('${owner}', 'TALLY-OWNER', NULL), ('${stranger}', 'OTHER', NULL);
  `)
  await db.exec(migration)
  assert.equal((await db.query("SELECT value FROM public.app_settings WHERE key='referral_commission_pct'")).rows[0].value, '0')
  for (let i = 1; i <= 8; i++) {
    await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3)', [referredId(i), 'REF-' + i, owner])
  }
  const addCredit = async (i, provider, amount, reference, metadata = {}) => {
    await db.query(`INSERT INTO public.transactions VALUES ($1,'topup','completed',$2,now(),$3,$3,$4)`, [
      referredId(i), amount, reference,
      JSON.stringify({ provider, verified_amount_ngn: String(amount), ...metadata }),
    ])
  }
  const count = async () => Number((await db.query('SELECT public.tally_circle_qualified_count($1) AS n', [owner])).rows[0].n)
  // Caller-provided metadata cannot grant the discount without provider evidence.
  await addCredit(1, 'pocketfi', 1000, 'forged', { webhook_log_id: logId(1) })
  await addCredit(2, 'ercaspay', 1000, 'forged-ercas')
  await addCredit(3, 'pocketfi', 1000, 'bad-id', { webhook_log_id: 'not-a-uuid' })
  assert.equal(await count(), 0)
  // A proof belonging to another person must not qualify this referrer.
  await db.query('INSERT INTO public.pocketfi_webhook_logs VALUES ($1,$2,true,1000,$3)', [logId(1), stranger, 'forged'])
  assert.equal(await count(), 0)
  await db.exec('TRUNCATE public.transactions, public.pocketfi_webhook_logs;')
  // Five people each reaching the cumulative threshold qualify once.
  for (let i = 1; i <= 5; i++) {
    for (let part = 1; part <= 2; part++) {
      const reference = 'verified-' + i + '-' + part
      if (i % 2) {
        const id = logId(i * 10 + part)
        await db.query('INSERT INTO public.pocketfi_webhook_logs VALUES ($1,$2,true,500,$3)', [id, referredId(i), reference])
        await addCredit(i, 'pocketfi', 500, reference, { webhook_log_id: id })
      } else {
        await db.query("INSERT INTO public.pending_payments VALUES ($1,500,'credited',$2,$2)", [referredId(i), reference])
        await addCredit(i, 'ercaspay', 500, reference)
      }
    }
  }
  assert.equal(await count(), 5)
  // A paid-looking credit with an uncredited checkout cannot count.
  await db.query("INSERT INTO public.pending_payments VALUES ($1,1000,'pending','pending','pending')", [referredId(6)])
  await addCredit(6, 'ercaspay', 1000, 'pending')
  await addCredit(7, 'ercaspay', 999, 'under-threshold')
  await db.query("INSERT INTO public.pending_payments VALUES ($1,999,'credited','under-threshold','under-threshold')", [referredId(7)])
  assert.equal(await count(), 5)
  await db.exec(`SET request.jwt.claim.sub = '${owner}'; SET ROLE authenticated;`)
  const summary = (await db.query('SELECT public.get_my_tally_circle_status() AS status')).rows[0].status
  assert.equal(summary.is_member, true)
  assert.equal(summary.qualified_referrals, 5)
  assert.equal(summary.referral_code, 'TALLY-OWNER')
  await assert.rejects(db.query('SELECT public.tally_circle_qualified_count($1)', [stranger]), /permission denied/)
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${stranger}'; SET ROLE authenticated;`)
  assert.equal((await db.query('SELECT public.get_my_tally_circle_status() AS status')).rows[0].status.is_member, false)
  await db.exec('RESET ROLE; SET ROLE anon;')
  await assert.rejects(db.query('SELECT public.get_my_tally_circle_status()'), /permission denied/)
  console.log('Tally Circle: verified cumulative credits, malformed evidence, ownership, threshold and role isolation passed.')
} finally {
  await db.close()
}
