import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import { canonicalCryptoAmount, sameCryptoTopupRequest } from '../supabase/functions/_shared/crypto-topup-request.mjs'

const source = readFileSync(new URL('../supabase/functions/create-crypto-sell-order/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const userId = 'a195bb4f-ec76-4bfe-9ea2-4d7064900b12'
const transactionId = 'b3170f42-ae6a-41c9-97a3-d41f2671d45d'
const baseBody = { crypto_type: 'btc', crypto_amount: '0.001', client_display_naira_amount: 39375, idempotency_key: 'runtime-test-0001' }

function harness() {
  const state = {
    enabled: false, user: { id: userId }, profile: { is_staff: false, is_admin: false, account_suspended: false },
    existing: [], registered: true, registerFails: false, receiptFails: false,
    providerMode: 'valid', calls: [], inserts: [], quoteArgs: null, invoiceCount: 0,
  }
  const admin = {
    from(table) {
      const query = {
        inserted: null, select() { return this }, eq() { return this }, in() { return this },
        insert(row) { this.inserted = row; state.inserts.push({ table, row, client: 'admin' }); return this },
        upsert() { return Promise.resolve({ error: null }) },
        async single() {
          if (table === 'profiles') return { data: state.profile, error: null }
          if (table === 'app_settings') return { data: { value: '1500' }, error: null }
          if (table === 'crypto_transactions' && this.inserted) return state.receiptFails
            ? { data: null, error: { message: 'internal secret receipt failure' } }
            : { data: { id: transactionId, ...this.inserted }, error: null }
          throw new Error(`Unexpected single ${table}`)
        },
        then(resolve, reject) {
          if (table !== 'crypto_transactions') return Promise.resolve({ data: [], error: null }).then(resolve, reject)
          return Promise.resolve({ data: state.existing, error: null }).then(resolve, reject)
        },
        limit() { return this },
      }
      return query
    },
    async rpc(name, args) {
      state.calls.push({ name, args })
      if (name === 'register_nowpayments_wallet_quote') {
        state.quoteArgs = args
        return state.registerFails ? { data: null, error: { message: 'internal secret quote failure' } }
          : { data: { success: true, quote_id: '19cf216b-d248-4a8c-a3eb-bde9784eb51d' }, error: null }
      }
      if (name === 'get_registered_nowpayments_wallet_quote') return {
        data: state.registered ? {
          registered: true, payment_id: '12345', order_reference: state.existing[0]?.payment_reference,
        } : { registered: false }, error: null,
      }
      throw new Error(`Unexpected RPC ${name}`)
    },
  }
  const anon = {
    auth: { async getUser() { return { data: { user: state.user }, error: state.user ? null : { message: 'bad token' } } } },
    from() { throw new Error('Anonymous client must not write a crypto receipt') },
  }
  let handler
  const env = { CRYPTO_TOPUP_ENABLED: 'false', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', NOWPAYMENTS_API_KEY: 'provider-secret' }
  const sandbox = {
    exports: {}, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortSignal, crypto: webcrypto, setTimeout, clearTimeout,
    Deno: { env: { get: name => name === 'CRYPTO_TOPUP_ENABLED' ? String(state.enabled) : env[name] } },
    console: { log() {}, error() {}, warn() {} },
    fetch: async (url, options = {}) => {
      const location = String(url)
      state.calls.push({ url: location, method: options.method || 'GET' })
      if (location.includes('/estimate?')) return Response.json({ estimated_amount: 25 })
      if (location.endsWith('/payment') && options.method === 'POST') {
        state.invoiceCount += 1
        if (state.providerMode === 'http-500') return new Response('provider-secret', { status: 500 })
        if (state.providerMode === 'timeout') throw new Error('provider-secret timeout')
        const sent = JSON.parse(options.body)
        const invoice = {
          payment_id: '12345', payment_status: 'waiting', pay_address: 'bc1qexampledepositaddress',
          price_amount: 25, price_currency: 'usd', pay_amount: 0.001, pay_currency: 'btc',
          order_id: sent.order_id, purchase_id: '6789', payin_extra_id: null,
          network: 'BTC', smart_contract: '', amount_received: null,
          expiration_estimate_date: '2099-10-05T04:00:00Z', valid_until: '2099-10-05T04:00:00Z',
        }
        if (state.providerMode === 'wrong-id') invoice.payment_id = '0'
        if (state.providerMode === 'wrong-order') invoice.order_id = 'OTHER-ORDER'
        if (state.providerMode === 'wrong-currency') invoice.pay_currency = 'eth'
        if (state.providerMode === 'missing-address') invoice.pay_address = ''
        if (state.providerMode === 'wrong-status') invoice.payment_status = 'finished'
        if (state.providerMode === 'tiny-amount') invoice.pay_amount = 0.000001
        return Response.json(invoice)
      }
      throw new Error(`Unexpected external request: ${location}`)
    },
    require(specifier) {
      if (specifier.includes('/http/server.ts')) return { serve: fn => { handler = fn } }
      if (specifier.includes('supabase-js')) return { createClient: (_url, key) => key === 'service' ? admin : anon }
      if (specifier.endsWith('crypto-topup-request.mjs')) return { canonicalCryptoAmount, sameCryptoTopupRequest }
      throw new Error(`Unexpected import ${specifier}`)
    },
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'create-crypto-sell-order.js' })
  assert.equal(typeof handler, 'function')
  async function request(body = baseBody, method = 'POST', headers = {}) {
    const response = await handler(new Request('https://example.supabase.co/functions/v1/create-crypto-sell-order', {
      method, headers: { Authorization: 'Bearer customer-token', 'Content-Type': 'application/json', ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }))
    return { status: response.status, data: await response.json() }
  }
  return { state, request }
}

const t = harness()
let result = await t.request()
assert.equal(result.status, 503)
assert.equal(t.state.invoiceCount, 0)
t.state.enabled = true
t.state.user = null
result = await t.request()
assert.equal(result.status, 401)
assert.equal(t.state.invoiceCount, 0)
t.state.user = { id: userId }
result = await t.request(null, 'GET')
assert.equal(result.status, 405)
result = await t.request('{broken')
assert.equal(result.status, 400)
result = await t.request({ ...baseBody, filler: 'x'.repeat(33_000) })
assert.equal(result.status, 413)
assert.equal(t.state.invoiceCount, 0)

t.state.profile = { is_staff: true, is_admin: false, account_suspended: false }
result = await t.request()
assert.equal(result.status, 400)
assert.equal(t.state.invoiceCount, 0)
t.state.profile = { is_staff: false, is_admin: false, account_suspended: true }
result = await t.request()
assert.equal(result.status, 400)
assert.equal(t.state.invoiceCount, 0)
t.state.profile = { is_staff: false, is_admin: false, account_suspended: false }
result = await t.request({ ...baseBody, client_display_naira_amount: 100, naira_amount: 9999999, user_id: 'forged' })
assert.equal(result.status, 409)
assert.equal(t.state.invoiceCount, 0)

for (const mode of ['wrong-id', 'wrong-order', 'wrong-currency', 'missing-address', 'wrong-status', 'tiny-amount']) {
  t.state.providerMode = mode
  const before = t.state.inserts.length
  result = await t.request()
  assert.equal(result.status, 502, mode)
  assert.equal(t.state.inserts.length, before, mode)
  assert.equal(JSON.stringify(result.data).includes('pay_address'), false)
}
for (const mode of ['http-500', 'timeout']) {
  t.state.providerMode = mode
  const before = t.state.inserts.length
  result = await t.request()
  assert.equal(result.status, 500, mode)
  assert.equal(t.state.inserts.length, before, mode)
  assert.equal(JSON.stringify(result.data).includes('provider-secret'), false)
}
t.state.providerMode = 'valid'
t.state.receiptFails = true
result = await t.request()
assert.equal(result.status, 500)
assert.equal(JSON.stringify(result.data).includes('bc1qexample'), false)
assert.equal(t.state.quoteArgs, null)
t.state.receiptFails = false
t.state.registerFails = true
result = await t.request()
assert.equal(result.status, 500)
assert.equal(JSON.stringify(result.data).includes('bc1qexample'), false)
assert.equal(JSON.stringify(result.data).includes('internal secret'), false)
const failedReceipt = t.state.inserts.at(-1).row
t.state.existing = [{ id: transactionId, ...failedReceipt }]
t.state.registered = false
const invoiceAfterFailedRegistration = t.state.invoiceCount
result = await t.request()
assert.equal(result.status, 409)
assert.equal(t.state.invoiceCount, invoiceAfterFailedRegistration)
assert.equal(JSON.stringify(result.data).includes('bc1qexample'), false)

const live = harness()
live.state.enabled = true
result = await live.request({ ...baseBody, naira_amount: 99999999, user_id: 'forged' })
assert.equal(result.status, 200)
assert.equal(result.data.naira_amount, 39375)
assert.equal(result.data.payment_details.pay_address, 'bc1qexampledepositaddress')
assert.equal(live.state.quoteArgs.p_user_id, userId)
assert.equal(live.state.quoteArgs.p_ngn_amount, 39375)
assert.equal(live.state.quoteArgs.p_pay_amount, 0.001)
assert.equal(live.state.quoteArgs.p_pay_currency, 'btc')
assert.equal(live.state.quoteArgs.p_pay_address, 'bc1qexampledepositaddress')
assert.equal(live.state.inserts.at(-1).client, 'admin')
assert.equal(live.state.inserts.at(-1).row.naira_amount, 39375)

const saved = live.state.inserts.at(-1).row
live.state.existing = [{ id: transactionId, ...saved }]
const invoiceCount = live.state.invoiceCount
live.state.registered = false
result = await live.request()
assert.equal(result.status, 409)
assert.equal(JSON.stringify(result.data).includes('bc1qexample'), false)
assert.equal(live.state.invoiceCount, invoiceCount)
live.state.registered = true
result = await live.request()
assert.equal(result.status, 200)
assert.equal(result.data.idempotency_hit, true)
assert.equal(live.state.invoiceCount, invoiceCount)
assert.equal(result.data.payment_details.pay_address, 'bc1qexampledepositaddress')

console.log('Crypto creation runtime: pause/auth/staff/size/price/provider/registration/replay boundaries passed without network or live data.')
