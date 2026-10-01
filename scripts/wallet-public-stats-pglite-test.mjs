import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const db = new PGlite()
const customer = '11111111-1111-4111-8111-111111111111'
const ordinary = '22222222-2222-4222-8222-222222222222'
const staff = '33333333-3333-4333-8333-333333333333'
const admin = '44444444-4444-4444-8444-444444444444'
const product = '55555555-5555-4555-8555-555555555555'

async function denied(sql) {
  await assert.rejects(() => db.query(sql), (error) => error.code === '42501')
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
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_staff boolean DEFAULT false, is_admin boolean DEFAULT false,
      account_suspended boolean DEFAULT false
    );
    CREATE TABLE public.staff_permissions (
      user_id uuid, permission_key text, is_enabled boolean DEFAULT false
    );
    ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_staff_permissions ON public.staff_permissions
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY, user_id uuid, status text, amount numeric,
      product_group_id uuid, account_details jsonb DEFAULT '{}'::jsonb
    );
    INSERT INTO public.profiles(id, is_staff, is_admin) VALUES
      ('${customer}', false, false), ('${ordinary}', false, false),
      ('${staff}', true, false), ('${admin}', false, true);
    INSERT INTO public.staff_permissions VALUES ('${staff}', 'view_stats', false);
    INSERT INTO public.orders(id, user_id, status, amount, product_group_id, account_details) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${customer}', 'completed', 1000, '${product}', '{"quantity":2}'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${customer}', 'completed', 2000, '${product}', '{"quantity":1}'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${staff}', 'completed', 9000, '${product}', '{}');
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT ON public.profiles, public.staff_permissions, public.orders TO anon, authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.staff_permissions TO anon, authenticated;
  `)
  await db.exec(migration('20260820017000_create_customer_sales_stats_rpc.sql'))
  await db.exec(migration('20260820020000_create_customer_top_product_groups_rpc.sql'))

  await db.query('SET ROLE anon')
  const oldRevenue = await db.query('SELECT * FROM public.get_customer_sales_stats()')
  assert.equal(Number(oldRevenue.rows[0].total_revenue), 3000)
  const oldUnits = await db.query('SELECT * FROM public.get_customer_top_product_groups(8)')
  assert.equal(Number(oldUnits.rows[0].units_sold), 3)
  await db.query('RESET ROLE')

  await db.exec(migration('20260924017000_restrict_public_sales_aggregates.sql'))
  await db.exec(`
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path = '' AS $$
      SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
        AND COALESCE(p.is_admin, false) AND NOT COALESCE(p.account_suspended, false))
      $$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path = '' AS $$ SELECT false $$;
    CREATE FUNCTION public.can_read_wallet_legacy_funding() RETURNS boolean LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path = '' AS $$ SELECT false $$;
  `)
  await db.exec(migration('20261001016000_require_active_privileged_helpers.sql'))
  for (const role of ['anon', 'authenticated']) {
    const writeGrant = await db.query(
      `SELECT has_table_privilege('${role}', 'public.staff_permissions', 'INSERT')
         OR has_table_privilege('${role}', 'public.staff_permissions', 'UPDATE')
         OR has_table_privilege('${role}', 'public.staff_permissions', 'DELETE') AS can_write`,
    )
    assert.equal(writeGrant.rows[0].can_write, false)
  }
  await db.query('SET ROLE anon')
  await denied('SELECT * FROM public.get_customer_sales_stats()')
  await denied('SELECT * FROM public.get_customer_top_product_groups(8)')
  const count = await db.query('SELECT public.get_public_customer_order_count() AS count')
  assert.equal(Number(count.rows[0].count), 2)
  const ranked = await db.query('SELECT * FROM public.get_public_top_product_group_ids(1000000)')
  assert.deepEqual(Object.keys(ranked.rows[0]), ['product_group_id'])
  assert.equal(ranked.rows[0].product_group_id, product)
  await db.query('RESET ROLE')

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${ordinary}', false)`)
  await db.query('SET ROLE authenticated')
  await denied('SELECT * FROM public.get_customer_sales_stats()')
  await db.query('RESET ROLE')

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${staff}', false)`)
  await db.query('SET ROLE authenticated')
  await denied('SELECT * FROM public.get_customer_sales_stats()')
  await db.query('RESET ROLE')
  await db.exec(`UPDATE public.staff_permissions SET is_enabled = true WHERE user_id = '${staff}'`)
  await db.query('SET ROLE authenticated')
  const staffStats = await db.query('SELECT * FROM public.get_customer_sales_stats()')
  assert.equal(Number(staffStats.rows[0].total_revenue), 3000)
  await db.query('RESET ROLE')
  await db.exec(`UPDATE public.profiles SET account_suspended = true WHERE id = '${staff}'`)
  await db.query('SET ROLE authenticated')
  await denied('SELECT * FROM public.get_customer_sales_stats()')
  await db.query('RESET ROLE')

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${admin}', false)`)
  await db.query('SET ROLE authenticated')
  const adminStats = await db.query('SELECT * FROM public.get_customer_sales_stats()')
  assert.equal(Number(adminStats.rows[0].total_sales), 2)
  await db.query('RESET ROLE')
  await db.exec(`UPDATE public.profiles SET account_suspended = true WHERE id = '${admin}'`)
  await db.query('SET ROLE authenticated')
  const suspendedAdmin = await db.query(
    'SELECT public.is_admin() AS admin, public.can_read_wallet_legacy_funding() AS can_read',
  )
  assert.equal(suspendedAdmin.rows[0].admin, false)
  assert.equal(suspendedAdmin.rows[0].can_read, false)
  await denied('SELECT * FROM public.get_customer_sales_stats()')
  await db.query('RESET ROLE')

  console.log('Public sales aggregate privilege scenarios passed in isolated PostgreSQL (not Supabase staging).')
} finally {
  await db.close()
}
