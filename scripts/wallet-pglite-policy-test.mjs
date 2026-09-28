import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')

async function denied(sql, params = []) {
  let rejected = false
  try {
    await db.query(sql, params)
  } catch (error) {
    rejected = error.code === '42501'
    if (!rejected) throw error
  }
  assert(rejected, `Expected permission/RLS denial: ${sql.split('\n')[0]}`)
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_staff boolean DEFAULT false, is_admin boolean DEFAULT false
    );
    CREATE TABLE public.app_settings (key text PRIMARY KEY, value text);
    CREATE TABLE public.site_visits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visitor_id text NOT NULL,
      user_id uuid,
      path text NOT NULL,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      ip_address text,
      ip_source text,
      ip_country text,
      ip_region text,
      ip_city text,
      ip_isp text
    );
    CREATE TABLE public.cro_outcomes (id integer GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE public.cro_interventions (id integer GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE public.cro_decision_audit (
      decision_id text PRIMARY KEY, user_id uuid, surface text,
      selected_action text, metadata jsonb, guardrails jsonb
    );
    CREATE TABLE public.chat_sessions (id integer GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE public.chat_interventions (id integer GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE public.admin_alerts (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      alert_type text NOT NULL, severity text NOT NULL, message text NOT NULL,
      acknowledged boolean DEFAULT false, acknowledged_at timestamptz,
      acknowledged_by uuid, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.revenue_events (
      event_id text PRIMARY KEY, event_type text NOT NULL, user_id uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON public.app_settings, public.site_visits,
      public.cro_outcomes, public.cro_interventions,
      public.cro_decision_audit,
      public.chat_sessions, public.chat_interventions,
      public.revenue_events, public.admin_alerts TO anon, authenticated, service_role;
    GRANT SELECT ON public.profiles TO anon, authenticated;
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cro_outcomes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cro_interventions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cro_decision_audit ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_interventions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anyone can read app settings"
      ON public.app_settings FOR SELECT USING (true);
    CREATE POLICY "Anyone can insert site visits"
      ON public.site_visits FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can select own cro outcomes"
      ON public.cro_outcomes FOR SELECT USING (true);
    CREATE POLICY "Clients can insert own cro outcomes"
      ON public.cro_outcomes FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can read own cro interventions"
      ON public.cro_interventions FOR SELECT USING (true);
    CREATE POLICY "Clients can insert own cro interventions"
      ON public.cro_interventions FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can update own cro interventions"
      ON public.cro_interventions FOR UPDATE USING (true) WITH CHECK (true);
    CREATE POLICY "Anyone can record cro decisions"
      ON public.cro_decision_audit FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can select chat sessions"
      ON public.chat_sessions FOR SELECT USING (true);
    CREATE POLICY "Clients can insert chat sessions"
      ON public.chat_sessions FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can update chat sessions"
      ON public.chat_sessions FOR UPDATE USING (true) WITH CHECK (true);
    CREATE POLICY "Clients can select own chat interventions"
      ON public.chat_interventions FOR SELECT USING (true);
    CREATE POLICY "Clients can insert chat interventions"
      ON public.chat_interventions FOR INSERT WITH CHECK (true);
    CREATE POLICY "Clients can select own revenue events"
      ON public.revenue_events FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);
    CREATE POLICY "Admins can view all alerts" ON public.admin_alerts
      FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin)
      );
    CREATE POLICY "Admins can update alerts" ON public.admin_alerts
      FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin)
      );
    CREATE POLICY "Service role can insert alerts" ON public.admin_alerts
      FOR INSERT TO service_role WITH CHECK (true);
    CREATE POLICY "Allow insert via service role" ON public.admin_alerts
      FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Clients can update non-financial revenue events"
      ON public.revenue_events FOR UPDATE USING (true) WITH CHECK (true);
    CREATE POLICY "Clients can record non-financial revenue events"
      ON public.revenue_events FOR INSERT WITH CHECK (event_type <> 'PAYMENT_COMPLETED');
    INSERT INTO public.app_settings(key, value) VALUES
      ('ngn_usd_rate', '1500'), ('private_provider_secret', 'fixture-only');
    INSERT INTO public.profiles(id, is_admin) VALUES
      ('11111111-1111-4111-8111-111111111111', false),
      ('33333333-3333-4333-8333-333333333333', true);
    INSERT INTO auth.users(id) VALUES
      ('11111111-1111-4111-8111-111111111111'),
      ('33333333-3333-4333-8333-333333333333');
    INSERT INTO public.revenue_events(event_id, event_type, user_id) VALUES
      ('private-anonymous-event', 'PAGE_VIEWED', NULL),
      ('own-event', 'PAGE_VIEWED', '11111111-1111-4111-8111-111111111111'),
      ('other-event', 'PAGE_VIEWED', '22222222-2222-4222-8222-222222222222');
  `)

  await db.exec(migration('20260820001000_create_site_visits.sql'))
  await db.exec(migration('20260924002000_restrict_site_visit_fraud_evidence.sql'))
  await db.exec(migration('20260924003000_restrict_public_app_settings.sql'))

  await db.query('SET ROLE anon')
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.app_settings WHERE key = 'private_provider_secret'")).rows[0].n, 0)
  await db.query('RESET ROLE')

  await db.exec(`
    CREATE POLICY "Anyone can read app settings"
      ON public.app_settings FOR SELECT USING (true);
    CREATE POLICY "Anyone can insert site visits"
      ON public.site_visits FOR INSERT WITH CHECK (true);
  `)
  await db.query('SET ROLE anon')
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.app_settings WHERE key = 'private_provider_secret'")).rows[0].n, 1)
  await db.query('RESET ROLE')

  await db.exec(migration('20260924013000_close_manual_sql_editor_rls_reopens.sql'))
  await db.query('SET ROLE anon')
  assert.equal((await db.query('SELECT value FROM public.app_settings WHERE key = $1', ['ngn_usd_rate'])).rows[0].value, '1500')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_settings WHERE key = $1', ['private_provider_secret'])).rows[0].n, 0)
  await denied('SELECT * FROM public.chat_sessions')
  await denied('SELECT * FROM public.cro_outcomes')
  await denied('SELECT * FROM public.cro_interventions')
  await denied("INSERT INTO public.revenue_events(event_id, event_type, user_id) VALUES ('forged', 'PAGE_VIEWED', '22222222-2222-4222-8222-222222222222')")
  await db.query("INSERT INTO public.revenue_events(event_id, event_type) VALUES ('anon-behavior', 'PAGE_VIEWED')")
  await db.query('RESET ROLE')

  await db.query('SET ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)")
  assert.deepEqual((await db.query('SELECT event_id FROM public.revenue_events ORDER BY event_id')).rows.map((row) => row.event_id), ['own-event'])
  await denied("INSERT INTO public.revenue_events(event_id, event_type, user_id) VALUES ('forged-auth', 'PAGE_VIEWED', '22222222-2222-4222-8222-222222222222')")
  await denied("INSERT INTO public.revenue_events(event_id, event_type, user_id) VALUES ('forged-financial', 'PAYMENT_COMPLETED', '11111111-1111-4111-8111-111111111111')")
  await denied("UPDATE public.revenue_events SET event_type = 'SEARCHED' WHERE event_id = 'own-event'")
  await db.query("INSERT INTO public.revenue_events(event_id, event_type, user_id) VALUES ('own-behavior', 'PAGE_VIEWED', '11111111-1111-4111-8111-111111111111')")
  await db.query('RESET ROLE')

  await db.query('SET ROLE anon')
  await db.query(`INSERT INTO public.cro_decision_audit
    (decision_id, user_id, surface, selected_action, metadata, guardrails)
    VALUES ('forged-before-fix', '22222222-2222-4222-8222-222222222222',
      'fixture', 'DO_NOTHING', '{"client_observed":true}', '{}')`)
  await db.query('RESET ROLE')

  await db.exec(migration('20260924014000_bind_browser_cro_decision_evidence.sql'))
  await db.query('SET ROLE anon')
  await denied(`INSERT INTO public.cro_decision_audit
    (decision_id, user_id, surface, selected_action, metadata, guardrails)
    VALUES ('forged-after-fix', '22222222-2222-4222-8222-222222222222',
      'fixture', 'DO_NOTHING', '{"client_observed":true}', '{}')`)
  await db.query('RESET ROLE')
  await db.query('SET ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)")
  await denied(`INSERT INTO public.cro_decision_audit
    (decision_id, user_id, surface, selected_action, metadata, guardrails)
    VALUES ('forged-other-user', '22222222-2222-4222-8222-222222222222',
      'fixture', 'DO_NOTHING', '{"client_observed":true}', '{}')`)
  await denied(`INSERT INTO public.cro_decision_audit
    (decision_id, user_id, surface, selected_action, metadata, guardrails)
    VALUES ('forged-authority', '11111111-1111-4111-8111-111111111111',
      'fixture', 'DO_NOTHING', '{"client_observed":true,"authoritative":true}', '{}')`)
  await db.query(`INSERT INTO public.cro_decision_audit
    (decision_id, user_id, surface, selected_action, metadata, guardrails)
    VALUES ('own-observation', '11111111-1111-4111-8111-111111111111',
      'fixture', 'DO_NOTHING', '{"client_observed":true,"authoritative":false}',
      '{"server_authoritative":false}')`)
  await db.query('RESET ROLE')

  await db.query('SET ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)")
  await db.query(`INSERT INTO public.admin_alerts(alert_type, severity, message)
    VALUES ('security', 'critical', 'forged-browser-alert')`)
  await db.query('RESET ROLE')
  await db.exec(migration('20260924015000_restrict_admin_alert_inserts.sql'))
  await db.query('SET ROLE authenticated')
  await denied(`INSERT INTO public.admin_alerts(alert_type, severity, message)
    VALUES ('security', 'critical', 'forged-after-fix')`)
  await db.query("SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false)")
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.admin_alerts')).rows[0].n, 1)
  await db.query("UPDATE public.admin_alerts SET message = 'silenced-browser-alert' WHERE message = 'forged-browser-alert'")
  await db.query('RESET ROLE')
  await db.exec(migration('20260925012000_restrict_admin_alert_acknowledgement.sql'))
  assert.equal((await db.query("SELECT has_table_privilege('authenticated', 'public.admin_alerts', 'UPDATE') AS writable")).rows[0].writable, false)
  assert.equal((await db.query("SELECT has_column_privilege('authenticated', 'public.admin_alerts', 'acknowledged', 'UPDATE') AS writable")).rows[0].writable, true)
  assert.equal((await db.query("SELECT has_column_privilege('authenticated', 'public.admin_alerts', 'message', 'UPDATE') AS writable")).rows[0].writable, false)
  await db.query('SET ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)")
  assert.equal((await db.query("UPDATE public.admin_alerts SET acknowledged = true WHERE message = 'silenced-browser-alert' RETURNING id")).rows.length, 0)
  await db.query("SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false)")
  await denied("UPDATE public.admin_alerts SET message = 'rewritten' WHERE message = 'silenced-browser-alert'")
  await db.query("UPDATE public.admin_alerts SET acknowledged = true WHERE message = 'silenced-browser-alert'")
  const acknowledgedAlert = (await db.query("SELECT acknowledged, acknowledged_at, acknowledged_by FROM public.admin_alerts WHERE message = 'silenced-browser-alert'")).rows[0]
  assert.equal(acknowledgedAlert.acknowledged, true)
  assert(acknowledgedAlert.acknowledged_at)
  assert.equal(acknowledgedAlert.acknowledged_by, '33333333-3333-4333-8333-333333333333')
  await denied("UPDATE public.admin_alerts SET acknowledged = false WHERE message = 'silenced-browser-alert'")
  await db.query('RESET ROLE')
  await db.query('SET ROLE anon')
  await denied("UPDATE public.admin_alerts SET acknowledged = true WHERE message = 'silenced-browser-alert'")
  await db.query('RESET ROLE')
  await db.query('SET ROLE service_role')
  await db.query(`INSERT INTO public.admin_alerts(alert_type, severity, message)
    VALUES ('security', 'critical', 'service-alert')`)
  await db.query("UPDATE public.admin_alerts SET message = 'service-resolution' WHERE message = 'service-alert'")
  await db.query('RESET ROLE')

  await db.exec(`
    INSERT INTO public.site_visits(visitor_id, user_id, path, ip_address, ip_source, user_agent)
    VALUES ('fixture-visitor', '11111111-1111-4111-8111-111111111111', '/', '192.0.2.7', 'edge', 'fixture-agent');
  `)
  await db.exec(migration('20260924010000_admin_fraud_visit_telemetry.sql'))
  await db.query('SET ROLE anon')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.site_visits')).rows[0].n, 0)
  await denied("SELECT * FROM public.get_admin_fraud_latest_visits(ARRAY['11111111-1111-4111-8111-111111111111']::uuid[])")
  await db.query('RESET ROLE')
  await db.query('SET ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)")
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.site_visits')).rows[0].n, 0)
  await denied("SELECT * FROM public.get_admin_fraud_latest_visits(ARRAY['11111111-1111-4111-8111-111111111111']::uuid[])")
  await db.query("SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false)")
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.site_visits')).rows[0].n, 1)
  const visits = await db.query("SELECT user_id, ip_address FROM public.get_admin_fraud_latest_visits(ARRAY['11111111-1111-4111-8111-111111111111']::uuid[])")
  assert.deepEqual(visits.rows, [{ user_id: '11111111-1111-4111-8111-111111111111', ip_address: '192.0.2.7' }])
  await assert.rejects(
    () => db.query("SELECT * FROM public.get_admin_fraud_latest_visits(ARRAY(SELECT '11111111-1111-4111-8111-111111111111'::uuid FROM generate_series(1, 101)))"),
    (error) => error.code === '22023',
  )
  await db.query('RESET ROLE')

  const refundSql = migration('20260924012000_refund_link_precedence_in_financial_truth.sql')
  const patchStart = refundSql.indexOf('DO $patch$')
  assert(patchStart > 0, 'refund-link migration patch boundary missing')
  await db.exec(refundSql.slice(0, patchStart))
  const debitId = '33333333-3333-4333-8333-333333333333'
  const match = async (metadata) => (await db.query(
    'SELECT public.wallet_refund_links_debit($1::jsonb, $2::uuid, $3::text, $4::jsonb, $5::text) AS ok',
    [JSON.stringify(metadata), debitId, 'purchase-key', JSON.stringify({ source_order_id: 'order-1' }), 'purchase-ref'],
  )).rows[0].ok
  assert.equal(await match({ source_debit_transaction_id: debitId, source_debit_idempotency_key: 'wrong-key' }), true)
  assert.equal(await match({ source_debit_transaction_id: '44444444-4444-4444-8444-444444444444', source_debit_idempotency_key: 'purchase-key' }), false)
  assert.equal(await match({ source_debit_idempotency_key: 'wrong-key', source_order_id: 'order-1' }), false)
  assert.equal(await match({ source_debit_idempotency_key: 'purchase-key' }), true)
  assert.equal(await match({ source_order_id: 'order-1' }), true)
  assert.equal(await match({ original_reference: 'purchase-ref' }), true)
  assert.equal(await match({}), false)

  await db.exec(`
    CREATE TABLE public.transactions (
      id uuid PRIMARY KEY, user_id uuid, amount numeric, metadata jsonb,
      idempotency_key text, reference text
    );
    CREATE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql AS $body$
    DECLARE v_count integer;
    BEGIN
      WITH classified AS (
        SELECT t.*, t.amount > 0 AS is_refund FROM public.transactions t
      ), debits AS (
        SELECT * FROM public.transactions
      )
      SELECT count(*) INTO v_count
      FROM classified r JOIN debits d ON d.user_id = r.user_id
      AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
      AND (
        NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text
      )
    WHERE r.is_refund AND r.amount > 0;
      RETURN jsonb_build_object('matches', v_count);
    END;
    $body$;
    CREATE FUNCTION public.apply_wallet_transaction(
      p_user_id uuid, p_type text, p_amount numeric, p_reference text,
      p_description text, p_idempotency_key text, p_metadata jsonb,
      p_currency text, p_balance_type text, p_external_payment_id text,
      p_created_by uuid
    ) RETURNS jsonb LANGUAGE plpgsql AS $body$
    DECLARE
      v_original_debit public.transactions%ROWTYPE;
      v_original_debit_id uuid;
      v_refunded_against_original numeric;
    BEGIN
      SELECT * INTO v_original_debit FROM public.transactions t
      WHERE t.user_id = p_user_id
      AND (
        (v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id)
      )
    ORDER BY t.id LIMIT 1;
      SELECT COALESCE(SUM(amount), 0) INTO v_refunded_against_original
      FROM public.transactions r WHERE r.user_id = p_user_id
      AND (
        NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = v_original_debit.id::text
      );
      RETURN jsonb_build_object('refunded', v_refunded_against_original);
    END;
    $body$;
    CREATE FUNCTION public.guard_trusted_principal_transaction()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE
      v_original_debit public.transactions%ROWTYPE;
      v_original_debit_id uuid;
      v_refunded_against_original numeric;
    BEGIN
      SELECT * INTO v_original_debit FROM public.transactions t
      WHERE t.user_id = NEW.user_id
      AND (
        (v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id)
      )
    ORDER BY t.id LIMIT 1;
      SELECT COALESCE(SUM(amount), 0) INTO v_refunded_against_original
      FROM public.transactions r WHERE r.user_id = NEW.user_id
      AND (
        NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = v_original_debit.id::text
      );
      RETURN NEW;
    END;
    $body$;
  `)
  await db.exec(refundSql)
  for (const signature of [
    'public.wallet_financial_truth_internal(uuid)',
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)',
    'public.guard_trusted_principal_transaction()',
  ]) {
    const definition = (await db.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS definition', [signature])).rows[0].definition
    assert.equal((definition.match(/public\.wallet_refund_links_debit\(/g) || []).length,
      signature.includes('wallet_financial_truth_internal') ? 1 : 2)
  }

  console.log('PGlite RLS, admin fraud telemetry, and refund-link migration tests passed (isolated fixture, not Supabase staging).')
} finally {
  await db.close()
}
