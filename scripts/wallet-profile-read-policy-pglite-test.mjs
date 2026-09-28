import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const patch = readFileSync(new URL('../supabase/migrations/20260925013000_secure_profile_admin_reader.sql', import.meta.url), 'utf8')
const queryPack = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const customer = '11111111-1111-4111-8111-111111111111'
const admin = '22222222-2222-4222-8222-222222222222'
const staff = '33333333-3333-4333-8333-333333333333'

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
      id uuid PRIMARY KEY, email text, is_admin boolean NOT NULL DEFAULT false,
      account_suspended boolean NOT NULL DEFAULT false
    );
    INSERT INTO public.profiles(id, email, is_admin) VALUES
      ('${customer}', 'customer@example.test', false),
      ('${admin}', 'admin@example.test', true),
      ('${staff}', 'staff-private@example.test', false);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.profiles TO anon, authenticated;
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin
        )
      $$;
    CREATE POLICY "Admin can read all profiles" ON public.profiles
      FOR SELECT TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin
        ) OR auth.uid() = id
      );
  `)

  await db.query('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${customer}', false)`)
  await assert.rejects(
    () => db.query('SELECT id FROM public.profiles'),
    (error) => error.code === '42P17',
  )
  await db.query('RESET ROLE')

  await db.exec(patch)
  await db.exec(queryPack.slice(queryPack.indexOf('-- 52.'), queryPack.indexOf('-- 53.')))
  await db.query('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${customer}', false)`)
  const customerRows = await db.query('SELECT id FROM public.profiles ORDER BY id')
  assert.deepEqual(customerRows.rows.map((row) => row.id), [customer])
  assert.equal((await db.query('SELECT public.is_admin_profile() AS admin')).rows[0].admin, false)

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${staff}', false)`)
  const staffRows = await db.query('SELECT email FROM public.profiles ORDER BY id')
  assert.deepEqual(staffRows.rows.map((row) => row.email), ['staff-private@example.test'])

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${admin}', false)`)
  const adminRows = await db.query('SELECT id FROM public.profiles ORDER BY id')
  assert.equal(adminRows.rows.length, 3)
  assert.equal((await db.query('SELECT public.is_admin_profile() AS admin')).rows[0].admin, true)
  await db.query('RESET ROLE')

  await db.query(`UPDATE public.profiles SET account_suspended = true WHERE id = '${admin}'`)
  await db.query('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${admin}', false)`)
  const suspendedAdminRows = await db.query('SELECT id FROM public.profiles ORDER BY id')
  assert.deepEqual(suspendedAdminRows.rows.map((row) => row.id), [admin])
  assert.equal((await db.query('SELECT public.is_admin_profile() AS admin')).rows[0].admin, false)
  await db.query('RESET ROLE')

  await db.query('SET ROLE anon')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)")
  assert.equal((await db.query('SELECT id FROM public.profiles')).rows.length, 0)
  assert.equal((await db.query('SELECT public.is_admin_profile() AS admin')).rows[0].admin, false)
  await db.query('RESET ROLE')

  console.log('Profile read policy recursion and caller-bound admin scope passed isolated PostgreSQL fixture.')
} finally {
  await db.close()
}
