// Source project evidence only: database reads and denied anonymous order reads.
// No customer identifiers, numbers, messages, secrets or response bodies are printed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const project = 'dssvvswvqnxanyzfhixf'
const token = readFileSync('.env', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]
  ?.trim().replace(/^['"]|['"]$/g, '')
assert.ok(token, 'Source management credential unavailable')
async function management(path, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15000),
  })
  assert.ok(response.ok, `Management read status ${response.status}`)
  return response.json()
}

const rows = await management('database/query', { method: 'POST', body: JSON.stringify({ query: `
  BEGIN READ ONLY;
  SELECT c.relrowsecurity AS rls_enabled,
    has_table_privilege('anon','public.sms_orders','SELECT') AS anon_table_read,
    has_column_privilege('anon','public.sms_orders','messages','SELECT') AS anon_messages_read,
    (SELECT count(*) FROM information_schema.columns a
      WHERE a.table_schema='public' AND a.table_name='sms_orders'
      AND a.column_name ~ '(provider|token|secret|raw_payload)'
      AND has_column_privilege('authenticated','public.sms_orders',a.column_name,'SELECT')) AS browser_private_columns,
    (SELECT count(*) FROM public.sms_orders) AS sms_orders
    FROM pg_class c WHERE c.oid='public.sms_orders'::regclass;
  COMMIT;
` }) })
assert.equal(rows.length, 1)
const evidence = rows[0]
assert.equal(evidence.rls_enabled, true)
assert.equal(evidence.anon_table_read, false)
assert.equal(evidence.anon_messages_read, false)
assert.equal(Number(evidence.browser_private_columns), 0)
const functions = await management('functions')
const sms = functions.find(item => item.slug === 'smsbus' || item.name === 'smsbus')
assert.equal(sms?.status, 'ACTIVE')
const keys = await management('api-keys')
const anon = keys.find(item => item.name === 'anon')?.api_key
assert.ok(anon, 'Public API key unavailable')
const statuses = []
for (const headers of [{}, { apikey: anon, Authorization: `Bearer ${anon}` }]) {
  const response = await fetch(`https://${project}.supabase.co/functions/v1/smsbus`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'orders' }), signal: AbortSignal.timeout(15000),
  })
  statuses.push(response.status)
  await response.body?.cancel()
  assert.equal(response.status, 401, 'Anonymous SMS order access must be rejected')
}
console.log(JSON.stringify({ verified: true, project, sms_function_version: sms.version,
  rls_enabled: true, anonymous_order_statuses: statuses,
  browser_private_columns: 0, sms_orders: Number(evidence.sms_orders) }))
