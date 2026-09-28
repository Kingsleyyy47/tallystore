import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL(
  '../supabase/migrations/20260925017000_recheck_suspended_admin_rpcs.sql', import.meta.url,
), 'utf8')
const ids = {
  active: '11111111-1111-4111-8111-111111111111',
  suspended: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
}
const functions = [
  ['get_admin_wallet_financial_truth', 'p_user_id uuid', `('${ids.customer}'::uuid)`],
  ['get_admin_wallet_financial_truth_page', 'p_after_user_id uuid, p_limit integer', '(NULL::uuid, 10)'],
  ['get_admin_fraud_latest_visits', 'p_user_ids uuid[]', '(ARRAY[]::uuid[])'],
  ['get_admin_cross_wallet_payment_conflicts_page', 'p_after_payment_identity text, p_limit integer', '(NULL::text, 10)'],
  ['get_admin_smm_services', 'p_query text', '(NULL::text)'],
  ['set_admin_smm_service_active', 'p_service_id bigint, p_platform text, p_is_active boolean', '(NULL::bigint, NULL::text, true)'],
]

async function fixture(unexpectedLast = false) {
  const db = new PGlite()
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
      ('${ids.active}', true, false),
      ('${ids.suspended}', true, true),
      ('${ids.customer}', false, false);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  `)
  for (const [index, [name, args]] of functions.entries()) {
    const predicate = unexpectedLast && index === functions.length - 1
      ? 'WHERE p.id = auth.uid() AND p.is_admin'
      : 'WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)'
    await db.exec(`
      CREATE FUNCTION public.${name}(${args}) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.profiles p
          ${predicate}
        ) THEN
          RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
        END IF;
        RETURN true;
      END;
      $body$;
      REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated;
    `)
  }
  return db
}

async function call(db, userId, name, args) {
  await db.query('SET ROLE authenticated')
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId])
    return await db.query(`SELECT public.${name}${args} AS allowed`)
  } finally {
    await db.query('RESET ROLE')
  }
}

const db = await fixture()
try {
  for (const [name, , args] of functions) {
    assert.equal((await call(db, ids.suspended, name, args)).rows[0].allowed, true,
      `${name}: old function must reproduce suspended-admin access`)
  }

  await db.exec(migration)
  for (const [name, , args] of functions) {
    assert.equal((await call(db, ids.active, name, args)).rows[0].allowed, true,
      `${name}: active administrator must retain access`)
    await assert.rejects(call(db, ids.suspended, name, args), /admin_required/,
      `${name}: suspended administrator must be denied with an old session`)
    await assert.rejects(call(db, ids.customer, name, args), /admin_required/,
      `${name}: ordinary customer must remain denied`)
  }
} finally {
  await db.close()
}

const unexpected = await fixture(true)
try {
  await assert.rejects(unexpected.exec(migration),
    /admin_rpc_suspension_unexpected_definition/,
    'migration must abort on a changed deployed function body')
  assert.equal((await call(unexpected, ids.suspended, functions[0][0], functions[0][2])).rows[0].allowed,
    true, 'aborted migration must not leave partially replaced functions')
} finally {
  await unexpected.close()
}

console.log('Admin financial/investigation RPCs deny suspended old sessions; drift aborts atomically.')
