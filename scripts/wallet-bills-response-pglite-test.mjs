import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924026000_restrict_bills_provider_response.sql', import.meta.url), 'utf8')
const customer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.bills_transactions (
      id uuid PRIMARY KEY, user_id uuid, reference text, transaction_type text,
      amount numeric, status text, service_provider text, service_code text,
      beneficiary_phone text, payment_source text, sagecloud_reference text,
      sagecloud_response text, created_at timestamptz, completed_at timestamptz
    );
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT ON public.bills_transactions TO PUBLIC;
    ALTER TABLE public.bills_transactions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_bill ON public.bills_transactions FOR SELECT TO authenticated
      USING (user_id = auth.uid());
    INSERT INTO public.bills_transactions
      (id, user_id, reference, amount, status, sagecloud_response)
      VALUES
      ('11111111-1111-4111-8111-111111111111', '${customer}', 'mine', 100,
       'pending', '{"provider_secret":"hidden"}'),
      ('22222222-2222-4222-8222-222222222222', '${other}', 'other', 200,
       'successful', '{"provider_secret":"other-hidden"}');
  `)
  await db.exec(migration)

  const grants = (await db.query(`
    SELECT has_table_privilege('authenticated', 'public.bills_transactions', 'SELECT') AS table_read,
      has_column_privilege('authenticated', 'public.bills_transactions', 'reference', 'SELECT') AS summary_read,
      has_column_privilege('authenticated', 'public.bills_transactions', 'sagecloud_response', 'SELECT') AS raw_read,
      has_table_privilege('service_role', 'public.bills_transactions', 'SELECT') AS service_read
  `)).rows[0]
  assert.deepEqual(grants, {
    table_read: false, summary_read: true, raw_read: false, service_read: true,
  })

  await db.exec(`SET request.jwt.claim.sub = '${customer}'; SET ROLE authenticated;`)
  const own = await db.query('SELECT reference FROM public.bills_transactions')
  assert.deepEqual(own.rows.map((row) => row.reference), ['mine'])
  await assert.rejects(
    () => db.query('SELECT sagecloud_response FROM public.bills_transactions'),
    (error) => error.code === '42501',
  )
  await db.exec('RESET ROLE')
  console.log('Bills history retains own-row summaries without exposing raw provider response.')
} finally {
  await db.close()
}
