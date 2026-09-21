import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))
const fakeStripeSecret = ['sk', 'live'].join('_') + '_123456789012345678901234'

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

const validatePath = args.get('validate')
const filledTemplate = args.get('filled-template') === 'true'
const format = String(args.get('format') || 'markdown').toLowerCase()

if (!['markdown', 'json'].includes(format)) {
  fail('Use --format markdown or --format json.')
}

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

if (validatePath && validatePath !== 'true') {
  const result = validateEvidenceFile(validatePath)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

const manifest = buildDeploymentEvidenceTemplate()

if (filledTemplate) {
  console.log(JSON.stringify(manifest, null, 2))
} else if (format === 'json') {
  console.log(JSON.stringify({
    generatedAt: manifest.generatedAt,
    warning: manifest.warning,
    source: manifest.source,
    surfaces: manifest.surfaces.map(({ id, name, type, requiredEvidence }) => ({
      id,
      name,
      type,
      requiredEvidence,
    })),
  }, null, 2))
} else {
  console.log('# Wallet Deployed Version Evidence Template\n')
  console.log('Fill this with owner-controlled Vercel/Supabase/database evidence after deployment. Do not paste secrets, bearer tokens, customer data, or raw private payloads.\n')
  console.log(`- source commit: \`${manifest.source.commit || 'unknown'}\``)
  console.log(`- source dirty: \`${manifest.source.dirty}\``)
  console.log(`- source fingerprint: \`${manifest.source.fingerprint}\`\n`)
  for (const surface of manifest.surfaces) {
    console.log(`## ${surface.name}`)
    console.log(`\n- surface id: \`${surface.id}\``)
    console.log(`- type: \`${surface.type}\``)
    console.log('- deployed reference:')
    console.log('- observed fingerprint/version:')
    console.log('- verified by:')
    console.log('- verified at:')
    console.log('- status: `pending`\n')
    console.log('Required proof:')
    for (const item of surface.requiredEvidence) console.log(`- [ ] ${item}`)
    console.log('\nNotes:\n')
  }
}

function buildDeploymentEvidenceTemplate() {
  const source = sourceSummary()
  const surfaces = [
    {
      id: 'vercel_app',
      name: 'Vercel/site application build',
      type: 'app',
      expectedSourceFingerprint: source.appFingerprint,
      requiredEvidence: [
        'deployed Vercel commit/build id matches the reviewed source commit or an approved artifact built from it',
        'public partner API bridge returns PARTNER_API_PAUSED',
        'legacy Ercas bridges return 410',
        'PocketFi unsigned bridge rejects before proxy',
        'iStar unsigned webhook rejects or reports unconfigured without mutation',
        'browser bundle does not expose provider/service-role secrets',
      ],
    },
    {
      id: 'supabase_migrations',
      name: 'Supabase database migrations',
      type: 'database',
      expectedSourceFingerprint: source.migrationFingerprint,
      requiredEvidence: [
        'all incident migrations through 20260919027000_harden_financial_security_version.sql are applied',
        'legacy replay migrations are applied in their no-op/suspend-only form',
        'read-only query pack reports zero unsafe grants/cascades for protected wallet evidence',
        'wallet DB security pack passes in staging/local owner-controlled Postgres',
        'DB concurrency runner passes in staging/local with dedicated fixture wallets',
      ],
    },
    {
      id: 'pause_flags',
      name: 'Production pause flags',
      type: 'configuration',
      expectedSourceFingerprint: source.pauseFlagFingerprint,
      requiredEvidence: [
        'BILLS_ENABLED is false or unset',
        'BITREFILL_ENABLED is false or unset',
        'WITHDRAWALS_ENABLED is false or unset',
        'REFERRAL_WITHDRAWALS_ENABLED is false or unset',
        'CRYPTO_TOPUP_ENABLED is false or unset',
        'SMM_ORDERS_ENABLED is false or unset',
        'SMS_OTP_ENABLED is false or unset',
        'TELEGRAM_ORDERS_ENABLED is false or unset',
        'LIVE_ACCOUNT_FULFILLMENT_ENABLED is false or unset',
        'AUTO_RESTOCK_ENABLED is false or unset',
        'MANUAL_RESTOCK_ENABLED is false or unset',
      ],
    },
    ...source.functions.map((fn) => ({
      id: `function:${fn.name}`,
      name: `Supabase Edge Function: ${fn.name}`,
      type: 'supabase_function',
      expectedSourceFingerprint: fn.fingerprint,
      requiredEvidence: [
        `deployed function ${fn.name} version matches the reviewed source or approved artifact`,
        'JWT setting matches repository config and any JWT-disabled function has its internal boundary verified',
        'function appears in the deployed function inventory or is explicitly disabled/removed',
        'if the function can move money, deliver value, or process provider evidence, the matching smoke/provider/staging proof is attached',
      ],
    })),
  ]

  return {
    generatedAt: new Date().toISOString(),
    warning: 'Fill with owner-controlled deployment/version evidence. Pending or missing proof keeps routes paused.',
    source: {
      ...source,
      dirtyArtifactApprovedBy: '',
      dirtyArtifactApprovedAt: '',
      dirtyArtifactEvidencePathOrLink: '',
      dirtyArtifactReviewNote: source.dirty
        ? 'Required because this template was generated from a dirty worktree. Preserve the reviewed artifact/fingerprint and approval evidence before relying on it.'
        : 'Not required when source.dirty is false.',
    },
    surfaces: surfaces.map((surface) => ({
      ...surface,
      status: 'pending',
      deployedReference: '',
      observedFingerprintOrVersion: '',
      verifiedBy: '',
      verifiedAt: '',
      evidencePathOrLink: '',
      evidence: surface.requiredEvidence.map((proof) => ({
        proof,
        status: 'pending',
        reference: '',
        notes: '',
      })),
      notes: '',
    })),
  }
}

function sourceSummary() {
  const functions = discoverFunctions()
  const migrationFiles = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((name) => /\.sql$/i.test(name))
    .sort()
    .map((name) => `supabase/migrations/${name}`)
  const appFiles = [
    'package.json',
    'api/partner-api.ts',
    'api/webhook-ercas.ts',
    'api/webhook-istar.ts',
    'api/webhook-pocketfi.ts',
    'pages/api/webhook/ercas.ts',
    'src/pages/AdminPage.tsx',
    'src/pages/OrderHistoryPage.tsx',
    'src/lib/supabase.ts',
  ].filter((path) => existsSync(join(root, path)))

  return {
    commit: git(['rev-parse', 'HEAD']).stdout.trim(),
    dirty: git(['status', '--porcelain']).stdout.trim().length > 0,
    fingerprint: hashFiles([...appFiles, ...migrationFiles, ...functions.flatMap((fn) => fn.files)]),
    appFingerprint: hashFiles(appFiles),
    migrationFingerprint: hashFiles(migrationFiles),
    pauseFlagFingerprint: hashText([
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
    ].join('\n')),
    functions,
  }
}

function discoverFunctions() {
  const functionsRoot = join(root, 'supabase', 'functions')
  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .filter((entry) => existsSync(join(functionsRoot, entry.name, 'index.ts')))
    .map((entry) => {
      const files = [`supabase/functions/${entry.name}/index.ts`]
      const configPath = `supabase/functions/${entry.name}/config.toml`
      if (existsSync(join(root, configPath))) files.push(configPath)
      return {
        name: entry.name,
        files,
        verifyJwtDisabled: files.some((file) => file.endsWith('config.toml') && read(file).includes('verify_jwt = false')),
        fingerprint: hashFiles(files),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function validateEvidenceFile(path) {
  const issues = []
  const evidence = JSON.parse(readFileSync(path, 'utf8'))
  const template = buildDeploymentEvidenceTemplate()
  validateSourceEvidence(evidence.source, template.source, issues)
  const expectedIds = new Set(template.surfaces.map((surface) => surface.id))
  const templateById = new Map(template.surfaces.map((surface) => [surface.id, surface]))
  const supplied = Array.isArray(evidence.surfaces) ? evidence.surfaces : []
  const byId = new Map(supplied.map((surface) => [surface.id, surface]))
  const surfaceCounts = new Map()
  for (const surface of supplied) {
    const id = String(surface?.id || '')
    surfaceCounts.set(id, (surfaceCounts.get(id) || 0) + 1)
  }

  for (const expectedId of expectedIds) {
    if (!byId.has(expectedId)) {
      issues.push(issue(expectedId, 'MISSING_SURFACE', 'deployment evidence is missing this required surface'))
    }
  }

  for (const surface of supplied) {
    if ((surfaceCounts.get(String(surface?.id || '')) || 0) > 1) {
      issues.push(issue(surface.id || '(blank)', 'DUPLICATE_SURFACE', 'deployment evidence contains duplicate rows for this surface'))
    }

    if (!expectedIds.has(surface.id)) {
      issues.push(issue(surface.id || '(blank)', 'UNKNOWN_SURFACE', 'surface is not in the deployment evidence template'))
      continue
    }

    if (String(surface.status || '').toLowerCase() !== 'passed') {
      issues.push(issue(surface.id, 'SURFACE_NOT_PASSED', 'surface status must be passed before reopening or relying on it'))
    }

    for (const field of ['deployedReference', 'observedFingerprintOrVersion', 'verifiedBy', 'verifiedAt', 'evidencePathOrLink']) {
      if (!String(surface[field] || '').trim()) {
        issues.push(issue(surface.id, 'MISSING_FIELD', `surface is missing ${field}`))
      }
    }
    if (String(surface.verifiedAt || '').trim() && !isValidTimestamp(surface.verifiedAt)) {
      issues.push(issue(surface.id, 'INVALID_VERIFIED_AT', 'verifiedAt must be a parseable absolute timestamp'))
    }

    const expected = templateById.get(surface.id)?.expectedSourceFingerprint
    const observed = String(surface.observedFingerprintOrVersion || '').trim()
    if (expected && String(surface.expectedSourceFingerprint || '').trim() !== String(expected)) {
      issues.push(issue(surface.id, 'EXPECTED_FINGERPRINT_CHANGED', 'submitted expected source fingerprint is missing or differs from the reviewed source fingerprint'))
    }
    if (expected && isSha256Fingerprint(observed) && observed.toLowerCase() !== String(expected).toLowerCase()) {
      issues.push(issue(surface.id, 'FINGERPRINT_MISMATCH', 'observed SHA-256 fingerprint does not match the reviewed source fingerprint'))
    }

    for (const [key, value] of Object.entries(surface)) {
      if (['expectedSourceFingerprint', 'observedFingerprintOrVersion'].includes(key) && isSha256Fingerprint(value)) continue
      if (typeof value === 'string' && looksSecretLike(value)) {
        issues.push(issue(surface.id, 'SECRET_LIKE_VALUE', `${key} looks like a secret/token; store sanitized references only`))
      }
    }

    validateSurfaceProofEvidence(surface, templateById.get(surface.id), issues)
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    expectedSurfaceCount: expectedIds.size,
    suppliedSurfaceCount: supplied.length,
    issues,
  }
}

function validateSurfaceProofEvidence(surface, expectedSurface, issues) {
  const requiredEvidence = Array.isArray(expectedSurface?.requiredEvidence)
    ? expectedSurface.requiredEvidence
    : []
  const proofRows = Array.isArray(surface.evidence) ? surface.evidence : []
  const requiredProofs = new Set(requiredEvidence)
  const proofCounts = new Map()
  const proofByText = new Map()

  for (const row of proofRows) {
    const proof = String(row?.proof || '').trim()
    proofCounts.set(proof, (proofCounts.get(proof) || 0) + 1)
    if (!proofByText.has(proof)) proofByText.set(proof, row)
    if (!requiredProofs.has(proof)) {
      issues.push(issue(surface.id, 'UNKNOWN_PROOF', proof || 'blank proof row'))
    }
    for (const field of ['reference', 'notes']) {
      if (looksSecretLike(row?.[field])) {
        issues.push(issue(surface.id, 'SECRET_LIKE_VALUE', `${proof || 'unknown proof'}: ${field} looks like a secret/token; store sanitized references only`))
      }
    }
  }

  for (const required of requiredEvidence) {
    if ((proofCounts.get(required) || 0) > 1) {
      issues.push(issue(surface.id, 'DUPLICATE_PROOF', `${required}: duplicate proof rows are not allowed`))
    }
    const row = proofByText.get(required)
    if (!row) {
      issues.push(issue(surface.id, 'REQUIRED_PROOF_MISSING', required))
      continue
    }
    const status = String(row.status || '').trim().toLowerCase()
    if (!['passed', 'pending', 'blocked', 'failed'].includes(status)) {
      issues.push(issue(surface.id, 'INVALID_PROOF_STATUS', `${required}: proof status must be passed, pending, blocked, or failed`))
    }
    if (status !== 'passed') {
      issues.push(issue(surface.id, 'PROOF_NOT_PASSED', `${required}: proof status must be passed before relying on this deployed surface`))
    }
    if (String(surface.status || '').toLowerCase() === 'passed' && status !== 'passed') {
      issues.push(issue(surface.id, 'PASSED_SURFACE_HAS_UNPASSED_PROOF', `${required}: surface is passed but proof is ${status || 'missing'}`))
    }
    if (status === 'passed' && !String(row.reference || '').trim()) {
      issues.push(issue(surface.id, 'PROOF_REFERENCE_MISSING', `${required}: passed proof needs a deployment/smoke/staging evidence reference`))
    }
  }
}

function validateSourceEvidence(source, expectedSource, issues) {
  if (!source || typeof source !== 'object') {
    issues.push(issue('source', 'MISSING_SOURCE', 'deployment evidence is missing reviewed source metadata'))
    return
  }

  for (const field of ['commit', 'dirty', 'fingerprint', 'appFingerprint', 'migrationFingerprint', 'pauseFlagFingerprint']) {
    if (source[field] === undefined || source[field] === null || String(source[field]).trim() === '') {
      issues.push(issue('source', 'MISSING_SOURCE_FIELD', `source is missing ${field}`))
    }
  }

  for (const field of ['fingerprint', 'appFingerprint', 'migrationFingerprint', 'pauseFlagFingerprint']) {
    if (String(source[field] || '').trim() !== String(expectedSource[field] || '').trim()) {
      issues.push(issue('source', 'SOURCE_FINGERPRINT_CHANGED', `source.${field} differs from the current reviewed source fingerprint`))
    }
  }

  if (String(source.commit || '').trim() !== String(expectedSource.commit || '').trim()) {
    issues.push(issue('source', 'SOURCE_COMMIT_CHANGED', 'source.commit differs from the current reviewed source commit'))
  }

  if (Boolean(source.dirty) !== Boolean(expectedSource.dirty)) {
    issues.push(issue('source', 'SOURCE_DIRTY_STATE_CHANGED', 'source.dirty differs from the current reviewed source dirty state; regenerate the evidence template from the exact reviewed artifact'))
  }

  if (Boolean(source.dirty)) {
    for (const field of ['dirtyArtifactApprovedBy', 'dirtyArtifactApprovedAt', 'dirtyArtifactEvidencePathOrLink', 'dirtyArtifactReviewNote']) {
      if (!String(source[field] || '').trim()) {
        issues.push(issue('source', 'DIRTY_SOURCE_APPROVAL_REQUIRED', `dirty source evidence is missing ${field}`))
      }
    }
    if (String(source.dirtyArtifactApprovedAt || '').trim() && !isValidTimestamp(source.dirtyArtifactApprovedAt)) {
      issues.push(issue('source', 'INVALID_DIRTY_SOURCE_APPROVAL_AT', 'dirtyArtifactApprovedAt must be a parseable absolute timestamp'))
    }
  }

  for (const field of ['dirtyArtifactApprovedBy', 'dirtyArtifactEvidencePathOrLink', 'dirtyArtifactReviewNote']) {
    if (typeof source[field] === 'string' && looksSecretLike(source[field])) {
      issues.push(issue('source', 'SECRET_LIKE_VALUE', `source.${field} looks like a secret/token; store sanitized references only`))
    }
  }
}

function runSelfTest() {
  const template = buildDeploymentEvidenceTemplate()
  const missing = validateObject({ surfaces: template.surfaces.slice(0, 2) })
  assert(!missing.ok && missing.issues.some((item) => item.code === 'MISSING_SURFACE'), 'self-test expected missing surfaces to fail')

  const pending = validateObject(template)
  assert(!pending.ok && pending.issues.some((item) => item.code === 'SURFACE_NOT_PASSED'), 'self-test expected pending surfaces to fail')

  const complete = {
    ...template,
    source: withDirtySourceApproval(template.source),
    surfaces: template.surfaces.map((surface) => ({
      ...surface,
      status: 'passed',
      deployedReference: `deploy-${surface.id.replace(/[^a-z0-9:-]/gi, '-')}`,
      observedFingerprintOrVersion: surface.expectedSourceFingerprint || 'verified-version',
      verifiedBy: 'owner',
      verifiedAt: '2026-09-19T00:00:00Z',
      evidencePathOrLink: `private-evidence/${surface.id.replace(/[^a-z0-9:-]/gi, '-')}.json`,
      evidence: surface.requiredEvidence.map((proof, index) => ({
        proof,
        status: 'passed',
        reference: `private-evidence/${surface.id.replace(/[^a-z0-9:-]/gi, '-')}-proof-${index + 1}.json`,
        notes: 'sanitized owner-controlled deployment proof reference only',
      })),
    })),
  }
  const passed = validateObject(complete)
  assert(passed.ok, `self-test expected complete evidence to pass: ${JSON.stringify(passed.issues)}`)

  const dirtyWithoutApproval = structuredClone(complete)
  dirtyWithoutApproval.source = {
    ...template.source,
    dirty: true,
    dirtyArtifactApprovedBy: '',
    dirtyArtifactApprovedAt: '',
    dirtyArtifactEvidencePathOrLink: '',
    dirtyArtifactReviewNote: '',
  }
  const dirtyWithoutApprovalResult = validateObject(dirtyWithoutApproval)
  assert(
    !dirtyWithoutApprovalResult.ok
      && dirtyWithoutApprovalResult.issues.some((item) => item.code === 'DIRTY_SOURCE_APPROVAL_REQUIRED'),
    'self-test expected dirty source without approval evidence to fail',
  )

  const dirtyWithInvalidTimestamp = structuredClone(complete)
  dirtyWithInvalidTimestamp.source = {
    ...template.source,
    dirty: true,
    dirtyArtifactApprovedBy: 'owner',
    dirtyArtifactApprovedAt: 'after reviewing it',
    dirtyArtifactEvidencePathOrLink: 'private-evidence/reviewed-dirty-source.json',
    dirtyArtifactReviewNote: 'Approved reviewed artifact fingerprint before deployment.',
  }
  const dirtyWithInvalidTimestampResult = validateObject(dirtyWithInvalidTimestamp)
  assert(
    !dirtyWithInvalidTimestampResult.ok
      && dirtyWithInvalidTimestampResult.issues.some((item) => item.code === 'INVALID_DIRTY_SOURCE_APPROVAL_AT'),
    'self-test expected dirty source with informal approval timestamp to fail',
  )

  const secret = structuredClone(complete)
  secret.surfaces[0].deployedReference = fakeStripeSecret
  const secretResult = validateObject(secret)
  assert(!secretResult.ok && secretResult.issues.some((item) => item.code === 'SECRET_LIKE_VALUE'), 'self-test expected secret-looking values to fail')

  const mismatch = structuredClone(complete)
  mismatch.surfaces[0].observedFingerprintOrVersion = '0'.repeat(64)
  const mismatchResult = validateObject(mismatch)
  assert(!mismatchResult.ok && mismatchResult.issues.some((item) => item.code === 'FINGERPRINT_MISMATCH'), 'self-test expected mismatched deployed fingerprint to fail')

  const tamperedExpected = structuredClone(complete)
  tamperedExpected.surfaces[0].expectedSourceFingerprint = '0'.repeat(64)
  tamperedExpected.surfaces[0].observedFingerprintOrVersion = '0'.repeat(64)
  const tamperedExpectedResult = validateObject(tamperedExpected)
  assert(!tamperedExpectedResult.ok && tamperedExpectedResult.issues.some((item) => item.code === 'EXPECTED_FINGERPRINT_CHANGED'), 'self-test expected tampered expected fingerprint to fail')

  const duplicate = structuredClone(complete)
  duplicate.surfaces.push({ ...duplicate.surfaces[0] })
  const duplicateResult = validateObject(duplicate)
  assert(!duplicateResult.ok && duplicateResult.issues.some((item) => item.code === 'DUPLICATE_SURFACE'), 'self-test expected duplicate surface evidence to fail')

  const invalidTimestamp = structuredClone(complete)
  invalidTimestamp.surfaces[0].verifiedAt = 'sometime after deploy'
  const invalidTimestampResult = validateObject(invalidTimestamp)
  assert(!invalidTimestampResult.ok && invalidTimestampResult.issues.some((item) => item.code === 'INVALID_VERIFIED_AT'), 'self-test expected invalid verifiedAt to fail')

  const missingProof = structuredClone(complete)
  missingProof.surfaces[0].evidence = missingProof.surfaces[0].evidence.slice(1)
  const missingProofResult = validateObject(missingProof)
  assert(!missingProofResult.ok && missingProofResult.issues.some((item) => item.code === 'REQUIRED_PROOF_MISSING'), 'self-test expected missing deployment proof row to fail')

  const pendingProof = structuredClone(complete)
  pendingProof.surfaces[0].evidence[0].status = 'pending'
  const pendingProofResult = validateObject(pendingProof)
  assert(!pendingProofResult.ok && pendingProofResult.issues.some((item) => item.code === 'PROOF_NOT_PASSED'), 'self-test expected pending deployment proof row to fail')

  const unknownProof = structuredClone(complete)
  unknownProof.surfaces[0].evidence.push({
    proof: 'extra proof not in deployed-version checklist',
    status: 'passed',
    reference: fakeStripeSecret,
    notes: 'sanitized owner-controlled deployment proof reference only',
  })
  const unknownProofResult = validateObject(unknownProof)
  assert(!unknownProofResult.ok && unknownProofResult.issues.some((item) => item.code === 'UNKNOWN_PROOF'), 'self-test expected unknown deployment proof row to fail')
  assert(!unknownProofResult.ok && unknownProofResult.issues.some((item) => item.code === 'SECRET_LIKE_VALUE'), 'self-test expected secret-looking deployment proof row reference to fail')

  console.log(JSON.stringify({ ok: true, surfaces: template.surfaces.length }, null, 2))
}

function validateObject(value) {
  const tempPath = join(root, '.wallet-deployed-version-evidence-self-test.json')
  writeFileSync(tempPath, JSON.stringify(value, null, 2))
  try {
    return validateEvidenceFile(tempPath)
  } finally {
    rmSync(tempPath, { force: true })
  }
}

function withDirtySourceApproval(source) {
  if (!source.dirty) return source
  return {
    ...source,
    dirtyArtifactApprovedBy: 'owner',
    dirtyArtifactApprovedAt: '2026-09-19T00:00:00Z',
    dirtyArtifactEvidencePathOrLink: 'private-evidence/reviewed-dirty-source.json',
    dirtyArtifactReviewNote: 'Approved reviewed artifact fingerprint before deployment.',
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

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function hashFiles(files) {
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(read(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex')
}

function git(params) {
  const result = spawnSync('git', params, { cwd: root, encoding: 'utf8' })
  return {
    status: result.status,
    stdout: result.status === 0 ? result.stdout : '',
    stderr: result.stderr || result.stdout || '',
  }
}

function looksSecretLike(value) {
  const clean = String(value || '').trim()
  return /(sk_live_|eyJ[a-zA-Z0-9_-]{20,}|service_role|bearer\s+[a-z0-9._-]{20,}|[a-z0-9]{32,})/i.test(clean)
}

function isSha256Fingerprint(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim())
}

function isValidTimestamp(value) {
  const text = String(value || '').trim()
  if (!/\d{4}-\d{2}-\d{2}/.test(text)) return false
  return !Number.isNaN(Date.parse(text))
}

function issue(surfaceId, code, message) {
  return { surfaceId, code, message }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function printHelp() {
  console.log(`Create or validate wallet incident deployed-version evidence.

Usage:
  npm run security:wallet:deployed-versions -- --format json
  npm run security:wallet:deployed-versions -- --filled-template > deployed-version-evidence.json
  npm run security:wallet:deployed-versions -- --validate deployed-version-evidence.json
  npm run security:wallet:deployed-versions -- --self-test

The generated template fingerprints the reviewed source surfaces and lists every
Supabase Edge Function plus the app, migrations, and incident pause flags. The
validator is intentionally fail-closed: missing, pending, failed, blocked, or
secret-looking evidence fails validation. It does not contact Vercel or Supabase
and does not prove production by itself; the owner must fill it from deployment
dashboards and preserved smoke/staging output.
`)
}
