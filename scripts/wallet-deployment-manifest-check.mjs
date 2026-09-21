import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const outputPlan = process.argv.includes('--plan')
const selfTest = process.argv.includes('--self-test')
const validatePlanPath = argValue('--validate-plan')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const manifest = read('docs/security/wallet-deployment-manifest.md')
const normalizedManifest = manifest.replace(/\s+/g, ' ')
const worktreeChangedFunctionPaths = gitChangedPaths('supabase/functions')
const worktreeChangedFunctionNames = [...new Set(
  worktreeChangedFunctionPaths
    .map((path) => path.match(/^supabase\/functions\/([^/_][^/]*)\/index\.ts$/)?.[1])
    .filter(Boolean),
)].sort()
const sharedFunctionFilesChanged = worktreeChangedFunctionPaths
  .some((path) => path.startsWith('supabase/functions/_shared/'))

const requiredMigrations = [
  '20260914007000_fix_security_definer_public_views.sql',
  ...readdirSync(join(root, 'supabase', 'migrations'))
    .filter((file) => /^202609(?:17|19).+\.sql$/i.test(file))
    .sort(),
]

const legacyReplayMigrations = [
  '20260914006000_normalize_ledger_suspension_checks.sql',
  '20260914011000_harden_crypto_transfer_and_fraud_credits.sql',
  '20260914012000_reset_auto_fraud_suspensions.sql',
]

const changedFunctions = [
  'admin-adjust-balance',
  'apply-referral',
  'auto-restock',
  'check-pending-payments',
  'create-crypto-sell-order',
  'create-pocketfi-topup',
  'create-wallet-topup',
  'create-withdrawal-request',
  'manage-staff',
  'manual-restock',
  'muabanvia-fulfill',
  'nowpayments-webhook',
  'partner-api',
  'process-purchase',
  'purchase-bills',
  'purchase-bitrefill',
  'record-site-visit',
  'revenue-os-loop',
  'revenue-os-maintenance',
  'smm-check-all-orders',
  'smm-check-status',
  'smm-create-order',
  'smsbus',
  'telegram-stars',
  'verify-and-credit-wallet',
  'webhook-pocketfi',
  'withdraw-referral-balance',
]

const existingSecurityFunctions = [
  'apply-referral',
  'check-pending-payments',
  'nowpayments-webhook',
  'partner-api',
  'record-site-visit',
  'revenue-os-maintenance',
  'smm-check-all-orders',
  'smsbus',
  'webhook-pocketfi',
]

const edgeFunctions = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .filter((entry) => existsSync(join(root, 'supabase', 'functions', entry.name, 'index.ts')))
  .map((entry) => entry.name)
  .sort()

const jwtDisabledFunctions = edgeFunctions
  .filter((name) => {
    const configPath = join('supabase', 'functions', name, 'config.toml')
    return existsSync(join(root, configPath)) && read(configPath).includes('verify_jwt = false')
  })
  .sort()

const vercelSurfaces = [
  'api/partner-api.ts',
  'api/webhook-ercas.ts',
  'api/webhook-istar.ts',
  'api/webhook-pocketfi.ts',
  'pages/api/webhook/ercas.ts',
  'src/components/CryptoBalanceCard.tsx',
  'src/contexts/SimpleAuth.tsx',
  'src/hooks/useAuth.ts',
  'src/hooks/useRecommendations.ts',
  'src/lib/productAvailability.ts',
  'src/lib/supabase.ts',
  'src/pages/AdminPage.tsx',
  'src/pages/BillsPayment.tsx',
  'src/pages/GiftCardsEsims.tsx',
  'src/pages/OrderHistoryPage.tsx',
  'src/pages/SupportPage.tsx',
]

const pauseFlags = [
  'BILLS_ENABLED=false',
  'BITREFILL_ENABLED=false',
  'WITHDRAWALS_ENABLED=false',
  'REFERRAL_WITHDRAWALS_ENABLED=false',
  'CRYPTO_TOPUP_ENABLED=false',
  'SMM_ORDERS_ENABLED=false',
  'SMS_OTP_ENABLED=false',
  'TELEGRAM_ORDERS_ENABLED=false',
  'LIVE_ACCOUNT_FULFILLMENT_ENABLED=false',
  'AUTO_RESTOCK_ENABLED=false',
  'MANUAL_RESTOCK_ENABLED=false',
]

const manifestDeployFunctionNames = [...manifest.matchAll(/^supabase functions deploy ([a-z0-9-]+)$/gm)]
  .map((match) => match[1])
  .sort()

const preDeployCommands = [
  'npm run security:wallet:local',
  'npm run security:wallet:admin-review',
  'npm run security:wallet',
  'npm run security:wallet:db-pack -- --help',
  'npm run security:wallet:db-concurrency -- --help',
  'npm run security:wallet:deployed-smoke -- --help',
  'npm run security:wallet:env-secrets',
  'npm run security:wallet:evidence',
  'npm run security:wallet:deployed-versions -- --format json',
  'npm run security:wallet:deployed-versions -- --filled-template',
  'npm run security:wallet:deployed-versions -- --self-test',
  'npm run security:wallet:migrations',
  'npm run security:wallet:deploy-manifest',
  'npm run security:wallet:deploy-manifest -- --self-test',
  'npm run security:wallet:handoff',
  'npm run security:wallet:audit',
  'npm run security:wallet:provider-evidence -- --format json',
  'npm run security:wallet:provider-evidence -- --filled-template',
  'npm run security:wallet:provider-evidence -- --self-test',
  'npm run security:wallet:reservations',
  'npm run build',
]

const postDeployProofFields = [
  'deployed app version',
  'deployed function versions',
  'migrations applied through',
  'restricted-role DB test result',
  'provider sandbox/dashboard result',
  'denied-order supplier-call count',
  'credential reveal count for denied order',
  'production evidence link/path',
  'reviewer',
  'timestamp',
]

for (const command of [
  ...preDeployCommands,
  'supabase db push',
]) {
  assert(manifest.includes(command), `deployment manifest missing command: ${command}`)
}

for (const migration of requiredMigrations) {
  assert(manifest.includes(migration), `deployment manifest missing migration ${migration}`)
}

for (const migration of legacyReplayMigrations) {
  assert(manifest.includes(migration), `deployment manifest missing legacy replay migration ${migration}`)
}

for (const fn of changedFunctions) {
  assert(manifest.includes(`supabase functions deploy ${fn}`), `deployment manifest missing deploy command for ${fn}`)
}

for (const fn of worktreeChangedFunctionNames) {
  assert(
    manifest.includes(`supabase functions deploy ${fn}`),
    `deployment manifest missing deploy command for currently changed function ${fn}`,
  )
}

if (sharedFunctionFilesChanged) {
  assert(
    manifest.includes('Shared code is bundled through importing functions, so deploy every function'),
    'deployment manifest must warn that changed shared function code requires redeploying importing functions',
  )
}

for (const fn of existingSecurityFunctions) {
  assert(manifest.includes(fn), `deployment manifest missing security-sensitive existing function ${fn}`)
}

for (const fn of jwtDisabledFunctions) {
  assert(manifest.includes(fn), `deployment manifest missing JWT-disabled function ${fn}`)
}

for (const phrase of [
  'From source `config.toml`, the currently JWT-disabled functions are',
  'Every JWT-disabled deployed function must still match this source list',
  'All other deployed Edge Functions should keep Supabase JWT verification enabled',
]) {
  assert(normalizedManifest.includes(phrase), `deployment manifest missing JWT config boundary: ${phrase}`)
}

for (const surface of vercelSurfaces) {
  assert(manifest.includes(surface), `deployment manifest missing Vercel/site surface ${surface}`)
}

for (const flag of pauseFlags) {
  assert(manifest.includes(flag), `deployment manifest missing pause flag ${flag}`)
}

for (const proof of [
  'PARTNER_API_PAUSED',
  'Legacy Ercas Vercel webhook routes return `410`',
  'PocketFi bridge rejects unsigned requests',
  'iStar bridge rejects invalid signatures',
  'Rollback rule',
  'Do not reopen any paused route',
  'deployed function versions',
  'provider sandbox/dashboard result',
]) {
  assert(manifest.includes(proof), `deployment manifest missing proof boundary: ${proof}`)
}

for (const field of postDeployProofFields) {
  assert(manifest.includes(`${field}:`), `deployment manifest missing post-deploy proof field ${field}`)
}

const summary = {
  ok: true,
  migrations: requiredMigrations.length,
  legacyReplayMigrations: legacyReplayMigrations.length,
  changedFunctions: changedFunctions.length,
  deployFunctions: manifestDeployFunctionNames.length,
  worktreeChangedFunctions: worktreeChangedFunctionNames.length,
  sharedFunctionFilesChanged,
  existingSecurityFunctions: existingSecurityFunctions.length,
  jwtDisabledFunctions: jwtDisabledFunctions.length,
  vercelSurfaces: vercelSurfaces.length,
  pauseFlags: pauseFlags.length,
}

if (selfTest) {
  runSelfTest()
} else if (validatePlanPath) {
  console.log(JSON.stringify(validateDeploymentPlanFile(validatePlanPath), null, 2))
} else {
  console.log(JSON.stringify(outputPlan ? buildDeploymentPlan(summary) : summary, null, 2))
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : ''
}

function gitChangedPaths(pathspec) {
  const result = spawnSync('git', ['status', '--short', '--', pathspec], {
    cwd: root,
    encoding: 'utf8',
  })

  assert(result.status === 0, `git status failed while checking deployment manifest coverage: ${result.stderr || result.stdout}`)

  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => line.includes(' -> ') ? line.split(' -> ').pop() : line)
    .map((line) => line.replaceAll('\\', '/'))
}

function buildDeploymentPlan(summary) {
  const deployCommands = manifestDeployFunctionNames.map((name) => ({
    function: name,
    command: `supabase functions deploy ${name}`,
  }))

  return {
    ...summary,
    mode: 'deployment-plan',
    generatedAt: new Date().toISOString(),
    preDeployLocalGates: preDeployCommands,
    database: {
      command: 'supabase db push',
      requiredMigrations,
      legacyReplayMigrations,
      boundary: 'Apply migrations before deploying functions; preserve SQL output if using SQL editor instead of CLI.',
    },
    supabaseFunctions: {
      count: deployCommands.length,
      deployCommands,
      sharedFunctionFilesChanged,
      boundary: sharedFunctionFilesChanged
        ? 'Shared function code changed; deploy every listed function, not only directly edited routes.'
        : 'Deploy every listed changed/security-sensitive function before smoke tests.',
    },
    vercelOrSite: {
      redeployRequired: true,
      surfaces: vercelSurfaces,
      requiredChecks: [
        'public partner API returns PARTNER_API_PAUSED',
        'legacy Ercas Vercel webhook routes return 410',
        'PocketFi bridge rejects unsigned requests before proxying',
        'iStar bridge rejects invalid signatures',
        'crypto transfer UI is not visible',
        'frozen customers can read order/support history but cannot make new paid purchases',
      ],
    },
    pauseFlags,
    postDeployProofFields,
    rollbackBoundary: [
      'If migration or function deploy fails, keep paid/provider routes paused.',
      'Do not roll back to a version that restores direct wallet writes, partner API checkout, crypto auto-credit, or unverified provider fulfillment.',
      'Do not reopen any paid route until readiness evidence validates and owner approval is recorded.',
    ],
    evidenceCommands: [
      'npm run security:wallet:deployed-versions -- --filled-template',
      'npm run security:wallet:provider-evidence -- --filled-template',
      'npm run security:wallet:evidence -- --filled-template',
      'npm run security:wallet:reopen-readiness -- --init-bundle C:\\private\\wallet-reopen-evidence',
    ],
  }
}

function validateDeploymentPlanFile(path) {
  assert(path, 'Provide --validate-plan deployment-plan.json')

  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`failed to read deployment plan ${path}: ${error.message}`)
  }

  return validateDeploymentPlanObject(parsed)
}

function validateDeploymentPlanObject(plan) {
  const expectedPlan = buildDeploymentPlan(summary)
  const issues = []

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    issues.push(issue('PLAN_NOT_OBJECT', 'deployment plan must be a JSON object'))
    return deploymentValidationResult(issues)
  }

  if (plan.mode !== 'deployment-plan') {
    issues.push(issue('MODE_MISMATCH', 'deployment plan mode must be deployment-plan'))
  }

  if (!isIsoDate(plan.generatedAt)) {
    issues.push(issue('INVALID_GENERATED_AT', 'generatedAt must be an ISO timestamp'))
  }

  comparePrimitive(plan.database?.command, expectedPlan.database.command, 'DATABASE_COMMAND', issues)
  compareArray(plan.database?.requiredMigrations, expectedPlan.database.requiredMigrations, 'DATABASE_MIGRATIONS', issues)
  compareArray(plan.database?.legacyReplayMigrations, expectedPlan.database.legacyReplayMigrations, 'LEGACY_REPLAY_MIGRATIONS', issues)
  compareArray(plan.preDeployLocalGates, expectedPlan.preDeployLocalGates, 'PRE_DEPLOY_LOCAL_GATES', issues)
  compareArray(plan.vercelOrSite?.surfaces, expectedPlan.vercelOrSite.surfaces, 'VERCEL_SURFACES', issues)
  compareArray(plan.pauseFlags, expectedPlan.pauseFlags, 'PAUSE_FLAGS', issues)
  compareArray(plan.postDeployProofFields, expectedPlan.postDeployProofFields, 'POST_DEPLOY_PROOF_FIELDS', issues)
  compareArray(plan.rollbackBoundary, expectedPlan.rollbackBoundary, 'ROLLBACK_BOUNDARY', issues)
  compareArray(plan.evidenceCommands, expectedPlan.evidenceCommands, 'EVIDENCE_COMMANDS', issues)

  const deployCommands = plan.supabaseFunctions?.deployCommands
  if (!Array.isArray(deployCommands)) {
    issues.push(issue('DEPLOY_COMMANDS_MISSING', 'supabaseFunctions.deployCommands must be an array'))
  } else {
    const normalizedDeployCommands = deployCommands.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        issues.push(issue('DEPLOY_COMMAND_INVALID', `deploy command row ${index} must be an object`))
        return ''
      }
      if (entry.command !== `supabase functions deploy ${entry.function}`) {
        issues.push(issue('DEPLOY_COMMAND_MISMATCH', `deploy command for row ${index} does not match its function name`))
      }
      return `${entry.function}:${entry.command}`
    })

    compareArray(
      normalizedDeployCommands,
      expectedPlan.supabaseFunctions.deployCommands.map((entry) => `${entry.function}:${entry.command}`),
      'SUPABASE_FUNCTION_DEPLOY_COMMANDS',
      issues,
    )
  }

  comparePrimitive(plan.supabaseFunctions?.count, expectedPlan.supabaseFunctions.count, 'SUPABASE_FUNCTION_COUNT', issues)
  comparePrimitive(plan.supabaseFunctions?.sharedFunctionFilesChanged, expectedPlan.supabaseFunctions.sharedFunctionFilesChanged, 'SHARED_FUNCTION_FLAG', issues)
  comparePrimitive(plan.vercelOrSite?.redeployRequired, true, 'VERCEL_REDEPLOY_REQUIRED', issues)

  for (const requiredText of [
    'Do not roll back to a version that restores direct wallet writes',
    'Do not reopen any paid route until readiness evidence validates',
    'npm run security:wallet:reopen-readiness -- --init-bundle',
  ]) {
    if (!JSON.stringify(plan).includes(requiredText)) {
      issues.push(issue('SAFETY_BOUNDARY_MISSING', `deployment plan missing required boundary text: ${requiredText}`))
    }
  }

  const secretLikeValues = findSecretLikeValues(plan)
  for (const valuePath of secretLikeValues) {
    issues.push(issue('SECRET_LIKE_VALUE', `deployment plan contains a secret-looking value at ${valuePath}`))
  }

  return deploymentValidationResult(issues)
}

function comparePrimitive(actual, expected, code, issues) {
  if (actual !== expected) {
    issues.push(issue(code, `expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`))
  }
}

function compareArray(actual, expected, code, issues) {
  if (!Array.isArray(actual)) {
    issues.push(issue(`${code}_MISSING`, `${code} must be an array`))
    return
  }

  const normalizedActual = actual.map((item) => String(item)).sort()
  const normalizedExpected = expected.map((item) => String(item)).sort()

  if (new Set(normalizedActual).size !== normalizedActual.length) {
    issues.push(issue(`${code}_DUPLICATE`, `${code} contains duplicate entries`))
  }

  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    issues.push(issue(`${code}_MISMATCH`, `${code} does not match the current reviewed repository plan`))
  }
}

function deploymentValidationResult(issues) {
  return {
    ok: issues.length === 0,
    mode: 'validate-deployment-plan',
    issues,
    summary: {
      migrations: requiredMigrations.length,
      legacyReplayMigrations: legacyReplayMigrations.length,
      deployFunctions: manifestDeployFunctionNames.length,
      vercelSurfaces: vercelSurfaces.length,
      pauseFlags: pauseFlags.length,
      postDeployProofFields: postDeployProofFields.length,
    },
  }
}

function issue(code, message) {
  return { code, message }
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function findSecretLikeValues(value, path = '$', found = []) {
  if (typeof value === 'string') {
    if (looksSecretLike(value)) found.push(path)
    return found
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecretLikeValues(item, `${path}[${index}]`, found))
    return found
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findSecretLikeValues(item, `${path}.${key}`, found))
  }

  return found
}

function looksSecretLike(value) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\b(?:service[_-]?role|api[_-]?secret|webhook[_-]?secret|private[_-]?key|bearer\s+[a-z0-9._-]{20,})\b/i.test(trimmed)) return true
  if (/\b(?:sk_live|sk_test|rk_live|supabase_service_role|nowpayments|pocketfi|ercas)_[a-z0-9_=-]{16,}\b/i.test(trimmed)) return true
  if (/^[A-Za-z0-9+/=_-]{48,}$/.test(trimmed) && !trimmed.includes(' ')) return true
  return false
}

function runSelfTest() {
  const plan = buildDeploymentPlan(summary)
  const valid = validateDeploymentPlanObject(plan)
  assert(valid.ok, `valid deployment plan failed validation: ${JSON.stringify(valid.issues)}`)

  const staleMigration = structuredClone(plan)
  staleMigration.database.requiredMigrations = staleMigration.database.requiredMigrations.slice(1)
  assert(
    validateDeploymentPlanObject(staleMigration).issues.some((item) => item.code === 'DATABASE_MIGRATIONS_MISMATCH'),
    'stale deployment plan migration list was accepted',
  )

  const staleDeployCommand = structuredClone(plan)
  staleDeployCommand.supabaseFunctions.deployCommands = staleDeployCommand.supabaseFunctions.deployCommands.slice(1)
  assert(
    validateDeploymentPlanObject(staleDeployCommand).issues.some((item) => item.code === 'SUPABASE_FUNCTION_DEPLOY_COMMANDS_MISMATCH'),
    'stale deployment plan function deploy list was accepted',
  )

  const missingBoundary = structuredClone(plan)
  missingBoundary.rollbackBoundary = []
  const missingBoundaryResult = validateDeploymentPlanObject(missingBoundary)
  assert(
    missingBoundaryResult.issues.some((item) => item.code === 'ROLLBACK_BOUNDARY_MISMATCH')
      && missingBoundaryResult.issues.some((item) => item.code === 'SAFETY_BOUNDARY_MISSING'),
    'deployment plan without rollback/reopen boundaries was accepted',
  )

  const secretLeak = structuredClone(plan)
  secretLeak.evidenceCommands = [...secretLeak.evidenceCommands, 'service_role_secret_abcdefghijklmnopqrstuvwxyz1234567890']
  assert(
    validateDeploymentPlanObject(secretLeak).issues.some((item) => item.code === 'SECRET_LIKE_VALUE'),
    'deployment plan with secret-looking value was accepted',
  )

  console.log(JSON.stringify({
    ok: true,
    mode: 'deployment-plan-self-test',
    checks: 5,
  }, null, 2))
}
