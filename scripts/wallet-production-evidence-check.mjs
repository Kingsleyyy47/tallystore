import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))
const fakeStripeSecret = ['sk', 'live'].join('_') + '_abcdefghijklmnopqrstuvwxyz1234567890'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ')
}

function includesPhrase(value, phrase) {
  return normalizeText(value).includes(normalizeText(phrase))
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

const standardFields = [
  'evidence id:',
  'requirement:',
  'production evidence link/path:',
  'verified by:',
  'verified at:',
  'status:',
  'notes:',
]

const jsonEvidenceFields = [
  'evidenceId',
  'verifiedBy',
  'verifiedAt',
  'evidencePathOrLink',
]

const productionAreas = [
  'Wallet mutation map',
  'Fulfillment map',
  'Route inventory',
  'Environment and secret inventory',
  'Wallet security event ledger',
  'Purchase request forensics',
  'Admin security event review',
  'T01-T80 regression matrix',
  'Wallet financial model',
  'Linked refund principal proof',
  'Reserve-first order authorization columns',
  'Wallet state machine and review workflow',
  'Incident final report',
  'Deployed version evidence file',
  'Dirty source artifact approval',
  'Partner API closure',
  'PocketFi Vercel bridge',
  'PocketFi partner payments during pause',
  'Wallet engine permissions',
  'Legacy balance RPC retirement',
  'Profile financial-field protection',
  'Referral attribution authority',
  'Direct ledger mutation protection',
  'Purchase backing gate',
  'Real DB concurrency proof',
  'Admin unsuspend review gate',
  'Chargeback debt handling',
  'Admin timestamp display',
  'Payment top-up evidence',
  'Scheduled pending-payment recovery',
  'JWT-disabled Edge Functions',
  'Crypto top-up and transfer',
  'Legacy webhook routes',
  'Provider delivery routes',
  'Provider reopening evidence file',
  'iStar webhook',
  'Refund/retry idempotency',
  'Admin/staff adjustments',
  'Identity/delete audit',
  'Read-only reconciliation report',
]

const outcomeStates = [
  'not_dispatched',
  'dispatch_claimed',
  'submitted_or_processing',
  'fulfilled',
  'definitively_failed',
  'outcome_unknown',
]

const providerCapabilities = [
  'Ercas',
  'PocketFi',
  'NOWPayments',
  'iStar/Telegram',
  'DaisySMS',
  'SMM panel',
  'Bitrefill',
  'Withdrawal provider',
]

const reopeningFields = [
  'route:',
  'deployed app version:',
  'deployed function version:',
  'migrations applied through:',
  'payment/provider sandbox test:',
  'restricted-role DB test:',
  'denied-order supplier calls observed:',
  'refund/retry duplicate test:',
  'owner approved:',
  'date/time:',
]

const stagingEvidenceFields = [
  'database/project:',
  'test profile id:',
  'migrations applied through:',
  'result row:',
  'errors:',
  'date/time:',
  'operator:',
]

const safetyBoundaryPhrases = [
  'No route should move from paused to active without this entry filled in',
  'Do not run it against a real customer',
  'Do not blindly retry the supplier',
  'Any missing route must be treated as `UNKNOWN`',
  'repository evidence from production proof',
  'mismatched SHA-256 fingerprints',
  'per-surface required proof rows',
  'evidence[].proof',
  'pending/non-passed proof rows',
  'missing proof references',
  'unknown proof rows',
  'source.dirtyArtifactApprovedBy',
  'source.dirtyArtifactApprovedAt',
  'source.dirtyArtifactEvidencePathOrLink',
  'source.dirtyArtifactReviewNote',
  'Do not treat a dirty local fingerprint as production proof',
  'linked_eligible_refunds',
  'trusted_principal_authorized',
  'trusted_principal_debit_amount',
  'wallet_reservation_id',
  'fulfillment_outbox_id',
  'financial_authorization_status',
  'section 10e',
  'zero rows',
]

if (args.get('self-test') === 'true') {
  runSelfTest()
} else if (args.get('filled-template') === 'true') {
  output(buildFilledEvidenceTemplate())
} else if (args.get('validate') && args.get('validate') !== 'true') {
  const result = validateProductionEvidenceFile(args.get('validate'))
  output(result)
  if (!result.ok) process.exit(1)
} else {
  const doc = readFileSync(join(root, 'docs/security/wallet-production-evidence-register.md'), 'utf8')
  output(validateEvidenceRegister(doc))
}

function parseArgs(rawArgs) {
  const parsed = new Map()
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? rawArgs[i + 1]
    if (inlineValue == null && value && !value.startsWith('--')) i += 1
    parsed.set(key, value === undefined || value.startsWith('--') ? 'true' : value)
  }
  return parsed
}

function validateEvidenceRegister(doc) {
  for (const label of evidenceLabels) {
    assert(doc.includes(label), `production evidence register missing label ${label}`)
  }

  for (const field of standardFields) {
    assert(doc.toLowerCase().includes(field), `production evidence register missing standard field ${field}`)
  }

  for (const field of jsonEvidenceFields) {
    assert(doc.includes(field), `production evidence register missing generated JSON evidence field ${field}`)
  }

  assert(doc.includes('parseable absolute timestamp'), 'production evidence register must require parseable absolute timestamps for verifiedAt')

  for (const area of productionAreas) {
    assert(doc.includes(`| ${area} |`), `production evidence register missing production area ${area}`)
  }

  for (const state of outcomeStates) {
    assert(doc.includes(`\`${state}\``), `production evidence register missing unknown-outcome state ${state}`)
  }

  for (const provider of providerCapabilities) {
    assert(doc.includes(`| ${provider} |`), `production evidence register missing provider capability row ${provider}`)
  }

  for (const field of reopeningFields) {
    assert(doc.toLowerCase().includes(field.toLowerCase()), `production evidence register missing reopening gate field ${field}`)
  }

  for (const field of stagingEvidenceFields) {
    assert(doc.toLowerCase().includes(field.toLowerCase()), `production evidence register missing staging SQL evidence field ${field}`)
  }

  for (const phrase of safetyBoundaryPhrases) {
    assert(includesPhrase(doc, phrase), `production evidence register missing safety boundary: ${phrase}`)
  }

  return {
    ok: true,
    labels: evidenceLabels.length,
    standardFields: standardFields.length,
    jsonEvidenceFields: jsonEvidenceFields.length,
    productionAreas: productionAreas.length,
    outcomeStates: outcomeStates.length,
    providerCapabilities: providerCapabilities.length,
    reopeningFields: reopeningFields.length,
  }
}

function runSelfTest() {
  const goodDoc = buildSelfTestDoc()
  const good = validateEvidenceRegister(goodDoc)
  expectFailure('missing evidence label', goodDoc.replace('SOURCE_REVIEWED', 'REMOVED_LABEL'), /missing label SOURCE_REVIEWED/)
  expectFailure('missing standard field', goodDoc.replace('production evidence link/path:', 'production evidence path removed:'), /missing standard field production evidence link\/path:/)
  expectFailure('missing provider row', goodDoc.replace('| Ercas |', '| Removed provider |'), /missing provider capability row Ercas/)
  expectFailure('missing safety boundary', goodDoc.replace('Any missing route must be treated as `UNKNOWN`', 'Any missing route can be ignored'), /missing safety boundary/)
  expectFailure('missing per-proof deployment evidence boundary', goodDoc.replace('per-surface required proof rows', 'surface status only'), /missing safety boundary/)
  expectFailure('missing dirty source production area', goodDoc.replace('| Dirty source artifact approval |', '| Removed dirty source artifact approval |'), /missing production area Dirty source artifact approval/)

  const filled = validateProductionEvidenceObject(buildFilledEvidenceTemplate())
  assert(!filled.ok && filled.issues.some((item) => item.code === 'AREA_NOT_PASSED'), 'pending production evidence template was treated as complete')

  const complete = buildCompleteProductionEvidenceFixture()
  const completeResult = validateProductionEvidenceObject(complete)
  assert(completeResult.ok, `complete production evidence fixture failed validation: ${JSON.stringify(completeResult.issues)}`)

  const missingArea = structuredClone(complete)
  missingArea.areas = missingArea.areas.slice(1)
  assert(validateProductionEvidenceObject(missingArea).issues.some((item) => item.code === 'AREA_MISSING'), 'missing production evidence area was accepted')

  const duplicateArea = structuredClone(complete)
  duplicateArea.areas.push({ ...duplicateArea.areas[0] })
  assert(validateProductionEvidenceObject(duplicateArea).issues.some((item) => item.code === 'DUPLICATE_AREA'), 'duplicate production evidence area was accepted')

  const unknownArea = structuredClone(complete)
  unknownArea.areas.push({ ...unknownArea.areas[0], area: 'Unknown production area' })
  assert(validateProductionEvidenceObject(unknownArea).issues.some((item) => item.code === 'UNKNOWN_AREA'), 'unknown production evidence area was accepted')

  const invalidTimestamp = structuredClone(complete)
  invalidTimestamp.areas[0].verifiedAt = 'after deployment'
  assert(validateProductionEvidenceObject(invalidTimestamp).issues.some((item) => item.code === 'INVALID_VERIFIED_AT'), 'informal production evidence timestamp was accepted')

  const missingReference = structuredClone(complete)
  missingReference.areas[0].productionEvidenceLinkOrPath = ''
  assert(validateProductionEvidenceObject(missingReference).issues.some((item) => item.code === 'STANDARD_FIELD_MISSING'), 'passed production evidence without reference was accepted')

  const secretReference = structuredClone(complete)
  secretReference.areas[0].productionEvidenceLinkOrPath = fakeStripeSecret
  assert(validateProductionEvidenceObject(secretReference).issues.some((item) => item.code === 'SECRET_LIKE_VALUE'), 'secret-looking production evidence reference was accepted')

  output({
    ...good,
    selfTest: true,
    failureBranchesChecked: 13,
    productionEvidenceTemplateValidator: true,
  })
}

function expectFailure(label, doc, pattern) {
  try {
    validateEvidenceRegister(doc)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(pattern.test(message), `${label} failed with unexpected message: ${message}`)
    return
  }
  throw new Error(`${label} did not fail`)
}

function buildSelfTestDoc() {
  return [
    ...evidenceLabels,
    ...standardFields,
    ...jsonEvidenceFields,
    'verifiedAt must be a parseable absolute timestamp.',
    ...productionAreas.map((area) => `| ${area} | source | proof |`),
    ...outcomeStates.map((state) => `\`${state}\``),
    ...providerCapabilities.map((provider) => `| ${provider} | capability |`),
    ...reopeningFields,
    ...stagingEvidenceFields,
    ...safetyBoundaryPhrases,
  ].join('\n')
}

function buildFilledEvidenceTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    warning: 'Fill with sanitized owner-controlled production evidence. Do not paste provider secrets, bearer tokens, customer credentials, product credentials, OTPs, raw webhook payloads, or service-role keys.',
    areas: productionAreas.map((area) => ({
      area,
      evidenceId: '',
      requirement: area,
      productionEvidenceLinkOrPath: '',
      verifiedBy: '',
      verifiedAt: '',
      status: 'pending',
      notes: '',
    })),
  }
}

function validateProductionEvidenceFile(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      error: 'PRODUCTION_EVIDENCE_FILE_UNREADABLE',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  return validateProductionEvidenceObject(parsed)
}

function validateProductionEvidenceObject(parsed) {
  const rows = Array.isArray(parsed?.areas) ? parsed.areas : []
  const expectedAreas = new Set(productionAreas)
  const suppliedCounts = new Map()
  const suppliedByArea = new Map()
  const issues = []

  for (const row of rows) {
    const area = String(row?.area || '').trim()
    suppliedCounts.set(area, (suppliedCounts.get(area) || 0) + 1)
    if (!suppliedByArea.has(area)) suppliedByArea.set(area, row)
    if (!expectedAreas.has(area)) {
      issues.push(issue(area || '(blank)', 'UNKNOWN_AREA', 'production evidence area is not in the register'))
    }
  }

  for (const area of productionAreas) {
    if ((suppliedCounts.get(area) || 0) > 1) {
      issues.push(issue(area, 'DUPLICATE_AREA', 'production evidence contains duplicate rows for this area'))
    }
    const row = suppliedByArea.get(area)
    if (!row) {
      issues.push(issue(area, 'AREA_MISSING', 'production evidence is missing this required area'))
      continue
    }

    for (const field of ['evidenceId', 'requirement', 'productionEvidenceLinkOrPath', 'verifiedBy', 'verifiedAt', 'status']) {
      if (!String(row[field] || '').trim()) {
        issues.push(issue(area, 'STANDARD_FIELD_MISSING', `${field} is required`))
      }
      if (looksSecret(row[field])) {
        issues.push(issue(area, 'SECRET_LIKE_VALUE', `${field} looks like a secret/token; store sanitized references only`))
      }
    }
    if (looksSecret(row.notes)) {
      issues.push(issue(area, 'SECRET_LIKE_VALUE', 'notes looks like a secret/token; store sanitized references only'))
    }
    if (String(row.verifiedAt || '').trim() && !isValidTimestamp(row.verifiedAt)) {
      issues.push(issue(area, 'INVALID_VERIFIED_AT', 'verifiedAt must be a parseable absolute timestamp'))
    }
    const status = String(row.status || '').trim().toLowerCase()
    if (!['passed', 'pending', 'blocked', 'failed'].includes(status)) {
      issues.push(issue(area, 'INVALID_STATUS', 'status must be passed, pending, blocked, or failed'))
    } else if (status !== 'passed') {
      issues.push(issue(area, 'AREA_NOT_PASSED', 'production evidence area must be passed before relying on it'))
    }
  }

  return {
    ok: issues.length === 0,
    checkedAreas: productionAreas.length,
    suppliedAreas: rows.length,
    issueCount: issues.length,
    issues,
  }
}

function buildCompleteProductionEvidenceFixture() {
  return {
    generatedAt: '2026-09-20T01:00:00Z',
    warning: 'sanitized fixture',
    areas: productionAreas.map((area, index) => ({
      area,
      evidenceId: `owner-production-${index + 1}`,
      requirement: area,
      productionEvidenceLinkOrPath: `private-evidence/production-${index + 1}.json`,
      verifiedBy: 'owner',
      verifiedAt: '2026-09-20T01:00:00Z',
      status: 'passed',
      notes: 'sanitized owner-controlled proof reference only',
    })),
  }
}

function issue(area, code, message) {
  return { area, code, message }
}

function looksSecret(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^(sk|pk|sec|whsec|rk|api|bearer|eyJ)[_\-.A-Za-z0-9]{20,}$/i.test(text)) return true
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text) && !/^\d+$/.test(text)) return true
  return false
}

function isValidTimestamp(value) {
  const text = String(value || '').trim()
  if (!/\d{4}-\d{2}-\d{2}/.test(text)) return false
  return !Number.isNaN(Date.parse(text))
}

function output(summary) {
  console.log(JSON.stringify(summary, null, 2))
}
