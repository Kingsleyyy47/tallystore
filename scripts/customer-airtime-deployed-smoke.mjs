// Anonymous/private-boundary checks only. Never creates a user, invoice or payment.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sourceRef = 'dssvvswvqnxanyzfhixf'
const tokenLine = readFileSync('.env', 'utf8').split(/\r?\n/).find(line => line.startsWith('SUPABASE_ACCESS_TOKEN='))
const token = tokenLine?.slice(tokenLine.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
assert.ok(token)
async function management(path, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  })
  assert.ok(response.ok, `Management HTTP ${response.status}`)
  return response.json()
}
const keys = await management('/api-keys')
const anon = keys.find(key => key.name === 'anon')?.api_key
assert.ok(anon)
const functions = await management('/functions')
const fn = functions.find(fn => fn.slug === 'customer-airtime')
assert.equal(fn?.status, 'ACTIVE')
for (const slug of ['smsbus', 'manage-staff']) assert.equal(functions.find(fn => fn.slug === slug)?.status, 'ACTIVE')
const before = await management('/database/query', { query: `BEGIN READ ONLY;
  SELECT (SELECT count(*) FROM public.customer_airtime_orders) AS orders,
    (SELECT count(*) FROM private.customer_airtime_dispatch) AS dispatches; COMMIT;` })
for (const action of ['check_phone', 'quote', 'purchase', 'orders', 'status', 'admin_pricing_get', 'admin_pricing_set', 'admin_product_options']) {
  const response = await fetch(`https://${sourceRef}.supabase.co/functions/v1/customer-airtime`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, kind: 'sms', scope: 'global', mode: 'amount', value: 0 }), signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 401, `Anonymous ${action} must be denied`)
}
for (const [slug, action] of [['smsbus', 'services'], ['smsbus', 'create_otp'], ['manage-staff', 'supplier_balance_alerts']]) {
  const response = await fetch(`https://${sourceRef}.supabase.co/functions/v1/${slug}`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }), signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 401, `Anonymous ${slug}/${action} must be denied`)
}
for (const [rpc, body] of [
  ['get_customer_bitrefill_pricing_batch', { p_kind: 'sms', p_selectors: [] }],
  ['list_customer_bitrefill_pricing', { p_owner_user_id: 'c1396bda-86e2-4dfc-94bb-0d95469d1d36', p_kind: 'sms' }],
  ['get_customer_airtime_reconciliation', { p_user_id: 'c1396bda-86e2-4dfc-94bb-0d95469d1d36', p_order_id: '00000000-0000-4000-8000-000000000001' }],
]) {
  const response = await fetch(`https://${sourceRef}.supabase.co/rest/v1/rpc/${rpc}`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 401, `Anonymous private ${rpc} must be denied`)
}
const after = await management('/database/query', { query: `BEGIN READ ONLY;
  SELECT (SELECT count(*) FROM public.customer_airtime_orders) AS orders,
    (SELECT count(*) FROM private.customer_airtime_dispatch) AS dispatches; COMMIT;` })
assert.deepEqual(after, before)
console.log(JSON.stringify({ sourceRef, version: fn.version, status: fn.status,
  functions: functions.filter(fn => ['smsbus', 'manage-staff'].includes(fn.slug)).map(fn => ({ slug: fn.slug, version: fn.version, status: fn.status })),
  anonymousActionsDenied: 11, privateRpcsDenied: 3, airtimeRowsUnchanged: true, paidCalls: 0 }))
