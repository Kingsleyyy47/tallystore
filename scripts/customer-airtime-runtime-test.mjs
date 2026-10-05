// Runs the real Edge handler with synthetic Supabase and Bitrefill adapters.
// No network, Bitrefill key, customer credentials, or paid request is used.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import esbuild from 'esbuild'
import { createHash, createHmac, randomUUID, webcrypto } from 'node:crypto'

const build = await esbuild.build({
  entryPoints: ['supabase/functions/customer-airtime/index.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'mock-supabase-import', setup(api) {
    api.onResolve({ filter: /^https:\/\/esm\.sh\// }, () => ({ path: 'supabase', namespace: 'mock' }))
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient = globalThis.__createClient', loader: 'js' }))
  } }],
})
const bundled = build.outputFiles[0].text
const userId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const phone = '+15551234567'
const key = 'airtime-test-idempotency-123'
const product = { data: { id: 'gosmart-usa', name: 'GoSmart', recipient_type: 'phone_number', currency: 'USD', country: 'US',
  packages: [{ id: 'gosmart-usa<&>25', value: 25, amount: 25, price: 29038 }] } }
const invoiceId = 'invoice-test'
const providerOrderId = 'provider-order-test'
const delegationSecret = 'test-only-airtime-success-capability-secret-1234567890'
const customerKeyId = '33333333-3333-4333-8333-333333333333'
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }

function harness({ reserve = 'ok', paid = 'delivered', replay = false, statusReady = false, invoicePrice = 29038, prepayPhone = phone, merchantBalance = 100000000, owner = false, delegated = false, priceUnit = 'satoshi', billingCurrency = 'BTC', providerPrice = 29038 } = {}) {
  let edge
  const calls = { create: 0, pay: 0, reserve: 0, claimDispatch: 0, bind: 0, claimPay: 0, unknown: 0, completed: 0, rejected: 0, alerts: 0, pricingWrites: 0, consume: 0 }
  const nonces = new Set()
  let invoiceReads = statusReady ? 1 : 0
  let publicStatus = statusReady ? 'processing' : 'pending'
  const admin = {
    from(table) {
      if (table === 'app_settings') {
        let setting
        return { select() { return this }, eq(_field, value) { setting = value; return this }, async maybeSingle() {
          return { data: setting === 'ngn_usd_rate' ? { value: '1500' } : null, error: null }
        } }
      }
      if (table === 'customer_airtime_orders') return {
        select() { return this }, eq() { return this }, async maybeSingle() {
          return { data: { id: orderId, status: publicStatus, recipient_phone: phone, product_name: 'GoSmart', amount_ngn: 37460, currency: 'USD', created_at: '2026-10-05T00:00:00Z' }, error: null }
        }, order() { return this }, async limit() { return { data: [], error: null } },
      }
      throw new Error(`unexpected table ${table}`)
    },
    async rpc(name, args) {
      if (name === 'customer_api_consume_capability') {
        calls.consume++
        assert.equal(args.p_key_id, customerKeyId)
        assert.equal(args.p_user_id, userId)
        assert.equal(args.p_section, 'airtime')
        assert.equal(nonces.has(args.p_nonce), false)
        nonces.add(args.p_nonce)
        return { data: true, error: null }
      }
      if (name === 'record_supplier_balance_alert') { calls.alerts++; return { data: null, error: null } }
      if (name === 'list_customer_bitrefill_pricing') return { data: owner ? { success: true, global: { mode: 'percent', value: 0 }, overrides: [] }
        : { success: false, code: 'OWNER_DENIED' }, error: null }
      if (name === 'set_customer_bitrefill_pricing') { calls.pricingWrites++; return { data: owner ? { success: true, changed: true }
        : { success: false, code: 'OWNER_DENIED' }, error: null } }
      if (name === 'get_customer_airtime_reconciliation') return { data: { success: true, invoice_id: invoiceId,
        state: 'paying', payment_claimed: true, quote: { product_id: 'gosmart-usa', product_name: 'GoSmart', operator_id: 'gosmart-usa',
          operator_name: 'GoSmart', country_code: 'US', recipient_phone: phone, package_id: 'gosmart-usa<&>25',
          unit_value: 25, currency: 'USD', amount_ngn: 37460 } }, error: null }
      if (name === 'get_customer_bitrefill_pricing') return { data: { success: true, mode: 'percent', value: 0, source: 'global' }, error: null }
      if (name === 'authorize_customer_airtime_purchase') {
        calls.reserve++
        assert.equal(args.p_user_id, userId)
        assert.equal(args.p_quote.amount_ngn, 37460)
        assert.equal(args.p_quote.recipient_phone, phone)
        return reserve === 'fail' ? { data: { success: false, code: 'INSUFFICIENT_FUNDS' }, error: null }
          : { data: { success: true, order_id: orderId, idempotent_replay: replay, state: replay ? 'unknown' : 'prepared' }, error: null }
      }
      if (name === 'claim_customer_airtime_dispatch') { calls.claimDispatch++; return { data: { success: true, send_allowed: true }, error: null } }
      if (name === 'bind_customer_airtime_invoice') { calls.bind++; return { data: { success: true, bound: true }, error: null } }
      if (name === 'claim_customer_airtime_payment') { calls.claimPay++; return { data: { success: true, pay_allowed: true }, error: null } }
      if (name === 'record_customer_airtime_outcome') {
        const outcome = arguments[1]?.p_outcome
        if (outcome === 'completed') { calls.completed++; publicStatus = 'completed' }
        if (outcome === 'unknown') { calls.unknown++; publicStatus = 'review_required' }
        if (outcome === 'rejected') { calls.rejected++; publicStatus = 'failed' }
        return { data: { success: true }, error: null }
      }
      throw new Error(`unexpected RPC ${name}`)
    },
  }
  const context = {
    module: { exports: {} }, exports: {}, Response, Request, AbortSignal, URL, Date, console, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout, crypto: webcrypto, atob, btoa,
    Deno: { serve(handler) { edge = handler }, env: { get(name) {
      return ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'public-test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
        BITREFILL_API_KEY: 'synthetic-provider', BITREFILL_PRICE_UNIT: priceUnit,
        CUSTOMER_AIRTIME_ENABLED: 'true', CUSTOMER_API_ENABLED: 'true', CUSTOMER_API_DELEGATION_SECRET: delegationSecret })[name] || ''
    } } },
    async fetch(input, options = {}) {
      const url = String(input)
      if (url.includes('bitrefill')) assert.ok(url.startsWith('https://api.bitrefill.com/v2/'), 'provider must use official dotted HTTPS origin')
      if (url.includes('BTC-USD/ticker')) return response({ price: '86000', time: new Date().toISOString() })
      if (url.endsWith('/check_phone_number?phone_number=%2B15551234567')) return response({ operator_found: true,
        data: [{ id: 'gosmart-usa', name: 'GoSmart', country: 'US', recipient_type: 'phone_number' }] })
      if (url.endsWith('/products/gosmart-usa')) return response({ data: { ...product.data,
        packages: [{ ...product.data.packages[0], price: providerPrice }] } })
      if (url.endsWith('/accounts/balance')) return response({ data: { currency: billingCurrency, balance: merchantBalance } })
      if (url.endsWith('/invoices') && options.method === 'POST') {
        calls.create++
        const payload = JSON.parse(options.body)
        assert.equal(payload.auto_pay, false)
        assert.equal(payload.products[0].phone_number, phone)
        return response({ data: { id: invoiceId, status: 'unpaid', orders: [{ id: providerOrderId, product_id: 'gosmart-usa' }] } })
      }
      if (url.endsWith(`/invoices/${invoiceId}/pay`)) {
        calls.pay++
        if (paid === 'unknown') throw new Error('synthetic transport failure')
        return response({ data: { id: invoiceId, status: 'pending' } })
      }
      if (url.endsWith(`/invoices/${invoiceId}`)) {
        invoiceReads++
        return response({ data: { id: invoiceId, status: invoiceReads < 2 ? 'unpaid' : 'complete', payment: { price: invoicePrice, currency: billingCurrency },
          orders: [{ id: providerOrderId, product_id: 'gosmart-usa' }] } })
      }
      if (url.endsWith(`/orders/${providerOrderId}`)) return response({ data: { id: providerOrderId, status: calls.pay > 0 || statusReady ? 'delivered' : 'created', phone_number: calls.pay > 0 || statusReady ? phone : prepayPhone,
        product: { id: 'gosmart-usa', value: 25 } } })
      throw new Error(`unexpected fetch ${url}`)
    },
  }
  context.globalThis = context
  context.__createClient = (_url, token) => token === 'public-test'
    ? { auth: { async getUser(jwt) { return jwt === 'synthetic-jwt' ? { data: { user: { id: userId } }, error: null }
      : { data: { user: null }, error: { message: 'Unauthorized' } } } } } : admin
  vm.runInNewContext(bundled, context, { timeout: 5000 })
  const post = body => {
    const raw = JSON.stringify(body)
    const headers = { Authorization: delegated ? 'Bearer synthetic-service' : 'Bearer synthetic-jwt', 'Content-Type': 'application/json' }
    if (delegated) {
      const encoded = Buffer.from(JSON.stringify({ key_id: customerKeyId, user_id: userId, section: 'airtime', target: 'customer-airtime',
        body_hash: createHash('sha256').update(raw).digest('hex'), nonce: randomUUID(), expires_at: Date.now() + 30000 })).toString('base64url')
      headers['x-tally-api-capability'] = encoded + '.' + createHmac('sha256', delegationSecret).update(encoded).digest('hex')
    }
    return edge(new Request('https://synthetic.invalid/functions/v1/customer-airtime', {
      method: 'POST', headers, body: raw,
    })).then(async result => ({ status: result.status, body: await result.json() }))
  }
  return { post, calls }
}

const request = { action: 'purchase', phone_number: phone, operator_id: 'gosmart-usa', product_id: 'gosmart-usa',
  package_id: 'gosmart-usa<&>25', idempotency_key: key,
  expected_amount_ngn: Math.ceil((29038 / 1e8 * 86000 * 1500) / 10) * 10 }

let h = harness()
let result = await h.post({ action: 'check_phone', phone_number: phone })
assert.equal(result.body.success, true)
assert.equal(result.body.country_code, 'US')
assert.equal(result.body.operators[0].products[0].packages[0].unit_value, 25)
assert.ok(!JSON.stringify(result.body).includes('29038'), 'supplier pricing must not reach browser')
assert.equal(h.calls.create, 0)

for (const config of [
  { priceUnit: '' },
  { priceUnit: 'SATOSHI' },
  { priceUnit: 'major' },
  { priceUnit: 'satoshi', billingCurrency: 'USD' },
]) {
  h = harness(config)
  result = await h.post(request)
  assert.equal(result.body.code, 'PRICE_UNAVAILABLE', 'unset, unknown, or currency-mismatched unit fails closed')
  assert.equal(h.calls.reserve, 0, 'unverified price unit cannot authorize a wallet hold')
  assert.equal(h.calls.create, 0)
  assert.equal(h.calls.pay, 0)
}
h = harness({ priceUnit: 'major', billingCurrency: 'USD', providerPrice: 1.25 })
result = await h.post({ action: 'quote', phone_number: phone, operator_id: 'gosmart-usa',
  product_id: 'gosmart-usa', package_id: 'gosmart-usa<&>25' })
assert.equal(result.body.success, true)
assert.equal(result.body.quote.amount_ngn, 1880, 'major USD price 1.25 at 1500 NGN/USD rounds up to NGN 10')
assert.equal(h.calls.reserve, 0)
assert.equal(h.calls.pay, 0)

h = harness({ owner: true })
result = await h.post({ action: 'admin_pricing_set', kind: 'airtime', scope: 'denomination', product_id: 'gosmart-usa',
  package_id: 'gosmart-usa<&>25', unit_value: 25, currency: 'USD', mode: 'amount', value: 100 })
assert.equal(result.body.success, true)
assert.equal(h.calls.pricingWrites, 1)
result = await h.post({ action: 'admin_pricing_set', kind: 'airtime', scope: 'denomination', product_id: 'gosmart-usa',
  package_id: 'gosmart-usa<&>25', unit_value: 50, currency: 'USD', mode: 'amount', value: 100 })
assert.equal(result.body.code, 'INVALID_PRICING', 'server validates denomination before owner write')
assert.equal(h.calls.pricingWrites, 1)
result = await h.post({ action: 'admin_product_options', kind: 'gift_card', product_id: 'gosmart-usa' })
assert.equal(result.body.code, 'INVALID_PRODUCT', 'owner cannot treat airtime as a gift card')
h = harness()
result = await h.post({ action: 'admin_product_options', kind: 'gift_card', product_id: 'gosmart-usa' })
assert.equal(result.body.code, 'OWNER_DENIED', 'non-owner cannot inspect owner pricing product options')
assert.equal(h.calls.create, 0)

h = harness({ reserve: 'fail' })
result = await h.post(request)
assert.equal(result.body.code, 'INSUFFICIENT_FUNDS')
assert.equal(h.calls.create, 0, 'zero/insufficient wallet never creates an invoice')
assert.equal(h.calls.pay, 0)

h = harness({ merchantBalance: null })
result = await h.post(request)
assert.equal(result.body.code, 'PRICE_UNAVAILABLE')
assert.equal(h.calls.reserve, 0, 'missing merchant balance is unknown, not a confirmed low balance')
assert.equal(h.calls.alerts, 0)
assert.equal(h.calls.create, 0)
assert.equal(h.calls.pay, 0)

h = harness({ merchantBalance: 0 })
result = await h.post(request)
assert.equal(result.body.code, 'PROVIDER_BALANCE_LOW')
assert.equal(h.calls.reserve, 1, 'customer wallet authorization precedes merchant decline')
assert.equal(h.calls.rejected, 1, 'prepared wallet hold is released')
assert.equal(h.calls.alerts, 1, 'a redacted supplier warning is recorded')
assert.equal(h.calls.create, 0, 'no invoice is created with insufficient merchant funds')
assert.equal(h.calls.pay, 0)

h = harness({ replay: true })
result = await h.post(request)
assert.equal(result.body.idempotent_replay, true)
assert.equal(h.calls.create, 0, 'replay never creates another invoice')
assert.equal(h.calls.pay, 0)

h = harness({ paid: 'unknown' })
result = await h.post(request)
assert.equal(result.body.outcome_unknown, true)
assert.equal(h.calls.create, 1)
assert.equal(h.calls.bind, 1, 'invoice bound before paid send')
assert.equal(h.calls.claimPay, 1)
assert.equal(h.calls.pay, 1, 'ambiguous provider result is never retried')
assert.equal(h.calls.unknown, 1)

h = harness({ invoicePrice: 29500 })
result = await h.post(request)
assert.equal(result.body.code, 'PRICE_CHANGED')
assert.equal(h.calls.rejected, 1, 'known unpaid price increase releases before payment')
assert.equal(h.calls.pay, 0)

h = harness({ invoicePrice: 0.00029038 })
result = await h.post(request)
assert.equal(result.body.outcome_unknown, true, 'ambiguous fractional BTC price fails closed')
assert.equal(h.calls.pay, 0)

h = harness({ prepayPhone: null })
result = await h.post(request)
assert.equal(result.body.outcome_unknown, true, 'unpaid invoice without exact recipient proof remains held')
assert.equal(h.calls.pay, 0)

h = harness()
result = await h.post(request)
assert.equal(result.body.success, true)
assert.equal(result.body.order.status, 'completed')
assert.equal(h.calls.completed, 1)
assert.equal(h.calls.pay, 1)

h = harness({ statusReady: true })
result = await h.post({ action: 'status', order_id: orderId })
assert.equal(result.body.order.status, 'completed', 'status can capture GET-verified delivery')
assert.equal(h.calls.pay, 0, 'status never resends a provider payment')
assert.equal(h.calls.create, 0, 'status never creates another invoice')

// The real signed capability reaches the same reserve/bind/pay/capture flow.
// Provider and database adapters are synthetic, so this incurs no charge.
h = harness({ delegated: true })
result = await h.post(request)
assert.equal(result.status, 200)
assert.equal(result.body.order.status, 'completed')
assert.equal(h.calls.consume, 1)
assert.equal(h.calls.reserve, 1)
assert.equal(h.calls.claimDispatch, 1)
assert.equal(h.calls.bind, 1)
assert.equal(h.calls.claimPay, 1)
assert.equal(h.calls.create, 1)
assert.equal(h.calls.pay, 1)
assert.equal(h.calls.completed, 1)
h = harness({ delegated: true, replay: true })
result = await h.post(request)
assert.equal(result.body.idempotent_replay, true)
assert.equal(h.calls.consume, 1)
assert.equal(h.calls.create, 0)
assert.equal(h.calls.pay, 0)
console.log('customer airtime Edge runtime fixtures passed')
