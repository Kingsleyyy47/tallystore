import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const tableOnlyMigration = readFileSync(new URL('../supabase/migrations/20260919008000_harden_partner_table_authority.sql', import.meta.url), 'utf8')
const fullMigration = readFileSync(new URL('../supabase/migrations/20260924028000_close_partner_inherited_grants.sql', import.meta.url), 'utf8')
const ownerQueries = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const tables = [
  'api_partners', 'api_partner_keys', 'api_partner_orders',
  'api_partner_logs', 'api_partner_customers',
  'api_partner_webhook_deliveries',
]

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `)
  for (const table of tables) {
    await db.exec(`
      CREATE TABLE public.${table} (id integer PRIMARY KEY, secret text);
      GRANT ALL ON TABLE public.${table} TO PUBLIC;
      GRANT ALL ON TABLE public.${table} TO service_role;
      GRANT SELECT (secret), UPDATE (secret) ON TABLE public.${table} TO PUBLIC;
    `)
  }

  await db.exec(tableOnlyMigration)
  const oldGrant = await db.query(`
    SELECT has_table_privilege('authenticated', 'public.api_partner_keys', 'SELECT') AS can_read,
      has_column_privilege('anon', 'public.api_partner_keys', 'secret', 'UPDATE') AS can_write_secret
  `)
  assert.deepEqual(oldGrant.rows[0], { can_read: true, can_write_secret: true })

  await db.exec(fullMigration)
  for (const table of tables) {
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query(`
        SELECT has_table_privilege('${role}', 'public.${table}', 'SELECT') AS can_read,
          has_table_privilege('${role}', 'public.${table}', 'INSERT') AS can_insert,
          has_table_privilege('${role}', 'public.${table}', 'UPDATE') AS can_update,
          has_table_privilege('${role}', 'public.${table}', 'DELETE') AS can_delete,
          has_table_privilege('${role}', 'public.${table}', 'TRUNCATE') AS can_truncate,
          has_column_privilege('${role}', 'public.${table}', 'secret', 'SELECT') AS can_read_secret,
          has_column_privilege('${role}', 'public.${table}', 'secret', 'UPDATE') AS can_update_secret,
          has_table_privilege('service_role', 'public.${table}', 'SELECT') AS service_can_read,
          has_table_privilege('service_role', 'public.${table}', 'UPDATE') AS service_can_update
      `)
      assert.deepEqual(result.rows[0], {
        can_read: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_read_secret: false,
        can_update_secret: false,
        service_can_read: true,
        service_can_update: true,
      }, `${table} as ${role}`)
    }
  }

  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => db.query('SELECT secret FROM public.api_partner_keys'), (error) => error.code === '42501')
  await db.exec('RESET ROLE')

  const query34 = ownerQueries.slice(
    ownerQueries.indexOf('-- 34. Effective partner-table privilege closure.'),
    ownerQueries.indexOf('-- 35. Cross-wallet external payment identity review.'),
  )
  assert.match(query34, /^-- 34\./)
  const deployedGrantShape = await db.query(query34)
  assert.equal(deployedGrantShape.rows.length, tables.length * 2)
  for (const row of deployedGrantShape.rows) {
    assert.equal(Number(row.accessible_columns), 0, `${row.table_name} as ${row.role_name}`)
    for (const field of [
      'table_select', 'table_insert', 'table_update', 'table_delete',
      'table_truncate', 'table_references', 'table_trigger',
    ]) assert.equal(row[field], false, `${row.table_name} ${row.role_name} ${field}`)
  }

  console.log('Partner tables deny inherited/column browser access and retain server access.')
} finally {
  await db.close()
}
