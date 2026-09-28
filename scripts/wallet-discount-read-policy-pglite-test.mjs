import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const expand = readFileSync(new URL('../supabase/migrations/20260925014000_add_scoped_discount_readers.sql', import.meta.url), 'utf8')
const contract = readFileSync(new URL('../supabase/migrations/20260925015000_restrict_discount_code_browser_reads.sql', import.meta.url), 'utf8')
const queryPack = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const ids = {
  customer: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  staff: '44444444-4444-4444-8444-444444444444',
  noPermission: '55555555-5555-4555-8555-555555555555',
  suspended: '66666666-6666-4666-8666-666666666666',
}
const product = '77777777-7777-4777-8777-777777777777'
const category = '88888888-8888-4888-8888-888888888888'

async function as(role, userId, sql, params = []) {
  await db.query(`SET ROLE ${role}`)
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
    return await db.query(sql, params)
  } finally {
    await db.query('RESET ROLE')
  }
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
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean NOT NULL DEFAULT false,
      is_staff boolean NOT NULL DEFAULT false,
      account_suspended boolean NOT NULL DEFAULT false
    );
    INSERT INTO public.profiles(id, is_admin, is_staff, account_suspended) VALUES
      ('${ids.customer}', false, false, false),
      ('${ids.other}', false, false, false),
      ('${ids.admin}', true, false, false),
      ('${ids.staff}', false, true, false),
      ('${ids.noPermission}', false, true, false),
      ('${ids.suspended}', false, true, true);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.profiles TO authenticated;
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND p.is_admin AND NOT p.account_suspended
        )
      $$;
    CREATE TABLE public.staff_permissions (
      user_id uuid, permission_key text, is_enabled boolean NOT NULL DEFAULT false
    );
    INSERT INTO public.staff_permissions VALUES
      ('${ids.staff}', 'tab_discount_codes', true),
      ('${ids.noPermission}', 'tab_discount_codes', false),
      ('${ids.suspended}', 'tab_discount_codes', true);
    CREATE TABLE public.product_groups(id uuid PRIMARY KEY, category_id uuid);
    INSERT INTO public.product_groups VALUES ('${product}', '${category}');
    CREATE TABLE public.discount_codes (
      id uuid PRIMARY KEY, code text NOT NULL UNIQUE, percent_off smallint,
      category_id uuid, product_group_id uuid, max_uses integer,
      used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
      is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid, max_order_amount integer
    );
    INSERT INTO public.discount_codes(id, code, percent_off, user_id, max_uses, used_count, expires_at) VALUES
      (gen_random_uuid(), 'SAVE10', 10, NULL, NULL, 0, NULL),
      (gen_random_uuid(), 'VIP25', 25, '${ids.customer}', NULL, 0, NULL),
      (gen_random_uuid(), 'OTHER30', 30, '${ids.other}', NULL, 0, NULL),
      (gen_random_uuid(), 'MAXED', 20, NULL, 1, 1, NULL),
      (gen_random_uuid(), 'EXPIRED', 20, NULL, NULL, 0, now() - interval '1 day');
    ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.discount_codes TO anon, authenticated;
    CREATE POLICY "Anyone can read active discount codes" ON public.discount_codes
      FOR SELECT TO anon, authenticated
      USING (is_active AND (user_id IS NULL OR user_id = auth.uid()));
    CREATE POLICY "Admin can manage discount codes" ON public.discount_codes
      FOR ALL TO authenticated
      USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile());
  `)

  const exposed = await as('authenticated', ids.customer,
    'SELECT code FROM public.discount_codes ORDER BY code')
  assert(exposed.rows.some((row) => row.code === 'SAVE10'),
    'old policy must reproduce enumeration of store-wide codes')
  assert(!exposed.rows.some((row) => row.code === 'OTHER30'),
    'old reward-owner policy must not expose another customer reward')

  await db.exec(expand)
  const preview = async (userId, code, amount = 100) => {
    const result = await as('authenticated', userId,
      'SELECT public.preview_discount_code($1, $2, $3) AS value',
      [code, product, amount])
    return result.rows[0].value
  }
  assert.deepEqual(await preview(ids.customer, 'SAVE10'), { valid: true, percent_off: 10 })
  assert.deepEqual(await preview(ids.customer, 'VIP25'), { valid: true, percent_off: 25 })
  for (const code of ['OTHER30', 'MAXED', 'EXPIRED', 'UNKNOWN']) {
    assert.deepEqual(await preview(ids.customer, code),
      { valid: false, error: 'Invalid or expired code' })
  }
  assert.deepEqual(await preview(ids.other, 'VIP25'),
    { valid: false, error: 'Invalid or expired code' })
  await assert.rejects(
    () => as('anon', '', `SELECT public.preview_discount_code('SAVE10', '${product}', 100)`),
    (error) => error.code === '42501',
  )

  const managed = 'SELECT code FROM public.get_managed_discount_codes() ORDER BY code'
  assert.equal((await as('authenticated', ids.admin, managed)).rows.length, 5)
  assert.deepEqual((await as('authenticated', ids.staff, managed)).rows.map((row) => row.code),
    ['EXPIRED', 'MAXED', 'SAVE10'])
  for (const userId of [ids.customer, ids.noPermission, ids.suspended]) {
    await assert.rejects(
      () => as('authenticated', userId, managed),
      (error) => error.code === '42501',
    )
  }

  await db.exec(contract)
  await db.exec(queryPack.slice(queryPack.indexOf('-- 53.'), queryPack.indexOf('-- 54.')))
  assert.equal((await as('authenticated', ids.customer,
    'SELECT code FROM public.discount_codes')).rows.length, 0)
  assert.equal((await as('authenticated', ids.customer,
    "UPDATE public.discount_codes SET percent_off = 99 WHERE code = 'SAVE10' RETURNING id")).rows.length, 0)
  assert.deepEqual(await preview(ids.customer, 'SAVE10'), { valid: true, percent_off: 10 })
  assert.equal((await as('authenticated', ids.staff,
    'SELECT code FROM public.discount_codes')).rows.length, 0)
  assert.equal((await as('authenticated', ids.admin,
    'SELECT code FROM public.discount_codes')).rows.length, 5)
  await assert.rejects(
    () => as('anon', '', 'SELECT code FROM public.discount_codes'),
    (error) => error.code === '42501',
  )
  assert.deepEqual(await preview(ids.customer, 'SAVE10'), { valid: true, percent_off: 10 })
  assert.equal((await as('authenticated', ids.staff, managed)).rows.length, 3)

  await db.query(`UPDATE public.profiles SET account_suspended = true WHERE id = '${ids.admin}'`)
  assert.equal((await as('authenticated', ids.admin,
    'SELECT code FROM public.discount_codes')).rows.length, 0)
  await assert.rejects(
    () => as('authenticated', ids.admin, managed),
    (error) => error.code === '42501',
  )
  console.log('Discount preview, managed list, and post-contract table reads passed isolated PostgreSQL role tests.')
} finally {
  await db.close()
}
