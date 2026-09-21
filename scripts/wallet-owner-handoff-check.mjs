import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ')
}

function includesPhrase(doc, phrase) {
  return normalizeText(doc).includes(normalizeText(phrase))
}

const docs = {
  checklist: read('docs/security/wallet-owner-verification-checklist.md'),
  finalReport: read('docs/security/wallet-incident-final-report.md'),
  testReport: read('docs/security/wallet-test-report.md'),
  evidenceRegister: read('docs/security/wallet-production-evidence-register.md'),
  deploymentManifest: read('docs/security/wallet-deployment-manifest.md'),
  regressionMatrix: read('docs/security/wallet-regression-matrix.md'),
  routeInventory: read('docs/security/wallet-route-inventory.md'),
  envSecretInventory: read('docs/security/wallet-env-secret-inventory.md'),
  stateMachine: read('docs/security/wallet-state-machine.md'),
}

const requiredPendingProofLabels = [
  'PRODUCTION_DEPLOYMENT_PENDING',
  'PRODUCTION_VERIFICATION_PENDING_OWNER',
  'HISTORICAL_CAUSE_UNPROVEN',
  'LOCAL_DB_SECURITY_TESTS_PENDING',
  'PROVIDER_TEST_PENDING',
]

const requiredOwnerChecks = [
  'Preserve affected-account, provider, webhook, order, and ledger evidence',
  'Apply migrations in timestamp order',
  'Deploy changed Supabase Edge Functions',
  'Redeploy Vercel app',
  'Keep paused env flags disabled',
  'Run read-only production query pack',
  'Run staging DB security test pack',
  'Verify provider webhook URLs/secrets',
  'Verify no old workers/routes remain active',
  'Reopen only routes whose row in the regression matrix',
]

const requiredNoOverclaimBoundaries = [
  'does not claim production safety',
  'repository-scoped',
  'not proof that the live service is safe',
  'Do not reopen a paused paid route',
  'Do not use this manifest as proof that production is safe',
]

const retiredProofLabels = [
  'LOCAL_CONCURRENCY_TESTS_PENDING',
  'PROVIDER_SANDBOX_TESTS_PENDING',
  'PROVIDER_OUTCOME_TESTS_PENDING',
  'PRODUCTION_EVIDENCE_PENDING_OWNER',
  'STAGING_PROVIDER_CONCURRENCY_TESTS_PENDING',
  'PRODUCTION_EVIDENCE_COLLECTION_PENDING_OWNER',
]

const requiredPausedSurfaces = [
  'Partner API',
  'bills',
  'gift cards',
  'withdrawals',
  'crypto top-up',
  'SMM',
  'SMS OTP',
  'Telegram',
  'referral withdrawal',
  'direct live account fulfillment',
  'manual restock',
  'auto-restock',
]

const requiredEvidenceRegisterFields = [
  'evidence id',
  'requirement',
  'production evidence link/path',
  'verified by',
  'verified at',
  'status',
  'evidenceId',
  'deploymentEvidenceReference',
  'verifiedBy',
  'verifiedAt',
  'evidencePathOrLink',
  'parseable absolute timestamp',
]

const requiredDeploymentEvidencePhrases = [
  'Dirty source artifact approval',
  'source.dirtyArtifactApprovedBy',
  'source.dirtyArtifactApprovedAt',
  'source.dirtyArtifactEvidencePathOrLink',
  'source.dirtyArtifactReviewNote',
  'Do not treat a dirty local fingerprint as production proof',
  'deploymentEvidenceReference',
  'validated deployed-version evidence',
  'per-surface required proof rows',
  'evidence[].proof',
  'missing-proof-reference',
]

const requiredStateMachinePhrases = [
  'Account access state',
  'Wallet financial state',
  'Service health state',
  'Decision Matrix',
  'Review And Recovery Workflow',
  'Ordinary `INSUFFICIENT_FUNDS`; do not auto-suspend',
  'Routes must remain paused',
]

for (const label of requiredPendingProofLabels) {
  assert(docs.finalReport.includes(label), `final report missing proof label ${label}`)
  assert(
    docs.testReport.includes(label) || docs.regressionMatrix.includes(label),
    `test report/regression matrix missing proof label ${label}`,
  )
}

for (const label of retiredProofLabels) {
  assert(!docs.testReport.includes(label), `test report still uses retired proof label ${label}`)
}

for (const check of requiredOwnerChecks) {
  assert(includesPhrase(docs.finalReport, check) || includesPhrase(docs.checklist, check), `owner handoff missing action: ${check}`)
}

for (const boundary of requiredNoOverclaimBoundaries) {
  assert(
    Object.values(docs).some((doc) => includesPhrase(doc, boundary)),
    `handoff docs missing no-overclaim boundary: ${boundary}`,
  )
}

for (const surface of requiredPausedSurfaces) {
  assert(docs.checklist.toLowerCase().includes(surface.toLowerCase()), `owner checklist missing paused surface ${surface}`)
  assert(docs.deploymentManifest.toLowerCase().includes(surface.toLowerCase()), `deployment manifest missing paused surface ${surface}`)
}

for (const field of requiredEvidenceRegisterFields) {
  assert(docs.evidenceRegister.toLowerCase().includes(field.toLowerCase()), `production evidence register missing field ${field}`)
}

for (const phrase of requiredDeploymentEvidencePhrases) {
  assert(
    Object.values(docs).some((doc) => includesPhrase(doc, phrase)),
    `handoff docs missing deployment evidence boundary: ${phrase}`,
  )
}

for (const phrase of [
  'Wallet state machine and review workflow',
  'ordinary insufficient funds',
  'legitimate deposits while frozen do not auto-unfreeze',
]) {
  assert(includesPhrase(docs.evidenceRegister, phrase), `production evidence register missing state-machine proof item: ${phrase}`)
}

for (const phrase of requiredStateMachinePhrases) {
  assert(includesPhrase(docs.stateMachine, phrase), `wallet state-machine handoff missing phrase: ${phrase}`)
}

for (const command of [
  'npm run security:wallet',
  'npm run security:wallet:local',
  'npm run security:wallet:admin-review',
  'npm run security:wallet:db-pack',
  'npm run security:wallet:deployed-smoke',
  'npm run security:wallet:deployed-versions',
  'npm run security:wallet:deploy-manifest',
  'npm run security:wallet:env-secrets',
  'npm run security:wallet:evidence',
  'npm run security:wallet:handoff',
  'npm run security:wallet:provider-evidence',
  'npm run security:wallet:reopen-readiness',
  'npm run security:wallet:route-inventory',
  'docs/security/wallet-db-security-test-pack.sql',
  'docs/security/wallet-readonly-query-pack.sql',
  'docs/security/wallet-route-inventory.md',
  'docs/security/wallet-env-secret-inventory.md',
  'docs/security/wallet-state-machine.md',
]) {
  assert(includesPhrase(docs.checklist, command) || includesPhrase(docs.testReport, command), `handoff docs missing command/artifact ${command}`)
}

for (const route of [
  'product',
  'SMM',
  'SMS',
  'Telegram',
  'Bills',
  'Bitrefill',
  'withdrawal',
  'partner API',
]) {
  assert(
    docs.regressionMatrix.includes(route) || docs.finalReport.includes(route) || docs.checklist.includes(route),
    `handoff docs missing route coverage language for ${route}`,
  )
}

console.log(JSON.stringify({
  ok: true,
  checkedDocuments: Object.keys(docs).length,
  pendingProofLabels: requiredPendingProofLabels.length,
  ownerChecks: requiredOwnerChecks.length,
  pausedSurfaces: requiredPausedSurfaces.length,
}, null, 2))
