import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

const initBundlePath = args.get('init-bundle')
if (initBundlePath && initBundlePath !== 'true') {
  const result = createEvidenceBundle(initBundlePath)
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

const result = validateReopenReadiness({
  deploymentPlan: args.get('deployment-plan'),
  deployedVersionEvidence: args.get('deployed-version-evidence'),
  productionEvidence: args.get('production-evidence'),
  providerEvidence: args.get('provider-evidence'),
  deniedProbes: args.get('denied-probes'),
  deployedSmokeResult: args.get('deployed-smoke-result'),
})

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)

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

function validateReopenReadiness(paths) {
  const issues = []
  const evidence = {}

  const requiredFiles = [
    ['deploymentPlan', 'DEPLOYMENT_PLAN_MISSING', 'validated deployment plan file'],
    ['deployedVersionEvidence', 'DEPLOYED_VERSION_EVIDENCE_MISSING', 'validated deployed-version evidence file'],
    ['productionEvidence', 'PRODUCTION_EVIDENCE_MISSING', 'validated production evidence file'],
    ['providerEvidence', 'PROVIDER_EVIDENCE_MISSING', 'validated provider evidence file'],
    ['deniedProbes', 'DENIED_PROBES_MISSING', 'owner denied-route probe definition file'],
    ['deployedSmokeResult', 'DEPLOYED_SMOKE_RESULT_MISSING', 'deployed smoke result JSON file'],
  ]

  for (const [key, code, description] of requiredFiles) {
    const path = paths[key]
    if (!path || path === 'true') {
      issues.push(issue(key, code, `Provide --${kebab(key)} with a ${description}.`))
      continue
    }
    if (!existsSync(resolvePath(path))) {
      issues.push(issue(key, 'FILE_NOT_FOUND', `${description} was not found: ${path}`))
    }
  }

  if (issues.length === 0) {
    evidence.deploymentPlan = runValidator('scripts/wallet-deployment-manifest-check.mjs', ['--validate-plan', paths.deploymentPlan])
    evidence.deployedVersionEvidence = runValidator('scripts/wallet-deployed-version-evidence.mjs', ['--validate', paths.deployedVersionEvidence])
    evidence.productionEvidence = runValidator('scripts/wallet-production-evidence-check.mjs', ['--validate', paths.productionEvidence])
    evidence.providerEvidence = runValidator('scripts/wallet-provider-evidence-template.mjs', ['--validate', paths.providerEvidence])
    evidence.deniedProbes = runValidator('scripts/wallet-deployed-smoke-test.mjs', ['--validate-owner-denied-probes', paths.deniedProbes])
    evidence.deployedSmokeResult = validateDeployedSmokeResult(paths.deployedSmokeResult)

    for (const [key, check] of Object.entries(evidence)) {
      if (!check.ok) {
        issues.push(issue(key, 'VALIDATION_FAILED', `${key} did not pass readiness validation`))
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    requiredEvidenceFiles: requiredFiles.map(([key]) => key),
    issues,
    evidence,
    acceptanceBoundary: [
      'This is a fail-closed reopening gate for evidence files only.',
      'It does not contact production, providers, Supabase, Vercel, or supplier APIs.',
      'A paid route should remain paused unless this gate passes and the owner has separately applied the matching deployment and database changes.',
    ],
  }
}

function runValidator(script, scriptArgs) {
  const child = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  const parsed = parseJson(child.stdout)
  return {
    ok: child.status === 0 && parsed?.ok === true,
    exitCode: child.status,
    script,
    stderr: redact(child.stderr).trim(),
    summary: parsed ?? redact(child.stdout).slice(0, 500),
  }
}

function validateDeployedSmokeResult(path) {
  const issues = []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(resolvePath(path), 'utf8'))
  } catch (error) {
    return {
      ok: false,
      issues: [issue('deployedSmokeResult', 'INVALID_JSON', error instanceof Error ? error.message : String(error))],
    }
  }

  if (parsed?.ok !== true) issues.push(issue('deployedSmokeResult', 'SMOKE_NOT_OK', 'deployed smoke result must have ok: true'))
  if (!['staging', 'preview', 'production'].includes(String(parsed?.environment || '').toLowerCase())) {
    issues.push(issue('deployedSmokeResult', 'INVALID_ENVIRONMENT', 'environment must be staging, preview, or production'))
  }
  if (!isHttpsUrl(parsed?.baseUrl)) issues.push(issue('deployedSmokeResult', 'BASE_URL_REQUIRED', 'baseUrl must be an https URL'))
  if (!isHttpsUrl(parsed?.functionsBaseUrl)) {
    issues.push(issue('deployedSmokeResult', 'FUNCTIONS_BASE_URL_REQUIRED', 'functionsBaseUrl must be present and https before reopening paid Edge routes'))
  }
  if (parsed?.edgeAuthorizationProvided !== true) {
    issues.push(issue('deployedSmokeResult', 'EDGE_AUTH_REQUIRED', 'paused Edge Function smoke checks must run with owner-provided authorization'))
  }
  if (!Number.isInteger(parsed?.ownerDeniedProbesLoaded) || parsed.ownerDeniedProbesLoaded <= 0) {
    issues.push(issue('deployedSmokeResult', 'OWNER_DENIED_PROBES_REQUIRED', 'owner denied probes must be loaded and tested before reopening'))
  }
  if (!Number.isInteger(parsed?.total) || parsed.total <= 0) {
    issues.push(issue('deployedSmokeResult', 'TOTAL_REQUIRED', 'smoke result must include at least one executed probe'))
  }
  if (parsed?.failed !== 0) issues.push(issue('deployedSmokeResult', 'FAILED_PROBES', 'smoke result must have zero failed probes'))
  if (parsed?.passed !== parsed?.total) issues.push(issue('deployedSmokeResult', 'PASSED_TOTAL_MISMATCH', 'passed count must equal total count'))
  if (!isValidTimestamp(parsed?.startedAt) || !isValidTimestamp(parsed?.finishedAt)) {
    issues.push(issue('deployedSmokeResult', 'TIMESTAMPS_REQUIRED', 'startedAt and finishedAt must be parseable absolute timestamps'))
  }
  if (!Array.isArray(parsed?.results) || parsed.results.length !== parsed.total) {
    issues.push(issue('deployedSmokeResult', 'RESULTS_MISMATCH', 'results array length must equal total count'))
  } else {
    for (const [index, row] of parsed.results.entries()) {
      if (row?.passed !== true) issues.push(issue(`deployedSmokeResult.results[${index}]`, 'PROBE_NOT_PASSED', 'every deployed smoke probe must pass'))
      if (!String(row?.name || '').trim() || !String(row?.path || '').trim()) {
        issues.push(issue(`deployedSmokeResult.results[${index}]`, 'PROBE_IDENTITY_MISSING', 'every probe needs a name and path'))
      }
      if (row?.body && looksSecret(JSON.stringify(row.body))) {
        issues.push(issue(`deployedSmokeResult.results[${index}]`, 'SECRET_LIKE_VALUE', 'probe body looks like it may contain a secret'))
      }
    }
  }
  const boundaries = Array.isArray(parsed?.acceptanceBoundary) ? parsed.acceptanceBoundary.join('\n') : ''
  if (!/Do not reopen a paused paid route/i.test(boundaries)) {
    issues.push(issue('deployedSmokeResult', 'BOUNDARY_MISSING', 'smoke result must preserve the no-reopen boundary text'))
  }

  return {
    ok: issues.length === 0,
    issues,
    environment: parsed?.environment,
    total: parsed?.total,
    passed: parsed?.passed,
    ownerDeniedProbesLoaded: parsed?.ownerDeniedProbesLoaded,
  }
}

function createEvidenceBundle(targetDir) {
  const dir = resolvePath(targetDir)
  mkdirSync(dir, { recursive: true })

  const deployedVersionPath = join(dir, 'deployed-version-evidence.json')
  const deploymentPlanPath = join(dir, 'deployment-plan.json')
  const productionPath = join(dir, 'production-evidence.json')
  const providerPath = join(dir, 'provider-evidence.json')
  const deniedProbesPath = join(dir, 'denied-probes.json')
  const deployedSmokePath = join(dir, 'deployed-smoke-result.json')
  const readmePath = join(dir, 'README.md')

  writeJson(dir, 'deployment-plan.json', childJson('scripts/wallet-deployment-manifest-check.mjs', ['--plan']))
  writeJson(dir, 'deployed-version-evidence.json', childJson('scripts/wallet-deployed-version-evidence.mjs', ['--filled-template']))
  writeJson(dir, 'production-evidence.json', childJson('scripts/wallet-production-evidence-check.mjs', ['--filled-template']))
  writeJson(dir, 'provider-evidence.json', childJson('scripts/wallet-provider-evidence-template.mjs', ['--filled-template']))
  copyFileSync(join(root, 'docs/security/wallet-deployed-denied-probes.example.json'), deniedProbesPath)
  writeJson(dir, 'deployed-smoke-result.json', buildDeployedSmokeResultTemplate())
  writeFileSync(readmePath, buildBundleReadme({
    deployedVersionPath,
    deploymentPlanPath,
    productionPath,
    providerPath,
    deniedProbesPath,
    deployedSmokePath,
  }))

  return {
    ok: true,
    createdAt: new Date().toISOString(),
    directory: dir,
    files: {
      deployedVersionEvidence: deployedVersionPath,
      deploymentPlan: deploymentPlanPath,
      productionEvidence: productionPath,
      providerEvidence: providerPath,
      deniedProbes: deniedProbesPath,
      deployedSmokeResult: deployedSmokePath,
      readme: readmePath,
    },
    nextSteps: [
      'Validate deployment-plan.json to prove the saved deployment commands still match the reviewed repository.',
      'Fill deployed-version-evidence.json from Vercel/Supabase/database/pause-flag dashboards, then validate it.',
      'Fill production-evidence.json and provider-evidence.json with sanitized owner-controlled proof references, then validate them.',
      'Replace denied-probes.json placeholders with owner-controlled staging/production denied-checkout values and validate it.',
      'Run deployed smoke with --json and save the real output over deployed-smoke-result.json.',
      'Run npm run security:wallet:reopen-readiness with these six files before reopening any paid route.',
    ],
    acceptanceBoundary: [
      'The generated files are templates, not proof.',
      'Do not store secrets, tokens, cookies, raw private webhook payloads, customer credentials, or product credentials in this bundle.',
      'A route remains paused until the filled bundle validates and owner approval is recorded.',
    ],
  }
}

function buildDeployedSmokeResultTemplate() {
  return {
    ok: false,
    environment: '',
    baseUrl: '',
    functionsBaseUrl: '',
    edgeAuthorizationProvided: false,
    cronSecretProvided: false,
    ownerDeniedProbesLoaded: 0,
    requestTimeoutMs: 15_000,
    startedAt: '',
    finishedAt: '',
    total: 0,
    passed: 0,
    failed: 0,
    results: [],
    acceptanceBoundary: [
      'This placeholder must be replaced with real output from npm run security:wallet:deployed-smoke -- --json.',
      'Do not reopen a paused paid route solely because this smoke test passes.',
    ],
  }
}

function buildBundleReadme(paths) {
  return `# Wallet Reopening Evidence Bundle

Generated: ${new Date().toISOString()}

This directory is private operator evidence. Do not commit it if it contains
deployment references, private staging values, support references, customer
data, provider dashboard references, or smoke-test output.

## Files

- \`${paths.deployedVersionPath}\`: fill from Vercel, Supabase function,
  migration, and pause-flag dashboards.
- \`${paths.deploymentPlanPath}\`: preserve the generated machine-readable
  deployment plan and validate it against the reviewed repository before
  reopening.
- \`${paths.productionPath}\`: fill with sanitized production/staging proof for
  every production evidence area.
- \`${paths.providerPath}\`: fill with sanitized provider sandbox/dashboard
  proof and link every provider row to deployed-version evidence.
- \`${paths.deniedProbesPath}\`: replace placeholders with owner-controlled
  denied-checkout probe values.
- \`${paths.deployedSmokePath}\`: replace the placeholder with real
  \`security:wallet:deployed-smoke -- --json\` output.

## Validation Commands

\`\`\`powershell
npm run security:wallet:deploy-manifest -- --validate-plan "${paths.deploymentPlanPath}"
npm run security:wallet:deployed-versions -- --validate "${paths.deployedVersionPath}"
npm run security:wallet:evidence -- --validate "${paths.productionPath}"
npm run security:wallet:provider-evidence -- --validate "${paths.providerPath}"
npm run security:wallet:deployed-smoke -- --validate-owner-denied-probes "${paths.deniedProbesPath}"
npm run security:wallet:reopen-readiness -- --deployment-plan "${paths.deploymentPlanPath}" --deployed-version-evidence "${paths.deployedVersionPath}" --production-evidence "${paths.productionPath}" --provider-evidence "${paths.providerPath}" --denied-probes "${paths.deniedProbesPath}" --deployed-smoke-result "${paths.deployedSmokePath}"
\`\`\`

## Deployed Smoke Output

Run the deployed smoke command separately against staging/preview/production
with the required owner-controlled environment variables, then write its JSON
output to \`${paths.deployedSmokePath}\`.

\`\`\`powershell
$env:TALLYSTORE_DEPLOYED_SMOKE_ENV="staging"
$env:TALLYSTORE_DEPLOYED_SMOKE_ACK="I_UNDERSTAND_NO_ORDER_CREATION"
$env:TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES="${paths.deniedProbesPath}"
$env:TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK="I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED"
npm run security:wallet:deployed-smoke -- --base-url https://your-deployment.example --functions-base-url https://your-functions.example --json > "${paths.deployedSmokePath}"
\`\`\`

The generated files are templates, not proof. Keep paid routes paused until the
filled bundle validates and the owner records approval for the exact route.
`
}

function runSelfTest() {
  const dir = join(root, '.wallet-reopen-readiness-self-test')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const scaffold = createEvidenceBundle(join(dir, 'bundle'))
    assert(scaffold.ok, 'bundle scaffold should be created')
    for (const path of Object.values(scaffold.files)) {
      assert(existsSync(path), `bundle scaffold missing ${path}`)
    }
    const scaffoldReadiness = validateReopenReadiness({
      deploymentPlan: scaffold.files.deploymentPlan,
      deployedVersionEvidence: scaffold.files.deployedVersionEvidence,
      productionEvidence: scaffold.files.productionEvidence,
      providerEvidence: scaffold.files.providerEvidence,
      deniedProbes: scaffold.files.deniedProbes,
      deployedSmokeResult: scaffold.files.deployedSmokeResult,
    })
    assert(!scaffoldReadiness.ok, 'fresh template bundle should not pass readiness before owner proof is filled')

    const deployedVersion = completeDeployedVersionEvidence()
    const production = completeProductionEvidence()
    const provider = completeProviderEvidence()
    const smoke = completeSmokeResult()

    const deploymentPlanPath = writeJson(dir, 'deployment-plan.json', childJson('scripts/wallet-deployment-manifest-check.mjs', ['--plan']))
    const deployedPath = writeJson(dir, 'deployed-version.json', deployedVersion)
    const productionPath = writeJson(dir, 'production.json', production)
    const providerPath = writeJson(dir, 'provider.json', provider)
    const smokePath = writeJson(dir, 'smoke.json', smoke)
    const deniedProbePath = join(root, 'docs/security/wallet-deployed-denied-probes.example.json')

    const passed = validateReopenReadiness({
      deploymentPlan: deploymentPlanPath,
      deployedVersionEvidence: deployedPath,
      productionEvidence: productionPath,
      providerEvidence: providerPath,
      deniedProbes: deniedProbePath,
      deployedSmokeResult: smokePath,
    })
    assert(passed.ok, `complete readiness fixture should pass: ${JSON.stringify(passed.issues)}`)

    const missing = validateReopenReadiness({})
    assert(!missing.ok && missing.issues.some((item) => item.code === 'DEPLOYED_VERSION_EVIDENCE_MISSING'), 'missing evidence files should fail')

    const pendingProduction = structuredClone(production)
    pendingProduction.areas[0].status = 'pending'
    const pendingProductionPath = writeJson(dir, 'production-pending.json', pendingProduction)
    const pending = validateReopenReadiness({
      deploymentPlan: deploymentPlanPath,
      deployedVersionEvidence: deployedPath,
      productionEvidence: pendingProductionPath,
      providerEvidence: providerPath,
      deniedProbes: deniedProbePath,
      deployedSmokeResult: smokePath,
    })
    assert(!pending.ok && pending.evidence.productionEvidence.ok === false, 'pending production evidence should fail')

    const unsafeSmoke = structuredClone(smoke)
    unsafeSmoke.ownerDeniedProbesLoaded = 0
    const unsafeSmokePath = writeJson(dir, 'smoke-unsafe.json', unsafeSmoke)
    const unsafe = validateReopenReadiness({
      deploymentPlan: deploymentPlanPath,
      deployedVersionEvidence: deployedPath,
      productionEvidence: productionPath,
      providerEvidence: providerPath,
      deniedProbes: deniedProbePath,
      deployedSmokeResult: unsafeSmokePath,
    })
    assert(!unsafe.ok && unsafe.evidence.deployedSmokeResult.issues.some((item) => item.code === 'OWNER_DENIED_PROBES_REQUIRED'), 'smoke result without owner denied probes should fail')

    console.log(JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      failureBranchesChecked: 4,
      bundleScaffold: true,
      readinessGate: true,
    }, null, 2))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function completeDeployedVersionEvidence() {
  const template = childJson('scripts/wallet-deployed-version-evidence.mjs', ['--filled-template'])
  return {
    ...template,
    source: {
      ...template.source,
      dirtyArtifactApprovedBy: 'owner',
      dirtyArtifactApprovedAt: '2026-09-20T00:00:00Z',
      dirtyArtifactEvidencePathOrLink: 'private-evidence/dirty-source-artifact-review.json',
      dirtyArtifactReviewNote: 'sanitized owner-controlled approval reference',
    },
    surfaces: template.surfaces.map((surface) => ({
      ...surface,
      status: 'passed',
      deployedReference: `deploy-${safeId(surface.id)}`,
      observedFingerprintOrVersion: surface.expectedSourceFingerprint || 'verified-version',
      verifiedBy: 'owner',
      verifiedAt: '2026-09-20T00:00:00Z',
      evidencePathOrLink: `private-evidence/deployed-${safeId(surface.id)}.json`,
      evidence: surface.requiredEvidence.map((proof, index) => ({
        proof,
        status: 'passed',
        reference: `private-evidence/deployed-${safeId(surface.id)}-${index + 1}.json`,
        notes: 'sanitized proof reference only',
      })),
    })),
  }
}

function completeProductionEvidence() {
  const template = childJson('scripts/wallet-production-evidence-check.mjs', ['--filled-template'])
  return {
    ...template,
    areas: template.areas.map((area, index) => ({
      ...area,
      evidenceId: `production-${index + 1}`,
      productionEvidenceLinkOrPath: `private-evidence/production-${index + 1}.json`,
      verifiedBy: 'owner',
      verifiedAt: '2026-09-20T00:00:00Z',
      status: 'passed',
      notes: 'sanitized proof reference only',
    })),
  }
}

function completeProviderEvidence() {
  const template = childJson('scripts/wallet-provider-evidence-template.mjs', ['--filled-template'])
  return {
    ...template,
    providers: template.providers.map((provider, index) => ({
      ...provider,
      evidenceId: `provider-${index + 1}`,
      environment: 'staging',
      deployedVersion: 'validated deployed-version evidence',
      deploymentEvidenceReference: 'deployed-version-evidence:validated',
      providerReference: `private-evidence/provider-${provider.id}.json`,
      verifiedBy: 'owner',
      verifiedAt: '2026-09-20T00:00:00Z',
      result: 'passed',
      evidence: provider.evidence.map((proofRow, proofIndex) => ({
        ...proofRow,
        status: 'passed',
        reference: `private-evidence/provider-${provider.id}-${proofIndex + 1}.json`,
        notes: 'sanitized provider proof reference only',
      })),
    })),
  }
}

function completeSmokeResult() {
  return {
    ok: true,
    environment: 'staging',
    baseUrl: 'https://staging.example.test',
    functionsBaseUrl: 'https://functions.example.test',
    edgeAuthorizationProvided: true,
    cronSecretProvided: true,
    ownerDeniedProbesLoaded: 10,
    requestTimeoutMs: 15_000,
    startedAt: '2026-09-20T00:00:00Z',
    finishedAt: '2026-09-20T00:01:00Z',
    total: 3,
    passed: 3,
    failed: 0,
    results: [
      { name: 'partner api is paused', path: '/api/partner-api', status: 503, passed: true, durationMs: 12, body: { code: 'PARTNER_API_PAUSED' } },
      { name: 'edge paid route is paused', path: '/purchase-bills', status: 503, passed: true, durationMs: 10, body: { code: 'BILLS_PAUSED' } },
      { name: 'owner denied probe blocks delivery', path: '/process-purchase', status: 403, passed: true, durationMs: 15, body: { code: 'WALLET_FROZEN' } },
    ],
    acceptanceBoundary: [
      'This smoke test sends only denied/paused webhook and partner API requests.',
      'Do not reopen a paused paid route solely because this smoke test passes.',
    ],
  }
}

function childJson(script, scriptArgs) {
  const child = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (child.status !== 0) {
    throw new Error(`${script} failed: ${redact(child.stderr || child.stdout)}`)
  }
  return JSON.parse(child.stdout)
}

function writeJson(dir, name, value) {
  const path = join(dir, name)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function resolvePath(path) {
  return isAbsolute(path) ? path : join(root, path)
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function issue(area, code, message) {
  return { area, code, message }
}

function assert(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function kebab(value) {
  return String(value).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

function safeId(value) {
  return String(value || 'item').replace(/[^a-z0-9:-]/gi, '-')
}

function isHttpsUrl(value) {
  const text = String(value || '')
  try {
    const url = new URL(text)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidTimestamp(value) {
  const text = String(value || '').trim()
  if (!/\d{4}-\d{2}-\d{2}/.test(text)) return false
  return !Number.isNaN(Date.parse(text))
}

function looksSecret(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^(sk|pk|sec|whsec|rk|api|bearer|eyJ)[_\-.A-Za-z0-9]{20,}$/i.test(text)) return true
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text) && !/^\d+$/.test(text)) return true
  return false
}

function redact(value) {
  return String(value || '').replace(/(sk|pk|sec|whsec|rk|api|bearer|eyJ)[_\-.A-Za-z0-9]{8,}/gi, '[redacted]')
}

function printHelp() {
  console.log(`Validate the wallet incident paid-route reopening evidence bundle.

Usage:
  npm run security:wallet:reopen-readiness -- --init-bundle C:\\private\\wallet-reopen-evidence

  npm run security:wallet:reopen-readiness -- \\
    --deployment-plan C:\\private\\deployment-plan.json \\
    --deployed-version-evidence C:\\private\\deployed-version-evidence.json \\
    --production-evidence C:\\private\\production-evidence.json \\
    --provider-evidence C:\\private\\provider-evidence.json \\
    --denied-probes C:\\private\\denied-probes.json \\
    --deployed-smoke-result C:\\private\\deployed-smoke-result.json

  npm run security:wallet:reopen-readiness -- --self-test

Use --init-bundle to create private fillable evidence templates. This command
does not contact live services. It fails closed unless the owner-controlled
evidence files prove deployment/version matching, production checks, provider
sandbox/dashboard checks, denied-route probe coverage, a validated deployment
plan, and a passing deployed smoke result. Passing this command is still not a deployment; it is the final
evidence gate before a paused paid route can be considered for owner-approved
reopening.
`)
}
