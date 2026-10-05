import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// Read credentials in memory; never print or send them to the partner endpoint.
const token = readFileSync('.env', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
assert(token, 'Source project management token is required')
const project = 'dssvvswvqnxanyzfhixf'
const management = `https://api.supabase.com/v1/projects/${project}`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
async function query(query) {
  const response = await fetch(management + '/database/query', { method: 'POST', headers, body: JSON.stringify({ query }) })
  assert(response.ok, `Metadata query HTTP ${response.status}`)
  return response.json()
}
const countQuery = `SELECT (SELECT count(*) FROM public.api_partner_external_orders) AS orders,
  (SELECT count(*) FROM public.api_partner_obligations) AS obligations,
  (SELECT count(*) FROM public.api_partner_external_events) AS events`
const before = await query(countQuery)
const functionResponse = await fetch(management + '/functions', { headers })
assert(functionResponse.ok)
const deployed = (await functionResponse.json()).find(f => f.slug === 'partner-api')
assert.equal(deployed?.status, 'ACTIVE')
assert.equal(deployed?.verify_jwt, false, 'Partner function authenticates scoped partner keys internally')
console.log(JSON.stringify({ deployed: { slug: deployed.slug, version: deployed.version, status: deployed.status } }))
const endpoint = `https://${project}.supabase.co/functions/v1/partner-api`
const cases = [
  ['missing_key', { action: 'catalogue' }, 401, 'INVALID_KEY'],
  ['fake_key', { action: 'balance' }, 401, 'INVALID_KEY'],
  ['checkout_paused', { action: 'create_checkout' }, 503, 'PARTNER_PURCHASES_PAUSED'],
  ['external_sms_paused', { action: 'create_order', item_type: 'sms' }, 503, 'PARTNER_PURCHASES_PAUSED'],
  ['internal_confirmation_paused', { action: 'internal_confirm_checkout' }, 503, 'PARTNER_PURCHASES_PAUSED'],
  ['invalid_array', [], 400, 'INVALID_REQUEST'],
  ['oversized', 'x'.repeat(32769), 413, 'REQUEST_TOO_LARGE'],
]
for (const [name, body, status, code] of cases) {
  const response = await fetch(endpoint, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(name === 'fake_key' ? { 'x-tally-api-key': 'tly_live_TEST_ONLY_NONEXISTENT' } : {}),
  }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const data = await response.json()
  assert.equal(response.status, status, name)
  assert.equal(data.code, code, name)
  console.log(JSON.stringify({ case: name, status: response.status, code: data.code }))
}
assert.deepEqual(await query(countQuery), before, 'Rejected requests must not create financial records')
console.log('Deployed rejected-request checks passed; external journals, obligations and financial events unchanged.')
