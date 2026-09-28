import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924018000_restrict_pocketfi_payment_evidence.sql', import.meta.url), 'utf8')

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.pocketfi_webhook_logs (id integer PRIMARY KEY);
    INSERT INTO public.pocketfi_webhook_logs VALUES (1);
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON public.pocketfi_webhook_logs TO anon, authenticated, service_role;
    ALTER TABLE public.pocketfi_webhook_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY deny_browser_rows ON public.pocketfi_webhook_logs
      TO anon, authenticated USING (false) WITH CHECK (false);
    REVOKE SELECT, INSERT, UPDATE, DELETE ON public.pocketfi_webhook_logs
      FROM anon, authenticated;
  `)

  const before = await db.query(`
    SELECT has_table_privilege('authenticated', 'public.pocketfi_webhook_logs', 'TRUNCATE') AS can_truncate
  `)
  assert.equal(before.rows[0].can_truncate, true)

  await db.exec(migration)
  const after = await db.query(`
    SELECT
      has_table_privilege('anon', 'public.pocketfi_webhook_logs', 'TRUNCATE') AS anon_truncate,
      has_table_privilege('authenticated', 'public.pocketfi_webhook_logs', 'TRUNCATE') AS auth_truncate,
      has_table_privilege('authenticated', 'public.pocketfi_webhook_logs', 'REFERENCES') AS auth_references,
      has_table_privilege('service_role', 'public.pocketfi_webhook_logs', 'INSERT') AS service_insert
  `)
  assert.deepEqual(after.rows[0], {
    anon_truncate: false,
    auth_truncate: false,
    auth_references: false,
    service_insert: true,
  })

  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => db.exec('TRUNCATE public.pocketfi_webhook_logs'), (error) => error.code === '42501')
  await db.exec('RESET ROLE')
  const intact = await db.query('SELECT count(*)::integer AS rows FROM public.pocketfi_webhook_logs')
  assert.equal(intact.rows[0].rows, 1)
  console.log('PocketFi payment evidence rejects browser TRUNCATE after migration.')
} finally {
  await db.close()
}
