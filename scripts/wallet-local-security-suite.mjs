import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const compact = process.argv.includes('--compact')
const checkTimeoutMs = Number(process.env.TALLYSTORE_WALLET_LOCAL_CHECK_TIMEOUT_MS || 180_000)
const toolProbeTimeoutMs = Number(process.env.TALLYSTORE_WALLET_TOOL_PROBE_TIMEOUT_MS || 15_000)

const commands = [
  ['node', ['scripts/security-wallet-check.mjs'], 'aggregate static wallet guard'],
  ['node', ['scripts/wallet-db-concurrency-runner.mjs', '--help'], 'staging DB concurrency runner help'],
  ['node', ['scripts/wallet-db-concurrency-runner.mjs', '--self-test'], 'staging DB concurrency runner self-test'],
  ['node', ['scripts/wallet-db-security-runner.mjs', '--help'], 'staging DB security runner help'],
  ['node', ['scripts/wallet-db-security-runner.mjs', '--self-test'], 'staging DB security runner self-test'],
  ['node', ['scripts/wallet-deployed-smoke-test.mjs', '--help'], 'deployed denied-route smoke test help'],
  ['node', ['scripts/wallet-deployed-smoke-test.mjs', '--self-test'], 'deployed denied-route smoke test self-test'],
  ['node', ['scripts/wallet-deployed-smoke-test.mjs', '--validate-owner-denied-probes', 'docs/security/wallet-deployed-denied-probes.example.json'], 'owner denied-route probe file validation'],
  ['node', ['scripts/wallet-deployed-version-evidence.mjs', '--format', 'json'], 'deployment version evidence template'],
  ['node', ['scripts/wallet-deployed-version-evidence.mjs', '--filled-template'], 'fillable deployment version evidence file'],
  ['node', ['scripts/wallet-deployed-version-evidence.mjs', '--self-test'], 'deployment version evidence validator self-test'],
  ['node', ['scripts/wallet-deno-edge-check.mjs'], 'all Edge Function Deno type check'],
  ['node', ['scripts/wallet-deployment-manifest-check.mjs'], 'deployment manifest coverage'],
  ['node', ['scripts/wallet-deployment-manifest-check.mjs', '--plan'], 'machine-readable deployment plan'],
  ['node', ['scripts/wallet-deployment-manifest-check.mjs', '--self-test'], 'deployment plan validator self-test'],
  ['node', ['scripts/wallet-env-secret-check.mjs'], 'environment and secret inventory coverage'],
  ['node', ['scripts/wallet-production-evidence-check.mjs'], 'production evidence register coverage'],
  ['node', ['scripts/wallet-production-evidence-check.mjs', '--filled-template'], 'fillable production evidence file'],
  ['node', ['scripts/wallet-production-evidence-check.mjs', '--self-test'], 'production evidence register validator self-test'],
  ['node', ['scripts/wallet-owner-handoff-check.mjs'], 'owner handoff coverage'],
  ['node', ['scripts/wallet-incident-completion-audit.mjs'], 'incident deliverable completion audit'],
  ['node', ['scripts/wallet-frozen-access-model-test.mjs'], 'frozen account read-only access model'],
  ['node', ['scripts/wallet-route-inventory-check.mjs'], 'route inventory coverage'],
  ['node', ['scripts/wallet-provider-adapter-test.mjs'], 'no-network provider adapter mocks'],
  ['node', ['scripts/wallet-admin-ui-model-test.mjs'], 'admin UI date and transaction display model'],
  ['node', ['scripts/wallet-customer-ui-model-test.mjs'], 'customer UI transaction display model'],
  ['node', ['scripts/wallet-admin-review-decision-test.mjs'], 'admin review/approved credit decision model'],
  ['node', ['scripts/wallet-migration-safety-test.mjs'], 'incident migration static safety'],
  ['node', ['scripts/wallet-money-boundary-test.mjs'], 'money precision/currency boundary model'],
  ['node', ['scripts/wallet-fulfillment-decision-test.mjs'], 'fulfillment decision model'],
  ['node', ['scripts/wallet-model-sequence-test.mjs'], 'generated wallet accounting model'],
  ['node', ['scripts/wallet-outbox-decision-test.mjs'], 'outbox/queue dispatch decision model'],
  ['node', ['scripts/wallet-concurrency-decision-test.mjs'], 'local concurrency decision model'],
  ['node', ['scripts/wallet-route-decision-test.mjs'], 'route hostile-payload/idempotency model'],
  ['node', ['scripts/wallet-runtime-boundary-source-test.mjs'], 'runtime boundary source ordering'],
  ['node', ['scripts/wallet-supplier-outcome-test.mjs'], 'supplier outcome model'],
  ['node', ['scripts/wallet-trusted-principal-test.mjs'], 'trusted principal source-of-funds model'],
  ['node', ['scripts/wallet-source-mutation-audit.mjs'], 'source mutation audit'],
  ['node', ['scripts/wallet-provider-decision-test.mjs'], 'provider payment decision model'],
  ['node', ['scripts/wallet-provider-evidence-template.mjs', '--format', 'json'], 'provider evidence template'],
  ['node', ['scripts/wallet-provider-evidence-template.mjs', '--filled-template'], 'fillable provider evidence file'],
  ['node', ['scripts/wallet-provider-evidence-template.mjs', '--self-test'], 'provider evidence validator self-test'],
  ['node', ['scripts/wallet-reopen-readiness-check.mjs', '--help'], 'paid-route reopening readiness gate help'],
  ['node', ['scripts/wallet-reopen-readiness-check.mjs', '--self-test'], 'paid-route reopening readiness gate self-test'],
  ['node', ['scripts/wallet-reconcile-offline-test.mjs'], 'offline CSV reconciliation model'],
  ['node', ['scripts/wallet-reservation-decision-test.mjs'], 'reservation hold/capture/release decision model'],
  ['node', ['scripts/wallet-refund-conservation-test.mjs'], 'refund conservation model'],
  ['node', ['scripts/wallet-route-source-order-test.mjs'], 'route source ordering audit'],
  ['node', ['scripts/wallet-reconcile-readonly.mjs', '--help'], 'read-only reconciliation help'],
  ['node', ['scripts/wallet-reconcile-readonly.mjs', '--self-test'], 'read-only reconciliation self-test'],
]

const toolChecks = [
  ['docker', ['--version'], 'Supabase local database containers'],
  ['psql', ['--version'], 'direct Postgres migration/RLS tests'],
  ['deno', ['--version'], 'direct Deno binary; local suite uses npx fallback for all Edge Function type checks'],
  ['supabase', ['--version'], 'Supabase CLI'],
]

function run(command, args, description) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: checkTimeoutMs,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  })

  const timedOut = result.error?.code === 'ETIMEDOUT'
  return {
    command: [command, ...args].join(' '),
    description,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    timedOut,
    stdout: (result.stdout || '').trim().slice(-4000),
    stderr: timedOut
      ? `timed out after ${checkTimeoutMs}ms`
      : (result.stderr || '').trim().slice(-4000),
  }
}

function resolveWindowsCommand(command) {
  if (process.platform !== 'win32') return command

  const result = spawnSync('where.exe', [command], {
    cwd: root,
    encoding: 'utf8',
    timeout: toolProbeTimeoutMs,
  })

  if (result.status !== 0) return command

  return (result.stdout || '')
    .trim()
    .split(/\r?\n/)
    .find((path) => path.toLowerCase().endsWith('.cmd'))
    || (result.stdout || '').trim().split(/\r?\n/)[0]
    || command
}

function spawnTool(command, args) {
  const resolved = resolveWindowsCommand(command)

  if (process.platform === 'win32' && resolved.toLowerCase().endsWith('.cmd')) {
    return spawnSync('cmd.exe', ['/d', '/c', resolved, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: toolProbeTimeoutMs,
    })
  }

  return spawnSync(resolved, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: toolProbeTimeoutMs,
  })
}

function probe(command, args, requiredFor) {
  const result = spawnTool(command, args)

  return {
    tool: command,
    command: [command, ...args].join(' '),
    requiredFor,
    available: result.status === 0,
    version: result.status === 0 ? (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] : null,
    unavailableReason: result.status === 0
      ? null
      : (result.error?.code === 'ETIMEDOUT'
          ? `probe timed out after ${toolProbeTimeoutMs}ms`
          : ((result.stderr || result.stdout || '').trim().split(/\r?\n/)[0] || 'not available on PATH')),
  }
}

const missingScripts = commands
  .map(([, args]) => args[0])
  .filter((path) => path.startsWith('scripts/') && !existsSync(join(root, path)))

const packageWalletScriptCoverage = resolvePackageWalletScriptCoverage()

if (missingScripts.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    reason: 'missing security suite script(s)',
    missingScripts,
  }, null, 2))
  process.exit(1)
}

if (packageWalletScriptCoverage.missingFromLocalSuite.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    reason: 'package wallet security script(s) are not covered by the local security suite',
    missingFromLocalSuite: packageWalletScriptCoverage.missingFromLocalSuite,
  }, null, 2))
  process.exit(1)
}

const startedAt = new Date().toISOString()
const results = commands.map(([command, args, description]) => run(command, args, description))
const tools = toolChecks.map(([command, args, requiredFor]) => probe(command, args, requiredFor))
const failed = results.filter((result) => result.status !== 'passed')

const externalGaps = tools
  .filter((tool) => !tool.available && tool.tool !== 'supabase')
  .map((tool) => ({
    tool: tool.tool,
    requiredFor: tool.requiredFor,
    reason: tool.unavailableReason,
  }))

const summary = {
  ok: failed.length === 0,
  startedAt,
  finishedAt: new Date().toISOString(),
  outputMode: compact ? 'compact' : 'full',
  checkTimeoutMs,
  toolProbeTimeoutMs,
  localChecks: {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
  },
  packageWalletScriptCoverage,
  tools,
  externalGaps,
  results: compact
    ? results.map((result) => ({
        command: result.command,
        description: result.description,
        status: result.status,
        exitCode: result.exitCode,
        timedOut: result.timedOut || undefined,
        stdout: result.status === 'passed' ? undefined : result.stdout,
        stderr: result.status === 'passed' ? undefined : result.stderr,
      }))
    : results,
  acceptanceBoundary: [
    'This suite proves repository-local static/model/mock checks only.',
    'It does not execute Supabase migrations, RLS grants, Postgres locks, deployed routes, provider sandboxes, or production configuration.',
    'Routes must remain paused until the owner completes the staging/provider/production checks in docs/security/wallet-owner-verification-checklist.md.',
  ],
}

console.log(JSON.stringify(summary, null, 2))

if (failed.length > 0) process.exit(1)

function resolvePackageWalletScriptCoverage() {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const suiteScript = 'scripts/wallet-local-security-suite.mjs'
  const localCommandScripts = new Set(
    commands
      .map(([, args]) => args[0])
      .filter((path) => path.startsWith('scripts/') && path.endsWith('.mjs')),
  )
  const packageWalletScripts = Object.entries(packageJson.scripts || {})
    .filter(([name]) => name === 'security:wallet' || name.startsWith('security:wallet:'))
    .map(([name, command]) => ({
      name,
      script: extractNodeScript(command),
    }))
    .filter((entry) => entry.script && entry.script !== suiteScript)

  const missingFromLocalSuite = packageWalletScripts
    .filter((entry) => !localCommandScripts.has(entry.script))
    .map((entry) => `${entry.name} -> ${entry.script}`)

  return {
    packageWalletScripts: packageWalletScripts.length,
    localSuiteScripts: localCommandScripts.size,
    missingFromLocalSuite,
  }
}

function extractNodeScript(command) {
  const match = String(command).match(/^node\s+(scripts\/[^\s]+\.mjs)(?:\s|$)/)
  return match?.[1] || null
}
