import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const errors = []
const warnings = []
const publicEnvNames = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED',
  'VITE_APP_BUILD_VERSION',
])
const personalEmailPattern = /[a-z0-9._%+-]+@(?!example\.(?:com|test|invalid)\b|email\.com\b|tallystore\.org\b)[a-z0-9.-]+\.[a-z]{2,}/i

const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean)
const historicalEnvPaths = [...new Set(execFileSync('git', [
  'log', '--all', '--name-only', '--format=', '--', '.env', '.env.*',
], { cwd: root }).toString('utf8').split(/\r?\n/).filter(Boolean))]
const historicalSecretValues = new Map()
let historicalEnvironmentBlobsChecked = 0
for (const file of historicalEnvPaths) {
  if (file === '.env.example') continue
  const commits = execFileSync('git', ['log', '--all', '--format=%H', '--', file], { cwd: root })
    .toString('utf8').split(/\r?\n/).filter(Boolean)
  for (const commit of commits) {
    let content
    try {
      content = execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString('utf8')
    } catch {
      continue // Deletion commits have no blob at this path.
    }
    historicalEnvironmentBlobsChecked += 1
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, name, raw] = match
      const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2')
      if (publicEnvNames.has(name) || !/(?:SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/.test(name) ||
          value.length < 16 || /^(?:change.?me|replace|your_|example|<.*>|\$\{.*\})/i.test(value)) continue
      if (!historicalSecretValues.has(name)) historicalSecretValues.set(name, new Set())
      historicalSecretValues.get(name).add(value)
    }
  }
  warnings.push(`Git history contains environment file ${file}; removing the current file does not rotate exposed credentials`)
}
for (const name of historicalSecretValues.keys()) {
  warnings.push(`Git history contains a non-placeholder ${name}; rotate this credential if it was active`)
}

for (const file of tracked) {
  if (/(^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.env.example')) {
    errors.push(`tracked environment file: ${file}`)
  }
  if (/\.(?:pem|p12|pfx|key)$/i.test(file)) {
    errors.push(`tracked private-key-shaped file: ${file}`)
  }
}

const localEnv = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : ''
const values = new Map()
for (const line of localEnv.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/)
  if (!match) continue
  const [, name, raw] = match
  const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!value) continue
  values.set(name, value)
  if (name.startsWith('VITE_') && !publicEnvNames.has(name)) {
    warnings.push(`local .env uses browser-reserved prefix for ${name}; move it to server-only configuration and rotate if exposed`)
  }
}

const browserFiles = [...walk('src'), ...walk('public'), 'index.html']
  .filter((file) => /\.(?:ts|tsx|js|jsx|html|json|txt)$/.test(file))
for (const file of browserFiles) {
  const content = readFileSync(join(root, file), 'utf8')
  if (personalEmailPattern.test(content)) errors.push(`personal email address in browser source: ${file}`)
  for (const match of content.matchAll(/\bVITE_[A-Z0-9_]+\b/g)) {
    if (!publicEnvNames.has(match[0])) errors.push(`unapproved browser environment name ${match[0]} in ${file}`)
  }
}

const outputFiles = walk('dist').filter((file) => /\.(?:js|html|json|map)$/.test(file))
for (const file of outputFiles) {
  const content = readFileSync(join(root, file), 'utf8')
  if (personalEmailPattern.test(content)) errors.push(`personal email address in browser build: ${file}`)
  if (/\bsb_secret_[A-Za-z0-9_-]{20,}\b/.test(content)) errors.push(`Supabase secret-shaped value in browser build: ${file}`)
  if (/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{20,}\b/.test(content)) errors.push(`provider secret-shaped value in browser build: ${file}`)
  for (const [name, value] of values) {
    if (publicEnvNames.has(name) || value.length < 16) continue
    if (content.includes(value)) errors.push(`local server credential ${name} appears in browser build: ${file}`)
  }
  for (const [name, previousValues] of historicalSecretValues) {
    if ([...previousValues].some((value) => content.includes(value))) {
      errors.push(`historical server credential ${name} appears in browser build: ${file}`)
    }
  }
}

const serverChecks = [
  ['supabase/functions/webhook-pocketfi/index.ts', /searchParams\.get\(['"]token['"]\)/, 'PocketFi webhook accepts a URL token'],
  ['supabase/functions/smsbus/index.ts', /searchParams\.get\(['"]token['"]\)/, 'SMS webhook accepts a URL token'],
  ['api/webhook-pocketfi.ts', /requestUrl\.search\b/, 'PocketFi bridge forwards query strings'],
  ['supabase/functions/validate-bank-account/index.ts', /console\.(?:log|error)\([^\n]*(?:validationResponse|accountName)/, 'bank identity is logged'],
  ['supabase/functions/create-pocketfi-topup/index.ts', /console\.(?:log|error)\([^\n]*JSON\.stringify\((?:result|saveAccountError)/, 'PocketFi response is logged'],
  ['supabase/functions/manage-staff/index.ts', /\[row\.account_name, row\.account_number\]/, 'staff sales history includes withdrawal bank details'],
]
const serverFiles = [...walk('api'), ...walk('supabase/functions')]
  .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
for (const file of serverFiles) {
  if (personalEmailPattern.test(readFileSync(join(root, file), 'utf8'))) {
    errors.push(`personal email address in server source: ${file}`)
  }
}
const migrationFiles = [...walk('supabase/migrations'), ...walk('migrations')]
  .filter((path) => /\.sql$/.test(path))
const toolingFiles = walk('scripts').filter((path) => /\.[cm]?[jt]s$/.test(path))
const documentationFiles = walk('docs').filter((path) => /\.(?:md|sql|json)$/.test(path))
for (const file of [...migrationFiles, ...toolingFiles, ...documentationFiles]) {
  if (personalEmailPattern.test(readFileSync(join(root, file), 'utf8'))) {
    errors.push(`personal email address in migration/tooling source: ${file}`)
  }
}
for (const [file, pattern, message] of serverChecks) {
  if (pattern.test(readFileSync(join(root, file), 'utf8'))) errors.push(`${message}: ${file}`)
}
const emailSource = readFileSync(join(root, 'supabase/functions/email/index.ts'), 'utf8')
if (!/async function handleProcessBroadcast\(req: Request\)\s*\{[\s\S]{0,200}await requireBroadcastWorker\(req\)/.test(emailSource)) {
  errors.push('email broadcast worker lacks an application-level caller check')
}
const identityMigration = readFileSync(join(root, 'supabase/migrations/20260924001000_close_public_identity_surfaces.sql'), 'utf8')
if (!identityMigration.includes('CASE WHEN false THEN username ELSE NULL END AS username') || !identityMigration.includes("'Customer'::text AS masked_name")) {
  errors.push('public identity migration must suppress inventory usernames and customer email prefixes')
}
const activityMigration = readFileSync(join(root, 'supabase/migrations/20260924005000_pause_public_activity_feed.sql'), 'utf8')
if (!/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_recent_activity_feed\(integer\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(activityMigration)) {
  errors.push('public activity feed must be unreachable by browser roles')
}
for (const file of [
  'migrations/fix-all-client-rls-policies.sql',
  'migrations/fix-revenue-events-rls-simple.sql',
  'migrations/fix-rls-revenue-events-and-cro-interventions.sql',
  'migrations/fix-revenue-events-rls-add-select.sql',
]) {
  const retiredRlsScript = readFileSync(join(root, file), 'utf8')
  if (/\b(?:CREATE\s+POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE))\b/i.test(retiredRlsScript.replace(/^--.*$/gm, ''))) {
    errors.push(`retired manual RLS repair script still creates browser access: ${file}`)
  }
}
const manualRlsClosure = readFileSync(join(root, 'supabase/migrations/20260924013000_close_manual_sql_editor_rls_reopens.sql'), 'utf8')
for (const oldPolicy of [
  'Anyone can read app settings', 'Anyone can insert site visits',
  'Clients can insert own cro outcomes', 'Clients can select own cro outcomes',
  'Clients can insert chat interventions', 'Clients can select own chat interventions',
  'Clients can insert chat sessions', 'Clients can update chat sessions',
  'Clients can select chat sessions',
  'Clients can insert own cro interventions', 'Clients can update own cro interventions',
  'Clients can read own cro interventions',
  'Clients can update non-financial revenue events',
]) {
  if (!manualRlsClosure.includes(`DROP POLICY IF EXISTS "${oldPolicy}"`)) {
    errors.push(`manual SQL Editor policy is not retired: ${oldPolicy}`)
  }
}
if (!/REVOKE INSERT, SELECT, UPDATE, DELETE, TRUNCATE ON public\.chat_sessions FROM PUBLIC, anon, authenticated/.test(manualRlsClosure)) {
  errors.push('manual SQL Editor chat-session table grants remain browser-accessible')
}
if (!/REVOKE UPDATE, DELETE, TRUNCATE ON public\.revenue_events FROM PUBLIC, anon, authenticated/.test(manualRlsClosure) ||
    !manualRlsClosure.includes('(user_id IS NULL OR auth.uid() = user_id)')) {
  errors.push('manual SQL Editor revenue-event policies remain too permissive')
}
const croDecisionMigration = readFileSync(join(root, 'supabase/migrations/20260924014000_bind_browser_cro_decision_evidence.sql'), 'utf8')
if (!croDecisionMigration.includes('DROP POLICY IF EXISTS "Anyone can record cro decisions"') ||
    !croDecisionMigration.includes('auth.uid() = user_id') ||
    !croDecisionMigration.includes("metadata->>'client_observed'") ||
    !croDecisionMigration.includes('REVOKE UPDATE, DELETE, TRUNCATE ON public.cro_decision_audit')) {
  errors.push('CRO decision audit remains writable as forged or authoritative browser evidence')
}
const adminAlertMigration = readFileSync(join(root, 'supabase/migrations/20260924015000_restrict_admin_alert_inserts.sql'), 'utf8')
if (!adminAlertMigration.includes('DROP POLICY IF EXISTS "Allow insert via service role"') ||
    !adminAlertMigration.includes('REVOKE INSERT, DELETE, TRUNCATE ON public.admin_alerts') ||
    !adminAlertMigration.includes('FROM PUBLIC, anon, authenticated') ||
    !adminAlertMigration.includes('GRANT INSERT ON public.admin_alerts TO service_role')) {
  errors.push('browser-originated admin security alerts are not closed')
}
const salesAggregateMigration = readFileSync(join(root, 'supabase/migrations/20260924017000_restrict_public_sales_aggregates.sql'), 'utf8')
const publicHome = readFileSync(join(root, 'src/pages/Index.tsx'), 'utf8')
const publicStats = readFileSync(join(root, 'src/components/StatsBar.tsx'), 'utf8')
const browserClient = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8')
if (!salesAggregateMigration.includes('REVOKE ALL ON FUNCTION public.get_customer_sales_stats() FROM PUBLIC, anon, authenticated') ||
    !salesAggregateMigration.includes('REVOKE ALL ON FUNCTION public.get_customer_top_product_groups(integer) FROM PUBLIC, anon, authenticated') ||
    !salesAggregateMigration.includes("sp.permission_key = 'view_stats'") ||
    !salesAggregateMigration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_permissions') ||
    !salesAggregateMigration.includes('LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 12)') ||
    publicHome.includes('getAdminSalesStats') || publicStats.includes('getAdminSalesStats') ||
    !browserClient.includes("supabase.rpc('get_public_customer_order_count')") ||
    !browserClient.includes("supabase.rpc('get_public_top_product_group_ids'")) {
  errors.push('public storefront still exposes exact sales revenue or product units')
}
const dbSecurityPack = readFileSync(join(root, 'docs/security/wallet-db-security-test-pack.sql'), 'utf8')
const ownerQueryPack = readFileSync(join(root, 'docs/security/wallet-readonly-query-pack.sql'), 'utf8')
if (!dbSecurityPack.includes("has_function_privilege('anon', 'public.get_recent_activity_feed(integer)', 'EXECUTE')") ||
    !dbSecurityPack.includes("has_function_privilege('authenticated', 'public.get_recent_activity_feed(integer)', 'EXECUTE')") ||
    !ownerQueryPack.includes('Public per-customer activity feed execution')) {
  errors.push('deployed public activity feed execution is not covered by staging and owner checks')
}
if (!dbSecurityPack.includes("has_column_privilege(\n      'anon', 'public.individual_accounts'") ||
    !ownerQueryPack.includes('Inventory credential exposure after column-level grant cleanup')) {
  errors.push('deployed anonymous inventory column access is not covered by staging and owner checks')
}
if (!dbSecurityPack.includes('anon can read a private app setting') ||
    !dbSecurityPack.includes('authenticated browser can forge another user revenue event') ||
    !dbSecurityPack.includes('browser can attribute a CRO decision to another user') ||
    !ownerQueryPack.includes('Legacy SQL Editor policy reopen check')) {
  errors.push('manual RLS policy reopen is not covered by staging and owner checks')
}
if (!dbSecurityPack.includes('browser can forge admin security alerts') ||
    !ownerQueryPack.includes('Admin alert evidence authority')) {
  errors.push('admin-alert write boundary lacks staging or owner verification')
}
if (!dbSecurityPack.includes('anonymous caller read exact sales revenue') ||
    !ownerQueryPack.includes('Public sales aggregate exposure')) {
  errors.push('public sales aggregate grant boundary lacks staging or owner verification')
}
for (const file of ['src/App.tsx', 'src/pages/Index.tsx', 'src/pages/ProductsPage.tsx']) {
  if (/<(?:GlobalActivityFeed|HomepageLiveActivity)\b/.test(readFileSync(join(root, file), 'utf8'))) {
    errors.push(`public activity feed remains mounted: ${file}`)
  }
}

const uniqueErrors = [...new Set(errors)]
const uniqueWarnings = [...new Set(warnings)]
console.log(JSON.stringify({
  ok: uniqueErrors.length === 0,
  trackedFiles: tracked.length,
  browserSourceFiles: browserFiles.length,
  browserBuildFiles: outputFiles.length,
  serverSourceFiles: serverFiles.length,
  migrationFilesChecked: migrationFiles.length,
  toolingFilesChecked: toolingFiles.length,
  documentationFilesChecked: documentationFiles.length,
  serverPathsChecked: serverChecks.length + 1,
  errors: uniqueErrors,
  warnings: uniqueWarnings,
  historicalGitSecretValuesChecked: true,
  historicalEnvironmentBlobsChecked,
  historicalSecretNames: [...historicalSecretValues.keys()].sort(),
  historicalEnvironmentPaths: historicalEnvPaths,
}, null, 2))
if (uniqueErrors.length) process.exitCode = 1

function walk(path) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [path]
  const files = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const item = join(absolute, entry.name)
    if (entry.isDirectory()) files.push(...walk(relative(root, item)))
    else if (entry.isFile()) files.push(relative(root, item))
  }
  return files
}
