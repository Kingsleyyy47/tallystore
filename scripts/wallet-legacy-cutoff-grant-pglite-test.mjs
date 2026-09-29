import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(
  new URL('../supabase/migrations/20260929000000_allow_protected_legacy_cutoff_callers.sql', import.meta.url),
  'utf8',
)

try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE history_owner;
    CREATE ROLE truth_owner;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT '11111111-1111-4111-8111-111111111111'::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE public.categories (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.product_groups (
      id uuid PRIMARY KEY, name text, price numeric, category_id uuid
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY, user_id uuid, product_group_id uuid,
      amount numeric, status text, created_at timestamptz,
      financial_authorization_status text, account_details jsonb
    );
    INSERT INTO public.orders VALUES (
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111', null,
      100, 'completed', '2026-09-18 00:00:00+00', null,
      '{"product_name":"Fixture","secret":"existing customer secret"}'::jsonb
    );
    INSERT INTO public.orders VALUES (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111', null,
      100, 'completed', '2026-09-20 00:00:00+00', null,
      '{"product_name":"Pending","secret":"uncommitted secret"}'::jsonb
    );
    INSERT INTO public.orders VALUES (
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555', null,
      100, 'completed', '2026-09-18 00:00:00+00', null,
      '{"product_name":"Other customer","secret":"private"}'::jsonb
    );
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    REVOKE ALL ON FUNCTION public.wallet_legacy_funding_cutoff() FROM PUBLIC, authenticated;
    GRANT EXECUTE ON FUNCTION public.wallet_legacy_funding_cutoff() TO service_role;
    CREATE VIEW public.orders_safe_history AS
      SELECT o.id, o.user_id, o.product_group_id, o.amount, o.status, o.created_at,
        CASE WHEN o.user_id = (SELECT auth.uid())
          AND lower(COALESCE(o.status, '')) = 'completed'
          AND (o.created_at < public.wallet_legacy_funding_cutoff()
            OR o.financial_authorization_status = 'captured')
          THEN o.account_details ELSE jsonb_build_object(
            'product_name', o.account_details->>'product_name') END AS account_details,
        CASE WHEN pg.id IS NULL THEN NULL ELSE jsonb_build_object(
          'name', pg.name, 'price', pg.price, 'category_id', pg.category_id,
          'categories', CASE WHEN c.id IS NULL THEN NULL
            ELSE jsonb_build_object('name', c.name) END
        ) END AS product_groups
      FROM public.orders o
      LEFT JOIN public.product_groups pg ON pg.id = o.product_group_id
      LEFT JOIN public.categories c ON c.id = pg.category_id
      WHERE o.user_id = (SELECT auth.uid()) OR public.is_admin_profile();
    ALTER VIEW public.orders_safe_history SET (security_invoker = false, security_barrier = true);
    REVOKE ALL ON public.orders_safe_history FROM PUBLIC;
    GRANT SELECT ON public.orders_safe_history TO authenticated;
    CREATE FUNCTION public.wallet_financial_truth_internal(uuid) RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
        SELECT pg_catalog.jsonb_build_object('cutoff', public.wallet_legacy_funding_cutoff())
      $$;
    ALTER FUNCTION public.wallet_financial_truth_internal(uuid) OWNER TO truth_owner;
    GRANT EXECUTE ON FUNCTION public.wallet_financial_truth_internal(uuid) TO service_role;
  `)

  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT * FROM public.orders_safe_history'), /permission denied for function wallet_legacy_funding_cutoff/i)
  await db.exec('RESET ROLE')

  await db.exec(migration)
  await db.exec(migration)

  await db.exec('SET ROLE authenticated')
  const history = await db.query('SELECT account_details FROM public.orders_safe_history ORDER BY created_at')
  assert.equal(history.rows.length, 2)
  assert.equal(history.rows[0].account_details.secret, 'existing customer secret')
  assert.equal(history.rows[1].account_details.secret, undefined)
  await assert.rejects(db.query('SELECT public.wallet_legacy_funding_cutoff()'), /permission denied for function wallet_legacy_funding_cutoff/i)
  await db.exec('RESET ROLE')

  await db.exec('SET ROLE service_role')
  const truth = await db.query("SELECT public.wallet_financial_truth_internal('11111111-1111-4111-8111-111111111111') AS result")
  assert.ok(truth.rows[0].result.cutoff)
  await db.exec('RESET ROLE')

  process.stdout.write('protected cutoff callers can read; authenticated cannot execute cutoff directly\n')
} finally {
  await db.close()
}
