import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/nowpayments-webhook/index.ts', 'utf8').replace(/^import .*$/gm, '')
const executable = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const secret = 'TEST_ONLY_IPN_SECRET'
const quote = {
  registered: true,
  quote_id: '50000000-0000-4000-8000-000000000005',
  crypto_transaction_id: '60000000-0000-4000-8000-000000000006',
  user_id: '70000000-0000-4000-8000-000000000007',
  payment_id: '123456',
  order_reference: 'TALLY-CRYPTO-TEST',
  amount_ngn: 16000,
  pay_amount: 10,
  pay_currency: 'usdttrc20',
  pay_address: 'TEST_ONLY_ADDRESS',
}
const providerPayment = {
  payment_id: quote.payment_id,
  order_id: quote.order_reference,
  pay_amount: quote.pay_amount,
  pay_currency: quote.pay_currency,
  pay_address: quote.pay_address,
  payment_status: 'finished',
  actually_paid: quote.pay_amount,
}
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : value
async function sign(payload) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return Buffer.from(await webcrypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(JSON.stringify(canonical(payload))))).toString('hex')
}

async function run({ notification = providerPayment, provider = providerPayment,
  signedNotification = notification, signature, receipt = true, registered = true,
  method = 'POST', raw, fetchError, rpcError, providerStatus = 200 } = {}) {
  let handler
  const calls = { tables: [], rpc: [], fetch: [], logs: [] }
  let filters = {}
  const receiptQuery = {
    select(columns) { assert.equal(columns, 'id'); return this },
    eq(field, value) { filters[field] = value; return this },
    async maybeSingle() {
      return { data: receipt && filters.nowpayments_payment_id === quote.payment_id
        && filters.payment_reference === quote.order_reference
        ? { id: quote.crypto_transaction_id } : null, error: null }
    },
  }
  const admin = {
    from(table) {
      calls.tables.push(table)
      assert.equal(table, 'crypto_transactions', 'webhook must not directly read private evidence or update receipts')
      filters = {}
      return receiptQuery
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (rpcError === name) return { data: null, error: { message: 'PRIVATE_DATABASE_SECRET' } }
      if (name === 'get_registered_nowpayments_wallet_quote') {
        assert.equal(args.p_crypto_transaction_id, quote.crypto_transaction_id)
        return { data: registered ? quote : { registered: false }, error: null }
      }
      if (name === 'settle_nowpayments_wallet_quote') {
        const valid = args.p_actual_paid !== null && Number.isFinite(args.p_actual_paid)
          && args.p_actual_paid >= quote.pay_amount && args.p_provider_status === 'finished'
        return { data: { success: valid, credited: valid, idempotency_hit: false }, error: null }
      }
      if (name === 'revoke_nowpayments_wallet_quote') {
        return { data: { success: true, revoked: true, idempotency_hit: false }, error: null }
      }
      if (name === 'record_nowpayments_wallet_status') {
        return { data: { success: true, credited: false }, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const context = vm.createContext({
    serve: fn => { handler = fn }, createClient: () => admin,
    Deno: { env: { get: name => ({ NOWPAYMENTS_IPN_SECRET: secret,
      NOWPAYMENTS_API_KEY: 'PRIVATE_PROVIDER_API_KEY', SUPABASE_URL: 'https://test.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE_SERVICE_ROLE_KEY' })[name] } },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, AbortSignal, Request, Response, URL,
    fetch: async (url, options) => {
      calls.fetch.push({ url, options })
      if (fetchError) throw new Error('PRIVATE_PROVIDER_API_KEY_MUST_NOT_APPEAR')
      return new Response(JSON.stringify(provider), { status: providerStatus })
    },
    console: { log: (...parts) => calls.logs.push(parts.join(' ')),
      error: (...parts) => calls.logs.push(parts.join(' ')),
      warn: (...parts) => calls.logs.push(parts.join(' ')) },
  })
  vm.runInContext(executable, context)
  const request = new Request('https://test.invalid/functions/v1/nowpayments-webhook', {
    method,
    headers: { 'content-type': 'application/json',
      'x-nowpayments-sig': signature ?? await sign(signedNotification) },
    ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(notification) }),
  })
  const response = await handler(request)
  const data = await response.json()
  const publicOutput = JSON.stringify(data) + calls.logs.join(' ')
  assert.equal(publicOutput.includes('PRIVATE_'), false, 'private secret leaked publicly or to logs')
  return { status: response.status, data, calls }
}

let result = await run({ signature: '0'.repeat(128) })
assert.equal(result.status, 401)
assert.equal(result.calls.tables.length, 0)
assert.equal(result.calls.fetch.length, 0)
result = await run({ method: 'GET' })
assert.equal(result.status, 405)
result = await run({ raw: 'x'.repeat(32769) })
assert.equal(result.status, 413)
assert.equal(result.calls.tables.length, 0)

result = await run({ receipt: false })
assert.equal(result.data.code, 'UNREGISTERED_PAYMENT_REQUIRES_REVIEW')
assert.equal(result.calls.fetch.length, 0)
result = await run({ registered: false })
assert.equal(result.data.code, 'UNREGISTERED_PAYMENT_REQUIRES_REVIEW')
assert.deepEqual(result.calls.rpc.map(call => call.name), ['get_registered_nowpayments_wallet_quote'])
assert.equal(result.calls.fetch.length, 0)
result = await run({ rpcError: 'get_registered_nowpayments_wallet_quote' })
assert.equal(result.status, 503)
assert.equal(result.calls.fetch.length, 0)

for (const mismatch of [
  { payment_id: '654321' }, { order_id: 'WRONG' }, { pay_currency: 'btc' },
  { pay_address: 'WRONG' }, { pay_amount: 1000 },
]) {
  result = await run({ provider: { ...providerPayment, ...mismatch } })
  assert.equal(result.status, 409)
  assert.equal(result.data.code, 'PROVIDER_PAYMENT_MISMATCH')
  assert.deepEqual(result.calls.rpc.map(call => call.name), ['get_registered_nowpayments_wallet_quote'])
}

const nested = { ...providerPayment, metadata: { z: 1, a: { z: 2, a: 3 } } }
result = await run({ notification: nested })
assert.equal(result.status, 200, 'nested canonical HMAC must verify')
result = await run({ notification: { ...nested, metadata: { z: 1, a: { z: 2, a: 4 } } }, signedNotification: nested })
assert.equal(result.status, 401, 'nested notification tampering must fail HMAC')
assert.equal(result.calls.fetch.length, 0)

const forgedNotification = { ...providerPayment, user_id: 'ATTACKER', amount_ngn: 1,
  payment_status: 'refunded', actually_paid: 999999 }
result = await run({ notification: forgedNotification })
assert.equal(result.status, 200)
assert.deepEqual(result.calls.rpc.map(call => call.name),
  ['get_registered_nowpayments_wallet_quote', 'settle_nowpayments_wallet_quote'])
const settlement = result.calls.rpc[1].args
assert.equal(settlement.p_actual_paid, providerPayment.actually_paid)
assert.equal(settlement.p_pay_amount, quote.pay_amount)
assert.equal(settlement.p_user_id, undefined)
assert.equal(settlement.p_amount_ngn, undefined)
assert.equal(settlement.p_signature_hash.length, 64)
assert.equal(settlement.p_verification_hash.length, 64)
assert.equal(result.calls.fetch[0].options.headers['x-api-key'], 'PRIVATE_PROVIDER_API_KEY')

for (const actual of [null, 0, 'bad', 9.99]) {
  result = await run({ provider: { ...providerPayment, actually_paid: actual } })
  assert.equal(result.status, 409, 'unverified paid amount must not credit')
  assert.equal(result.data.code, 'PAYMENT_EVIDENCE_REJECTED')
  assert.equal(result.calls.rpc[1].args.p_actual_paid, actual === null ? null : Number(actual),
    'webhook must pass actual provider amount to SQL without quoted-amount fallback')
}

result = await run({ provider: { ...providerPayment, payment_status: 'refunded' },
  notification: { ...providerPayment, payment_status: 'finished', user_id: 'ATTACKER' } })
assert.equal(result.status, 200)
assert.equal(result.data.credited, false)
assert.equal(result.calls.rpc[1].name, 'revoke_nowpayments_wallet_quote')

result = await run({ provider: { ...providerPayment, payment_status: 'partially_paid', actually_paid: 1 } })
assert.equal(result.status, 200)
assert.equal(result.data.credited, false)
assert.equal(result.calls.rpc[1].name, 'record_nowpayments_wallet_status')
assert.equal(result.calls.rpc[1].args.p_status, 'partially_paid')
assert.deepEqual(result.calls.tables, ['crypto_transactions'])

result = await run({ fetchError: true })
assert.equal(result.status, 503)
assert.equal(result.calls.rpc.length, 1)
result = await run({ providerStatus: 500 })
assert.equal(result.status, 503)
assert.equal(result.calls.rpc.length, 1)
result = await run({ rpcError: 'settle_nowpayments_wallet_quote' })
assert.equal(result.status, 503)
assert.equal(result.data.code, 'PAYMENT_SETTLEMENT_UNAVAILABLE')
result = await run({ provider: { ...providerPayment, payment_status: 'unknown' } })
assert.equal(result.status, 409)
assert.equal(result.data.code, 'UNKNOWN_PROVIDER_STATUS')
result = await run({ provider: { ...providerPayment, payment_status: 'processing' },
  rpcError: 'record_nowpayments_wallet_status' })
assert.equal(result.status, 409)
assert.equal(result.data.code, 'UNKNOWN_PROVIDER_STATUS')
result = await run({ provider: { ...providerPayment, payment_status: 'waiting' },
  rpcError: 'record_nowpayments_wallet_status' })
assert.equal(result.status, 503)
assert.equal(result.data.code, 'PAYMENT_STATUS_UNAVAILABLE')

console.log('Verified webhook runtime: HMAC, quote registration, exact provider evidence, settlement, status, refund, redaction passed')
