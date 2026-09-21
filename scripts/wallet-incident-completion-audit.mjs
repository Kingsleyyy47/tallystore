import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalize(value) {
  return String(value).replace(/\s+/g, ' ').toLowerCase()
}

function includesAny(doc, phrases) {
  const haystack = normalize(doc)
  return phrases.some((phrase) => haystack.includes(normalize(phrase)))
}

function parseRegressionRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^\| T\d{2} \|/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())

      return {
        id: cells[0],
        scenario: cells[1],
        status: cells[2],
        evidence: cells[3],
      }
    })
}

const requiredArtifacts = {
  'incident findings and evidence limitations': 'docs/security/wallet-incident-final-report.md',
  'wallet mutation map': 'docs/security/wallet-mutation-map.md',
  'fulfillment route/worker coverage map': 'docs/security/wallet-fulfillment-map.md',
  'funding and reservation model': 'docs/security/wallet-financial-model.md',
  'suspension decision matrix and recovery workflow': 'docs/security/wallet-state-machine.md',
  'safe migrations and migration dependency order': 'docs/security/wallet-deployment-manifest.md',
  'local exploit reproductions and regression tests': 'docs/security/wallet-regression-matrix.md',
  'test execution report': 'docs/security/wallet-test-report.md',
  'read-only reconciliation/query pack': 'docs/security/wallet-readonly-query-pack.sql',
  'owner deployment and production verification checklist': 'docs/security/wallet-owner-verification-checklist.md',
  'remaining risk and production-evidence register': 'docs/security/wallet-production-evidence-register.md',
  'staging database security test pack': 'docs/security/wallet-db-security-test-pack.sql',
  'route inventory': 'docs/security/wallet-route-inventory.md',
  'environment and secret inventory': 'docs/security/wallet-env-secret-inventory.md',
  'incident containment record': 'docs/security/wallet-incident-containment.md',
}

for (const [label, path] of Object.entries(requiredArtifacts)) {
  assert(existsSync(join(root, path)), `missing required incident artifact for ${label}: ${path}`)
}

const docs = Object.fromEntries(
  Object.entries(requiredArtifacts).map(([label, path]) => [label, read(path)]),
)

const joinedDocs = Object.values(docs).join('\n\n')

const b15ReportRequirements = [
  ['exact vulnerable or suspicious paths', ['Vulnerable Or Suspicious Paths']],
  ['whether paths create arbitrary value or bypass delivery authorization', ['Risk class', 'Arbitrary value mutation', 'Deliver before']],
  ['fake gateway trigger assessment', ['Fake Gateway Trigger Assessment']],
  ['what proves suspected path versus live logs still needed', ['HISTORICAL_CAUSE_UNPROVEN', 'live logs']],
  ['P0 containment changes and delivery surfaces covered', ['P0 Containment Coverage']],
  ['permanent financial, permission, refund, and suspension changes', ['Permanent Financial Changes']],
  ['commands run and tests not run', ['Commands Run', 'Not Run']],
  ['migration and deployment actions remaining for owner', ['Required Owner Deployment Actions']],
  ['unknown outcome supplier exposure and provider limits', ['unknown supplier outcome', 'provider']],
  ['remaining risks and paused routes', ['Remaining Risks', 'remain paused']],
]

const finalReport = docs['incident findings and evidence limitations']
for (const [label, phrases] of b15ReportRequirements) {
  assert(includesAny(finalReport, phrases), `final report missing B15 requirement: ${label}`)
}

const promptDeliverableTerms = [
  'funding provenance',
  'accounting consistency',
  'delivery authorization',
  'verified gateway deposit',
  'approved admin credit',
  'refund conservation',
  'trusted principal',
  'idempotency',
  'provider verification',
  'provider-evidence validator',
  'deploymentEvidenceReference',
  'deployed-version evidence',
  'dirty source artifact approval',
  'source.dirtyArtifactApprovedBy',
  'verifiedAt',
  'evidenceId',
  'direct ledger writes',
  'protected profile fields',
  'fulfillment pause',
  'wallet_security_events',
  'production permissions',
  'account access state',
  'wallet financial state',
  'service health state',
  'decision matrix',
  'review and recovery workflow',
  'external or internal caller',
  'runtime database role',
  'source-of-funds validation',
  'transaction and locking behavior',
  'production evidence still needed',
  'price source',
  'order creation location',
  'financial authorization function',
  'reservation/capture location',
  'supplier adapter or inventory source',
  'first irreversible action',
  'retry, cancellation, or refund path',
  'coverage test',
]

for (const term of promptDeliverableTerms) {
  assert(includesAny(joinedDocs, [term]), `incident artifacts missing prompt coverage term: ${term}`)
}

const evidenceLabels = [
  'SOURCE_REVIEWED',
  'PATCH_IMPLEMENTED',
  'STATIC_CHECK_PASSED',
  'LOCAL_BUILD_OR_TYPECHECK_PASSED',
  'LOCAL_DB_SECURITY_TESTS_PENDING',
  'PROVIDER_TEST_PENDING',
  'PRODUCTION_DEPLOYMENT_PENDING',
  'PRODUCTION_VERIFICATION_PENDING_OWNER',
  'HISTORICAL_CAUSE_UNPROVEN',
]

for (const label of evidenceLabels) {
  assert(joinedDocs.includes(label), `incident artifacts missing evidence label: ${label}`)
}

const ownerBoundaryPhrases = [
  'does not claim production safety',
  'not proof that the live service is safe',
  'production proof',
  'owner-controlled',
  'do not reopen',
  'Routes must remain paused',
]

for (const phrase of ownerBoundaryPhrases) {
  assert(includesAny(joinedDocs, [phrase]), `incident artifacts missing owner proof boundary: ${phrase}`)
}

const requiredScripts = [
  'scripts/security-wallet-check.mjs',
  ...readdirSync(join(root, 'scripts'))
    .filter((name) => /^wallet-.*\.mjs$/.test(name))
    .sort()
    .map((name) => `scripts/${name}`),
]

for (const path of requiredScripts) {
  assert(existsSync(join(root, path)), `missing required wallet security script: ${path}`)
}

assert(
  finalReport.includes(`${requiredScripts.length} local wallet-security scripts`),
  `final report must reflect current wallet-security script count ${requiredScripts.length}`,
)
assert(
  !finalReport.includes('active route\nidempotency-content binding') &&
    !finalReport.includes('active route idempotency-content binding'),
  'final report must not describe paused/reopenable route idempotency as active-route coverage',
)

for (const stalePhrase of [
  'active route idempotency-content binding',
  'mapped active route files',
  'debit-first active routes',
  'Current active routes are still mostly debit-first',
  'Active purchase routes',
  'Active mapped customer purchase routes',
  'active routes are not yet all',
]) {
  assert(!joinedDocs.includes(stalePhrase), `incident artifacts contain stale active-route wording: ${stalePhrase}`)
}

const regressionMatrix = docs['local exploit reproductions and regression tests']
for (let index = 1; index <= 80; index += 1) {
  const id = `T${String(index).padStart(2, '0')}`
  assert(regressionMatrix.includes(id), `regression matrix missing ${id}`)
}

const regressionRows = parseRegressionRows(regressionMatrix)
assert(regressionRows.length === 80, `expected 80 regression matrix rows, found ${regressionRows.length}`)

const knownStatusLabels = [
  'STATIC_SOURCE_COVERED',
  'LOCAL_ADMIN_UI_MODEL_PASSED',
  'LOCAL_CUSTOMER_UI_MODEL_PASSED',
  'LOCAL_MIGRATION_STATIC_PASSED',
  'LOCAL_MONEY_BOUNDARY_PASSED',
  'LOCAL_MODEL_SEQUENCE_PASSED',
  'LOCAL_CONCURRENCY_MODEL_PASSED',
  'LOCAL_ROUTE_DECISION_PASSED',
  'LOCAL_ROUTE_SOURCE_ORDER_PASSED',
  'LOCAL_RUNTIME_BOUNDARY_SOURCE_PASSED',
  'LOCAL_TRUSTED_PRINCIPAL_PASSED',
  'LOCAL_SUPPLIER_OUTCOME_PASSED',
  'LOCAL_PROVIDER_DECISION_PASSED',
  'LOCAL_PROVIDER_ADAPTER_MOCK_PASSED',
  'LOCAL_ADMIN_REVIEW_MODEL_PASSED',
  'LOCAL_FULFILLMENT_DECISION_PASSED',
  'LOCAL_FROZEN_ACCESS_MODEL_PASSED',
  'LOCAL_OUTBOX_MODEL_PASSED',
  'LOCAL_REFUND_CONSERVATION_PASSED',
  'LOCAL_RECONCILE_OFFLINE_PASSED',
  'LOCAL_DEPLOYED_VERSION_EVIDENCE_PASSED',
  'DB_CONCURRENCY_RUNNER_CREATED_NOT_RUN',
  'DEPLOYED_SMOKE_CREATED_NOT_RUN',
  'STAGING_SQL_CREATED_NOT_RUN',
  'PATCH_IMPLEMENTED_TEST_PENDING',
  'PROVIDER_TEST_PENDING',
  'CONCURRENCY_TEST_PENDING',
  'PRODUCTION_OWNER_PENDING',
  'NOT_IMPLEMENTED_AS_FULL_TEST',
]

const pendingStatusLabels = [
  'STAGING_SQL_CREATED_NOT_RUN',
  'DB_CONCURRENCY_RUNNER_CREATED_NOT_RUN',
  'DEPLOYED_SMOKE_CREATED_NOT_RUN',
  'PATCH_IMPLEMENTED_TEST_PENDING',
  'PROVIDER_TEST_PENDING',
  'CONCURRENCY_TEST_PENDING',
  'PRODUCTION_OWNER_PENDING',
  'NOT_IMPLEMENTED_AS_FULL_TEST',
]

const definedMatrixStatuses = new Set(
  [...regressionMatrix.matchAll(/^- `([A-Z0-9_]+)`: /gm)]
    .map((match) => match[1]),
)
const usedMatrixStatuses = new Set(
  regressionRows.flatMap((row) =>
    [...row.status.matchAll(/`([A-Z0-9_]+)`/g)]
      .map((match) => match[1]),
  ),
)

for (const status of knownStatusLabels) {
  assert(definedMatrixStatuses.has(status), `regression matrix glossary missing known status ${status}`)
}

for (const status of usedMatrixStatuses) {
  assert(definedMatrixStatuses.has(status), `regression matrix row uses undefined status ${status}`)
}

const pendingCounts = Object.fromEntries(pendingStatusLabels.map((label) => [label, 0]))
for (const row of regressionRows) {
  assert(/^T\d{2}$/.test(row.id), `invalid regression row id: ${row.id}`)
  assert(row.scenario.length > 0, `${row.id} missing scenario`)
  assert(row.evidence.length > 0, `${row.id} missing evidence / next proof`)
  assert(
    knownStatusLabels.some((status) => row.status.includes(status)),
    `${row.id} has no known evidence status label`,
  )

  for (const status of pendingStatusLabels) {
    if (row.status.includes(status)) pendingCounts[status] += 1
  }
}

assert(
  regressionMatrix.includes('The repository now has containment, maps, static guards, and staging SQL'),
  'regression matrix missing current acceptance boundary',
)
assert(
  regressionMatrix.includes('the matrix is not fully green'),
  'regression matrix must explicitly state it is not fully green',
)
assert(
  regressionRows.find((row) => row.id === 'T79')?.status.includes('PRODUCTION_OWNER_PENDING'),
  'T79 must stay production-owner pending until old builds/workers are verified stopped',
)
assert(
  Object.values(pendingCounts).some((count) => count > 0),
  'audit unexpectedly found no pending runtime/owner proof gaps; update the production-proof boundary before claiming completion',
)

console.log(JSON.stringify({
  ok: true,
  artifactsChecked: Object.keys(requiredArtifacts).length,
  finalReportRequirements: b15ReportRequirements.length,
  promptCoverageTerms: promptDeliverableTerms.length,
  evidenceLabels: evidenceLabels.length,
  scriptsChecked: requiredScripts.length,
  regressionRowsChecked: 80,
  pendingRegressionProofRows: pendingCounts,
}, null, 2))
