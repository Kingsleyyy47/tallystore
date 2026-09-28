import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL(
  '../supabase/migrations/20260925024000_restrict_suspended_admin_financial_history.sql', import.meta.url,
), 'utf8')
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  suspended: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
}

async function rowsAs(userId, table) {
  await db.query('SET ROLE authenticated')
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId])
    return (await db.query(`SELECT id FROM public.${table} ORDER BY id`)).rows
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
  `)

  for (const [table, policy] of [
    ['orders', 'Admin can read all orders'],
    ['transactions', 'Admin can read all transactions'],
  ]) {
    await db.exec(`
      CREATE TABLE public.${table} (id integer, user_id uuid NOT NULL);
      INSERT INTO public.${table} VALUES
        (1, '${ids.customer}'), (2, '${ids.suspended}');
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.${table} TO authenticated;
      CREATE POLICY "${policy}" ON public.${table} FOR SELECT TO authenticated
        USING (user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
        ));
      CREATE POLICY legacy_broad_read ON public.${table}
        FOR SELECT TO authenticated USING (true);
    `)
    assert.deepEqual(await rowsAs(ids.suspended, table), [{ id: 1 }, { id: 2 }],
      `${table}: old policies must reproduce cross-customer suspended-admin read`)
  }

  await db.exec(migration)
  for (const table of ['orders', 'transactions']) {
    assert.deepEqual(await rowsAs(ids.admin, table), [{ id: 1 }, { id: 2 }],
      `${table}: active admin retains investigation access`)
    assert.deepEqual(await rowsAs(ids.suspended, table), [{ id: 2 }],
      `${table}: suspended admin retains only self-history`)
    assert.deepEqual(await rowsAs(ids.customer, table), [{ id: 1 }],
      `${table}: customer retains only self-history`)
  }
} finally {
  await db.close()
}

console.log('Base orders and transactions block suspended-admin cross-customer reads.')
