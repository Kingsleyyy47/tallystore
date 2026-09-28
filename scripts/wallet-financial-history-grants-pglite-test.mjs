import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260924019000_restrict_financial_history_table_privileges.sql', import.meta.url), 'utf8')
const columnMigration = readFileSync(new URL('../supabase/migrations/20260924027000_revoke_financial_history_column_writes.sql', import.meta.url), 'utf8')
const pendingReadMigration = readFileSync(new URL('../supabase/migrations/20260924032000_restrict_pending_payment_browser_reads.sql', import.meta.url), 'utf8')
const staffQueueMigration = readFileSync(new URL('../supabase/migrations/20260925010000_restrict_staff_action_queue.sql', import.meta.url), 'utf8')
const authCascadeMigration = readFileSync(new URL('../supabase/migrations/20260919020000_restrict_auth_user_cascade_evidence.sql', import.meta.url), 'utf8')
const ownerQueries = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const manageStaffSource = readFileSync(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8')
const tables = [
  'transactions', 'pending_payments', 'orders', 'bitrefill_orders',
  'crypto_transactions', 'crypto_withdrawals', 'smm_orders', 'sms_orders',
  'telegram_orders', 'bills_transactions',
]

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.profiles (id integer PRIMARY KEY);
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON TABLE public.profiles TO PUBLIC;
  `)
  for (const table of tables) {
    await db.exec(`
      CREATE TABLE public.${table} (id integer PRIMARY KEY, status text);
      GRANT ALL ON TABLE public.${table} TO PUBLIC;
      GRANT ALL ON TABLE public.${table} TO service_role;
      GRANT INSERT (status), UPDATE (status), REFERENCES (id)
        ON TABLE public.${table} TO PUBLIC;
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY browser_read ON public.${table}
        FOR SELECT TO authenticated USING (true);
    `)
  }
  await db.exec(`
    ALTER TABLE public.pending_payments ADD COLUMN error_message text;
    ALTER TABLE public.pending_payments ADD COLUMN transaction_reference text;
    GRANT SELECT (error_message) ON TABLE public.pending_payments TO PUBLIC;
  `)

  const before = await db.query(`
    SELECT has_table_privilege('authenticated', 'public.transactions', 'TRUNCATE') AS can_truncate
  `)
  assert.equal(before.rows[0].can_truncate, true)

  await db.exec(migration)
  const columnGrantSurvivesTableRevoke = await db.query(`
    SELECT has_column_privilege('authenticated', 'public.sms_orders', 'status', 'UPDATE') AS can_update
  `)
  assert.equal(columnGrantSurvivesTableRevoke.rows[0].can_update, true)

  await db.exec(columnMigration)
  for (const table of tables) {
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query(`
        SELECT
          has_table_privilege('${role}', 'public.${table}', 'SELECT') AS can_read,
          has_table_privilege('${role}', 'public.${table}', 'INSERT') AS can_insert,
          has_table_privilege('${role}', 'public.${table}', 'TRUNCATE') AS can_truncate,
          has_column_privilege('${role}', 'public.${table}', 'status', 'INSERT') AS can_insert_column,
          has_column_privilege('${role}', 'public.${table}', 'status', 'UPDATE') AS can_update_column,
          has_column_privilege('${role}', 'public.${table}', 'id', 'REFERENCES') AS can_reference_column,
          has_table_privilege('service_role', 'public.${table}', 'INSERT') AS service_can_insert
      `)
      assert.deepEqual(result.rows[0], {
        can_read: true,
        can_insert: false,
        can_truncate: false,
        can_insert_column: false,
        can_update_column: false,
        can_reference_column: false,
        service_can_insert: true,
      }, `${table} as ${role}`)
    }
  }

  const profile = await db.query(`
    SELECT
      has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS can_read,
      has_table_privilege('authenticated', 'public.profiles', 'UPDATE') AS can_update,
      has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') AS can_truncate
  `)
  assert.deepEqual(profile.rows[0], { can_read: true, can_update: true, can_truncate: false })

  await db.exec(pendingReadMigration)
  for (const role of ['anon', 'authenticated']) {
    const pendingRead = await db.query(`
      SELECT has_table_privilege('${role}', 'public.pending_payments', 'SELECT') AS whole_row,
        has_column_privilege('${role}', 'public.pending_payments', 'status', 'SELECT') AS status_read,
        has_column_privilege('${role}', 'public.pending_payments', 'error_message', 'SELECT') AS error_read,
        has_table_privilege('service_role', 'public.pending_payments', 'SELECT') AS service_read
    `)
    assert.deepEqual(pendingRead.rows[0], {
      whole_row: false, status_read: false, error_read: false, service_read: true,
    }, `${role} pending-payment evidence privileges`)
  }
  const query39 = ownerQueries.slice(
    ownerQueries.indexOf('-- 39. Pending-payment evidence must not be directly readable'),
    ownerQueries.indexOf('-- 40. After migration 20260925000000'),
  )
  const deployedGrantShape = await db.query(query39)
  assert.equal(deployedGrantShape.rows.length, 6)
  assert(deployedGrantShape.rows.every((row) => !row.table_select && !row.effective_column_select))

  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.staff_pending_actions (
      id integer PRIMARY KEY, staff_id uuid NOT NULL,
      action_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      CONSTRAINT staff_pending_actions_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'))
    );
    INSERT INTO public.staff_pending_actions (id, staff_id) VALUES
      (1, '00000000-0000-0000-0000-000000000001'),
      (2, '00000000-0000-0000-0000-000000000002');
    GRANT ALL ON TABLE public.staff_pending_actions TO PUBLIC, service_role;
    GRANT SELECT (action_data), INSERT (staff_id), UPDATE (status)
      ON TABLE public.staff_pending_actions TO PUBLIC;
    ALTER TABLE public.staff_pending_actions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Staff can insert own pending actions"
      ON public.staff_pending_actions FOR INSERT TO authenticated
      WITH CHECK (staff_id = auth.uid());
    CREATE POLICY "Staff can read own pending actions"
      ON public.staff_pending_actions FOR SELECT TO authenticated
      USING (staff_id = auth.uid());
  `)
  await db.exec('SET ROLE authenticated')
  await db.exec(`INSERT INTO public.staff_pending_actions (id, staff_id) VALUES
    (3, '00000000-0000-0000-0000-000000000001')`)
  await db.exec('RESET ROLE')
  await assert.rejects(() => db.exec("UPDATE public.staff_pending_actions SET status = 'failed' WHERE id = 1"), (error) => error.code === '23514')

  await db.exec(staffQueueMigration)
  await db.exec("UPDATE public.staff_pending_actions SET status = 'failed' WHERE id = 1")
  const staffQueueGrants = await db.query(`
    SELECT
      has_table_privilege('authenticated', 'public.staff_pending_actions', 'SELECT') AS staff_can_read,
      has_table_privilege('authenticated', 'public.staff_pending_actions', 'INSERT') AS staff_can_insert,
      has_table_privilege('authenticated', 'public.staff_pending_actions', 'TRUNCATE') AS staff_can_truncate,
      has_column_privilege('authenticated', 'public.staff_pending_actions', 'staff_id', 'INSERT') AS staff_can_insert_column,
      has_column_privilege('authenticated', 'public.staff_pending_actions', 'status', 'UPDATE') AS staff_can_update_column,
      has_table_privilege('anon', 'public.staff_pending_actions', 'SELECT') AS anon_can_read,
      has_table_privilege('service_role', 'public.staff_pending_actions', 'INSERT') AS service_can_insert,
      has_table_privilege('service_role', 'public.staff_pending_actions', 'UPDATE') AS service_can_update
  `)
  assert.deepEqual(staffQueueGrants.rows[0], {
    staff_can_read: true, staff_can_insert: false, staff_can_truncate: false,
    staff_can_insert_column: false, staff_can_update_column: false,
    anon_can_read: false, service_can_insert: true, service_can_update: true,
  })
  await db.exec('SET ROLE authenticated')
  const ownQueueRows = await db.query('SELECT id FROM public.staff_pending_actions ORDER BY id')
  assert.deepEqual(ownQueueRows.rows.map((row) => row.id), [1, 3])
  await assert.rejects(() => db.exec(`INSERT INTO public.staff_pending_actions (id, staff_id) VALUES
    (4, '00000000-0000-0000-0000-000000000001')`), (error) => error.code === '42501')
  await db.exec('RESET ROLE')
  assert(manageStaffSource.includes('await assertQueuedStaffPermission(admin, pendingAction)'), 'admin approval must recheck the queued requester and permission')
  const autoApproval = manageStaffSource.slice(
    manageStaffSource.indexOf('const approvedPendingRow = {'),
    manageStaffSource.indexOf('serve(async (req) =>'),
  )
  assert(autoApproval.indexOf('.insert(approvedPendingRow)') < autoApproval.indexOf('await applyStaffAction(admin, { ...approvedPendingRow, id: auditRow.id })'), 'auto-approved action must retain audit evidence before execution')

  await db.exec(`
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002');
    CREATE TABLE public.staff_permissions (
      user_id uuid,
      CONSTRAINT staff_permissions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) MATCH FULL ON UPDATE CASCADE
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );
    INSERT INTO public.staff_permissions (user_id)
      VALUES ('00000000-0000-0000-0000-000000000001');
    ALTER TABLE public.staff_pending_actions
      ADD CONSTRAINT staff_pending_actions_staff_id_fkey FOREIGN KEY (staff_id)
      REFERENCES auth.users(id) ON DELETE CASCADE;
  `)
  await db.exec(authCascadeMigration)
  const restrictedForeignKeys = await db.query(`
    SELECT conname, confdeltype, convalidated, condeferrable
    FROM pg_catalog.pg_constraint
    WHERE confrelid = 'auth.users'::regclass
    ORDER BY conname
  `)
  assert.deepEqual(restrictedForeignKeys.rows, [
    { conname: 'staff_pending_actions_staff_id_fkey', confdeltype: 'r', convalidated: false, condeferrable: false },
    { conname: 'staff_permissions_user_id_fkey', confdeltype: 'r', convalidated: false, condeferrable: true },
  ])
  await assert.rejects(
    () => db.exec("DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'"),
    (error) => error.code === '23001' || error.code === '23503',
  )

  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => db.query('SELECT * FROM public.pending_payments'), (error) => error.code === '42501')
  await assert.rejects(() => db.query('SELECT error_message FROM public.pending_payments'), (error) => error.code === '42501')
  await assert.rejects(() => db.exec('TRUNCATE public.transactions'), (error) => error.code === '42501')
  await db.exec('RESET ROLE')
  console.log('Financial history and staff approvals deny browser writes while retaining restricted reads and service access.')
} finally {
  await db.close()
}
