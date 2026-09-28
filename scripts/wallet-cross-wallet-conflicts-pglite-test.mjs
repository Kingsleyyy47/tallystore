import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924029000_admin_cross_wallet_payment_conflicts.sql', import.meta.url), 'utf8')
const referenceMigration = readFileSync(new URL('../supabase/migrations/20260925004000_show_cross_wallet_gateway_reference_conflicts.sql', import.meta.url), 'utf8')
const ownerQueries = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const adminId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const walletA = '33333333-3333-4333-8333-333333333333'
const walletB = '44444444-4444-4444-8444-444444444444'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_admin boolean NOT NULL);
    CREATE TABLE public.transactions (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid NOT NULL, external_payment_id text, reference text,
      metadata jsonb DEFAULT '{}'::jsonb, balance_type text, type text,
      status text DEFAULT 'completed', created_at timestamptz DEFAULT '2026-09-20 00:00:00+00'
    );
    INSERT INTO public.profiles VALUES
      ('${adminId}', true), ('${otherId}', false);
    INSERT INTO public.transactions (user_id, external_payment_id, balance_type, type)
    SELECT CASE WHEN side = 1 THEN '${walletA}'::uuid ELSE '${walletB}'::uuid END,
      'provider-' || lpad(identity_number::text, 3, '0'), 'wallet', 'topup'
    FROM generate_series(1, 201) AS identity_number
    CROSS JOIN generate_series(1, 2) AS side;
    INSERT INTO public.transactions (user_id, external_payment_id, balance_type, type)
    VALUES
      ('${walletA}', 'same-wallet-only', 'wallet', 'topup'),
      ('${walletA}', 'same-wallet-only', 'wallet', 'topup'),
      ('${walletA}', 'purchase-only', 'wallet', 'purchase'),
      ('${walletB}', 'purchase-only', 'wallet', 'purchase');
    INSERT INTO public.transactions
      (user_id, external_payment_id, reference, metadata, balance_type, type)
    VALUES
      ('${walletA}', 'alias-one', 'shared-reference', '{"provider":"pocketfi"}', 'wallet', 'topup'),
      ('${walletB}', 'alias-two', 'shared-reference', '{"provider":"pocketfi"}', 'wallet', 'topup'),
      ('${walletA}', 'cross-field-reference', 'unique-a', '{"provider":"pocketfi"}', 'wallet', 'topup'),
      ('${walletB}', 'unique-b', 'cross-field-reference', '{"provider":"pocketfi"}', 'wallet', 'topup');
  `)
  await db.exec(migration)
  await db.exec(referenceMigration)

  const privileges = await db.query(`
    SELECT has_function_privilege('anon',
        'public.get_admin_cross_wallet_payment_conflicts_page(text,integer)', 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',
        'public.get_admin_cross_wallet_payment_conflicts_page(text,integer)', 'EXECUTE') AS authenticated_execute,
      has_table_privilege('authenticated', 'public.transactions', 'SELECT') AS direct_history_read
  `)
  assert.deepEqual(privileges.rows[0], {
    anon_execute: false, authenticated_execute: true, direct_history_read: false,
  })

  await db.exec('SET ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${otherId}', false)`)
  await assert.rejects(
    () => db.query('SELECT * FROM public.get_admin_cross_wallet_payment_conflicts_page()'),
    (error) => error.code === '42501',
  )
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false)`)

  const first = await db.query('SELECT * FROM public.get_admin_cross_wallet_payment_conflicts_page(NULL, 100)')
  assert.equal(first.rows.length, 100)
  assert.equal(first.rows[0].payment_identity, 'provider-001')
  assert.deepEqual(first.rows[0].wallet_ids.sort(), [walletA, walletB].sort())
  assert.equal(Number(first.rows[0].funding_rows), 2)

  const second = await db.query(
    'SELECT * FROM public.get_admin_cross_wallet_payment_conflicts_page($1, 100)',
    [first.rows.at(-1).payment_identity],
  )
  const third = await db.query(
    'SELECT * FROM public.get_admin_cross_wallet_payment_conflicts_page($1, 100)',
    [second.rows.at(-1).payment_identity],
  )
  assert.equal(second.rows.length, 100)
  assert.equal(third.rows.length, 3)
  assert.equal(third.rows[0].payment_identity, 'provider-201')
  assert.equal(third.rows[1].payment_identity, 'reference:pocketfi:cross-field-reference')
  assert.deepEqual(third.rows[1].wallet_ids.sort(), [walletA, walletB].sort())
  assert.equal(third.rows[2].payment_identity, 'reference:pocketfi:shared-reference')
  assert.deepEqual(third.rows[2].wallet_ids.sort(), [walletA, walletB].sort())

  const last = await db.query(
    'SELECT * FROM public.get_admin_cross_wallet_payment_conflicts_page($1, 100)',
    [third.rows[2].payment_identity],
  )
  assert.equal(last.rows.length, 0)
  await db.exec('RESET ROLE')

  const query35 = ownerQueries.slice(
    ownerQueries.indexOf('-- 35. Cross-wallet external payment identity review.'),
    ownerQueries.indexOf('-- 36. Canonical gateway evidence deployment'),
  )
  assert.match(query35, /^-- 35\./)
  const ownerResult = await db.exec(query35)
  assert.equal(ownerResult.length, 2)
  assert.equal(Number(ownerResult[1].rows[0].cross_wallet_payment_identities), 201)

  const query43 = ownerQueries.slice(
    ownerQueries.indexOf('-- 43. Before migration'),
    ownerQueries.indexOf('\n\nselect\n  strpos(', ownerQueries.indexOf('-- 43. Before migration')),
  )
  assert.match(query43, /^-- 43\./)
  const referenceAudit = await db.exec(query43)
  assert.deepEqual(referenceAudit[0].rows.map((row) => row.payment_reference), [
    'cross-field-reference', 'shared-reference',
  ])

  console.log('Admin cross-wallet payment conflicts paginate full history without browser ledger reads.')
} finally {
  await db.close()
}
