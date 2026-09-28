import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL(
  '../supabase/migrations/20260925025000_restrict_suspended_admin_revenue_reads.sql', import.meta.url,
), 'utf8')
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  suspended: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
}

async function readAs(userId, table) {
  await db.query('SET ROLE authenticated')
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId])
    return (await db.query(`SELECT id FROM public.${table} ORDER BY id`)).rows.map((row) => row.id)
  } finally {
    await db.query('RESET ROLE')
  }
}

async function readAnon(table) {
  await db.query('SET ROLE anon')
  try {
    return (await db.query(`SELECT id FROM public.${table}`)).rows
  } finally {
    await db.query('RESET ROLE')
  }
}

try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
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
        SELECT EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND p.is_admin AND NOT p.account_suspended
        )
      $$;
    GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO authenticated;
    CREATE TABLE public.revenue_events (id integer, user_id uuid);
    CREATE TABLE public.cro_decision_audit (id integer, user_id uuid);
    INSERT INTO public.revenue_events VALUES
      (1, '${ids.customer}'), (2, '${ids.suspended}');
    INSERT INTO public.cro_decision_audit VALUES
      (1, '${ids.customer}'), (2, '${ids.suspended}');
    ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cro_decision_audit ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.revenue_events, public.cro_decision_audit TO authenticated, anon;
    CREATE POLICY "Admins can read revenue events" ON public.revenue_events
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY "Customers can select own revenue events" ON public.revenue_events
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE POLICY legacy_revenue_read ON public.revenue_events
      FOR SELECT USING (true);
    CREATE POLICY "Admins can read cro decisions" ON public.cro_decision_audit
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY legacy_decision_read ON public.cro_decision_audit
      FOR SELECT USING (true);
  `)

  assert.deepEqual(await readAs(ids.suspended, 'revenue_events'), [1, 2])
  assert.deepEqual(await readAs(ids.suspended, 'cro_decision_audit'), [1, 2])
  assert.equal((await readAnon('revenue_events')).length, 2)

  await db.exec(migration)

  for (const table of ['revenue_events', 'cro_decision_audit']) {
    assert.deepEqual(await readAs(ids.admin, table), [1, 2],
      `${table}: active admin retains investigation access`)
  }
  assert.deepEqual(await readAs(ids.suspended, 'revenue_events'), [2],
    'suspended admin retains only their own revenue events')
  assert.deepEqual(await readAs(ids.customer, 'revenue_events'), [1],
    'customer retains only their own revenue events')
  assert.deepEqual(await readAs(ids.suspended, 'cro_decision_audit'), [],
    'suspended admin cannot read CRO decision audit')
  assert.deepEqual(await readAs(ids.customer, 'cro_decision_audit'), [],
    'customer cannot read CRO decision audit')
  for (const table of ['revenue_events', 'cro_decision_audit']) {
    await assert.rejects(readAnon(table), /permission denied/,
      `${table}: anonymous browser role must not read telemetry`)
  }
} finally {
  await db.close()
}

console.log('Suspended admin loses cross-customer revenue and CRO audit reads.')
