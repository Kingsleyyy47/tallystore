import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL(
  '../supabase/migrations/20260925018000_restrict_suspended_admin_audit_reads.sql', import.meta.url,
), 'utf8')
const alertMigration = readFileSync(new URL(
  '../supabase/migrations/20260925020000_restrict_suspended_admin_alert_access.sql', import.meta.url,
), 'utf8')
const forensicMigration = readFileSync(new URL(
  '../supabase/migrations/20260925021000_restrict_suspended_admin_forensic_reads.sql', import.meta.url,
), 'utf8')
const telemetryMigration = readFileSync(new URL(
  '../supabase/migrations/20260925023000_restrict_suspended_admin_telemetry_reads.sql', import.meta.url,
), 'utf8')
const forensicPolicies = [
  ['fraud_device_bans', 'Admins can read fraud device bans'],
  ['profile_delete_audit', 'Admins can read profile delete audit'],
  ['auth_user_delete_audit', 'Admins can read auth user delete audit'],
  ['profile_balance_audit', 'Admins can read profile balance audit'],
  ['auth_user_identity_audit', 'Admins can read auth user identity audit'],
  ['profile_identity_audit', 'Admins can read profile identity audit'],
  ['profile_balance_blocked_attempts', 'Admins can read blocked profile balance attempts'],
]
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  suspended: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
}

async function readAs(userId, sql) {
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
        SELECT EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND p.is_admin AND NOT p.account_suspended
        )
      $$;
    GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO authenticated;
    CREATE TABLE public.transaction_ledger_blocked_attempts (id integer);
    CREATE TABLE public.wallet_security_events (id integer);
    CREATE TABLE public.sms_orders (id integer, user_id uuid);
    CREATE TABLE public.admin_alerts (id integer PRIMARY KEY, acknowledged boolean NOT NULL DEFAULT false);
    CREATE TABLE public.site_visits (id integer, user_id uuid);
    CREATE TABLE public.revenue_identity_links (id integer, user_id uuid);
    INSERT INTO public.transaction_ledger_blocked_attempts VALUES (1);
    INSERT INTO public.wallet_security_events VALUES (1);
    INSERT INTO public.sms_orders VALUES (1, '${ids.customer}'), (2, '${ids.suspended}');
    INSERT INTO public.admin_alerts VALUES (1, false);
    INSERT INTO public.site_visits VALUES (1, '${ids.customer}');
    INSERT INTO public.revenue_identity_links VALUES (1, '${ids.customer}');
    ALTER TABLE public.transaction_ledger_blocked_attempts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wallet_security_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sms_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.revenue_identity_links ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.transaction_ledger_blocked_attempts,
      public.wallet_security_events, public.sms_orders TO authenticated;
    GRANT SELECT, UPDATE (acknowledged) ON public.admin_alerts TO authenticated;
    GRANT SELECT ON public.site_visits TO authenticated;
    GRANT SELECT, INSERT ON public.revenue_identity_links TO authenticated;
    CREATE POLICY "Admins can read transaction ledger blocked attempts"
      ON public.transaction_ledger_blocked_attempts FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin));
    CREATE POLICY "Admins can read wallet security events"
      ON public.wallet_security_events FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin));
    CREATE POLICY sms_orders_customer_admin_read_limit ON public.sms_orders
      AS RESTRICTIVE FOR SELECT TO authenticated USING (
        user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin)
      );
    CREATE POLICY sms_orders_customer_admin_read ON public.sms_orders
      FOR SELECT TO authenticated USING (
        user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin)
      );
    CREATE POLICY "Admins can view all alerts" ON public.admin_alerts
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY "Admins can update alerts" ON public.admin_alerts
      FOR UPDATE TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY legacy_alert_read ON public.admin_alerts
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY legacy_alert_update ON public.admin_alerts
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "Admins can read site visits" ON public.site_visits
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin
      ));
    CREATE POLICY legacy_site_visit_read ON public.site_visits
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Admins can read revenue identity links"
      ON public.revenue_identity_links FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin));
    CREATE POLICY legacy_identity_link_read ON public.revenue_identity_links
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY customer_identity_link_insert ON public.revenue_identity_links
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  `)

  for (const [table, policy] of forensicPolicies) {
    await db.exec(`
      CREATE TABLE public.${table} (id integer);
      INSERT INTO public.${table} VALUES (1);
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.${table} TO authenticated;
      CREATE POLICY "${policy}" ON public.${table} FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.is_admin));
      CREATE POLICY legacy_forensic_read ON public.${table}
        FOR SELECT TO authenticated USING (true);
    `)
    assert.equal((await readAs(ids.suspended, `SELECT id FROM public.${table}`)).length, 1,
      `${table}: old policies must reproduce suspended-admin access`)
  }

  for (const table of ['transaction_ledger_blocked_attempts', 'wallet_security_events']) {
    assert.equal((await readAs(ids.suspended, `SELECT id FROM public.${table}`)).length, 1,
      `${table}: old policy must reproduce suspended-admin access`)
  }
  assert.equal((await readAs(ids.suspended, 'SELECT id FROM public.sms_orders')).length, 2,
    'old SMS policy must reproduce cross-customer access')

  await db.exec(migration)
  for (const table of ['transaction_ledger_blocked_attempts', 'wallet_security_events']) {
    assert.equal((await readAs(ids.admin, `SELECT id FROM public.${table}`)).length, 1,
      `${table}: active admin must retain access`)
    assert.equal((await readAs(ids.suspended, `SELECT id FROM public.${table}`)).length, 0,
      `${table}: suspended admin must lose cross-customer access`)
    assert.equal((await readAs(ids.customer, `SELECT id FROM public.${table}`)).length, 0,
      `${table}: customer must remain denied`)
  }
  assert.equal((await readAs(ids.admin, 'SELECT id FROM public.sms_orders')).length, 2)
  assert.deepEqual(await readAs(ids.suspended, 'SELECT id FROM public.sms_orders ORDER BY id'), [{ id: 2 }],
    'suspended admin retains only their own SMS history')
  assert.deepEqual(await readAs(ids.customer, 'SELECT id FROM public.sms_orders ORDER BY id'), [{ id: 1 }],
    'customer retains own SMS history')

  assert.deepEqual(await readAs(ids.suspended,
    'UPDATE public.admin_alerts SET acknowledged = true WHERE id = 1 RETURNING id'),
  [{ id: 1 }], 'old alert policies must reproduce suspended-admin acknowledgement')
  await db.query('UPDATE public.admin_alerts SET acknowledged = false WHERE id = 1')
  await db.exec(alertMigration)
  assert.deepEqual(await readAs(ids.admin, 'SELECT id FROM public.admin_alerts'), [{ id: 1 }],
    'active admin must retain fraud-alert reads')
  assert.deepEqual(await readAs(ids.admin,
    'UPDATE public.admin_alerts SET acknowledged = true WHERE id = 1 RETURNING id'),
  [{ id: 1 }], 'active admin must retain acknowledgement')
  await db.query('UPDATE public.admin_alerts SET acknowledged = false WHERE id = 1')
  for (const userId of [ids.suspended, ids.customer]) {
    assert.deepEqual(await readAs(userId, 'SELECT id FROM public.admin_alerts'), [],
      'inactive or non-admin actor must not read fraud alerts despite permissive legacy policy')
    assert.deepEqual(await readAs(userId,
      'UPDATE public.admin_alerts SET acknowledged = true WHERE id = 1 RETURNING id'), [],
    'inactive or non-admin actor must not acknowledge alerts despite permissive legacy policy')
  }

  await db.exec(forensicMigration)
  for (const [table] of forensicPolicies) {
    assert.equal((await readAs(ids.admin, `SELECT id FROM public.${table}`)).length, 1,
      `${table}: active admin must retain forensic access`)
    for (const userId of [ids.suspended, ids.customer]) {
      assert.equal((await readAs(userId, `SELECT id FROM public.${table}`)).length, 0,
        `${table}: restrictive policy must deny inactive/non-admin reads`)
    }
  }

  for (const table of ['site_visits', 'revenue_identity_links']) {
    assert.equal((await readAs(ids.suspended, `SELECT id FROM public.${table}`)).length, 1,
      `${table}: old policy must reproduce suspended-admin telemetry reads`)
  }
  await db.exec(telemetryMigration)
  assert.equal((await readAs(ids.admin, 'SELECT id FROM public.site_visits')).length, 1)
  assert.equal((await readAs(ids.suspended, 'SELECT id FROM public.site_visits')).length, 0)
  assert.equal((await readAs(ids.customer, 'SELECT id FROM public.site_visits')).length, 0)
  assert.equal((await readAs(ids.admin, 'SELECT id FROM public.revenue_identity_links')).length, 1)
  assert.equal((await readAs(ids.suspended, 'SELECT id FROM public.revenue_identity_links')).length, 0)
  assert.deepEqual(await readAs(ids.customer,
    'SELECT id FROM public.revenue_identity_links ORDER BY id'), [{ id: 1 }],
    'customer may read only their own identity link')
  assert.deepEqual(await readAs(ids.customer,
    `INSERT INTO public.revenue_identity_links(id, user_id) VALUES (2, '${ids.customer}') RETURNING id`),
  [{ id: 2 }], 'customer self-link write must remain available')
} finally {
  await db.close()
}

console.log('Suspended admin loses financial audit, alerts, forensic, and telemetry reads.')
