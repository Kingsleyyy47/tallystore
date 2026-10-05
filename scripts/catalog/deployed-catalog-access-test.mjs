import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Negative deployed probes only: no valid customer session or provider call.
const lines = readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)
const readFirst = name => lines.find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '')
const base = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const anon = readFirst('VITE_SUPABASE_ANON_KEY')
assert.ok(anon, 'Source project public key is required')
async function request(path, body, extra = {}) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  })
}
const checks = [
  ['supplier cron rejects wrong secret', '/functions/v1/supplier-catalog-maintenance', { action: 'refresh' }, { 'x-cron-secret': 'invalid-fixture-secret' }],
  ['customer API rejects invalid key', '/functions/v1/customer-api/v1/wallet?section=products', undefined, { Authorization: 'Bearer invalid-fixture-key' }],
  ['customer key creation requires a session', '/functions/v1/customer-api/v1/keys', { section: 'products', name: 'Denied fixture' }],
  ['partner provisioning requires owner session', '/functions/v1/partner-api', { action: 'admin_create_partner', name: 'Denied fixture' }],
  ['product purchase requires authorization', '/functions/v1/process-purchase', { quantity: 1 }],
  ['staff alerts require authorization', '/functions/v1/manage-staff', { action: 'supplier_balance_alerts' }],
  ['SMS requires authorization', '/functions/v1/smsbus', { action: 'get_number' }],
  ['social boost requires authorization', '/functions/v1/smm-create-order', { quantity: 1 }],
  ['supplier projection stays private', '/rest/v1/product_groups?select=id,supplier_fallback_ready', undefined],
  ['supplier journal stays private', '/rest/v1/supplier_purchase_attempts?select=id', undefined],
]
const statuses = await Promise.all(checks.map(async ([name, path, body, headers]) => {
  const response = await request(path, body, headers)
  return { name, status: response.status }
}))
console.log(JSON.stringify({ denied: statuses }, null, 2))
assert.ok(statuses.every(check => [401, 403].includes(check.status)), 'Every protected deployed probe must reject unauthenticated requests')
const catalogResponse = await request('/rest/v1/product_groups?select=id,stock_count,is_sellable,availability_status&is_active=eq.true')
assert.equal(catalogResponse.status, 200)
const catalog = await catalogResponse.json()
assert.ok(Array.isArray(catalog) && catalog.length > 0)
const fallbackAtZero = catalog.filter(row => row.stock_count === 0 && row.is_sellable === true && row.availability_status === 'UNLIMITED').length
assert.ok(fallbackAtZero > 0, 'Live configured fallback should remain available at zero local stock')
console.log(JSON.stringify({ passed: true, denied: statuses, publicCatalogRows: catalog.length, fallbackAtZero }, null, 2))
