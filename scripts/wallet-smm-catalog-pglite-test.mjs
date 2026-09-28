import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const expandMigration = readFileSync(new URL('../supabase/migrations/20260925005000_restrict_smm_supplier_ids.sql', import.meta.url), 'utf8')
const contractMigration = readFileSync(new URL('../supabase/migrations/20260925006000_restrict_smm_supplier_ids_browser_grants.sql', import.meta.url), 'utf8')
const orderPrivacyMigration = readFileSync(new URL('../supabase/migrations/20260925007000_restrict_smm_order_panel_response_reads.sql', import.meta.url), 'utf8')
const customerSource = readFileSync(new URL('../src/pages/SocialBoostPage.tsx', import.meta.url), 'utf8')
const adminSource = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const edgeSource = readFileSync(new URL('../supabase/functions/smm-get-services/index.ts', import.meta.url), 'utf8')
const statusSource = readFileSync(new URL('../supabase/functions/smm-check-status/index.ts', import.meta.url), 'utf8')
const createOrderSource = readFileSync(new URL('../supabase/functions/smm-create-order/index.ts', import.meta.url), 'utf8')
const adminId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_admin boolean NOT NULL);
    CREATE TABLE public.smm_services (
      id bigint PRIMARY KEY, external_id bigint, name text, category text,
      platform text, service_type text, price_ngn numeric,
      min_quantity integer, max_quantity integer,
      has_refill boolean, has_cancel boolean, is_active boolean
    );
    CREATE TABLE public.smm_orders (
      id uuid PRIMARY KEY, user_id uuid, service_id bigint, link text,
      quantity integer, amount_ngn numeric, status text, reference text,
      external_order_id bigint, start_count integer, remains integer,
      created_at timestamptz, updated_at timestamptz, completed_at timestamptz,
      panel_response jsonb, panel_charge numeric, cost_usd numeric
    );
    INSERT INTO public.profiles VALUES ('${adminId}', true), ('${customerId}', false);
    GRANT SELECT ON public.profiles TO authenticated;
    INSERT INTO public.smm_services VALUES
      (1, 918273, 'Followers', 'Followers', 'instagram', 'default', 500,
       10, 1000, true, false, true),
      (2, 827364, 'Hidden service', 'Likes', 'instagram', 'default', 300,
       10, 1000, false, false, false);
    INSERT INTO public.smm_orders VALUES
      ('33333333-3333-4333-8333-333333333333', '${customerId}', 1,
       'https://example.com/post', 100, 500, 'processing', 'SMM-1', 7123,
       0, 100, now(), now(), NULL, '{"charge":"3.50","error":"panel-internal"}', 3.5, 3.5),
      ('44444444-4444-4444-8444-444444444444', '${adminId}', 1,
       'https://example.com/private', 100, 500, 'processing', 'SMM-2', 7234,
       0, 100, now(), now(), NULL, '{"charge":"4.00"}', 4, 4);
    GRANT ALL ON public.smm_services TO PUBLIC, anon, authenticated;
    GRANT SELECT (external_id) ON public.smm_services TO PUBLIC;
    GRANT ALL ON public.smm_orders TO PUBLIC, anon, authenticated;
    GRANT SELECT (panel_response) ON public.smm_orders TO PUBLIC;
    ALTER TABLE public.smm_services ENABLE ROW LEVEL SECURITY;
    CREATE POLICY public_active_smm ON public.smm_services
      FOR SELECT TO anon, authenticated USING (is_active);
    ALTER TABLE public.smm_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY customer_smm_order_history ON public.smm_orders
      FOR SELECT TO authenticated USING (
        user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin
        )
      );
  `)
  await db.exec(expandMigration)
  assert.equal((await db.query(`SELECT has_column_privilege('authenticated', 'public.smm_services', 'external_id', 'SELECT') AS readable`)).rows[0].readable, true)
  await db.exec(contractMigration)
  await db.exec(orderPrivacyMigration)

  const grants = await db.query(`
    SELECT has_column_privilege('authenticated', 'public.smm_services', 'id', 'SELECT') AS id_read,
      has_column_privilege('authenticated', 'public.smm_services', 'name', 'SELECT') AS name_read,
      has_column_privilege('authenticated', 'public.smm_services', 'external_id', 'SELECT') AS supplier_id_read,
      has_table_privilege('authenticated', 'public.smm_services', 'UPDATE') AS customer_update,
      has_table_privilege('authenticated', 'public.smm_services', 'TRUNCATE') AS customer_truncate,
      has_function_privilege('anon', 'public.get_admin_smm_services(text)', 'EXECUTE') AS anon_admin_read,
      has_function_privilege('authenticated', 'public.get_admin_smm_services(text)', 'EXECUTE') AS admin_rpc_callable
  `)
  assert.deepEqual(grants.rows[0], {
    id_read: true,
    name_read: true,
    supplier_id_read: false,
    customer_update: false,
    customer_truncate: false,
    anon_admin_read: false,
    admin_rpc_callable: true,
  })

  const orderGrants = await db.query(`
    SELECT has_column_privilege('authenticated', 'public.smm_orders', 'id', 'SELECT') AS id_read,
      has_column_privilege('authenticated', 'public.smm_orders', 'panel_response', 'SELECT') AS panel_response_read,
      has_column_privilege('authenticated', 'public.smm_orders', 'panel_charge', 'SELECT') AS panel_charge_read,
      has_column_privilege('authenticated', 'public.smm_orders', 'cost_usd', 'SELECT') AS supplier_cost_read,
      has_table_privilege('authenticated', 'public.smm_orders', 'UPDATE') AS customer_update,
      has_table_privilege('anon', 'public.smm_orders', 'SELECT') AS anon_read
  `)
  assert.deepEqual(orderGrants.rows[0], {
    id_read: true,
    panel_response_read: false,
    panel_charge_read: false,
    supplier_cost_read: false,
    customer_update: false,
    anon_read: false,
  })

  await db.exec('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${customerId}', false)`)
  const publicRows = await db.query('SELECT id, name, platform FROM public.smm_services')
  assert.deepEqual(publicRows.rows, [{ id: 1, name: 'Followers', platform: 'instagram' }])
  await assert.rejects(
    () => db.query('SELECT external_id FROM public.smm_services'),
    (error) => error.code === '42501',
  )
  await assert.rejects(
    () => db.query('UPDATE public.smm_services SET is_active = false WHERE id = 1'),
    (error) => error.code === '42501',
  )
  await assert.rejects(
    () => db.query('SELECT public.get_admin_smm_services()'),
    (error) => error.code === '42501',
  )
  await assert.rejects(
    () => db.query('SELECT public.set_admin_smm_service_active(1, NULL, false)'),
    (error) => error.code === '42501',
  )
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.smm_orders')).rows[0].count, 1)
  await assert.rejects(
    () => db.query('SELECT panel_response FROM public.smm_orders'),
    (error) => error.code === '42501',
  )
  await assert.rejects(
    () => db.query('SELECT panel_charge FROM public.smm_orders'),
    (error) => error.code === '42501',
  )

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false)`)
  const adminRows = (await db.query('SELECT public.get_admin_smm_services() AS rows')).rows[0].rows
  assert.equal(adminRows.length, 2)
  assert.equal(adminRows[0].external_id, 918273)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.smm_orders')).rows[0].count, 2)
  const toggled = await db.query('SELECT public.set_admin_smm_service_active(1, NULL, false) AS changed')
  assert.equal(toggled.rows[0].changed, 1)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.smm_services')).rows[0].count, 0)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT is_active FROM public.smm_services WHERE id = 1')).rows[0].is_active, false)

  assert.doesNotMatch(customerSource, /external_id/)
  assert.doesNotMatch(edgeSource, /id, external_id, name/)
  assert.match(adminSource, /rpc\('get_admin_smm_services'/)
  assert.match(adminSource, /rpc\('set_admin_smm_service_active'/)
  assert.doesNotMatch(adminSource, /from\('smm_services'\)/)
  assert.match(adminSource, /readRows\('Social boost', 'smm_orders', 50000,/)
  assert.doesNotMatch(statusSource, /charge: panelStatus\.charge/)
  assert.doesNotMatch(statusSource, /error: `Panel error: \$\{panelStatus\.error\}`/)
  assert.doesNotMatch(createOrderSource, /Order failed: \$\{panelError\}/)
  const uncertainSupplierBranch = createOrderSource.split('if (panelError) {')[1]?.split("eventType: 'PAYMENT_COMPLETED'")[0]
  assert.ok(uncertainSupplierBranch)
  assert.match(uncertainSupplierBranch, /status: 'outcome_unknown'/)
  assert.match(uncertainSupplierBranch, /SMM_SUPPLIER_OUTCOME_UNKNOWN/)
  assert.doesNotMatch(uncertainSupplierBranch, /applyWalletTransaction\(/)
  assert.match(createOrderSource, /\.eq\('status', 'outcome_unknown'\)/)
  assert.match(createOrderSource, /\.in\('status', \['pending', 'processing', 'in_progress', 'outcome_unknown'\]\)/)
  assert.match(customerSource, /data\?\.code === 'SMM_SUPPLIER_OUTCOME_UNKNOWN'/)
  console.log('SMM supplier catalog and order-response privacy passed isolated PostgreSQL checks.')
} finally {
  await db.close()
}
