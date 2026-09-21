import fs from 'node:fs'

const args = parseArgs(process.argv.slice(2))
const fakeStripeSecret = ['sk', 'live'].join('_') + '_abcdefghijklmnopqrstuvwxyz1234567890'

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

const validatePath = args.get('validate')
const filledTemplate = args.get('filled-template') === 'true'
const format = String(args.get('format') || 'markdown').toLowerCase()
if (!['markdown', 'json'].includes(format)) {
  console.error('Use --format markdown or --format json.')
  process.exit(1)
}

const providers = [
  {
    id: 'ercas',
    name: 'Ercas wallet top-up',
    route: 'create-wallet-topup / verify-and-credit-wallet / check-pending-payments',
    requiredEvidence: [
      'server-created pending payment exists before verification',
      'successful provider verification credits exactly once',
      'missing pending payment does not credit',
      'wrong wallet/user does not credit',
      'wrong amount does not credit',
      'wrong or non-NGN currency does not credit',
      'wrong merchant/business/environment does not credit when provider exposes those fields',
      'provider pending/failed/timeout leaves payment pending or failed without provisional credit',
      'duplicate success replay returns idempotent result without second credit',
    ],
  },
  {
    id: 'pocketfi',
    name: 'PocketFi virtual-account top-up',
    route: 'api/webhook-pocketfi / webhook-pocketfi',
    requiredEvidence: [
      'unsigned public bridge request returns 401 before proxying',
      'signed/provider-shaped sandbox event credits exactly once for a normal wallet account',
      'duplicate reference for same user/amount is idempotent',
      'duplicate reference for different user or amount returns POCKETFI_REFERENCE_CONFLICT',
      'partner-account event while partner API is paused is logged for manual review and does not fulfill partner order',
      'missing account number/reference/amount does not credit',
    ],
  },
  {
    id: 'nowpayments',
    name: 'NOWPayments crypto top-up',
    route: 'nowpayments-webhook / create-crypto-sell-order',
    requiredEvidence: [
      'invalid or missing IPN signature is rejected',
      'server-side NOWPayments status verification is called before any accounting decision',
      'finished payment is held for manual review and does not auto-credit crypto or wallet balance',
      'partial/underpaid/disappearing payment does not become spendable',
      'replayed provider event does not create duplicate evidence',
      'CRYPTO_AUTO_CREDIT_ENABLED cannot reopen auto-credit behavior',
    ],
  },
  {
    id: 'istar',
    name: 'iStar Telegram fulfillment',
    route: 'telegram-stars / api/webhook-istar',
    requiredEvidence: [
      'unsigned webhook returns 401 or unconfigured 503',
      'invalid signature returns 401',
      'valid completed callback marks one matching local order completed once',
      'valid failed callback posts one wallet-engine refund with deterministic idempotency key',
      'duplicate failed callback does not double-refund',
      'late success/unknown provider result does not redispatch or double-credit',
    ],
  },
  {
    id: 'daisysms',
    name: 'DaisySMS OTP rental',
    route: 'smsbus',
    requiredEvidence: [
      'local pending sms_orders row exists before provider number allocation',
      'failed allocation refunds once and records failed/refunded state',
      'duplicate terminal callback does not double-refund',
      'late code after terminal failure does not reveal code or create second refund',
      'cancel/release semantics are documented for unknown provider outcome',
      'frozen wallet cannot start a new rental but can read existing order history',
    ],
  },
  {
    id: 'smm',
    name: 'SMM panel',
    route: 'smm-create-order / smm-check-status / smm-check-all-orders',
    requiredEvidence: [
      'panel order is not submitted until local wallet debit and local smm_orders row exist',
      'provider timeout becomes outcome_unknown without blind retry or refund',
      'provider failed/canceled status refunds once',
      'partial remains refund is capped and idempotent',
      'duplicate status worker run does not double-refund',
      'panel idempotency/status lookup limitations are documented',
    ],
  },
  {
    id: 'bitrefill',
    name: 'Bitrefill gift cards/eSIM',
    route: 'purchase-bitrefill / bitrefill-catalog',
    requiredEvidence: [
      'route remains paused until owner-approved reopening',
      'local bitrefill_orders row and wallet debit exist before invoice/order creation',
      'timeout/unknown invoice status does not blind retry or refund',
      'provider failure refund posts once',
      'duplicate provider failure does not double-refund',
      'merchant balance check and product-blocking behavior are verified',
    ],
  },
  {
    id: 'withdrawal',
    name: 'SageCloud withdrawal/transfer',
    route: 'create-withdrawal-request',
    requiredEvidence: [
      'route remains paused until owner-approved reopening',
      'local withdrawal row and selected-balance debit exist before provider transfer',
      'provider failed transfer refunds once',
      'duplicate failed transfer response does not double-refund',
      'provider transfer idempotency/reference contract is documented',
      'crypto/referral balance source cannot be swapped by client payload',
    ],
  },
]

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
} else if (validatePath && validatePath !== 'true') {
  const result = validateEvidenceFile(validatePath)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
} else if (filledTemplate) {
  console.log(JSON.stringify(buildFilledEvidenceTemplate(), null, 2))
} else if (format === 'json') {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    warning: 'Template only. Fill with owner-controlled provider sandbox/dashboard evidence before reopening routes.',
    providers,
  }, null, 2))
} else {
  console.log('# Wallet Provider Evidence Template\n')
  console.log('Fill one section per provider using owner-controlled sandbox/dashboard evidence. Do not paste secrets, full tokens, customer credentials, or raw private webhook payloads into a public repository.\n')
  for (const provider of providers) {
    console.log(`## ${provider.name}`)
    console.log(`\n- provider id: \`${provider.id}\``)
    console.log(`- route/function surface: \`${provider.route}\``)
    console.log('- evidence id:')
    console.log('- environment:')
    console.log('- deployed app/function version:')
    console.log('- deployed-version evidence reference:')
    console.log('- provider dashboard/sandbox reference:')
    console.log('- verified by:')
    console.log('- verified at:')
    console.log('- result: `pending`\n')
    console.log('Required proof:')
    for (const item of provider.requiredEvidence) {
      console.log(`- [ ] ${item}`)
    }
    console.log('\nNotes:\n')
  }
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

function printHelp() {
  console.log(`Generate a provider sandbox/dashboard evidence template.

Usage:
  npm run security:wallet:provider-evidence
  npm run security:wallet:provider-evidence -- --format json
  npm run security:wallet:provider-evidence -- --filled-template
  npm run security:wallet:provider-evidence -- --validate provider-evidence.json
  npm run security:wallet:provider-evidence -- --self-test

This command does not contact providers. It prints the evidence checklist the
owner must fill before reopening provider-backed routes.

Validation mode checks a filled JSON evidence file for every provider, required
proof item, standard owner evidence fields, deployed-version evidence linkage,
non-secret references, and passed proof status before a provider can be treated
as reopening-ready.
`)
}

function buildFilledEvidenceTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    warning: 'Fill this with sanitized owner-controlled sandbox/dashboard proof. Do not store provider secrets, tokens, customer credentials, or raw private webhook payloads here.',
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      route: provider.route,
      evidenceId: '',
      environment: '',
      deployedVersion: '',
      deploymentEvidenceReference: '',
      providerReference: '',
      verifiedBy: '',
      verifiedAt: '',
      result: 'pending',
      evidence: provider.requiredEvidence.map((proof) => ({
        proof,
        status: 'pending',
        reference: '',
        notes: '',
      })),
    })),
  }
}

function validateEvidenceFile(path) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      error: 'PROVIDER_EVIDENCE_FILE_UNREADABLE',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  return validateEvidenceObject(parsed)
}

function validateEvidenceObject(parsed) {
  const providerRows = Array.isArray(parsed.providers) ? parsed.providers : []
  const submittedProviders = new Map(providerRows.map((provider) => [String(provider?.id || ''), provider]))
  const providerCounts = new Map()
  for (const provider of providerRows) {
    const id = String(provider?.id || '')
    providerCounts.set(id, (providerCounts.get(id) || 0) + 1)
  }
  const issues = []
  const expectedIds = new Set(providers.map((provider) => provider.id))

  for (const provider of providers) {
    if ((providerCounts.get(provider.id) || 0) > 1) {
      issues.push(issue(provider.id, 'DUPLICATE_PROVIDER', 'provider evidence contains duplicate sections for this provider'))
    }

    const submitted = submittedProviders.get(provider.id)
    if (!submitted) {
      issues.push(issue(provider.id, 'PROVIDER_MISSING', 'provider section is missing'))
      continue
    }

    for (const field of ['evidenceId', 'environment', 'deployedVersion', 'deploymentEvidenceReference', 'providerReference', 'verifiedBy', 'verifiedAt', 'result']) {
      if (!String(submitted[field] || '').trim()) {
        issues.push(issue(provider.id, 'STANDARD_FIELD_MISSING', `${field} is required`))
      }
      if (looksSecret(String(submitted[field] || ''))) {
        issues.push(issue(provider.id, 'SECRET_LIKE_VALUE', `${field} looks like a secret; store only a dashboard/sandbox reference`))
      }
    }
    if (String(submitted.verifiedAt || '').trim() && !isValidTimestamp(submitted.verifiedAt)) {
      issues.push(issue(provider.id, 'INVALID_VERIFIED_AT', 'verifiedAt must be a parseable absolute timestamp'))
    }
    const deploymentEvidenceReference = String(submitted.deploymentEvidenceReference || '').trim()
    if (deploymentEvidenceReference && !/deployed-version/i.test(deploymentEvidenceReference)) {
      issues.push(issue(provider.id, 'DEPLOYMENT_EVIDENCE_REFERENCE_WEAK', 'deploymentEvidenceReference must point to validated deployed-version evidence'))
    }

    const result = String(submitted.result || '').trim().toLowerCase()
    if (!['passed', 'pending', 'blocked', 'failed'].includes(result)) {
      issues.push(issue(provider.id, 'INVALID_RESULT', 'result must be passed, pending, blocked, or failed'))
    } else if (result !== 'passed') {
      issues.push(issue(provider.id, 'PROVIDER_NOT_PASSED', 'provider result must be passed before reopening'))
    }

    const proofRows = Array.isArray(submitted.evidence) ? submitted.evidence : []
    const proofByText = new Map(proofRows.map((row) => [String(row?.proof || '').trim(), row]))
    const proofCounts = new Map()
    const requiredProofs = new Set(provider.requiredEvidence)
    for (const row of proofRows) {
      const proof = String(row?.proof || '').trim()
      proofCounts.set(proof, (proofCounts.get(proof) || 0) + 1)
      if (!requiredProofs.has(proof)) {
        issues.push(issue(provider.id, 'UNKNOWN_PROOF', proof || 'blank proof row'))
      }
      for (const field of ['reference', 'notes']) {
        if (looksSecret(String(row?.[field] || ''))) {
          issues.push(issue(provider.id, 'SECRET_LIKE_VALUE', `${proof || 'unknown proof'}: ${field} looks like a secret`))
        }
      }
    }
    for (const required of provider.requiredEvidence) {
      if ((proofCounts.get(required) || 0) > 1) {
        issues.push(issue(provider.id, 'DUPLICATE_PROOF', `${required}: duplicate proof rows are not allowed`))
      }
      const row = proofByText.get(required)
      if (!row) {
        issues.push(issue(provider.id, 'REQUIRED_PROOF_MISSING', required))
        continue
      }

      const status = String(row.status || '').trim().toLowerCase()
      if (!['passed', 'pending', 'blocked', 'failed', 'not_applicable'].includes(status)) {
        issues.push(issue(provider.id, 'INVALID_PROOF_STATUS', `${required}: status must be passed, pending, blocked, failed, or not_applicable`))
      }
      if (status !== 'passed') {
        issues.push(issue(provider.id, 'PROOF_NOT_PASSED', `${required}: proof status must be passed before reopening`))
      }
      if (result === 'passed' && status !== 'passed') {
        issues.push(issue(provider.id, 'PASSED_PROVIDER_HAS_UNPASSED_PROOF', `${required}: provider result is passed but proof is ${status || 'missing'}`))
      }
      if (status === 'passed' && !String(row.reference || '').trim()) {
        issues.push(issue(provider.id, 'PROOF_REFERENCE_MISSING', `${required}: passed proof needs a sandbox/dashboard/log reference`))
      }
    }
  }

  for (const id of submittedProviders.keys()) {
    if (!expectedIds.has(id)) {
      issues.push(issue(id || '(blank)', 'UNKNOWN_PROVIDER', 'provider id is not in the reopening checklist'))
    }
  }

  return {
    ok: issues.length === 0,
    checkedProviders: providers.length,
    issueCount: issues.length,
    issues,
  }
}

function runSelfTest() {
  const missing = validateEvidenceObject({ providers: [] })
  assert(!missing.ok && missing.issues.some((item) => item.code === 'PROVIDER_MISSING'), 'missing provider evidence was accepted')

  const fillable = validateEvidenceObject(buildFilledEvidenceTemplate())
  assert(!fillable.ok && fillable.issues.some((item) => item.code === 'PROVIDER_NOT_PASSED'), 'pending fillable template was treated as reopening-ready')
  assert(fillable.issues.some((item) => item.code === 'PROOF_NOT_PASSED'), 'pending proof rows were not rejected as reopening evidence')

  const completeEvidence = {
    providers: providers.map((provider) => ({
      id: provider.id,
      evidenceId: `owner-${provider.id}-sandbox-20260919`,
      environment: 'sandbox',
      deployedVersion: 'local-review-build',
      deploymentEvidenceReference: 'deployed-version-evidence:validated',
      providerReference: `dashboard-case-${provider.id}`,
      verifiedBy: 'owner',
      verifiedAt: '2026-09-19T23:00:00Z',
      result: 'passed',
      evidence: provider.requiredEvidence.map((proof, index) => ({
        proof,
        status: 'passed',
        reference: `${provider.id}-sandbox-proof-${index + 1}`,
        notes: 'sanitized owner-controlled proof reference only',
      })),
    })),
  }
  const valid = validateEvidenceObject(completeEvidence)
  assert(valid.ok, `complete provider evidence fixture failed validation: ${JSON.stringify(valid.issues)}`)

  const secretLeak = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-secret-test',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'deployed-version-evidence:validated',
        providerReference: fakeStripeSecret,
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [],
      },
    ],
  })
  assert(secretLeak.issues.some((item) => item.code === 'SECRET_LIKE_VALUE'), 'secret-looking provider evidence reference was accepted')

  const duplicateProvider = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-sandbox-1',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'deployed-version-evidence:validated',
        providerReference: 'dashboard-case-ercas-1',
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [],
      },
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-sandbox-2',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'deployed-version-evidence:validated',
        providerReference: 'dashboard-case-ercas-2',
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [],
      },
    ],
  })
  assert(duplicateProvider.issues.some((item) => item.code === 'DUPLICATE_PROVIDER'), 'duplicate provider evidence section was accepted')

  const invalidTimestamp = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-invalid-time',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'deployed-version-evidence:validated',
        providerReference: 'dashboard-case-ercas',
        verifiedBy: 'owner',
        verifiedAt: 'after checking dashboard',
        result: 'pending',
        evidence: [],
      },
    ],
  })
  assert(invalidTimestamp.issues.some((item) => item.code === 'INVALID_VERIFIED_AT'), 'invalid provider verifiedAt was accepted')

  const missingDeploymentEvidenceReference = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-missing-deployment-evidence',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: '',
        providerReference: 'dashboard-case-ercas',
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [],
      },
    ],
  })
  assert(
    missingDeploymentEvidenceReference.issues.some((item) => item.code === 'STANDARD_FIELD_MISSING' && item.message.includes('deploymentEvidenceReference')),
    'provider evidence without deployment evidence reference was accepted',
  )
  const weakDeploymentEvidenceReference = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-weak-deployment-evidence',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'manual note only',
        providerReference: 'dashboard-case-ercas',
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [],
      },
    ],
  })
  assert(
    weakDeploymentEvidenceReference.issues.some((item) => item.code === 'DEPLOYMENT_EVIDENCE_REFERENCE_WEAK'),
    'weak deployment evidence reference was accepted',
  )

  const unknownProof = validateEvidenceObject({
    providers: [
      {
        id: 'ercas',
        evidenceId: 'owner-ercas-unknown-proof',
        environment: 'sandbox',
        deployedVersion: 'local-review-build',
        deploymentEvidenceReference: 'deployed-version-evidence:validated',
        providerReference: 'dashboard-case-ercas',
        verifiedBy: 'owner',
        verifiedAt: '2026-09-19T23:00:00Z',
        result: 'pending',
        evidence: [
          {
            proof: 'extra proof not in checklist',
            status: 'passed',
            reference: fakeStripeSecret,
            notes: 'sanitized owner-controlled proof reference only',
          },
        ],
      },
    ],
  })
  assert(unknownProof.issues.some((item) => item.code === 'UNKNOWN_PROOF'), 'unknown provider proof row was accepted')
  assert(unknownProof.issues.some((item) => item.code === 'SECRET_LIKE_VALUE'), 'secret-looking unknown proof reference was accepted')

  const duplicateProof = structuredClone(completeEvidence)
  duplicateProof.providers[0].evidence.push({ ...duplicateProof.providers[0].evidence[0] })
  const duplicateProofResult = validateEvidenceObject(duplicateProof)
  assert(duplicateProofResult.issues.some((item) => item.code === 'DUPLICATE_PROOF'), 'duplicate required provider proof row was accepted')

  const missingPassedProofReference = structuredClone(completeEvidence)
  missingPassedProofReference.providers[0].evidence[0].reference = ''
  const missingPassedProofReferenceResult = validateEvidenceObject(missingPassedProofReference)
  assert(missingPassedProofReferenceResult.issues.some((item) => item.code === 'PROOF_REFERENCE_MISSING'), 'passed provider proof without reference was accepted')

  console.log(JSON.stringify({
    ok: true,
    scenarios: [
      'missing provider sections fail validation',
      'fillable pending template is not treated as reopening-ready evidence',
      'complete sanitized provider proof passes validation',
      'secret-looking provider references are rejected',
      'duplicate provider sections are rejected',
      'unparseable verifiedAt timestamps are rejected',
      'provider proof must reference deployed-version evidence before reopening',
      'weak deployed-version evidence references are rejected',
      'unknown proof rows and secret-looking extra proof references are rejected',
      'duplicate required proof rows are rejected',
      'passed provider proof rows require sandbox/dashboard/log references',
    ],
  }, null, 2))
}

function issue(providerId, code, message) {
  return { providerId, code, message }
}

function looksSecret(value) {
  const clean = String(value || '').trim()
  if (!clean) return false
  if (/^(sk|pk|sec|whsec|rk|api|bearer|eyJ)[_\-.A-Za-z0-9]{20,}$/i.test(clean)) return true
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(clean) && !/^\d+$/.test(clean)) return true
  return false
}

function isValidTimestamp(value) {
  const text = String(value || '').trim()
  if (!/\d{4}-\d{2}-\d{2}/.test(text)) return false
  return !Number.isNaN(Date.parse(text))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
