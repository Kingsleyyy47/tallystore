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
    .filter((file) => /^202609(?:1[7-9]|2[0-9]|30).+\.sql$/i.test(file))
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
const refundGuardMigration = read('supabase/migrations/20260924024000_use_financial_truth_for_refund_capacity.sql')
assert(refundGuardMigration.includes('SELECT public.trusted_principal_for_user(NEW.user_id)')
  && refundGuardMigration.includes('SELECT COALESCE(SUM(amount), 0)'),
  'refund guard patch must recognize both legacy-funding and original principal calculations')
assert(refundGuardMigration.includes('Canonical purchase guard must exist before refund guard patch'),
  'refund guard patch must reject an unexpected purchase guard definition')
const exactAmountMigration = read('supabase/migrations/20260925001000_require_exact_gateway_evidence_amounts.sql')
assert(exactAmountMigration.includes('Canonical wallet purchase gate must exist before exact amount patch')
  && exactAmountMigration.includes('v_index > 3')
  && exactAmountMigration.includes("pg_catalog.strpos(v_definition, 'round(t.amount, 2)') = 0"),
  'exact amount patch must handle the canonical engine without silently retaining rounded legacy checks')
const profileReaderMigration = read('supabase/migrations/20260925013000_secure_profile_admin_reader.sql')
assert(profileReaderMigration.includes("policyname = 'Users and admins can read profiles'")
  && profileReaderMigration.includes("policyname = 'profiles_select'")
  && profileReaderMigration.includes('v_select_policy_count = 2')
  && profileReaderMigration.includes('public.wallet_active_staff_profile_reader()')
  && profileReaderMigration.includes('NOT COALESCE(p.account_suspended, false)')
  && profileReaderMigration.includes('DROP POLICY IF EXISTS profiles_select'),
  'profile reader migration must replace both known permissive live policies and preserve active staff reads')
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
  'pocketfi_webhook_logs',
  'orders',
  'bitrefill_orders',
  'crypto_transactions',
  'smm_orders',
  'telegram_orders',
  'bills_transactions',
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
  'wallet_historical_admin_funding',
  'wallet_historical_review_resolutions',
  'admin_alerts',
  'staff_permissions',
]

const browserRoles = '(?:public|PUBLIC|anon|authenticated)'
const writePrivileges = '(?:ALL(?:\\s+PRIVILEGES)?|INSERT|UPDATE|DELETE|TRUNCATE)'

for (const table of protectedTables) {
  const grantWrite = new RegExp(
    `\\bGRANT\\s+[^;]*\\b${writePrivileges}\\b[^;]*\\bON\\s+(?:TABLE\\s+)?public\\.${table}\\b[^;]*\\bTO\\s+[^;]*\\b${browserRoles}\\b`,
    'i',
  )

  for (const { file, text } of statements) {
    const narrowAlertAcknowledge = table === 'admin_alerts'
      && file.endsWith('/20260925012000_restrict_admin_alert_acknowledgement.sql')
      && /^GRANT UPDATE \(acknowledged\) ON TABLE public\.admin_alerts TO authenticated$/i.test(text)
    assert(!grantWrite.test(text) || narrowAlertAcknowledge,
      `${file} grants browser write access to protected table public.${table}`)
  }
}

const alertAckMigration = read('supabase/migrations/20260925012000_restrict_admin_alert_acknowledgement.sql')
assert(/REVOKE UPDATE ON TABLE public\.admin_alerts FROM PUBLIC, anon, authenticated/i.test(alertAckMigration),
  'alert acknowledgement must remove browser table-level UPDATE')
assert(/REVOKE UPDATE \(%I\) ON TABLE public\.admin_alerts FROM PUBLIC, anon, authenticated/i.test(alertAckMigration),
  'alert acknowledgement must remove inherited column UPDATE grants')
assert(/GRANT UPDATE \(acknowledged\) ON TABLE public\.admin_alerts TO authenticated/i.test(alertAckMigration),
  'browser alert acknowledgement grant must remain column-scoped')
assert(/NEW\.acknowledged_by := auth\.uid\(\)/i.test(alertAckMigration)
  && /NEW\.acknowledged_at := clock_timestamp\(\)/i.test(alertAckMigration),
  'alert acknowledgement actor and time must be database-owned')
const activeAlertMigration = read('supabase/migrations/20260925020000_restrict_suspended_admin_alert_access.sql')
assert(activeAlertMigration.includes('v_policy_count = 0')
  && activeAlertMigration.includes('trg_guard_admin_alert_acknowledgement')
  && activeAlertMigration.includes("'search_path=\"\"'")
  && activeAlertMigration.includes('CREATE POLICY "Admins can view all alerts"')
  && activeAlertMigration.includes('CREATE POLICY "Admins can update alerts"')
  && activeAlertMigration.includes('AS RESTRICTIVE FOR ALL TO authenticated'),
  'zero-policy admin alerts must restore active-admin read and guarded acknowledgement only')
const financialHistoryMigration = read('supabase/migrations/20260925024000_restrict_suspended_admin_financial_history.sql')
assert(financialHistoryMigration.includes('Users and admins can read orders')
  && financialHistoryMigration.includes('Users and admins can read transactions')
  && financialHistoryMigration.includes('v_policy.roles IS DISTINCT FROM ARRAY[\'authenticated\']::name[]')
  && financialHistoryMigration.includes("v_policy.qual LIKE '%user_id = auth.uid()%'")
  && financialHistoryMigration.includes("cmd IN ('SELECT', 'ALL')")
  && financialHistoryMigration.includes('AS RESTRICTIVE FOR SELECT TO authenticated'),
  'financial history migration must recognize the live self/admin policies and preserve the restrictive gate')

for (const { file, text } of statements) {
  const browserFunctionGrant = text.match(/^GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.([a-z_]+)\([^)]*\)\s+TO\s+(.+)$/i)
  if (browserFunctionGrant && /\b(?:public|anon|authenticated)\b/i.test(browserFunctionGrant[2])) {
    const reviewedBrowserHelpers = new Map([
      ['can_read_wallet_legacy_funding', 'authenticated'],
      ['get_my_referral_count', 'authenticated'],
      ['get_recent_activity_feed', 'anon, authenticated'],
      ['is_admin_profile', 'anon, authenticated, service_role'],
      ['wallet_active_staff_profile_reader', 'authenticated, service_role'],
      ['get_admin_wallet_financial_truth', 'authenticated'],
      ['get_admin_wallet_financial_truth_page', 'authenticated'],
      ['get_admin_fraud_latest_visits', 'authenticated'],
      ['get_admin_cross_wallet_payment_conflicts_page', 'authenticated'],
      ['get_admin_smm_services', 'authenticated'],
      ['set_admin_smm_service_active', 'authenticated'],
      ['get_managed_product_groups', 'authenticated'],
      ['get_managed_product_group', 'authenticated'],
      ['preview_discount_code', 'authenticated'],
      ['get_managed_discount_codes', 'authenticated'],
      ['get_customer_sales_stats', 'authenticated'],
      ['get_public_customer_order_count', 'anon, authenticated'],
      ['get_public_top_product_group_ids', 'anon, authenticated'],
      ['get_my_bitrefill_order_history', 'authenticated'],
      ['save_admin_product_relationships', 'authenticated'],
    ])
    assert(
      reviewedBrowserHelpers.get(browserFunctionGrant[1].toLowerCase()) === browserFunctionGrant[2].trim().toLowerCase(),
      `${file} grants browser EXECUTE on a function outside reviewed scoped helpers`,
    )
  }
  assert(
    !/\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(text),
    `${file} disables row-level security`,
  )
}

const discountReaders = read('supabase/migrations/20260925014000_add_scoped_discount_readers.sql')
assert(discountReaders.includes('SECURITY DEFINER')
  && discountReaders.includes("SET search_path = ''")
  && discountReaders.includes('auth.uid() IS NULL')
  && discountReaders.includes("sp.permission_key = 'tab_discount_codes'")
  && discountReaders.includes('dc.user_id IS NULL OR public.is_admin_profile()')
  && !/\bEXECUTE\s+(?!ON\b)/i.test(discountReaders),
  'discount readers must remain caller-bound, staff-scoped, and free of dynamic SQL')
const discountContract = read('supabase/migrations/20260925015000_restrict_discount_code_browser_reads.sql')
assert(discountContract.includes('DROP POLICY "Anyone can read active discount codes"')
  && discountContract.includes('DROP POLICY IF EXISTS discount_codes_write')
  && discountContract.includes("qual = 'is_staff_or_admin()'")
  && discountContract.includes("with_check = 'is_staff_or_admin()'")
  && discountContract.includes('USING (public.is_admin_profile())')
  && discountContract.includes('REVOKE SELECT ON TABLE public.discount_codes FROM PUBLIC, anon'),
  'discount table reads must contract to current-admin policy')
const discountCapacity = read('supabase/migrations/20260925016000_reserve_discount_uses_with_orders.sql')
assert(discountCapacity.includes('FOR UPDATE')
  && discountCapacity.includes('v_code.used_count + v_pending_count >= v_code.max_uses')
  && discountCapacity.includes('NEW.discount_code_id := v_code_id')
  && discountCapacity.includes('SET used_count = used_count + 1')
  && discountCapacity.includes('CREATE TRIGGER guard_order_discount_capacity')
  && discountCapacity.includes('CREATE TRIGGER post_completed_order_discount_use')
  && discountCapacity.includes('GRANT EXECUTE ON FUNCTION public.discount_code_capacity_version() TO service_role'),
  'discount capacity must be reserved under a code lock and consumed once at order completion')

const relationshipWriter = read('supabase/migrations/20260924030200_add_admin_product_relationship_writer.sql')
assert(
  /FUNCTION public\.save_admin_product_relationships\(p_rows jsonb\)[\s\S]*SECURITY DEFINER\s+SET search_path = ''/.test(relationshipWriter) &&
  relationshipWriter.includes('p.id = auth.uid()') &&
  relationshipWriter.includes('COALESCE(p.is_admin, false)') &&
  relationshipWriter.includes('NOT COALESCE(p.account_suspended, false)') &&
  relationshipWriter.includes('INSERT INTO public.product_relationships') &&
  !/\bEXECUTE\s+(?!ON\b)/i.test(relationshipWriter),
  'admin relationship writer must remain a scoped current-admin function without dynamic SQL',
)

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

const functionBlocks = [...combined.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\([^]*?AS\s+\$[A-Za-z0-9_]*\$/gi)]
const functionDefinitions = [...combined.matchAll(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\([^]*?AS\s+\$([A-Za-z0-9_]*)\$([^]*?)\$\2\$/gi,
)]

assert(functionBlocks.length >= 10, 'incident migrations should contain the reviewed security functions')
assert(functionDefinitions.length >= 10, 'incident migrations should expose reviewed SQL function bodies')

for (const match of functionBlocks) {
  const [, functionName] = match
  const block = match[0]
  const immutableUtility = [
    'wallet_legacy_funding_cutoff',
    'wallet_refund_links_debit',
  ].includes(functionName) &&
    /\bIMMUTABLE\b/i.test(block) &&
    /\bLANGUAGE\s+sql\b/i.test(block)

  if (immutableUtility) continue

  if (functionName === 'guard_admin_alert_acknowledgement') {
    assert(/SECURITY\s+INVOKER/i.test(block),
      'alert acknowledgement trigger must observe the invoking database role')
    assert(/SET\s+search_path\s*=\s*''/i.test(block),
      'alert acknowledgement trigger must pin an empty search_path')
    continue
  }

  if ([
    'guard_historical_wallet_evidence_immutable',
    'resolve_reviewed_historical_admin_funding',
  ].includes(functionName)) {
    assert(/SECURITY\s+INVOKER/i.test(block),
      `${functionName} must use the invoking owner's privileges`)
    assert(/SET\s+search_path\s*=\s*''/i.test(block),
      `${functionName} must pin an empty search_path`)
    continue
  }

  assert(/SECURITY\s+DEFINER/i.test(block), `${functionName} is expected to declare SECURITY DEFINER explicitly`)
  const hasPublicSearchPath = /SET\s+search_path\s*=\s*public/i.test(block)
  const hasEmptySearchPath = /SET\s+search_path\s*=\s*''/i.test(block)
  assert(hasPublicSearchPath || hasEmptySearchPath, `${functionName} must pin a reviewed search_path`)
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
  'REVOKE ALL ON FUNCTION public.get_recent_activity_feed(integer)',
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
    'only reviewed admin-gated read RPCs and narrow helpers have browser EXECUTE grants',
    'no incident migration disables row-level security',
    'security-definer functions pin a reviewed search_path',
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
