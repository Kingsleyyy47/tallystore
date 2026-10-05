// Source-only denied requests. No customer JWT, real API key, provider request,
// invoice, wallet debit, or launch flag change is used by this smoke test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sourceRef = 'dssvvswvqnxanyzfhixf'
const line = readFileSync('.env', 'utf8').split(/\r?\n/).find(value => value.startsWith('SUPABASE_ACCESS_TOKEN='))
const token = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
assert.ok(token, 'Source management credential required')
async function management(path, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  })
  assert.ok(response.ok, `Management HTTP ${response.status}`)
  return response.json()
}
const keys = await management('/api-keys')
const anon = keys.find(key => key.name === 'anon')?.api_key
const service = keys.find(key => key.name === 'service_role')?.api_key
assert.ok(anon && service)
const functions = await management('/functions')
for (const slug of ['customer-api', 'customer-airtime']) assert.equal(functions.find(fn => fn.slug === slug)?.status, 'ACTIVE')
const snapshotQuery = `BEGIN READ ONLY; SELECT
  (SELECT count(*) FROM public.customer_airtime_orders) AS airtime_orders,
  (SELECT count(*) FROM private.customer_airtime_dispatch) AS airtime_dispatches,
  (SELECT count(*) FROM public.customer_api_capability_nonces) AS capability_nonces,
  public.tally_circle_launch_enabled() IS FALSE AS circle_paused; COMMIT;`
const before = await management('/database/query', { query: snapshotQuery })
assert.equal(before[0].circle_paused, true)
const base = `https://${sourceRef}.supabase.co/functions/v1`
async function request(path, body, bearer = anon, capability) {
  const response = await fetch(`${base}/${path}`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json',
      ...(capability === undefined ? {} : { 'x-tally-api-capability': capability }) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json()
  for (const secret of [anon, service, token]) assert.equal(JSON.stringify(result).includes(secret), false)
  return { response, result }
}
let denied = 0
for (const action of ['orders', 'purchase', 'admin_pricing_get']) {
  for (const bearer of [anon, service]) {
    const { response } = await request('customer-airtime', { action }, bearer)
    assert.equal(response.status, 401, `${action}: a project key is not a customer identity`)
    denied++
  }
  const { response } = await request('customer-airtime', { action }, service, 'invalid-capability')
  assert.equal(response.status, 401, `${action}: malformed delegation must be denied`)
  denied++
}
let paused = 0
for (const [path, body] of [
  ['airtime/check-phone', { section: 'airtime', phone_number: '+14155550123' }],
  ['airtime/quote', { section: 'airtime', phone_number: '+14155550123' }],
  ['airtime/status', { section: 'airtime', order_id: '00000000-0000-4000-8000-000000000001' }],
  ['purchases', { section: 'airtime' }],
]) {
  const { response, result } = await request(`customer-api/v1/${path}`, body, `tlyc_airtime_${'a'.repeat(64)}`)
  assert.equal(response.status, 503)
  assert.equal(result.code, 'coming_soon')
  paused++
}
const after = await management('/database/query', { query: snapshotQuery })
assert.deepEqual(after, before, 'Denied smoke requests must not create airtime orders, claims or nonces')
console.log(JSON.stringify({ sourceRef, functions: functions.filter(fn => ['customer-api', 'customer-airtime'].includes(fn.slug))
  .map(fn => ({ slug: fn.slug, version: fn.version, status: fn.status })),
  identityRequestsDenied: denied, preparedApiRoutesPaused: paused,
  airtimeRowsAndNoncesUnchanged: true, circlePaused: true, paidCalls: 0 }))
