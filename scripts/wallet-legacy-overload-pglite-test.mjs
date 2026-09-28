import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924020000_revoke_legacy_balance_rpc_overloads.sql', import.meta.url), 'utf8')

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE FUNCTION public.update_wallet_balance(integer)
      RETURNS integer LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE FUNCTION public.update_wallet_balance(integer, integer)
      RETURNS integer LANGUAGE sql AS $$ SELECT $1 + $2 $$;
    CREATE FUNCTION public.transfer_crypto_to_wallet(integer, numeric)
      RETURNS numeric LANGUAGE sql AS $$ SELECT $2 $$;
    CREATE FUNCTION public.get_public_customer_order_count()
      RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    GRANT EXECUTE ON FUNCTION public.update_wallet_balance(integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.update_wallet_balance(integer, integer) TO service_role;
  `)

  const before = await db.query(`
    SELECT has_function_privilege('authenticated',
      'public.update_wallet_balance(integer,integer)', 'EXECUTE') AS old_overload_callable
  `)
  assert.equal(before.rows[0].old_overload_callable, true)

  await db.exec(migration)
  const rows = await db.query(`
    SELECT p.oid::regprocedure::text AS signature,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS customer_can_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('update_wallet_balance', 'transfer_crypto_to_wallet',
       'get_public_customer_order_count')
    ORDER BY signature
  `)
  for (const row of rows.rows) {
    if (row.signature.includes('get_public_customer_order_count')) {
      assert.equal(row.customer_can_execute, true)
    } else {
      assert.equal(row.anon_can_execute, false, row.signature)
      assert.equal(row.customer_can_execute, false, row.signature)
    }
  }
  assert.equal(rows.rows.length, 4)
  await db.exec('SET ROLE authenticated')
  await assert.rejects(
    () => db.query('SELECT public.update_wallet_balance(1, 2)'),
    (error) => error.code === '42501',
  )
  await db.exec('RESET ROLE')
  console.log('Every legacy balance-RPC overload rejects browser execution.')
} finally {
  await db.close()
}
