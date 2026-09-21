import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationDir = join(root, 'supabase', 'migrations')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function incidentMigrationFiles() {
  const incidentFiles = readdirSync(migrationDir)
    .filter((file) => /^202609(?:17|19).+\.sql$/i.test(file))
    .sort()

  return [
    '20260914007000_fix_security_definer_public_views.sql',
    ...incidentFiles,
  ].map((file) => `supabase/migrations/${file}`)
}

function sqlStatements(src) {
  return src
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function normalized(statement) {
  return statement.replace(/\s+/g, ' ').trim()
}

function stripDollarQuotedBodies(src) {
  let output = ''
  let index = 0

  while (index < src.length) {
    const open = src.slice(index).match(/\$[A-Za-z0-9_]*\$/)
    if (!open || open.index === undefined) {
      output += src.slice(index)
      break
    }

    const openStart = index + open.index
    const tag = open[0]
    const bodyStart = openStart + tag.length
    const closeStart = src.indexOf(tag, bodyStart)

    output += src.slice(index, openStart)
    if (closeStart === -1) {
      output += tag
      index = bodyStart
      continue
    }

    output += tag + tag
    index = closeStart + tag.length
  }

  return output
}

const files = incidentMigrationFiles()

assert(files.length >= 20, 'incident migration set is unexpectedly small')

const combined = files.map((file) => `-- ${file}\n${read(file)}`).join('\n\n')
const statements = files.flatMap((file) =>
  sqlStatements(read(file)).map((statement) => ({ file, statement, text: normalized(statement) })),
)
const topLevelStatements = files.flatMap((file) =>
  sqlStatements(stripDollarQuotedBodies(read(file))).map((statement) => ({ file, statement, text: normalized(statement) })),
)

const protectedTables = [
  'profiles',
  'transactions',
  'pending_payments',
  'profile_balance_audit',
  'profile_balance_blocked_attempts',
  'profile_delete_audit',
  'auth_user_delete_audit',
  'auth_user_identity_audit',
  'profile_identity_audit',
  'transaction_ledger_blocked_attempts',
  'wallet_reservations',
  'fulfillment_dispatch_outbox',
  'api_partners',
  'api_partner_keys',
  'api_partner_orders',
  'api_partner_logs',
  'api_partner_customers',
  'api_partner_webhook_deliveries',
  'wallet_security_events',
]

const browserRoles = '(?:public|PUBLIC|anon|authenticated)'
const writePrivileges = '(?:ALL(?:\\s+PRIVILEGES)?|INSERT|UPDATE|DELETE|TRUNCATE)'

for (const table of protectedTables) {
  const grantWrite = new RegExp(
    `\\bGRANT\\s+[^;]*\\b${writePrivileges}\\b[^;]*\\bON\\s+(?:TABLE\\s+)?public\\.${table}\\b[^;]*\\bTO\\s+[^;]*\\b${browserRoles}\\b`,
    'i',
  )

  for (const { file, text } of statements) {
    assert(!grantWrite.test(text), `${file} grants browser write access to protected table public.${table}`)
  }
}

for (const { file, text } of statements) {
  assert(
    !/\bGRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\b[^;]*\bTO\b[^;]*\b(?:public|PUBLIC|anon|authenticated)\b/i.test(text),
    `${file} grants browser EXECUTE on a function`,
  )
  assert(
    !/\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(text),
    `${file} disables row-level security`,
  )
}

for (const { file, text } of topLevelStatements) {
  const writesProfileBalances = /\bUPDATE\s+public\.profiles\b/i.test(text) &&
    /\b(wallet_balance|crypto_balance|referral_balance)\b/i.test(text)
  if (writesProfileBalances) {
    const safeNullNormalization = file.endsWith('202609170050_enforce_profile_balance_authority.sql') &&
      /wallet_balance\s*=\s*COALESCE\s*\(\s*wallet_balance\s*,\s*0\s*\)/i.test(text) &&
      /crypto_balance\s*=\s*COALESCE\s*\(\s*crypto_balance\s*,\s*0\s*\)/i.test(text) &&
      /referral_balance\s*=\s*COALESCE\s*\(\s*referral_balance\s*,\s*0\s*\)/i.test(text)

    assert(safeNullNormalization, `${file} performs a top-level profile balance update during migration execution`)
  }

  assert(
    !/\bINSERT\s+INTO\s+public\.transactions\b/i.test(text),
    `${file} inserts transaction ledger rows during migration execution`,
  )
}

const functionBlocks = [...combined.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\([^]*?AS\s+\$\$/gi)]
const functionDefinitions = [...combined.matchAll(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\([^]*?AS\s+\$([A-Za-z0-9_]*)\$([^]*?)\$\2\$/gi,
)]

assert(functionBlocks.length >= 10, 'incident migrations should contain the reviewed security functions')
assert(functionDefinitions.length >= 10, 'incident migrations should expose reviewed SQL function bodies')

for (const match of functionBlocks) {
  const [, functionName] = match
  const block = match[0]
  assert(/SECURITY\s+DEFINER/i.test(block), `${functionName} is expected to declare SECURITY DEFINER explicitly`)
  assert(/SET\s+search_path\s*=\s*public/i.test(block), `${functionName} must pin search_path to public`)
}

for (const match of functionDefinitions) {
  const [, functionName,, rawBody] = match
  const body = rawBody.replace(/--.*$/gm, '')
  assert(
    !/\b(?:COMMIT|ROLLBACK|START\s+TRANSACTION|BEGIN\s+TRANSACTION)\b/i.test(body),
    `${functionName} contains standalone transaction control inside a SQL function body`,
  )
}

for (const fn of [
  'apply_wallet_transaction',
  'withdraw_referral_balance_to_wallet',
  'guard_profile_balance_authority',
  'guard_transaction_ledger_authority',
  'guard_profile_privileged_fields',
  'evaluate_customer_ledger_suspension',
  'transfer_crypto_to_wallet',
  'set_customer_pocketfi_account',
  'apply_profile_referral_attribution',
  'set_customer_suspension_state',
  'set_staff_role',
]) {
  assert(combined.includes(`FUNCTION public.${fn}`), `missing reviewed function ${fn}`)
}

const profilePrivilegeRestriction = read('supabase/migrations/20260919016000_restrict_profile_privileged_writes.sql')
assert(
  !/request_role\s*=\s*'service_role'\s+OR\s+current_setting\('app\.tally_profile_privileged_authorized'/.test(profilePrivilegeRestriction),
  'latest profile privileged-field guard must not allow service_role alone to bypass protected-field controls',
)

for (const required of [
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public',
  'REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  'REVOKE EXECUTE ON FUNCTIONS FROM anon',
  'REVOKE EXECUTE ON FUNCTIONS FROM authenticated',
  'REVOKE ALL ON FUNCTION public.apply_wallet_transaction',
  'GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction',
  'TO service_role',
  'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pending_payments FROM anon, authenticated',
  'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.api_partners FROM anon, authenticated',
  'CREATE TRIGGER trg_guard_transaction_ledger_authority',
  'CREATE TRIGGER guard_profile_privileged_fields_insert',
  'CREATE TRIGGER guard_profile_privileged_fields_update',
  'CREATE TRIGGER guard_profile_balance_insert',
  'CREATE TRIGGER guard_profile_balance_update',
  "current_setting('app.tally_wallet_engine_authorized', true) = 'true'",
  "current_setting('app.tally_profile_privileged_authorized', true) = 'true'",
  'Blocked direct service-role balance edit. Use apply_wallet_transaction().',
  'REVOKE ALL ON FUNCTION public.set_customer_pocketfi_account(uuid, text, text, text) FROM public, anon, authenticated',
  'GRANT EXECUTE ON FUNCTION public.set_customer_pocketfi_account(uuid, text, text, text) TO service_role',
  'CREATE TABLE IF NOT EXISTS public.wallet_security_events',
  'REVOKE ALL ON public.wallet_security_events FROM anon',
  'CREATE POLICY "Service role can insert wallet security events"',
  'REVOKE ALL ON FUNCTION public.record_wallet_security_event',
  'GRANT EXECUTE ON FUNCTION public.record_wallet_security_event',
  'CREATE TRIGGER trg_capture_transaction_ledger_blocked_event',
  'CREATE TRIGGER trg_capture_profile_balance_blocked_event',
  'CREATE TRIGGER trg_capture_profile_financial_freeze_event',
  'ON DELETE RESTRICT',
  'con.confdeltype = \'c\'',
  'auth.users ON DELETE CASCADE',
  'api_partners',
  'api_partner_webhook_deliveries',
  'Partner/API incident evidence must survive partner-record deletion attempts',
  'CREATE TABLE IF NOT EXISTS public.wallet_reservations',
  'CREATE TABLE IF NOT EXISTS public.fulfillment_dispatch_outbox',
  'REVOKE ALL ON public.wallet_reservations FROM PUBLIC, anon, authenticated',
  'REVOKE ALL ON public.fulfillment_dispatch_outbox FROM PUBLIC, anon, authenticated',
  'Service-role-only reserve-first wallet holds',
  'Workers must re-check wallet/security state before sending supplier requests',
  'CREATE OR REPLACE FUNCTION public.enqueue_fulfillment_dispatch',
  'CREATE OR REPLACE FUNCTION public.claim_fulfillment_dispatch',
  'CREATE OR REPLACE FUNCTION public.finish_fulfillment_dispatch',
  'REVOKE ALL ON FUNCTION public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer) FROM PUBLIC, anon, authenticated',
  'REVOKE ALL ON FUNCTION public.claim_fulfillment_dispatch(text, text, integer) FROM PUBLIC, anon, authenticated',
  'REVOKE ALL ON FUNCTION public.finish_fulfillment_dispatch(uuid, text, text, text) FROM PUBLIC, anon, authenticated',
  'GRANT EXECUTE ON FUNCTION public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.claim_fulfillment_dispatch(text, text, integer) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.finish_fulfillment_dispatch(uuid, text, text, text) TO service_role',
  'FOR UPDATE SKIP LOCKED',
  'v_existing.payload IS DISTINCT FROM COALESCE(p_payload, \'{}\'::jsonb)',
  'ORDER_AUTHORIZATION_STALE',
  'FULFILLMENT_RESERVATION_REQUIRED',
  'fulfillment_dispatch_security_version_stale',
  'OUTBOX_CLAIM_INVALID',
  'CREATE OR REPLACE FUNCTION public.create_wallet_reservation',
  'CREATE OR REPLACE FUNCTION public.capture_wallet_reservation',
  'CREATE OR REPLACE FUNCTION public.release_wallet_reservation',
  'REVOKE ALL ON FUNCTION public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz) FROM PUBLIC, anon, authenticated',
  'REVOKE ALL ON FUNCTION public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated',
  'REVOKE ALL ON FUNCTION public.release_wallet_reservation(uuid, text, text) FROM PUBLIC, anon, authenticated',
  'GRANT EXECUTE ON FUNCTION public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.release_wallet_reservation(uuid, text, text) TO service_role',
  'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS',
  'WALLET_RESERVATION_IDEMPOTENCY_CONFLICT',
  'WALLET_RESERVATION_ALREADY_CAPTURED',
  '20260919026000_add_order_financial_authorization_columns.sql',
  '20260919027000_harden_financial_security_version.sql',
  '20260919028000_migrate_product_purchase_reserve_capture.sql',
  'CREATE OR REPLACE FUNCTION public.bump_financial_security_version',
  'CREATE TRIGGER trg_bump_financial_security_version',
  'profiles_financial_security_version_positive',
  'financial_security_version integer NOT NULL DEFAULT 1',
  'WALLET_SECURITY_VERSION_STALE',
  'CREATE OR REPLACE FUNCTION public.authorize_product_purchase',
  'CREATE OR REPLACE FUNCTION public.complete_product_purchase',
  'GRANT EXECUTE ON FUNCTION public.authorize_product_purchase',
  'GRANT EXECUTE ON FUNCTION public.complete_product_purchase',
  'product_purchase_inventory_reservation_conflict',
  'product_purchase_completion_inventory_conflict',
  'source_order_id',
  'ADD COLUMN IF NOT EXISTS wallet_reservation_id uuid REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT',
  'ADD COLUMN IF NOT EXISTS fulfillment_outbox_id uuid REFERENCES public.fulfillment_dispatch_outbox(id) ON DELETE RESTRICT',
  'ADD COLUMN IF NOT EXISTS financial_authorization_status text',
  'financial_authorization_status IN',
  'idx_\' || target_table || \'_wallet_reservation_id',
  'idx_\' || target_table || \'_fulfillment_outbox_id',
  'Reserve-first authorization record for this order',
  'Durable dispatch message linked to this order',
]) {
  assert(combined.includes(required), `migration safety check missing required SQL: ${required}`)
}

console.log(JSON.stringify({
  ok: true,
  checked_migrations: files.length,
  security_definer_functions: functionBlocks.length,
  protected_tables: protectedTables.length,
  checks: [
    'no browser write grants on incident financial, partner, payment, profile-security, or ledger tables',
    'no browser EXECUTE grants on incident functions',
    'no incident migration disables row-level security',
    'security-definer functions pin search_path to public',
    'SQL function bodies contain no standalone transaction control',
    'default future public function execution is revoked from browser roles',
    'wallet engine and partner/payment evidence revokes are present',
    'direct service-role profile balance edits require wallet-engine authorization',
    'profile privileged-field writes require narrow service-role-only RPCs',
    'no top-level migration writes create wallet balances or transaction ledger rows',
    'auth.users cascade deletes are replaced with restrictive evidence-preserving foreign keys',
    'partner/API cascade deletes are replaced with restrictive evidence-preserving foreign keys',
  ],
}, null, 2))
