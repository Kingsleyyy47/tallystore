import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20260925008000_restrict_sms_order_private_reads.sql', import.meta.url), 'utf8')
const adminSource = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const smsSource = readFileSync(new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'utf8')
const customerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'
const db = new PGlite()

async function denied(sql) {
  await assert.rejects(() => db.query(sql), (error) => error.code === '42501')
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_admin boolean NOT NULL);
    CREATE TABLE public.sms_orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, reference text,
      order_type text, service_id text, service_name text, phone_number text,
      country_code text, price_ngn numeric, status text, messages jsonb,
      created_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
      refunded_at timestamptz, refund_amount_ngn numeric,
      provider_request_id text, provider_payload jsonb, error_message text
    );
    INSERT INTO public.profiles VALUES
      ('${customerId}', false), ('${otherId}', false), ('${adminId}', true);
    INSERT INTO public.sms_orders(id, user_id, status, created_at, error_message, provider_payload)
    VALUES
      ('44444444-4444-4444-8444-444444444444', '${customerId}', 'failed', now(),
       'private-provider-error', '{"private":"provider-payload"}'),
      ('55555555-5555-4555-8555-555555555555', '${otherId}', 'active', now(),
       'other-user-error', '{"private":"other-payload"}');
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT ALL ON public.sms_orders TO PUBLIC, anon, authenticated;
    GRANT SELECT (error_message), SELECT (provider_payload)
      ON public.sms_orders TO PUBLIC, authenticated;
    ALTER TABLE public.sms_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY unsafe_all_sms_history ON public.sms_orders
      FOR SELECT TO authenticated USING (true);
  `)

  await db.exec(migration)

  const grants = await db.query(`
    SELECT has_column_privilege('authenticated', 'public.sms_orders', 'id', 'SELECT') AS safe_id,
      has_column_privilege('authenticated', 'public.sms_orders', 'messages', 'SELECT') AS own_messages,
      has_column_privilege('authenticated', 'public.sms_orders', 'error_message', 'SELECT') AS raw_error,
      has_column_privilege('authenticated', 'public.sms_orders', 'provider_payload', 'SELECT') AS provider_payload,
      has_column_privilege('authenticated', 'public.sms_orders', 'provider_request_id', 'SELECT') AS provider_id,
      has_table_privilege('authenticated', 'public.sms_orders', 'UPDATE') AS update_order,
      has_table_privilege('anon', 'public.sms_orders', 'SELECT') AS anon_read
  `)
  assert.deepEqual(grants.rows[0], {
    safe_id: true,
    own_messages: true,
    raw_error: false,
    provider_payload: false,
    provider_id: false,
    update_order: false,
    anon_read: false,
  })

  await db.query('SET ROLE anon')
  await denied('SELECT id FROM public.sms_orders')
  await db.query('RESET ROLE')

  await db.query('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${customerId}', false)`)
  const customerRows = await db.query('SELECT id, status FROM public.sms_orders')
  assert.deepEqual(customerRows.rows.map((row) => row.id), ['44444444-4444-4444-8444-444444444444'])
  await denied('SELECT error_message FROM public.sms_orders')
  await denied('SELECT provider_payload FROM public.sms_orders')
  await denied('SELECT provider_request_id FROM public.sms_orders')
  await denied("UPDATE public.sms_orders SET status = 'completed'")

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false)`)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sms_orders')).rows[0].n, 2)
  await denied('SELECT error_message FROM public.sms_orders')
  await db.query('RESET ROLE')

  await db.query('SET ROLE service_role')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sms_orders WHERE error_message IS NOT NULL')).rows[0].n, 2)
  await db.query('RESET ROLE')

  assert.match(adminSource, /readRows\('SMS orders', 'sms_orders', 50000, SMS_ORDER_HISTORY_COLUMNS\)/)
  assert.match(adminSource, /readRows\('SMS orders', 'sms_orders', 10000, SMS_ORDER_HISTORY_COLUMNS\)/)
  assert.doesNotMatch(smsSource.slice(smsSource.indexOf('async function handleAdminSmsOrders'), smsSource.indexOf('// ── Admin:', smsSource.indexOf('async function handleAdminSmsOrders') + 1)), /return \{ \.\.\.o, profiles:/)
  assert.match(smsSource, /\.\.\.adminSmsOrderSummary\(o\)/)
  assert.doesNotMatch(smsSource, /\.\.\.publicSmsOrder\(o\)/)

  console.log('SMS order private columns and cross-user reads denied in isolated PostgreSQL fixture.')
} finally {
  await db.close()
}
