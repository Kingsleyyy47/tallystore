import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL(
  '../supabase/migrations/20260925022000_restrict_suspended_admin_settings_writes.sql', import.meta.url,
), 'utf8')
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  suspended: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
}

async function as(userId, sql) {
  await db.query('SET ROLE authenticated')
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId])
    return (await db.query(sql)).rows
  } finally {
    await db.query('RESET ROLE')
  }
}

try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean NOT NULL,
      account_suspended boolean NOT NULL
    );
    INSERT INTO public.profiles VALUES
      ('${ids.admin}', true, false),
      ('${ids.suspended}', true, true),
      ('${ids.customer}', false, false);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.profiles TO authenticated;
    CREATE POLICY own_profile ON public.profiles FOR SELECT TO authenticated
      USING (id = auth.uid());
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin AND NOT p.account_suspended)
      $$;
    GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO authenticated;

    CREATE TABLE public.app_settings (key text PRIMARY KEY, value text);
    INSERT INTO public.app_settings VALUES
      ('ngn_usd_rate', '1000'), ('provider_private', 'hidden');
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
    CREATE POLICY app_settings_public_keys ON public.app_settings
      FOR SELECT TO authenticated USING (key = 'ngn_usd_rate');
    CREATE POLICY app_settings_admin_write ON public.app_settings
      FOR ALL TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      )) WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY legacy_settings_update ON public.app_settings
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY legacy_settings_insert ON public.app_settings
      FOR INSERT TO authenticated WITH CHECK (true);

    CREATE TABLE public.sms_product_settings (
      service_code text PRIMARY KEY, price_override_ngn integer
    );
    INSERT INTO public.sms_product_settings VALUES ('sample', 100);
    ALTER TABLE public.sms_product_settings ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE ON public.sms_product_settings TO authenticated;
    CREATE POLICY sms_product_settings_admin_select
      ON public.sms_product_settings FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin));
    CREATE POLICY sms_product_settings_admin_write
      ON public.sms_product_settings FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin));
    CREATE POLICY legacy_sms_update ON public.sms_product_settings
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  `)

  assert.equal((await as(ids.suspended,
    "SELECT key FROM public.app_settings WHERE key = 'provider_private'")).length, 1,
  'old settings policy must reproduce suspended-admin private read')
  assert.deepEqual(await as(ids.suspended,
    "UPDATE public.app_settings SET value = 'unsafe' WHERE key = 'provider_private' RETURNING key"),
  [{ key: 'provider_private' }], 'old settings policy must reproduce suspended-admin write')
  assert.deepEqual(await as(ids.suspended,
    "UPDATE public.sms_product_settings SET price_override_ngn = 1 WHERE service_code = 'sample' RETURNING service_code"),
  [{ service_code: 'sample' }], 'old SMS policy must reproduce suspended-admin price write')

  await db.exec(migration)
  assert.deepEqual(await as(ids.customer,
    "SELECT key FROM public.app_settings WHERE key = 'ngn_usd_rate'"),
  [{ key: 'ngn_usd_rate' }], 'public storefront setting read must remain available')
  assert.deepEqual(await as(ids.admin,
    "UPDATE public.app_settings SET value = 'safe' WHERE key = 'provider_private' RETURNING key"),
  [{ key: 'provider_private' }], 'active admin must retain operational settings write')
  assert.deepEqual(await as(ids.admin,
    "UPDATE public.sms_product_settings SET price_override_ngn = 200 WHERE service_code = 'sample' RETURNING service_code"),
  [{ service_code: 'sample' }], 'active admin must retain SMS setting write')

  for (const userId of [ids.suspended, ids.customer]) {
    assert.deepEqual(await as(userId,
      "SELECT key FROM public.app_settings WHERE key = 'provider_private'"), [],
    'inactive/non-admin actor must not read private settings')
    assert.deepEqual(await as(userId,
      "UPDATE public.app_settings SET value = 'unsafe' WHERE key = 'provider_private' RETURNING key"), [],
    'inactive/non-admin actor must not update settings despite legacy permissive policy')
    await assert.rejects(as(userId,
      "INSERT INTO public.app_settings(key, value) VALUES ('test_new', 'unsafe')"),
      /row-level security policy/,
      'inactive/non-admin actor must not insert settings despite legacy permissive policy')
    assert.deepEqual(await as(userId,
      'SELECT service_code FROM public.sms_product_settings'), [],
      'inactive/non-admin actor must not read SMS supplier settings')
    assert.deepEqual(await as(userId,
      "UPDATE public.sms_product_settings SET price_override_ngn = 1 WHERE service_code = 'sample' RETURNING service_code"), [],
      'inactive/non-admin actor must not update SMS prices')
  }
} finally {
  await db.close()
}

console.log('Suspended admin cannot read/write operational or SMS settings; public storefront reads remain.')
