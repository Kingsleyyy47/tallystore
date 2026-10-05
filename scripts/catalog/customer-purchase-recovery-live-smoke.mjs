import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// Deployment smoke only: no user login, no paid action, no data writes.
const ref = 'dssvvswvqnxanyzfhixf'
const token = readFileSync('.env', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '')
assert.ok(token, 'Source Management credential unavailable')
const managementHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const base = `https://api.supabase.com/v1/projects/${ref}`
async function read(path) {
  const response = await fetch(base + path, { headers: managementHeaders, signal: AbortSignal.timeout(30000) })
  assert.ok(response.ok, `Management read failed: ${response.status}`)
  return response.json()
}
const functions = await read('/functions')
const fn = functions.find(item => item.slug === 'process-purchase')
assert.equal(fn?.status, 'ACTIVE')
const keys = await read('/api-keys')
const anon = keys.find(item => item.name === 'anon')?.api_key
assert.ok(anon, 'Public client key unavailable')
const key = 'purchase_status_smoke_never_dispatched_20261005'
async function count() {
  const response = await fetch(base + '/database/query', { method: 'POST', headers: managementHeaders,
    body: JSON.stringify({ query: `BEGIN READ ONLY; SELECT
      (SELECT count(*) FROM public.orders WHERE idempotency_key='${key}') AS orders,
      (SELECT count(*) FROM public.wallet_reservations WHERE idempotency_key='product:reservation:${key}') AS holds,
      (SELECT count(*) FROM public.transactions WHERE idempotency_key='purchase:${key}') AS debits; COMMIT;` }),
    signal: AbortSignal.timeout(30000),
  })
  assert.ok(response.ok, `Read-only count failed: ${response.status}`)
  const result = await response.json()
  return result[0]
}
const before = await count()
const checks = []
for (const authorization of [null, `Bearer ${anon}`]) {
  const response = await fetch(`https://${ref}.supabase.co/functions/v1/process-purchase`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ action: 'get_status', idempotency_key: key, product_group_id: '20000000-0000-4000-8000-000000000002' }),
    signal: AbortSignal.timeout(30000),
  })
  await response.arrayBuffer()
  assert.equal(response.status, 401, 'Unauthenticated status check must be denied')
  checks.push({ kind: authorization ? 'public_key_without_user' : 'missing_user_token', status: response.status })
}
const after = await count()
assert.deepEqual(before, after)
assert.equal(Number(after.orders), 0)
assert.equal(Number(after.holds), 0)
assert.equal(Number(after.debits), 0)
console.log(JSON.stringify({ project: ref, function: fn.slug, version: fn.version, status: fn.status,
  checks, syntheticRequestCreatedNothing: true }))
