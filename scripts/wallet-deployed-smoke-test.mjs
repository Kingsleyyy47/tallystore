import { readFileSync } from 'node:fs'

const args = parseArgs(process.argv.slice(2))

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

const validateOwnerDeniedProbesPath = resolveValidateOwnerDeniedProbesPath()
if (validateOwnerDeniedProbesPath) {
  validateOwnerDeniedProbesFile(validateOwnerDeniedProbesPath)
  process.exit(0)
}

const baseUrl = normalizeBaseUrl(args.get('base-url') || process.env.TALLYSTORE_DEPLOYED_BASE_URL)
const functionsBaseUrl = normalizeBaseUrl(args.get('functions-base-url') || process.env.TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL)
const envName = clean(process.env.TALLYSTORE_DEPLOYED_SMOKE_ENV).toLowerCase()
const ack = clean(process.env.TALLYSTORE_DEPLOYED_SMOKE_ACK)
const edgeAuthorization = clean(args.get('authorization') || process.env.TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION)
const cronSecret = clean(args.get('cron-secret') || process.env.TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET)
const ownerDeniedProbesPath = clean(args.get('owner-denied-probes') || process.env.TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES)
const ownerDeniedProbesAck = clean(process.env.TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK)
const allowProduction = args.get('allow-production') === 'true'
const jsonOnly = args.get('json') === 'true'
const requestTimeoutMs = Number(args.get('timeout-ms') || process.env.TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS || 15_000)

if (!['staging', 'production', 'preview'].includes(envName)) {
  fail('Set TALLYSTORE_DEPLOYED_SMOKE_ENV to staging, preview, or production.')
}

if (envName === 'production' && !allowProduction) {
  fail('Production smoke checks require --allow-production.')
}

if (ack !== 'I_UNDERSTAND_NO_ORDER_CREATION') {
  fail('Set TALLYSTORE_DEPLOYED_SMOKE_ACK=I_UNDERSTAND_NO_ORDER_CREATION before running deployed route checks.')
}

if (!baseUrl) {
  fail('Provide --base-url https://... or TALLYSTORE_DEPLOYED_BASE_URL.')
}

const publicRouteTests = [
  {
    name: 'partner api is paused',
    path: '/api/partner-api',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tally-api-key': 'smoke-test-not-a-real-key' },
      body: JSON.stringify({ action: 'catalogue' }),
    },
    expect: ({ status, body }) =>
      status === 503 &&
      String(body?.code || '').toUpperCase() === 'PARTNER_API_PAUSED',
  },
  {
    name: 'legacy ercas bridge is gone',
    path: '/api/webhook-ercas',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ smoke: true }),
    },
    expect: ({ status, text }) =>
      status === 410 &&
      /legacy webhook is disabled/i.test(text),
  },
  {
    name: 'legacy pages ercas bridge is gone',
    path: '/api/webhook/ercas',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ smoke: true }),
    },
    expect: ({ status, text }) =>
      status === 410 &&
      /legacy webhook is disabled/i.test(text),
  },
  {
    name: 'pocketfi unsigned bridge is rejected before proxy',
    path: '/api/webhook-pocketfi',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_reference: 'smoke-test', amount: 1 }),
    },
    expect: ({ status, text }) =>
      status === 401 &&
      /verification header/i.test(text),
  },
  {
    name: 'istar unsigned webhook is rejected or unconfigured',
    path: '/api/webhook-istar',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'order.failed', order: { id: 'smoke-test' } }),
    },
    expect: ({ status, text }) =>
      (status === 401 && /invalid webhook signature/i.test(text)) ||
      (status === 503 && /webhook is not configured/i.test(text)),
  },
]

const pausedEdgeFunctionTests = functionsBaseUrl
  ? [
      edgeFunctionDeniedTest('edge partner api is paused or denied', 'partner-api', {
        action: 'catalogue',
      }),
      edgeFunctionDeniedTest('bills purchase function is paused or denied', 'purchase-bills', {
        billType: 'airtime',
        amount: 100,
        customer: 'smoke-test',
      }, { expectedPausedCode: 'BILLS_PAUSED' }),
      edgeFunctionDeniedTest('bitrefill purchase function is paused or denied', 'purchase-bitrefill', {
        productId: 'smoke-test',
        quantity: 1,
      }, { expectedPausedCode: 'BITREFILL_PAUSED' }),
      edgeFunctionDeniedTest('withdrawal requests are paused or denied', 'create-withdrawal-request', {
        amount: 100,
        destination: 'smoke-test',
      }, { expectedPausedCode: 'WITHDRAWALS_PAUSED' }),
      edgeFunctionDeniedTest('crypto sell orders are paused or denied', 'create-crypto-sell-order', {
        cryptoType: 'BTC',
        amount: 1,
      }, { expectedPausedCode: 'CRYPTO_TOPUP_PAUSED' }),
      edgeFunctionDeniedTest('SMM orders are paused or denied', 'smm-create-order', {
        service_id: 'smoke-service',
        quantity: 100,
        link: 'https://example.invalid/smoke',
        expected_price_ngn: 1,
        idempotency_key: 'smoke-paused-smm',
      }, { expectedPausedCode: 'SMM_ORDERS_PAUSED' }),
      edgeFunctionDeniedTest('SMS OTP purchases are paused or denied', 'smsbus', {
        action: 'create_otp',
        service_id: 'smoke-service',
        expected_price_ngn: 1,
        idempotency_key: 'smoke-paused-sms',
      }, { expectedPausedCode: 'SMS_OTP_PAUSED' }),
      edgeFunctionDeniedTest('Telegram Stars orders are paused or denied', 'telegram-stars', {
        action: 'create_stars_order',
        username: 'smoke_user',
        recipient_hash: 'smoke-recipient',
        quantity: 50,
        idempotency_key: 'smoke-paused-telegram',
      }, { expectedPausedCode: 'TELEGRAM_ORDERS_PAUSED' }),
      edgeFunctionDeniedTest('referral withdrawal is paused or denied', 'withdraw-referral-balance', {
        amount: 100,
      }, { expectedPausedCode: 'REFERRAL_WITHDRAWALS_PAUSED' }),
      edgeFunctionDeniedTest('manual restock is paused or denied', 'manual-restock', {
        productId: 'smoke-test',
      }, { expectedPausedCode: 'MANUAL_RESTOCK_PAUSED' }),
      edgeFunctionDeniedTest('auto restock is paused or denied', 'auto-restock', {
        productId: 'smoke-test',
      }, { expectedPausedCode: 'AUTO_RESTOCK_PAUSED', requiresCronSecret: true }),
      edgeFunctionDeniedTest('live account fulfillment is paused or denied', 'muabanvia-fulfill', {
        orderId: 'smoke-test',
      }, { expectedPausedCode: 'LIVE_ACCOUNT_FULFILLMENT_PAUSED' }),
    ]
  : []

const malformedCheckoutTests = functionsBaseUrl
  ? [
      edgeFunctionMalformedTest('product checkout rejects invalid quantity before order creation', 'process-purchase', {
        product_group_id: 'smoke-product',
        quantity: -1,
        expected_amount_ngn: 1,
        idempotency_key: 'smoke-invalid-product',
      }, /invalid request|quantity/i),
    ]
  : []

const ownerDeniedProbeTests = functionsBaseUrl && ownerDeniedProbesPath
  ? loadOwnerDeniedProbeTests(ownerDeniedProbesPath)
  : []

const tests = [
  ...publicRouteTests.map((test) => ({ ...test, baseUrl })),
  ...pausedEdgeFunctionTests.map((test) => ({ ...test, baseUrl: functionsBaseUrl })),
  ...malformedCheckoutTests.map((test) => ({ ...test, baseUrl: functionsBaseUrl })),
  ...ownerDeniedProbeTests.map((test) => ({ ...test, baseUrl: functionsBaseUrl })),
]

const startedAt = new Date().toISOString()
const results = []

for (const test of tests) {
  const url = new URL(test.path, test.baseUrl).toString()
  const started = Date.now()
  try {
    const response = await fetch(url, {
      ...test.init,
      redirect: 'manual',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    const text = await response.text()
    const body = parseJson(text)
    const passed = test.expect({ status: response.status, text, body })
    results.push({
      name: test.name,
      path: test.path,
      status: response.status,
      passed,
      durationMs: Date.now() - started,
      body: safeBody(body, text),
    })
  } catch (error) {
    results.push({
      name: test.name,
      path: test.path,
      status: null,
      passed: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const failed = results.filter((result) => !result.passed)
const summary = {
  ok: failed.length === 0,
  environment: envName,
  baseUrl,
  functionsBaseUrl: functionsBaseUrl || null,
  edgeAuthorizationProvided: Boolean(edgeAuthorization),
  cronSecretProvided: Boolean(cronSecret),
  ownerDeniedProbesLoaded: ownerDeniedProbeTests.length,
  requestTimeoutMs,
  startedAt,
  finishedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
  acceptanceBoundary: [
    'This smoke test sends only denied/paused webhook and partner API requests.',
    'When TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL is set, it also sends unauthenticated no-order probes to paused paid Edge Functions.',
    'When TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION is set, paused Edge Functions must return their exact stable *_PAUSED codes.',
    'With TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION, malformed active-checkout probes must fail validation before order creation, wallet debit, provider dispatch, or value reveal.',
    'With TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES and its explicit acknowledgement, owner-defined denied checkout probes must fail with the configured reason and body.success must not be true.',
    'Auto-restock exact paused-code verification also requires TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET.',
    'It does not prove provider sandbox behavior, database grants, worker versions, or paid checkout fulfillment.',
    'Do not reopen a paused paid route solely because this smoke test passes.',
  ],
}

if (jsonOnly) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`Deployed wallet smoke test ${summary.ok ? 'passed' : 'failed'}: ${summary.passed}/${summary.total}`)
  for (const result of results) {
    console.log(`${result.passed ? 'ok' : 'not ok'} - ${result.name} [${result.status ?? 'error'}] ${result.path}`)
    if (!result.passed && result.error) console.log(`  ${result.error}`)
    if (!result.passed && result.body) console.log(`  ${JSON.stringify(result.body)}`)
  }
}

if (!summary.ok) process.exit(1)

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

function normalizeBaseUrl(value) {
  const cleaned = clean(value)
  if (!cleaned) return ''
  try {
    const parsed = new URL(cleaned)
    if (!['https:', 'http:'].includes(parsed.protocol)) return ''
    parsed.pathname = '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function safeBody(body, text) {
  if (body && typeof body === 'object') {
    const safe = {}
    for (const key of ['success', 'error', 'code', 'message']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) safe[key] = body[key]
    }
    return safe
  }
  return text ? text.slice(0, 300) : ''
}

function edgeFunctionDeniedTest(name, functionName, payload, options = {}) {
  const expectedPausedCode = clean(options.expectedPausedCode).toUpperCase()
  const headers = {
    'content-type': 'application/json',
    'x-tally-smoke-test': 'no-order-creation',
  }
  if (edgeAuthorization) headers.authorization = edgeAuthorization
  if (options.requiresCronSecret && cronSecret) headers['x-cron-secret'] = cronSecret

  return {
    name,
    path: `/${functionName}`,
    init: {
      method: 'POST',
      headers,
      body: buildEdgeDeniedProbeBody(payload, functionName),
    },
    expect: ({ status, body, text }) => {
      const code = String(body?.code || body?.error || body?.message || '').toLowerCase()
      const bodyCode = String(body?.code || '').toUpperCase()
      if (expectedPausedCode) {
        if (status === 503 && bodyCode === expectedPausedCode) return true
        if (!edgeAuthorization && [401, 403].includes(status) && /unauthorized|forbidden|missing authorization|jwt/i.test(`${code} ${text}`)) {
          return true
        }
        if (options.requiresCronSecret && !cronSecret && status === 401 && /unauthorized|forbidden|cron|secret/i.test(`${code} ${text}`)) {
          return true
        }
        return false
      }
      return (
        [401, 403, 410, 423, 503].includes(status) &&
        /paused|disabled|unauthorized|forbidden|suspended|not configured|missing authorization|jwt/i.test(`${code} ${text}`)
      )
    },
  }
}

function edgeFunctionMalformedTest(name, functionName, payload, expectedErrorPattern) {
  const headers = {
    'content-type': 'application/json',
    'x-tally-smoke-test': 'no-order-creation',
  }
  if (edgeAuthorization) headers.authorization = edgeAuthorization

  return {
    name,
    path: `/${functionName}`,
    init: {
      method: 'POST',
      headers,
      body: buildEdgeDeniedProbeBody(payload, functionName),
    },
    expect: ({ status, body, text }) => {
      const content = `${body?.code || ''} ${body?.error || ''} ${body?.message || ''} ${text || ''}`
      if (!edgeAuthorization && [401, 403].includes(status) && /unauthorized|forbidden|missing authorization|jwt/i.test(content)) {
        return true
      }
      return [200, 400, 422].includes(status) &&
        body?.success !== true &&
        expectedErrorPattern.test(content)
    },
  }
}

function loadOwnerDeniedProbeTests(path) {
  if (ownerDeniedProbesAck !== 'I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED') {
    fail('Set TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK=I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED before running owner-defined denied checkout probes.')
  }
  if (!edgeAuthorization) {
    fail('Owner-defined denied checkout probes require TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION or --authorization for the owner-controlled test account.')
  }

  const probes = readOwnerDeniedProbeConfig(path)
  return probes.map(ownerDeniedProbeToTest)
}

function ownerDeniedProbeToTest(probe, index) {
  const expectedPattern = compileOwnerDeniedProbePattern(probe, index)
  const expectedStatuses = normalizeOwnerDeniedProbeExpectedStatuses(probe, index)
  const functionName = normalizeOwnerDeniedProbeFunctionName(probe, index)
  const method = normalizeOwnerDeniedProbeMethod(probe, index)
  const payload = normalizeOwnerDeniedProbePayload(probe, index)
  const customHeaders = sanitizeOwnerProbeHeaders(probe.headers, index)
  const probeHeaders = {
    ...customHeaders,
    'content-type': 'application/json',
    'x-tally-smoke-test': 'owner-denied-no-value-delivery',
    authorization: edgeAuthorization,
  }
  return {
    name: clean(probe.name) || `owner denied checkout probe ${index + 1}`,
    path: `/${functionName}`,
    init: {
      method,
      headers: probeHeaders,
      body: buildOwnerDeniedProbeBody(payload),
    },
    expect: ({ status, body, text }) => {
      const content = `${body?.code || ''} ${body?.error || ''} ${body?.message || ''} ${text || ''}`
      return expectedStatuses.includes(status) &&
        body?.success !== true &&
        expectedPattern.test(content)
    },
  }
}

function readOwnerDeniedProbeConfig(path, failer = fail) {
  let text
  try {
    text = requireReadFile(path)
  } catch (error) {
    failer(`Could not read owner denied probes file: ${error instanceof Error ? error.message : String(error)}`)
  }

  let config
  try {
    config = JSON.parse(text)
  } catch (error) {
    failer(`Owner denied probes file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const probes = Array.isArray(config) ? config : config?.probes
  if (!Array.isArray(probes) || probes.length === 0) {
    failer('Owner denied probes file must contain a non-empty array or { "probes": [...] }.')
  }

  return probes.map((probe, index) => {
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
      failer(`Owner denied probe ${index + 1} must be an object.`)
    }
    normalizeOwnerDeniedProbeFunctionName(probe, index, failer)
    normalizeOwnerDeniedProbeMethod(probe, index, failer)
    normalizeOwnerDeniedProbePayload(probe, index, failer)
    normalizeOwnerDeniedProbeExpectedStatuses(probe, index, failer)
    compileOwnerDeniedProbePattern(probe, index, failer)
    sanitizeOwnerProbeHeaders(probe.headers, index, failer)
    return probe
  })
}

function normalizeOwnerDeniedProbeFunctionName(probe, index, failer = fail) {
  const functionName = clean(probe.functionName || probe.function || probe.path)
    .replace(/^\/+/, '')
    .replace(/^functions\/v1\//, '')
  if (!functionName || !/^[A-Za-z0-9_-]+$/.test(functionName)) {
    failer(`Owner denied probe ${index + 1} has an invalid functionName.`)
  }
  return functionName
}

function normalizeOwnerDeniedProbeMethod(probe, index, failer = fail) {
  const method = clean(probe.method || 'POST').toUpperCase()
  if (method !== 'POST') {
    failer(`Owner denied probe ${index + 1} must use POST so deployed smoke checks only exercise checkout-style denied requests.`)
  }
  return method
}

function normalizeOwnerDeniedProbePayload(probe, index, failer = fail) {
  if (probe.payload == null) return {}
  if (typeof probe.payload !== 'object' || Array.isArray(probe.payload)) {
    failer(`Owner denied probe ${index + 1} payload must be an object when supplied.`)
  }
  validateOwnerProbePayloadSafety(probe.payload, index, failer)
  return probe.payload
}

function buildOwnerDeniedProbeBody(payload) {
  return JSON.stringify({
    ...payload,
    smoke: true,
  })
}

function buildEdgeDeniedProbeBody(payload, functionName) {
  return JSON.stringify({
    ...payload,
    idempotency_key: clean(payload?.idempotency_key) || `smoke-no-order:${functionName}`,
    smoke: true,
  })
}

function validateOwnerProbePayloadSafety(payload, index, failer = fail, path = 'payload') {
  for (const [key, value] of Object.entries(payload)) {
    const fieldPath = `${path}.${key}`
    const normalizedKey = clean(key).toLowerCase()
    if (normalizedKey === 'smoke') {
      failer(`Owner denied probe ${index + 1} must not set ${fieldPath}; the smoke marker is controlled by the runner.`)
    }
    if (/authorization|cookie|token|secret|password|service[_-]?role|api[_-]?key/i.test(normalizedKey)) {
      failer(`Owner denied probe ${index + 1} payload field ${fieldPath} looks like a credential field. Keep credentials in environment variables, not probe JSON files.`)
    }
    if (typeof value === 'string' && looksSecretLike(value)) {
      failer(`Owner denied probe ${index + 1} payload field ${fieldPath} looks like a secret. Keep secrets in environment variables, not probe JSON files.`)
    }
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach((item, itemIndex) => {
          if (typeof item === 'string' && looksSecretLike(item)) {
            failer(`Owner denied probe ${index + 1} payload field ${fieldPath}[${itemIndex}] looks like a secret. Keep secrets in environment variables, not probe JSON files.`)
          }
          if (item && typeof item === 'object') validateOwnerProbePayloadSafety(item, index, failer, `${fieldPath}[${itemIndex}]`)
        })
      } else {
        validateOwnerProbePayloadSafety(value, index, failer, fieldPath)
      }
    }
  }
}

function normalizeOwnerDeniedProbeExpectedStatuses(probe, index, failer = fail) {
  const expectedStatuses = Array.isArray(probe.expectedStatuses)
    ? probe.expectedStatuses.map(Number)
    : [400, 402, 403, 409, 422, 423, 503]
  if (expectedStatuses.length === 0 || expectedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    failer(`Owner denied probe ${index + 1} expectedStatuses must contain valid HTTP status codes.`)
  }
  return expectedStatuses
}

function compileOwnerDeniedProbePattern(probe, index, failer = fail) {
  try {
    return probe.expectedPattern
      ? new RegExp(String(probe.expectedPattern), probe.expectedPatternFlags || 'i')
      : /insufficient|frozen|suspended|review|required|conflict|unbacked|unavailable|denied|paused/i
  } catch (error) {
    failer(`Owner denied probe ${index + 1} expectedPattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveValidateOwnerDeniedProbesPath() {
  const rawValue = args.get('validate-owner-denied-probes')
  if (!rawValue) return ''
  if (rawValue === 'true') {
    return clean(args.get('owner-denied-probes') || process.env.TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES)
  }
  return clean(rawValue)
}

function validateOwnerDeniedProbesFile(path) {
  if (!path) {
    fail('Provide --validate-owner-denied-probes C:\\private\\denied-probes.json or pair --validate-owner-denied-probes with --owner-denied-probes.')
  }
  const probes = readOwnerDeniedProbeConfig(path)
  console.log(JSON.stringify({
    ok: true,
    mode: 'validate-owner-denied-probes',
    ownerDeniedProbesLoaded: probes.length,
    noNetworkRequests: true,
    checked: [
      'non-empty probes array',
      'checkout function names',
      'POST-only methods',
      'payload object shape',
      'expected HTTP statuses',
      'expected denial regex patterns',
      'protected and secret-looking headers',
      'secret-looking payload values and protected smoke marker',
    ],
  }, null, 2))
}

function sanitizeOwnerProbeHeaders(headers, index, failer = fail) {
  if (headers == null) return {}
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    failer(`Owner denied probe ${index + 1} headers must be an object when supplied.`)
  }

  const protectedHeaders = new Set([
    'authorization',
    'cookie',
    'host',
    'content-type',
    'x-cron-secret',
    'x-tally-smoke-test',
  ])
  const safe = {}
  for (const [key, value] of Object.entries(headers)) {
    const headerName = clean(key).toLowerCase()
    if (!headerName || /[\r\n:]/.test(headerName)) {
      failer(`Owner denied probe ${index + 1} has an invalid header name.`)
    }
    if (protectedHeaders.has(headerName)) {
      failer(`Owner denied probe ${index + 1} must not override protected header ${headerName}. Use the dedicated environment variable or CLI flag instead.`)
    }
    const headerValue = clean(value)
    if (/[\r\n]/.test(headerValue)) {
      failer(`Owner denied probe ${index + 1} header ${headerName} contains a line break.`)
    }
    if (looksSecretLike(headerValue)) {
      failer(`Owner denied probe ${index + 1} header ${headerName} looks like a secret. Keep secrets in environment variables, not probe JSON files.`)
    }
    safe[headerName] = headerValue
  }
  return safe
}

function looksSecretLike(value) {
  const text = clean(value)
  if (!text) return false
  if (/^(bearer|sk|pk|sec|whsec|rk|api|eyJ)[_\-.A-Za-z0-9]{20,}$/i.test(text)) return true
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text) && !/^\d+$/.test(text)) return true
  return false
}

function requireReadFile(path) {
  return readFileSync(path, 'utf8')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function runSelfTest() {
  const thrower = (message) => {
    throw new Error(message)
  }

  const safe = sanitizeOwnerProbeHeaders({
    'X-Owner-Scenario': 'zero-balance',
    'x-test-note': 'denied checkout probe',
  }, 0, thrower)
  assertSelf(safe['x-owner-scenario'] === 'zero-balance', 'safe custom headers must be normalized to lowercase')
  assertSelf(safe['x-test-note'] === 'denied checkout probe', 'safe custom headers must be retained')

  for (const [headers, pattern, label] of [
    [{ authorization: 'Bearer token' }, /protected header authorization/i, 'authorization override'],
    [{ Cookie: 'session=abc' }, /protected header cookie/i, 'cookie override'],
    [{ 'x-cron-secret': 'cron-secret' }, /protected header x-cron-secret/i, 'cron secret override'],
    [{ 'content-type': 'text/plain' }, /protected header content-type/i, 'content type override'],
    [{ 'x-tally-smoke-test': 'custom' }, /protected header x-tally-smoke-test/i, 'smoke-test marker override'],
    [{ 'bad:name': 'value' }, /invalid header name/i, 'invalid header name'],
    [{ 'x-safe': 'one\ntwo' }, /line break/i, 'header value line break'],
    [{ 'x-safe': 'sk_live_abcdefghijklmnopqrstuvwxyz123456' }, /looks like a secret/i, 'secret-looking header value'],
  ]) {
    expectSelfTestFailure(label, () => sanitizeOwnerProbeHeaders(headers, 0, thrower), pattern)
  }

  assertSelf(looksSecretLike('Bearerabcdefghijklmnopqrstuvwxyz123456'), 'bearer-like values must be treated as secret-looking')
  assertSelf(!looksSecretLike('zero-balance-denied'), 'ordinary scenario labels must not be treated as secret-looking')

  const exampleProbes = readOwnerDeniedProbeConfig('docs/security/wallet-deployed-denied-probes.example.json', thrower)
  assertSelf(exampleProbes.length >= 10, 'owner denied probes example must validate without contacting deployed routes')
  assertSelf(exampleProbes.some((probe) => clean(probe.name) === 'frozen customer cannot use withdrawal route'), 'owner denied probes example must cover frozen withdrawal denial')

  expectSelfTestFailure('invalid owner probe method', () => normalizeOwnerDeniedProbeMethod({ method: 'GET' }, 0, thrower), /must use POST/i)
  expectSelfTestFailure('invalid owner probe payload', () => normalizeOwnerDeniedProbePayload({ payload: [] }, 0, thrower), /payload must be an object/i)
  expectSelfTestFailure('owner probe smoke override', () => normalizeOwnerDeniedProbePayload({ payload: { smoke: false } }, 0, thrower), /must not set payload\.smoke/i)
  expectSelfTestFailure('owner probe payload credential field', () => normalizeOwnerDeniedProbePayload({ payload: { api_key: 'placeholder' } }, 0, thrower), /credential field/i)
  expectSelfTestFailure('owner probe payload secret value', () => normalizeOwnerDeniedProbePayload({ payload: { metadata: { note: 'sk_live_abcdefghijklmnopqrstuvwxyz123456' } } }, 0, thrower), /looks like a secret/i)
  expectSelfTestFailure('invalid owner probe status', () => normalizeOwnerDeniedProbeExpectedStatuses({ expectedStatuses: [99] }, 0, thrower), /valid HTTP status/i)
  expectSelfTestFailure('invalid owner probe regex', () => compileOwnerDeniedProbePattern({ expectedPattern: '(' }, 0, thrower), /valid regular expression/i)
  expectSelfTestFailure('invalid owner probe function name', () => normalizeOwnerDeniedProbeFunctionName({ functionName: '../process-purchase' }, 0, thrower), /invalid functionName/i)

  const smokeProtectedBody = JSON.parse(buildOwnerDeniedProbeBody({ smoke: false, product_group_id: 'OWNER_STAGING_PRODUCT_ID' }))
  assertSelf(smokeProtectedBody.smoke === true, 'owner denied probe request body must contain the runner-controlled smoke marker')
  const edgeSmokeProtectedBody = JSON.parse(buildEdgeDeniedProbeBody({ smoke: false, idempotency_key: 'route-specific-key' }, 'process-purchase'))
  assertSelf(edgeSmokeProtectedBody.smoke === true, 'built-in deployed probe request body must contain the runner-controlled smoke marker')
  assertSelf(edgeSmokeProtectedBody.idempotency_key === 'route-specific-key', 'built-in deployed probe should preserve route-specific idempotency keys')

  console.log(JSON.stringify({
    ok: true,
    checks: 25,
    protectedHeaders: ['authorization', 'content-type', 'x-tally-smoke-test', 'cookie', 'host', 'x-cron-secret'],
    ownerDeniedProbeExampleCount: exampleProbes.length,
    noNetworkRequests: true,
  }, null, 2))
}

function expectSelfTestFailure(label, fn, pattern) {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assertSelf(pattern.test(message), `${label} failed with unexpected message: ${message}`)
    return
  }
  throw new Error(`${label} did not fail`)
}

function assertSelf(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function printHelp() {
  console.log(`Run safe deployed wallet/partner incident smoke checks.

Usage:
  TALLYSTORE_DEPLOYED_SMOKE_ENV=staging \\
  TALLYSTORE_DEPLOYED_SMOKE_ACK=I_UNDERSTAND_NO_ORDER_CREATION \\
  TALLYSTORE_DEPLOYED_BASE_URL=https://your-preview.example.com \\
  npm run security:wallet:deployed-smoke

Optional Edge Function probes:
  TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL=https://your-project.functions.supabase.co \\
  npm run security:wallet:deployed-smoke

  To verify exact paused Edge Function codes instead of only the platform/JWT
  auth wall, also provide an owner-controlled test authorization header:
  TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION="Bearer ey..." \\
  npm run security:wallet:deployed-smoke

  For auto-restock exact paused-code verification, also provide the cron secret
  because that route validates x-cron-secret before reaching the pause gate:
  TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET="..." \\
  npm run security:wallet:deployed-smoke

  To run owner-controlled denied checkout probes, copy
  docs/security/wallet-deployed-denied-probes.example.json outside the repo,
  replace placeholders with staging-only test values, then run:
  TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES=C:\\private\\denied-probes.json \\
  TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK=I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED \\
  TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION="Bearer ey..." \\
  npm run security:wallet:deployed-smoke

  Owner-denied probe files cannot override authorization, content-type,
  x-tally-smoke-test, cookie, host, x-cron-secret, the runner-controlled smoke
  marker, or secret-looking custom headers/payload values. Provide credentials
  through the dedicated environment variables or CLI flags instead of the probe
  JSON file.

  Validate an owner-denied probe file without network access before running it:
  npm run security:wallet:deployed-smoke -- --validate-owner-denied-probes C:\\private\\denied-probes.json

  Or pass --functions-base-url=https://your-project.functions.supabase.co
  and --authorization="Bearer ey..." --cron-secret="..."
  and --owner-denied-probes=C:\\private\\denied-probes.json
  and --timeout-ms=15000

Self-test:
  npm run security:wallet:deployed-smoke -- --self-test

  This validates owner-probe file parsing, protected header rejection,
  secret-looking header/payload value rejection, runner-controlled smoke marker
  protection, and method/payload/status/pattern checks without contacting any
  deployed route.

Timeout:
  Set TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS or pass --timeout-ms to override
  the per-request timeout. Default: 15000ms.

Production:
  Add --allow-production when TALLYSTORE_DEPLOYED_SMOKE_ENV=production.

Safety:
  - Sends only denied/paused requests.
  - Checks partner API returns PARTNER_API_PAUSED.
  - Checks legacy Ercas webhooks return 410.
  - Checks unsigned PocketFi/iStar webhook requests are rejected or unconfigured.
  - Optionally checks paused paid Edge Functions reject unauthenticated no-order probes.
  - With TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION, verifies exact *_PAUSED codes.
  - With TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION, verifies exact pause codes for
    paused supplier-money routes and sends malformed product checkout payloads
    that must fail before order creation, wallet debit, provider dispatch, or
    value reveal.
  - With owner-denied probes, sends owner-defined purchase attempts against
    owner-controlled denied test accounts and requires body.success !== true
    plus the configured denial reason.
  - With TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET, verifies the auto-restock exact pause code.
  - Does not create orders, top-ups, supplier requests, or wallet credits.
`)
}
