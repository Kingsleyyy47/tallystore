import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { customerApiRoute } from '../supabase/functions/_shared/customer-api-route.mjs'

const key = 'tlyc_airtime_' + 'a'.repeat(64)
const userId = '10000000-0000-4000-8000-000000000001'
const keyId = '20000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const calls = { auth: [], signed: [], fetch: [], tables: [], queries: [], clients: 0 }
let enabled = 'true'
let handler
const admin = {
  rpc: async (name, args) => {
    assert.equal(name, 'customer_api_authorize')
    calls.auth.push(args)
    return { data: { ok: true, key_id: keyId, user_id: userId, section: args.p_section }, error: null }
  },
  from: table => {
    calls.tables.push(table)
    const record = { table, fields: '', filters: {} }
    calls.queries.push(record)
    const query = { select(fields) { record.fields = fields; return this },
      eq(key, value) { record.filters[key] = value; return this }, order() { return this }, limit() { return this },
      async maybeSingle() { return { data: { id: orderId, user_id: userId, status: 'completed', amount_ngn: 100 }, error: null } },
      then(resolve) { return Promise.resolve({ data: [{ id: orderId, status: 'completed' }], error: null }).then(resolve) },
    }
    return query
  },
}
const code = ts.transpileModule(readFileSync('supabase/functions/customer-api/index.ts', 'utf8').replace(/^import .*$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
vm.runInNewContext(code, {
  serve: fn => { handler = fn },
  createClient: () => { calls.clients++; return admin },
  sha256Hex: async () => 'b'.repeat(64),
  signCustomerCapability: async (identity, target, raw) => {
    calls.signed.push({ identity, target, body: JSON.parse(raw) })
    return 'synthetic-capability'
  },
  customerApiRoute, Deno: { env: { get: name => ({ CUSTOMER_API_ENABLED: enabled,
    SUPABASE_URL: 'https://source.example.com', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' })[name] } },
  fetch: async (url, options) => {
    calls.fetch.push({ url, options })
    return new Response(JSON.stringify({ success: true, order: { id: orderId, status: 'processing' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  },
  Request, Response, URL, AbortSignal, TextEncoder, TextDecoder, Uint8Array, crypto: globalThis.crypto,
  setTimeout, clearTimeout, console: { error() {} },
})
function reset() { for (const list of Object.values(calls)) if (Array.isArray(list)) list.length = 0; calls.clients = 0 }
async function post(path, value, bearer = key) {
  const request = new Request(`https://source.example.com/functions/v1/customer-api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(value),
  })
  const response = await handler(request)
  return { status: response.status, data: await response.json() }
}
const quote = { section: 'airtime', phone_number: '+14155550123', operator_id: 'provider-product',
  product_id: 'provider-product', package_id: 'bundle-1' }
assert.deepEqual(customerApiRoute('/functions/v1/customer-api/v1/airtime/quote', 'POST'),
  { kind: 'airtime', path: '/v1/airtime/quote' })
let result = await post('/v1/airtime/quote', quote)
assert.equal(result.status, 200)
assert.equal(calls.signed[0].target, 'customer-airtime')
assert.equal(calls.signed[0].identity.section, 'airtime')
assert.deepEqual(Object.keys(calls.signed[0].body).sort(), ['action','operator_id','package_id','phone_number','product_id'])
assert.equal(calls.signed[0].body.action, 'quote')
assert.ok(calls.fetch[0].url.endsWith('/functions/v1/customer-airtime'))
assert.equal(calls.fetch[0].options.headers['x-tally-api-capability'], 'synthetic-capability')

reset()
result = await post('/v1/purchases', { ...quote, expected_amount_ngn: 100, idempotency_key: 'airtime-order-001' })
assert.equal(result.status, 200)
assert.equal(calls.signed[0].body.action, 'purchase')
assert.equal(calls.signed[0].body.expected_amount_ngn, 100)
assert.equal(calls.fetch.length, 1)

for (const invalid of [
  { ...quote, section: 'products' }, { ...quote, user_id: userId }, { ...quote, url: 'https://evil.example.com' },
  { ...quote, action: 'admin_pricing_set' }, { ...quote, phone_number: '4155550123' },
  { ...quote, package_id: undefined, unit_value: undefined },
]) {
  reset()
  result = await post('/v1/airtime/quote', invalid)
  assert.equal(result.status, 400); assert.equal(calls.auth.length, 0); assert.equal(calls.fetch.length, 0)
}
reset()
result = await post('/v1/purchases', { ...quote, expected_amount_ngn: 0,
  idempotency_key: 'airtime-order-002' })
assert.equal(result.status, 400); assert.equal(calls.fetch.length, 0)
reset()
result = await post('/v1/airtime/status', { section: 'airtime', order_id: orderId }, 'wrong-key')
assert.equal(result.status, 401); assert.equal(calls.fetch.length, 0)
reset()
result = await post('/v1/airtime/check-phone', { section: 'airtime', phone_number: '+14155550123' })
assert.equal(result.status, 200); assert.equal(calls.signed[0].body.action, 'check_phone')

reset()
let response = await handler(new Request('https://source.example.com/customer-api/v1/orders?section=airtime', {
  headers: { Authorization: `Bearer ${key}` },
}))
assert.equal(response.status, 200); assert.deepEqual(calls.tables, ['customer_airtime_orders'])
assert.deepEqual(calls.queries[0].filters, { user_id: userId })
assert.equal(calls.queries[0].fields,
  'id, status, recipient_phone, product_name, amount_ngn, currency, created_at')
reset()
response = await handler(new Request(`https://source.example.com/customer-api/v1/orders/${orderId}?section=airtime`, {
  headers: { Authorization: `Bearer ${key}` },
}))
assert.equal(response.status, 200); assert.deepEqual(calls.tables, ['customer_airtime_orders'])
assert.deepEqual(calls.queries[0].filters, { user_id: userId, id: orderId })
assert.equal(calls.queries[0].fields,
  'id, status, recipient_phone, product_name, amount_ngn, currency, created_at')
assert.ok(!/invoice|provider|wallet|member/i.test(calls.queries[0].fields))

reset()
response = await handler(new Request('https://source.example.com/customer-api/v1/airtime/quote', {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
    'Content-Length': '20000' }, body: '{}',
}))
assert.equal(response.status, 413); assert.equal(calls.auth.length, 0); assert.equal(calls.fetch.length, 0)
reset()
const oversizeStream = new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(quote)))
  controller.enqueue(new Uint8Array(16_385))
  controller.close()
} })
response = await handler(new Request('https://source.example.com/customer-api/v1/airtime/quote', {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: oversizeStream, duplex: 'half',
}))
assert.equal(response.status, 413); assert.equal(calls.auth.length, 0); assert.equal(calls.fetch.length, 0)
reset()
const hangingStream = new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('{"section":"airtime"'))
} })
response = await handler(new Request('https://source.example.com/customer-api/v1/airtime/quote', {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: hangingStream, duplex: 'half',
}))
assert.equal(response.status, 408); assert.equal(calls.auth.length, 0); assert.equal(calls.fetch.length, 0)

reset(); enabled = 'false'
result = await post('/v1/airtime/quote', quote)
assert.equal(result.status, 503); assert.equal(result.data.code, 'coming_soon')
assert.equal(calls.clients, 0); assert.equal(calls.fetch.length, 0)
console.log('Customer airtime API: exact section/body, signed target, owned reads and Coming Soon gate passed.')
