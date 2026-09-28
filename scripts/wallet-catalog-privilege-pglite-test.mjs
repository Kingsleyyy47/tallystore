import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const relationshipWriterMigration = readFileSync(new URL('../supabase/migrations/20260924030200_add_admin_product_relationship_writer.sql', import.meta.url), 'utf8')
const expandMigration = readFileSync(new URL('../supabase/migrations/20260924030500_add_managed_catalog_readers.sql', import.meta.url), 'utf8')
const contractMigration = readFileSync(new URL('../supabase/migrations/20260924031000_restrict_catalog_supplier_config.sql', import.meta.url), 'utf8')
const relationshipMigration = readFileSync(new URL('../supabase/migrations/20260924031500_restrict_product_relationship_metadata.sql', import.meta.url), 'utf8')
const ownerQueries = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const browserCatalog = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const legacyBrowserCatalog = readFileSync(new URL('../src/lib/supabase-step1.ts', import.meta.url), 'utf8')
const availability = readFileSync(new URL('../src/lib/productAvailability.ts', import.meta.url), 'utf8')
const revenueOs = readFileSync(new URL('../src/lib/revenue-os.ts', import.meta.url), 'utf8')
const adminPage = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const staffPage = readFileSync(new URL('../src/pages/StaffAdminPage.tsx', import.meta.url), 'utf8')
const chatbot = readFileSync(new URL('../supabase/functions/chatbot/index.ts', import.meta.url), 'utf8')
const customer = '11111111-1111-4111-8111-111111111111'
const admin = '22222222-2222-4222-8222-222222222222'
const staff = '33333333-3333-4333-8333-333333333333'

try {
  for (const source of [browserCatalog, legacyBrowserCatalog]) {
    assert.doesNotMatch(source, /\.from\('product_groups'\)\s*\.select\('\*'/)
    assert.doesNotMatch(source, /\.from\('product_groups'\)\s*\.select\('\*,/)
  }
  assert.doesNotMatch(availability, /muabanvia_product_id|shopclone_product_id|shopviaclone_product_id/)
  assert.doesNotMatch(chatbot, /\.from\("product_groups"\)\s*\.select\("\*/)
  assert.doesNotMatch(chatbot, /muabanvia_product_id|shopclone_product_id|shopviaclone_product_id/)
  assert.match(chatbot, /\.select\("id,category_id,name,description,price,stock_count,availability_status,is_sellable,is_active,categories\(name\)"\)/)
  assert.match(chatbot, /Deno\.env\.get\("LIVE_ACCOUNT_FULFILLMENT_ENABLED"\) === "true"/)
  assert.match(adminPage, /getManagedProductGroups\(/)
  assert.match(staffPage, /getManagedProductGroups\(/)
  assert.doesNotMatch(adminPage, /getAllProductGroups\(/)
  assert.match(staffPage, /can\(perms, 'tab_products'\) \? getManagedProductGroups\(\) : getAllProductGroups\(\)/)
  assert.match(adminPage, /readRows\('Product relationships', 'product_relationships', 5000, 'id,created_at'\)/)
  assert.match(adminPage, /\.rpc\('save_admin_product_relationships', \{ p_rows:/)
  assert.match(revenueOs, /\.rpc\('save_admin_product_relationships', \{/)
  assert.match(revenueOs, /\.from\('product_relationships' as any\)\s*\.select\('from_product_group_id,to_product_group_id,relationship_type,strength,confidence'\)/)

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean DEFAULT false,
      is_staff boolean DEFAULT false, account_suspended boolean DEFAULT false
    );
    CREATE TABLE public.staff_permissions (
      user_id uuid, permission_key text, is_enabled boolean
    );
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
      )
    $$;
    GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO authenticated;
    CREATE TABLE public.product_groups (
      id uuid PRIMARY KEY, category_id uuid, name text, description text,
      price numeric, features jsonb, stock_count integer,
      availability_status text, is_sellable boolean, is_active boolean,
      created_at timestamptz, quantity_discount_tiers jsonb,
      muabanvia_product_id text, shopclone_product_id text,
      shopviaclone_product_id text, auto_fulfill_enabled boolean,
      auto_restock_enabled boolean, restock_buffer_days numeric
    );
    CREATE TABLE public.product_relationships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_product_group_id uuid, to_product_group_id uuid,
      relationship_type text, strength numeric, confidence numeric,
      sample_size integer, source text, metadata jsonb,
      last_updated timestamptz, created_at timestamptz,
      UNIQUE (from_product_group_id, to_product_group_id, relationship_type, source)
    );
    INSERT INTO public.profiles(id, is_admin, is_staff) VALUES
      ('${customer}', false, false), ('${admin}', true, false),
      ('${staff}', false, true);
    INSERT INTO public.staff_permissions(user_id, permission_key, is_enabled)
      VALUES ('${staff}', 'tab_products', true);
    INSERT INTO public.product_groups
      (id, name, price, features, stock_count, availability_status,
       is_sellable, is_active, quantity_discount_tiers, muabanvia_product_id)
      VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Public item', 100,
       '[]', 1, 'AVAILABLE', true, true, '[]', 'supplier-secret-id'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Draft item', 200,
       '[]', 0, 'PAUSED', false, false, '[]', 'draft-supplier-id');
    GRANT SELECT ON TABLE public.product_groups TO PUBLIC, anon, authenticated, service_role;
    GRANT UPDATE ON TABLE public.product_groups TO authenticated;
    GRANT SELECT (muabanvia_product_id) ON TABLE public.product_groups TO PUBLIC;
    INSERT INTO public.product_relationships
      (id, from_product_group_id, to_product_group_id, relationship_type,
       strength, confidence, sample_size, source, metadata, created_at)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'COMPLEMENT', 0.8, 0.9, 12, 'BEHAVIOR',
        '{"internal_note":"do not expose"}', now());
    GRANT SELECT ON TABLE public.product_relationships TO PUBLIC, anon, authenticated;
    GRANT SELECT (metadata) ON TABLE public.product_relationships TO PUBLIC;
    GRANT INSERT, UPDATE ON TABLE public.product_relationships TO authenticated;
    ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;
    CREATE POLICY public_relationship_read ON public.product_relationships
      FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY admin_relationship_write ON public.product_relationships
      FOR ALL TO authenticated
      USING (public.is_admin_profile())
      WITH CHECK (public.is_admin_profile());
    ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;
    CREATE POLICY public_active_catalog ON public.product_groups
      FOR SELECT TO anon, authenticated USING (is_active = true);
    CREATE POLICY admin_catalog_edit ON public.product_groups
      FOR ALL TO authenticated
      USING (public.is_admin_profile())
      WITH CHECK (public.is_admin_profile());
  `)

  await db.exec(relationshipWriterMigration)
  await db.exec(expandMigration)
  await db.exec(contractMigration)
  await db.exec(relationshipMigration)
  for (const role of ['anon', 'authenticated']) {
    const privileges = await db.query(`
      SELECT has_table_privilege('${role}', 'public.product_groups', 'SELECT') AS whole_row,
        has_column_privilege('${role}', 'public.product_groups', 'name', 'SELECT') AS public_name,
        has_column_privilege('${role}', 'public.product_groups', 'muabanvia_product_id', 'SELECT') AS supplier_id,
        has_column_privilege('${role}', 'public.product_groups', 'auto_fulfill_enabled', 'SELECT') AS auto_fulfill
    `)
    assert.deepEqual(privileges.rows[0], {
      whole_row: false, public_name: true, supplier_id: false, auto_fulfill: false,
    }, `${role} catalog privileges`)
  }

  await db.exec('SET ROLE anon')
  const publicRows = await db.query('SELECT id, name, price FROM public.product_groups')
  const chatbotRows = await db.query('SELECT id, category_id, name, description, price, stock_count, availability_status, is_sellable, is_active FROM public.product_groups')
  assert.equal(chatbotRows.rows.length, publicRows.rows.length)
  assert.equal(publicRows.rows.length, 1)
  await assert.rejects(() => db.query('SELECT * FROM public.product_groups'), (error) => error.code === '42501')
  await assert.rejects(() => db.query('SELECT muabanvia_product_id FROM public.product_groups'), (error) => error.code === '42501')
  assert.equal((await db.query('SELECT relationship_type, strength FROM public.product_relationships')).rows.length, 1)
  await assert.rejects(() => db.query('SELECT * FROM public.product_relationships'), (error) => error.code === '42501')
  await assert.rejects(() => db.query('SELECT metadata FROM public.product_relationships'), (error) => error.code === '42501')
  await assert.rejects(() => db.query(`SELECT public.save_admin_product_relationships('[]'::jsonb)`),
    (error) => error.code === '42501')
  await assert.rejects(() => db.query('SELECT * FROM public.get_managed_product_groups()'), (error) => error.code === '42501')
  await db.exec('RESET ROLE')

  await db.exec('SET ROLE authenticated')
  await db.exec(`SET request.jwt.claim.sub = '${customer}'`)
  await assert.rejects(() => db.query('SELECT * FROM public.get_managed_product_groups()'), (error) => error.code === '42501')
  await assert.rejects(() => db.query(`SELECT public.save_admin_product_relationships('[]'::jsonb)`),
    (error) => error.code === '42501')
  await db.exec(`SET request.jwt.claim.sub = '${admin}'`)
  const managed = await db.query('SELECT name, muabanvia_product_id FROM public.get_managed_product_groups()')
  assert.deepEqual(managed.rows, [{ name: 'Public item', muabanvia_product_id: 'supplier-secret-id' }])
  const edited = await db.query(`
    UPDATE public.product_groups SET muabanvia_product_id = 'new-supplier-id'
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    RETURNING id, name
  `)
  assert.equal(edited.rows[0].name, 'Public item')
  const draft = await db.query(`SELECT name FROM public.get_managed_product_group('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')`)
  assert.equal(draft.rows[0].name, 'Draft item')
  const relationshipEdit = await db.query(`
    SELECT public.save_admin_product_relationships('[{
      "from_product_group_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "to_product_group_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "relationship_type":"COMPLEMENT","strength":0.9,"confidence":0.95,
      "sample_size":13,"source":"BEHAVIOR","metadata":{"reviewed":true}
    }]'::jsonb) AS written
  `)
  assert.equal(relationshipEdit.rows[0].written, 1)
  await db.exec('RESET ROLE')
  await db.exec(`UPDATE public.profiles SET account_suspended = true WHERE id = '${admin}'`)
  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => db.query(`SELECT public.save_admin_product_relationships('[]'::jsonb)`),
    (error) => error.code === '42501')
  await db.exec('RESET ROLE')
  await db.exec('SET ROLE authenticated')
  await db.exec(`SET request.jwt.claim.sub = '${staff}'`)
  const staffRows = await db.query('SELECT name FROM public.get_managed_product_groups()')
  assert.equal(staffRows.rows.length, 1)
  await db.exec('RESET ROLE')

  await db.exec(`UPDATE public.staff_permissions SET is_enabled = false WHERE user_id = '${staff}'`)
  await db.exec(`INSERT INTO public.staff_permissions(user_id, permission_key, is_enabled)
    VALUES ('${staff}', 'tab_add_product', true)`)
  await db.exec('SET ROLE authenticated')
  await db.exec(`SET request.jwt.claim.sub = '${staff}'`)
  await assert.rejects(() => db.query('SELECT * FROM public.get_managed_product_groups()'), (error) => error.code === '42501')
  await db.exec('RESET ROLE')

  const query37 = ownerQueries.slice(
    ownerQueries.indexOf('-- 37. Public product-catalog supplier configuration exposure.'),
    ownerQueries.indexOf('-- 38. Public product-relationship behavioral metadata exposure.'),
  )
  const deployedGrantShape = await db.query(query37)
  assert(deployedGrantShape.rows.length >= 2)
  assert(deployedGrantShape.rows.every((row) => !row.effective_column_select))

  const query38 = ownerQueries.slice(
    ownerQueries.indexOf('-- 38. Public product-relationship behavioral metadata exposure.'),
    ownerQueries.indexOf('-- 39. Pending-payment evidence must not be directly readable'),
  )
  const relationshipGrants = await db.query(query38)
  assert.equal(relationshipGrants.rows.length, 8)
  assert(relationshipGrants.rows.every((row) => !row.table_select && !row.effective_column_select))

  console.log('Catalog and relationship browser roles cannot read internal configuration; authorized editors retain scoped writes.')
} finally {
  await db.close()
}
