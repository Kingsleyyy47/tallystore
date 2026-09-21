import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

const envName = clean(process.env.TALLYSTORE_DB_TEST_ENV).toLowerCase()
const ack = clean(process.env.TALLYSTORE_DB_TEST_ACK)
const databaseUrl = clean(process.env.SUPABASE_DB_URL) || clean(process.env.DATABASE_URL)
const testUserId = clean(args.get('test-user-id') || process.env.TALLYSTORE_DB_TEST_USER_ID)
const testAdminId = clean(args.get('test-admin-id') || process.env.TALLYSTORE_DB_TEST_ADMIN_ID)
const jsonOnly = args.get('json') === 'true'
const psqlTimeoutMs = Number(process.env.TALLYSTORE_DB_TEST_TIMEOUT_MS || 180_000)

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

if (!['local', 'staging', 'owner-controlled'].includes(envName)) {
  fail('Set TALLYSTORE_DB_TEST_ENV to local, staging, or owner-controlled. This runner refuses production.')
}

if (ack !== 'I_UNDERSTAND_ROLLBACK_TEST_MUTATIONS') {
  fail('Set TALLYSTORE_DB_TEST_ACK=I_UNDERSTAND_ROLLBACK_TEST_MUTATIONS before running the DB security pack.')
}

if (!databaseUrl) {
  fail('Set SUPABASE_DB_URL or DATABASE_URL for the staging/local/owner-controlled Postgres database.')
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testUserId)) {
  fail('Provide --test-user-id <ordinary-customer-uuid> or TALLYSTORE_DB_TEST_USER_ID.')
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testAdminId)) {
  fail('Provide --test-admin-id <admin-profile-uuid> or TALLYSTORE_DB_TEST_ADMIN_ID.')
}

const psqlProbe = spawnSync('psql', ['--version'], { encoding: 'utf8', timeout: 15_000 })
if (psqlProbe.status !== 0) {
  fail('psql is not available on PATH. Install PostgreSQL client tools or run this from an environment that has psql.')
}

const sourcePath = join(root, 'docs', 'security', 'wallet-db-security-test-pack.sql')
const sourceSql = readFileSync(sourcePath, 'utf8')

if (!sourceSql.includes('ROLLBACK;')) {
  fail('DB security test pack must end with ROLLBACK before the runner will execute it.')
}
if (!sourceSql.includes('wallet-db-security-test-pack passed inside rollback transaction')) {
  fail('DB security test pack is missing the success marker.')
}

const patchedSql = injectFixtureIds(sourceSql, testUserId, testAdminId)

if (patchedSql === sourceSql) {
  fail('Could not inject fixture ids into wallet-db-security-test-pack.sql.')
}

const tempDir = mkdtempSync(join(tmpdir(), 'tallystore-wallet-db-security-'))
const tempSqlPath = join(tempDir, 'wallet-db-security-test-pack.sql')

try {
  writeFileSync(tempSqlPath, patchedSql, 'utf8')

  const startedAt = new Date().toISOString()
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', tempSqlPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: psqlTimeoutMs,
    env: {
      ...process.env,
      PSQLRC: '',
    },
  })

  const summary = {
    ok: result.status === 0,
    environment: envName,
    testUserId,
    testAdminId,
    startedAt,
    finishedAt: new Date().toISOString(),
    psqlVersion: (psqlProbe.stdout || psqlProbe.stderr || '').trim().split(/\r?\n/)[0],
    source: 'docs/security/wallet-db-security-test-pack.sql',
    successMarkerSeen: (result.stdout || '').includes('wallet-db-security-test-pack passed inside rollback transaction'),
    exitCode: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    timeoutMs: psqlTimeoutMs,
    stdoutTail: sanitizeOutput(result.stdout),
    stderrTail: result.error?.code === 'ETIMEDOUT'
      ? `psql timed out after ${psqlTimeoutMs}ms`
      : sanitizeOutput(result.stderr),
  }

  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Wallet DB security test pack ${summary.ok ? 'passed' : 'failed'}.`)
    console.log(`Environment: ${summary.environment}`)
    console.log(`Test user: ${summary.testUserId}`)
    console.log(`Admin fixture: ${summary.testAdminId}`)
    console.log(`Success marker seen: ${summary.successMarkerSeen}`)
    if (summary.stdoutTail) {
      console.log('\nstdout tail:')
      console.log(summary.stdoutTail)
    }
    if (summary.stderrTail) {
      console.log('\nstderr tail:')
      console.log(summary.stderrTail)
    }
  }

  if (result.status !== 0 || !summary.successMarkerSeen) process.exit(1)
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

function parseArgs(rawArgs) {
  const parsed = new Map()
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]
    if (arg === '--help' || arg === '-h') {
      parsed.set(arg.replace(/^-+/, ''), 'true')
      continue
    }
    if (!arg.startsWith('--')) continue

    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? rawArgs[i + 1]
    if (inlineValue == null && value && !value.startsWith('--')) i += 1
    parsed.set(key, value === undefined || value.startsWith('--') ? 'true' : value)
  }
  return parsed
}

function clean(value) {
  return String(value || '').trim()
}

function sanitizeOutput(value) {
  return sanitizeOutputWithUrl(value, databaseUrl)
}

function sanitizeOutputWithUrl(value, url) {
  const cleaned = clean(value)
  const redacted = url ? cleaned.replaceAll(url, '[DATABASE_URL_REDACTED]') : cleaned
  return redacted
    .split(/\r?\n/)
    .slice(-80)
    .join('\n')
}

function injectFixtureIds(sql, userId, adminId) {
  return sql
    .replace(
    /SELECT set_config\('app\.wallet_security_test_user_id',\s*'00000000-0000-0000-0000-000000000000',\s*false\);/,
    `SELECT set_config('app.wallet_security_test_user_id', '${userId}', false);`,
    )
    .replace(
      /SELECT set_config\('app\.wallet_security_test_admin_id',\s*'00000000-0000-0000-0000-000000000000',\s*false\);/,
      `SELECT set_config('app.wallet_security_test_admin_id', '${adminId}', false);`,
    )
}

function runSelfTest() {
  const sourcePath = join(root, 'docs', 'security', 'wallet-db-security-test-pack.sql')
  const sourceSql = readFileSync(sourcePath, 'utf8')
  const fixtureUserId = '11111111-1111-4111-8111-111111111111'
  const fixtureAdminId = '22222222-2222-4222-8222-222222222222'
  const patchedSql = injectFixtureIds(sourceSql, fixtureUserId, fixtureAdminId)
  const fakeUrl = 'postgres://owner:secret@example.invalid:5432/postgres'
  const sanitized = sanitizeOutputWithUrl(`error near ${fakeUrl}\n${fakeUrl}`, fakeUrl)

  assertSelf(sourceSql.includes('ROLLBACK;'), 'DB security SQL pack must contain a rollback')
  assertSelf(sourceSql.includes('wallet-db-security-test-pack passed inside rollback transaction'), 'DB security SQL pack must contain the success marker')
  assertSelf(sourceSql.includes('authenticated profile mutation changed protected financial/role fields'), 'DB security SQL pack must test browser-role protected profile writes')
  assertSelf(sourceSql.includes('direct service-role profile update changed protected fields'), 'DB security SQL pack must test direct service-role profile writes')
  assertSelf(sourceSql.includes('PAYMENT_VERIFICATION_EVIDENCE_REQUIRED'), 'DB security SQL pack must test fake provider evidence rejection')
  assertSelf(sourceSql.includes('REFUND_ORIGINAL_DEBIT_REQUIRED'), 'DB security SQL pack must test refunds without original debit links')
  assertSelf(sourceSql.includes('REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT'), 'DB security SQL pack must test over-refund rejection')
  assertSelf(sourceSql.includes('fake-trusted-refund-source:refund-attempt'), 'DB security SQL pack must test forged trusted-marker refund rejection')
  assertSelf(sourceSql.includes('Chargeback debt must be recorded and frozen'), 'DB security SQL pack must test chargeback debt preservation')
  assertSelf(sourceSql.includes('ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED'), 'DB security SQL pack must test missing admin-credit approval evidence')
  assertSelf(sourceSql.includes('approved admin credit with explicit approval metadata'), 'DB security SQL pack must test valid admin-credit approval evidence')
  assertSelf(sourceSql.includes('PARTNER_API_PAUSED') || sourceSql.includes('api_partners'), 'DB security SQL pack must test partner API pause or partner table authority')
  assertSelf(patchedSql !== sourceSql, 'self-test must patch the ordinary test user id')
  assertSelf(patchedSql.includes(`SELECT set_config('app.wallet_security_test_user_id', '${fixtureUserId}', false);`), 'patched SQL must contain the supplied test user id')
  assertSelf(patchedSql.includes(`SELECT set_config('app.wallet_security_test_admin_id', '${fixtureAdminId}', false);`), 'patched SQL must contain the supplied admin fixture id')
  assertSelf(!patchedSql.includes("SELECT set_config('app.wallet_security_test_user_id', '00000000-0000-0000-0000-000000000000', false);"), 'patched SQL must remove the placeholder user id')
  assertSelf(!patchedSql.includes("SELECT set_config('app.wallet_security_test_admin_id', '00000000-0000-0000-0000-000000000000', false);"), 'patched SQL must remove the placeholder admin id')
  assertSelf(!sanitized.includes(fakeUrl), 'sanitized output must redact the database URL')
  assertSelf(sanitized.includes('[DATABASE_URL_REDACTED]'), 'sanitized output must include the redaction marker')

  console.log(JSON.stringify({
    ok: true,
    checks: 15,
    source: 'docs/security/wallet-db-security-test-pack.sql',
    noDatabaseConnection: true,
  }, null, 2))
}

function assertSelf(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function printHelp() {
  console.log(`Run the wallet staging DB security test pack safely.

Usage:
  TALLYSTORE_DB_TEST_ENV=staging \\
  TALLYSTORE_DB_TEST_ACK=I_UNDERSTAND_ROLLBACK_TEST_MUTATIONS \\
  SUPABASE_DB_URL=postgres://... \\
  npm run security:wallet:db-pack -- --test-user-id <ordinary-customer-uuid> --test-admin-id <admin-profile-uuid>

Options:
  --test-user-id <uuid>  Required ordinary non-admin/non-staff profile id.
  --test-admin-id <uuid> Required current admin profile id used only to test
                         approved admin-credit evidence.
  --json                 Output a JSON result.
  --self-test            Validate SQL-pack guardrails without connecting to DB.

Timeout:
  Set TALLYSTORE_DB_TEST_TIMEOUT_MS to override the psql execution timeout.
  Default: 180000ms.

Safety:
  - Refuses production.
  - Requires an explicit rollback-mutation acknowledgement.
  - Requires an owner-controlled database role because some fixtures temporarily
    disable one trigger inside the rollback transaction to seed legacy malformed
    rows, then re-enable it before testing the hardened path.
  - Injects the ordinary test profile id and separate admin fixture id into a
    temporary copy of the SQL pack.
  - The SQL pack itself runs in one transaction and ends with ROLLBACK.
`)
}
