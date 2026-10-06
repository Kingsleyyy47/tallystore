import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
import { customerApiRoute } from '../supabase/functions/_shared/customer-api-route.mjs'

const customer = '10000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const foreignId = '30000000-0000-4000-8000-000000000002'
const key = `tlyc_sms_${'a'.repeat(64)}`
const keyId = '20000000-0000-4000-8000-000000000001'
let enabled = 'true', revoked = false, providerStatus = { status: 'waiting' }
let cancellation = { cancelled: true, response: 'ACCESS_CANCEL' }
let polls = 0, cancels = 0, refunds = 0, handler
const delegated = []
const orders = new Map()
function resetOrder(id = orderId, user = customer) {
  orders.set(id, { id, user_id: user, status: 'active', order_type: 'otp', reference: 'SMS-fixture',
    provider_request_id: `private-${id}`, provider_payload: { secret: 'must-stay-private' },
    phone_number: '+12025550123', service_id: 'sg', price_ngn: 1000, messages: [] })
}
resetOrder()
resetOrder(foreignId, '10000000-0000-4000-8000-000000000002')
const admin = {
  async rpc(name, args) {
    assert.equal(name, 'customer_api_authorize')
    assert.equal(args.p_section, 'sms')
    return { data: { ok: !revoked && args.p_hash === key, code: 'invalid_key', key_id: keyId, user_id: customer, section: 'sms' }, error: null }
  },
  from(table) {
    assert.equal(table, 'sms_orders')
    const filters = {}, guards = {}
    let patch = null
    return {
      select() { return this },
      eq(field, value) { filters[field] = value; return this },
      in(field, values) { guards[field] = values; return this },
      is(field, value) { guards[field] = value; return this },
      update(values) { patch = values; return this },
      async single() {
        const row = orders.get(filters.id)
        const owned = row && Object.entries(filters).every(([field, value]) => row[field] === value)
        return { data: owned ? structuredClone(row) : null, error: owned ? null : { message: 'not found' } }
      },
      async maybeSingle() {
        const row = orders.get(filters.id)
        if (!row || !Object.entries(filters).every(([field, value]) => row[field] === value) ||
            Object.entries(guards).some(([field, value]) => Array.isArray(value)
              ? !value.includes(row[field]) : (row[field] ?? null) !== value)) return { data: null, error: null }
        if (patch) Object.assign(row, patch)
        return { data: structuredClone(row), error: null }
      },
    }
  },
}
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None } }).outputText
}
const smsSource = readFileSync('supabase/functions/smsbus/index.ts', 'utf8')
const publicStart = smsSource.indexOf('function publicSmsOrder(')
const publicEnd = smsSource.indexOf('function smsOtpOrdersEnabled(', publicStart)
const checkStart = smsSource.indexOf('async function handleCheckOtp(')
const checkEnd = smsSource.indexOf('// ── Admin: fetch all SMS orders', checkStart)
assert.ok(publicStart >= 0 && publicEnd > publicStart && checkStart >= 0 && checkEnd > checkStart)
const sms = vm.runInNewContext(`${compile(smsSource.slice(publicStart, publicEnd))}
${compile(smsSource.slice(checkStart, checkEnd))}
({handleCheckOtp, handleCancelOtp})`, {
  TERMINAL_STATUSES: ['completed', 'cancelled', 'expired', 'failed'], getDaisyKey: () => 'fixture-only',
  json: (value, status = 200) => new Response(JSON.stringify(value), { status }),
  daisyGetStatus: async () => { polls++; return providerStatus },
  daisyCancelNumber: async () => { cancels++; return cancellation },
  daisyMarkDone: async () => {}, recordRevenueEvent: async () => {},
  cancelSmsOrderAndRefund: async (_db, order) => {
    refunds++
    const row = orders.get(order.id)
    Object.assign(row, { status: 'cancelled', refunded_at: 'fixture', refund_amount_ngn: row.price_ngn })
    return row
  },
  Response, Date,
})
const source = readFileSync('supabase/functions/customer-api/index.ts', 'utf8').replace(/^import .*\r?\n/gm, '')
vm.runInNewContext(compile(source), {
  serve: fn => { handler = fn }, createClient: () => admin, customerApiRoute,
  sha256Hex: async raw => raw,
  signCustomerCapability: async (identity, target, rawBody) => {
    assert.equal(identity.user_id, customer); assert.equal(identity.section, 'sms'); assert.equal(target, 'smsbus')
    delegated.push(JSON.parse(rawBody)); return 'signed-fixture-capability'
  },
  Deno: { env: { get: name => name === 'CUSTOMER_API_ENABLED' ? enabled :
    name === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'private-service-fixture' } },
  fetch: async (url, init) => {
    assert.equal(url, 'https://fixture.invalid/functions/v1/smsbus')
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers['x-tally-api-capability'], 'signed-fixture-capability')
    const body = JSON.parse(init.body)
    assert.deepEqual(Object.keys(body).sort(), ['action', 'order_id'])
    try { return await sms[body.action === 'check_otp' ? 'handleCheckOtp' : 'handleCancelOtp'](admin, customer, body) }
    catch { return new Response(JSON.stringify({ success: false, code: 'unavailable' }), { status: 400 }) }
  },
  Request, Response, URL, TextEncoder, TextDecoder, AbortController, crypto: webcrypto,
  setTimeout, clearTimeout, console: { error() {} },
})
async function call(action, input = { section: 'sms', order_id: orderId }, rawKey = key, suffix = '') {
  const response = await handler(new Request(`https://fixture.invalid/functions/v1/customer-api/v1/sms/${action}${suffix}`, {
    method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  return { status: response.status, body: await response.json() }
}
let result = await call('status')
assert.equal(result.status, 200); assert.equal(result.body.data.status, 'waiting'); assert.equal(polls, 1)
assert.ok(!JSON.stringify(result.body).includes('must-stay-private'))
providerStatus = { status: 'ok', code: '123456' }
result = await call('status')
assert.equal(result.body.data.status, 'completed'); assert.equal(result.body.data.messages[0].code, '123456')
const afterCode = { polls, cancels, refunds }
result = await call('cancel')
assert.equal(result.body.already_final, true)
assert.deepEqual({ polls, cancels, refunds }, afterCode, 'completed code must not cancel/refund')
resetOrder()
result = await call('cancel')
assert.equal(result.body.data.status, 'cancelled'); assert.equal(refunds, 1); assert.equal(cancels, 1)
await call('cancel'); assert.equal(refunds, 1); assert.equal(cancels, 1, 'terminal retry must not call provider again')
resetOrder()
cancellation = { cancelled: false, response: 'NO_ACTIVATION' }
result = await call('cancel')
assert.equal(result.status, 202); assert.equal(result.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
assert.equal(refunds, 1); assert.equal(orders.get(orderId).status, 'active')
const beforeForeign = { polls, cancels, refunds }
for (const action of ['status', 'cancel']) {
  assert.equal((await call(action, { section: 'sms', order_id: foreignId })).status, 400)
}
assert.deepEqual({ polls, cancels, refunds }, beforeForeign, 'foreign order reached provider/refund')
const beforeRejected = delegated.length
for (const input of [{ section: 'products', order_id: orderId }, { section: 'sms', order_id: 'bad' },
  { section: 'sms', order_id: orderId, user_id: customer }, { section: 'sms', order_id: orderId, action: 'admin_cancel_sms' },
  { section: 'sms', order_id: orderId, provider_request_id: 'arbitrary' }]) {
  assert.equal((await call('cancel', input)).status, 400)
}
assert.equal((await call('status', undefined, key, '?action=admin_sms_orders')).status, 400)
assert.equal((await call('status', undefined, `tlyc_products_${'a'.repeat(64)}`)).status, 401)
revoked = true; assert.equal((await call('status')).status, 401); revoked = false
enabled = 'false'; assert.equal((await call('status')).status, 503); assert.equal((await call('cancel')).status, 503)
assert.equal(delegated.length, beforeRejected, 'invalid/revoked/paused requests delegated')
assert.ok(delegated.every(body => ['check_otp', 'cancel_otp'].includes(body.action)))
console.log('Customer SMS API: latest OTP, owned cancellation, terminal retry, provider uncertainty, private fields, key/launch/parameter rejection passed; no live calls.')
