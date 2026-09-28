import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924025000_hide_uncommitted_order_credentials.sql', import.meta.url), 'utf8')
const suspensionMigration = readFileSync(new URL('../supabase/migrations/20260925019000_restrict_suspended_admin_order_history.sql', import.meta.url), 'utf8')
const customer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const admin = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const suspendedAdmin = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean DEFAULT false,
      account_suspended boolean DEFAULT false
    );
    CREATE TABLE public.categories (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.product_groups (
      id uuid PRIMARY KEY, name text, price numeric, category_id uuid
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, product_group_id uuid,
      amount numeric, status text, created_at timestamptz,
      account_details jsonb, financial_authorization_status text
    );
    INSERT INTO public.profiles VALUES
      ('${customer}', false, false), ('${other}', false, false),
      ('${admin}', true, false), ('${suspendedAdmin}', true, true);
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin AND NOT p.account_suspended)
      $$;
    INSERT INTO public.categories VALUES
      ('11111111-1111-4111-8111-111111111111', 'Social');
    INSERT INTO public.product_groups VALUES
      ('22222222-2222-4222-8222-222222222222', 'Account', 100,
       '11111111-1111-4111-8111-111111111111');
    INSERT INTO public.orders VALUES
      ('33333333-3333-4333-8333-333333333333', '${customer}',
       '22222222-2222-4222-8222-222222222222', 100, 'processing',
       '2026-09-24 01:00:00+00',
       '{"product_name":"Account","quantity":1,"password":"pending-secret"}', 'funds_held'),
      ('44444444-4444-4444-8444-444444444444', '${customer}',
       '22222222-2222-4222-8222-222222222222', 100, 'completed',
       '2026-09-24 02:00:00+00',
       '{"product_name":"Account","quantity":1,"password":"delivered-secret"}', 'captured'),
      ('55555555-5555-4555-8555-555555555555', '${customer}',
       '22222222-2222-4222-8222-222222222222', 100, 'completed',
       '2026-09-24 03:00:00+00',
       '{"product_name":"Account","quantity":1,"password":"uncaptured-secret"}', NULL),
      ('66666666-6666-4666-8666-666666666666', '${customer}',
       '22222222-2222-4222-8222-222222222222', 100, 'completed',
       '2026-09-18 03:00:00+00',
       '{"product_name":"Account","quantity":1,"password":"legacy-secret"}', NULL),
      ('77777777-7777-4777-8777-777777777777', '${other}',
       '22222222-2222-4222-8222-222222222222', 100, 'completed',
       '2026-09-24 04:00:00+00',
       '{"product_name":"Account","quantity":1,"password":"other-secret"}', 'captured');
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO authenticated;
    GRANT SELECT ON public.orders TO PUBLIC;
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_or_admin ON public.orders FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin
      ));
  `)
  await db.exec(migration)

  const grants = (await db.query(`
    SELECT has_table_privilege('authenticated', 'public.orders', 'SELECT') AS table_read,
      has_column_privilege('authenticated', 'public.orders', 'id', 'SELECT') AS id_read,
      has_column_privilege('authenticated', 'public.orders', 'account_details', 'SELECT') AS details_read
  `)).rows[0]
  assert.deepEqual(grants, { table_read: false, id_read: false, details_read: false })

  await db.exec(`SET request.jwt.claim.sub = '${customer}'; SET ROLE authenticated;`)
  await assert.rejects(
    () => db.query('SELECT account_details FROM public.orders'),
    (error) => error.code === '42501',
  )
  const own = (await db.query(`
    SELECT id, account_details->>'password' AS password, product_groups->>'name' AS product_name
    FROM public.orders_safe_history ORDER BY id
  `)).rows
  assert.equal(own.length, 4)
  assert.deepEqual(own.map((row) => row.password), [null, 'delivered-secret', null, 'legacy-secret'])
  assert(own.every((row) => row.product_name === 'Account'))

  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${admin}'; SET ROLE authenticated;`)
  const adminRows = (await db.query(`
    SELECT user_id, account_details->>'password' AS password
    FROM public.orders_safe_history ORDER BY id
  `)).rows
  assert.equal(adminRows.length, 5)
  assert(adminRows.every((row) => row.password === null))
  await db.exec('RESET ROLE')

  await db.exec(`SET request.jwt.claim.sub = '${suspendedAdmin}'; SET ROLE authenticated;`)
  assert.equal((await db.query('SELECT id FROM public.orders_safe_history')).rows.length, 5,
    'old order-history view must reproduce suspended-admin cross-customer reads')
  await db.exec('RESET ROLE')

  await db.exec(suspensionMigration)
  await db.exec(`SET request.jwt.claim.sub = '${suspendedAdmin}'; SET ROLE authenticated;`)
  assert.equal((await db.query('SELECT id FROM public.orders_safe_history')).rows.length, 0,
    'suspended admin must not see another customer order history')
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${admin}'; SET ROLE authenticated;`)
  assert.equal((await db.query('SELECT id FROM public.orders_safe_history')).rows.length, 5,
    'active admin must retain order investigation access')
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${customer}'; SET ROLE authenticated;`)
  const ownAfter = (await db.query(`
    SELECT account_details->>'password' AS password
    FROM public.orders_safe_history ORDER BY id
  `)).rows
  assert.deepEqual(ownAfter.map((row) => row.password),
    [null, 'delivered-secret', null, 'legacy-secret'],
    'customer history and completed credential reveal must remain intact')
  await db.exec('RESET ROLE')
  console.log('Order history blocks direct credential reads and suspended-admin cross-customer reads.')
} finally {
  await db.close()
}
