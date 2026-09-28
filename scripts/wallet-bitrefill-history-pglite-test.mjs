import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924022000_hide_unfinished_bitrefill_redemption.sql', import.meta.url), 'utf8')
const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.bitrefill_orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, reference text NOT NULL,
      idempotency_key text, product_id text, product_name text,
      package_id text, quantity integer, recipient_phone text,
      amount_ngn numeric, amount_original numeric, currency text,
      payment_source text, status text, bitrefill_invoice_id text,
      bitrefill_order_id text, bitrefill_response jsonb,
      redemption_code text, redemption_link text, redemption_pin text,
      redemption_instructions text, redemption_expiration timestamptz,
      created_at timestamptz, completed_at timestamptz
    );
    GRANT ALL ON public.bitrefill_orders TO PUBLIC;
    ALTER TABLE public.bitrefill_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_order ON public.bitrefill_orders FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
    INSERT INTO public.bitrefill_orders
      (id, user_id, reference, product_name, quantity, amount_ngn,
       payment_source, status, redemption_code, bitrefill_response, created_at)
      VALUES
      ('11111111-1111-4111-8111-111111111111', '${alice}', 'a-pending',
       'Gift card', 1, 100, 'wallet', 'pending', 'hidden-pending',
       '{"secret":"raw"}', '2026-09-24 01:00:00+00'),
      ('22222222-2222-4222-8222-222222222222', '${alice}', 'a-success',
       'Gift card', 1, 200, 'wallet', 'successful', 'delivered-code',
       '{"secret":"raw"}', '2026-09-24 02:00:00+00'),
      ('33333333-3333-4333-8333-333333333333', '${bob}', 'b-success',
       'Gift card', 1, 300, 'wallet', 'successful', 'bob-code',
       '{"secret":"raw"}', '2026-09-24 03:00:00+00');
  `)
  await db.exec(migration)

  const grants = await db.query(`
    SELECT has_table_privilege('authenticated', 'public.bitrefill_orders', 'SELECT') AS table_read,
      has_column_privilege('authenticated', 'public.bitrefill_orders', 'product_name', 'SELECT') AS safe_read,
      has_column_privilege('authenticated', 'public.bitrefill_orders', 'redemption_code', 'SELECT') AS secret_read,
      has_column_privilege('authenticated', 'public.bitrefill_orders', 'bitrefill_response', 'SELECT') AS raw_read
  `)
  assert.deepEqual(grants.rows[0], {
    table_read: false, safe_read: true, secret_read: false, raw_read: false,
  })

  await db.exec(`SET request.jwt.claim.sub = '${alice}'; SET ROLE authenticated;`)
  const direct = await db.query('SELECT reference FROM public.bitrefill_orders ORDER BY reference')
  assert.deepEqual(direct.rows.map((row) => row.reference), ['a-pending', 'a-success'])
  await assert.rejects(
    () => db.query('SELECT redemption_code FROM public.bitrefill_orders'),
    (error) => error.code === '42501',
  )
  const history = await db.query('SELECT reference, redemption_code FROM public.get_my_bitrefill_order_history()')
  assert.deepEqual(history.rows, [
    { reference: 'a-success', redemption_code: 'delivered-code' },
    { reference: 'a-pending', redemption_code: null },
  ])
  await db.exec('RESET ROLE')
  console.log('Bitrefill history enforces own-row and completed-redemption reads under authenticated role.')
} finally {
  await db.close()
}
