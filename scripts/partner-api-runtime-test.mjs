import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText
const runnerExports = {}
vm.runInNewContext(compile(readFileSync('supabase/functions/_shared/partner-external-runner.ts', 'utf8')),
  { exports: runnerExports, crypto: webcrypto, TextEncoder })
const pricingExports = {}
vm.runInNewContext(compile(readFileSync('supabase/functions/_shared/partner-pricing.ts', 'utf8')),
  { exports: pricingExports })
const source = readFileSync('supabase/functions/partner-api/index.ts', 'utf8').replace(/^import .*$/gm, '')
const keyId = '10000000-0000-4000-8000-000000000001'
const partnerId = '20000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const scopes = ['catalogue:read', 'orders:create', 'orders:read', 'wallet:read']
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const purchase = { action: 'create_order', item_type: 'sms', item_id: 'ds', quantity: 1,
  expected_amount_ngn: 100, idempotency_key: 'runtime-request-0001' }

async function run({ body = { action: 'balance' }, method = 'POST', raw, env = {},
  key = 'tly_live_TEST_ONLY_KEY', admission = { ok: true, key_id: keyId, partner_id: partnerId },
  rpcFailure = '', claimed = true, actor = owner, adminAccount = false, products = null } = {}) {
  let handler
  const calls = { rpc: [], tables: [], dispatch: 0, plans: 0, logs: [] }
  const partner = { id: partnerId, is_active: true, owner_reviewed_at: '2026-10-05',
    allowed_sections: ['sms', 'products'], balance_ngn: 500, unlimited_credit: false, markup_percent: 10 }
  const db = {
    from(table) {
      calls.tables.push(table)
      const q = { select() { return this }, eq() { return this }, is() { return this },
        order() { return this }, limit() { return this },
        async single() { return { data: table === 'profiles' ? { is_admin: adminAccount, account_suspended: false } : null, error: null } },
        async maybeSingle() { return { data: table === 'api_partner_keys' ? {
          id: keyId, partner_id: partnerId, scopes, api_partners: partner,
        } : null, error: null } },
        async insert() { return { data: null, error: null } },
        then(resolve) { return Promise.resolve({ data: table === 'product_groups' ? products : [], error: null }).then(resolve) },
      }
      return q
    },
    auth: { async getUser() { return { data: { user: { id: actor } }, error: null } } },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (name === rpcFailure) return { data: null, error: { message: 'PRIVATE_DATABASE_CREDENTIAL' } }
      if (name === 'authorize_api_partner_request') return { data: admission, error: null }
      if (name === 'reserve_api_partner_external_order') return { data: {
        success: true, order_id: orderId, dispatch_state: 'prepared', data: { id: orderId, status: 'pending' },
      }, error: null }
      if (name === 'claim_api_partner_external_dispatch') return { data: {
        success: claimed, send_allowed: claimed, order_id: orderId, dispatch_state: claimed ? 'sending' : 'accepted',
      }, error: null }
      if (name === 'record_api_partner_external_outcome') return { data: {
        success: true, data: { id: orderId, status: args.p_status, response_payload: args.p_public_payload },
      }, error: null }
      throw new Error('Unexpected privileged RPC')
    },
  }
  const context = vm.createContext({
    serve: fn => { handler = fn }, createClient: () => db,
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE_SERVICE_CREDENTIAL', ...env })[name] } },
    executePartnerExternalPurchase: runnerExports.executePartnerExternalPurchase,
    preparePartnerSmsPlan: async () => { calls.plans++; return {
      section: 'sms', itemId: 'ds', itemName: 'Discord', quantity: 1, amountNgn: 100,
      requestPayload: { service: 'ds' }, dispatch: async () => { calls.dispatch++; return {
        kind: 'accepted', source: 'daisy', id: 'FIXTURE_ACTIVATION', status: 'active',
        payload: { phone_number: '+10000000000' },
      } },
    } },
    partnerMarkup: pricingExports.partnerMarkup,
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL,
    setTimeout, clearTimeout, fetch: async () => { throw new Error('Unexpected provider network') },
    console: { log() {}, error() {}, warn() {} },
  })
  vm.runInContext(compile(source), context)
  // Isolate a real catalog error boundary: database/provider loaders can throw
  // secrets, but the real handler must return only its stable public code.
  vm.runInContext(`${products === null ? "productCatalogue = async () => { throw new Error('PRIVATE_PROVIDER_CREDENTIAL'); };" : ''}
    smsCatalogue = async () => { throw new Error('PRIVATE_PROVIDER_CREDENTIAL'); };`, context)
  const request = new Request('https://fixture.invalid/functions/v1/partner-api', {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-tally-api-key': key } : {}),
      ...(adminAccount ? { Authorization: 'Bearer FIXTURE_USER_JWT' } : {}) },
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: raw ?? JSON.stringify(body) }),
  })
  const response = await handler(request)
  const data = await response.json()
  assert.equal(JSON.stringify(data).includes('PRIVATE_'), false, 'Private data reached the response')
  return { status: response.status, data, calls }
}

let result = await run()
assert.equal(result.status, 503); assert.equal(result.calls.rpc.length, 0)
const enabled = { PARTNER_API_READ_ENABLED: 'true' }
for (const key of ['', 'not-a-valid-key']) {
  result = await run({ env: enabled, key, admission: { ok: false, code: 'INVALID_KEY' } })
  assert.equal(result.status, 401); assert.equal(result.calls.dispatch, 0)
}
for (const [code, status] of [['SCOPE_DENIED', 403], ['PARTNER_DISABLED', 403], ['RATE_LIMITED', 429]]) {
  result = await run({ env: enabled, admission: { ok: false, code } })
  assert.equal(result.status, status); assert.equal(result.calls.plans, 0)
}
result = await run({ env: enabled, rpcFailure: 'authorize_api_partner_request' })
assert.equal(result.status, 503)
result = await run({ env: enabled, body: { action: 'catalogue' } })
assert.equal(result.status, 200)
assert(result.data.items.every(item => item.error === 'SERVICE_UNAVAILABLE'))
result = await run({ env: enabled, body: { action: 'catalogue', section: 'products', quote_quantity: 2 },
  products: [{ id: 'product-1', name: 'Fixture', price: 1, stock_count: 5, is_sellable: true, availability_status: 'UNLIMITED' },
    { id: 'product-2', name: 'Empty fixture', price: 1, stock_count: 0, is_sellable: true, availability_status: 'PREORDER' }] })
assert.equal(result.status, 200)
assert.equal(result.data.items[0].price_ngn, 2)
assert.equal(result.data.items[0].total_price_ngn, 3, 'Quantity total must match SQL ceil(1 * 2 * 1.1)')
assert.equal(result.data.items[0].quote_quantity, 2)
assert.equal(result.data.items[0].availability, 'available')
assert.equal(result.data.items[1].availability, 'out_of_stock', 'Do not advertise supplier-only inventory on a local purchase endpoint')
result = await run({ env: enabled, body: { action: 'catalogue', quote_quantity: 501 } })
assert.equal(result.status, 400)
result = await run({ env: enabled, adminAccount: true, actor: '40000000-0000-4000-8000-000000000001', body: { action: 'admin_list_partners' } })
assert.equal(result.status, 403); assert.equal(result.calls.tables.includes('api_partners'), false)
result = await run({ env: enabled, adminAccount: true, body: { action: 'admin_create_partner',
  name: 'Fixture', allowed_sections: ['invalid-section'] } })
assert.equal(result.status, 400)
assert.equal(result.calls.rpc.length, 0, 'Invalid section input must not expand to all sections')
for (const body of [purchase, { action: 'create_checkout' }, { action: 'internal_confirm_checkout' },
  { ...purchase, item_type: 'crypto' }]) {
  result = await run({ env: enabled, body })
  assert.equal(result.status, 503); assert.equal(result.calls.dispatch, 0)
}
const smsEnabled = { ...enabled, PARTNER_EXTERNAL_SECTIONS_ENABLED: 'sms' }
for (const body of [{ ...purchase, force: true }, { ...purchase, unlimited_credit: true },
  { ...purchase, payment_mode: 'gateway' }]) {
  result = await run({ env: smsEnabled, body })
  assert.equal(result.status, 400); assert.equal(result.calls.dispatch, 0)
  assert.deepEqual(result.calls.rpc.map(c => c.name), ['authorize_api_partner_request'])
}
result = await run({ env: smsEnabled, body: { ...purchase, expected_amount_ngn: 99 } })
assert.equal(result.status, 409); assert.equal(result.calls.dispatch, 0)
result = await run({ env: smsEnabled, body: purchase, claimed: false })
assert.equal(result.calls.dispatch, 0)
result = await run({ env: smsEnabled, body: purchase })
assert.equal(result.status, 200); assert.equal(result.calls.dispatch, 1)
assert.deepEqual(result.calls.rpc.map(c => c.name), ['authorize_api_partner_request',
  'reserve_api_partner_external_order', 'claim_api_partner_external_dispatch', 'record_api_partner_external_outcome'])
assert.equal(result.calls.rpc[1].args.p_amount_ngn, 100)
for (const [raw, status] of [['[]', 400], ['null', 400], ['x'.repeat(32769), 413]]) {
  result = await run({ env: enabled, raw }); assert.equal(result.status, status)
  assert.equal(result.calls.rpc.length, 0)
}
result = await run({ env: enabled, method: 'DELETE' }); assert.equal(result.status, 405)
console.log('Partner API entry point: rate/scopes, owner-only admin, catalog error redaction, independent purchase gates, exact claim before dispatch and override/body denial passed.')
