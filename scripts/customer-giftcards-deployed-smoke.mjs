// SOURCE only. Negative authorization and read-only checks; no provider, invoice,
// purchase, wallet, launch-flag, or privileged mutation request is made.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourceRef = 'dssvvswvqnxanyzfhixf'
const preflight = process.argv.includes('--preflight')
assert.ok(process.argv.slice(2).every(arg => arg === '--preflight'), 'Unknown smoke option')
const tokenLine = readFileSync('.env', 'utf8').split(/\r?\n/)
  .find(line => /^\s*SUPABASE_ACCESS_TOKEN\s*=/.test(line))
const token = tokenLine?.split(/=(.*)/s, 2)[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')
assert.ok(token, 'SOURCE management credential required')

async function management(path, query, raw = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`, {
    method: query === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(query === undefined ? {} : { body: JSON.stringify({ query }) }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  assert.equal(response.ok, true, `SOURCE management ${path} HTTP ${response.status}`)
  return raw ? response.text() : response.json()
}

const [keys, functions, secrets] = await Promise.all([
  management('/api-keys'), management('/functions'), management('/secrets'),
])
const anon = keys.find(key => key.name === 'anon')?.api_key
const service = keys.find(key => key.name === 'service_role')?.api_key
assert.ok(anon && service, 'SOURCE project keys required')
if (!preflight) assert.equal(functions.find(fn => fn.slug === 'customer-giftcards')?.status, 'ACTIVE',
  'Gift-card handler must be deployed before this smoke check')
if (!preflight) {
  const bundle = await management('/functions/customer-giftcards/body', undefined, true)
  for (const marker of ['CUSTOMER_GIFTCARDS_ENABLED','BITREFILL_PRICE_UNIT','readOwnedOrder',
    'PURCHASE_REJECTED','record_supplier_balance_alert','claim_customer_giftcard_payment'])
    assert.ok(bundle.includes(marker), `Missing deployed handler marker ${marker}`)
}
assert.notEqual(secrets.find(secret => secret.name === 'CUSTOMER_GIFTCARDS_ENABLED')?.value, 'true',
  'Gift-card launch must remain paused')

const snapshotQuery = `BEGIN READ ONLY;
  SELECT (SELECT count(*) FROM public.customer_giftcard_orders) AS public_orders,
    (SELECT count(*) FROM private.customer_giftcard_dispatch) AS private_dispatches;
  COMMIT;`
const [before] = await management('/database/query', snapshotQuery)
assert.ok(before && Number.isFinite(Number(before.public_orders))
  && Number.isFinite(Number(before.private_dispatches)), 'Gift-card row snapshot unavailable')

const [grants] = await management('/database/query', `BEGIN READ ONLY;
  SELECT
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
        'get_customer_giftcard_replay','authorize_customer_giftcard_purchase',
        'claim_customer_giftcard_dispatch','bind_customer_giftcard_invoice',
        'claim_customer_giftcard_payment','record_customer_giftcard_outcome',
        'get_customer_giftcard_order','get_customer_giftcard_reconciliation'])) AS service_rpc_count,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
        'get_customer_giftcard_replay','authorize_customer_giftcard_purchase',
        'claim_customer_giftcard_dispatch','bind_customer_giftcard_invoice',
        'claim_customer_giftcard_payment','record_customer_giftcard_outcome',
        'get_customer_giftcard_order','get_customer_giftcard_reconciliation'])
      AND (has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) AS browser_service_rpc_grants,
    has_table_privilege('anon','public.customer_giftcard_orders','SELECT') AS anon_public_read,
    has_table_privilege('anon','private.customer_giftcard_dispatch','SELECT') AS anon_private_read,
    has_table_privilege('authenticated','private.customer_giftcard_dispatch','SELECT') AS customer_private_read,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_giftcard_orders'::regclass) AS public_rls,
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.customer_giftcard_dispatch'::regclass) AS private_rls;
  COMMIT;`)
assert.equal(Number(grants.service_rpc_count), 8, 'Service-only RPC set changed')
assert.equal(Number(grants.browser_service_rpc_grants), 0, 'Browser can execute a service-only RPC')
for (const field of ['anon_public_read','anon_private_read','customer_private_read'])
  assert.equal(grants[field], false, `${field} must be denied`)
assert.equal(grants.public_rls, true)
assert.equal(grants.private_rls, true)

const [legacy] = await management('/database/query', `BEGIN READ ONLY;
  SELECT pg_get_functiondef('public.get_my_bitrefill_order_history()'::regprocedure) AS definition,
    has_function_privilege('anon','public.get_my_bitrefill_order_history()','EXECUTE') AS anon_execute,
    has_function_privilege('authenticated','public.get_my_bitrefill_order_history()','EXECUTE') AS customer_execute,
    has_column_privilege('authenticated','public.bitrefill_orders','redemption_code','SELECT') AS direct_code_read,
    has_column_privilege('authenticated','public.bitrefill_orders','redemption_link','SELECT') AS direct_link_read,
    has_column_privilege('authenticated','public.bitrefill_orders','redemption_pin','SELECT') AS direct_pin_read;
  COMMIT;`)
assert.equal(legacy.anon_execute, false)
assert.equal(legacy.customer_execute, true)
for (const field of ['direct_code_read','direct_link_read','direct_pin_read']) assert.equal(legacy[field],false)
assert.match(legacy.definition,/WHERE\s+o\.user_id\s*=\s*\(SELECT\s+auth\.uid\(\)\)/i)
for (const field of ['code','link','pin'])
  assert.match(legacy.definition,new RegExp(`CASE WHEN\\s+o\\.status\\s*=\\s*'successful'\\s+THEN\\s+o\\.redemption_${field}\\s+ELSE NULL END`,'i'))

const restBase = `https://${sourceRef}.supabase.co/rest/v1`
const functionUrl = `https://${sourceRef}.supabase.co/functions/v1/customer-giftcards`
const deniedStatuses = new Set([401, 403, 404, 406])
let deniedRest = 0
let deniedHandler = 0
async function negative(url, { method = 'POST', body, bearer = anon, headers = {}, expected } = {}) {
  const response = await fetch(url, {
    method, headers: { apikey: anon, Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  const responseText = await response.text()
  for (const credential of [anon, service, token])
    assert.equal(responseText.includes(credential), false, 'Credential echoed in denied response')
  assert.equal(expected ? response.status === expected : deniedStatuses.has(response.status), true,
    `Denied probe returned HTTP ${response.status}`)
  return response.status
}

for (const [name, body] of [
  ['get_customer_giftcard_replay', { p_user_id:'00000000-0000-4000-8000-000000000001',
    p_idempotency_key:'smoke-denied', p_request:{} }],
  ['get_customer_giftcard_order', { p_user_id:'00000000-0000-4000-8000-000000000001',
    p_order_id:'00000000-0000-4000-8000-000000000001' }],
  ['get_customer_giftcard_reconciliation', { p_user_id:'00000000-0000-4000-8000-000000000001',
    p_order_id:'00000000-0000-4000-8000-000000000001' }],
  ['get_my_customer_giftcard_order', { p_order_id:'00000000-0000-4000-8000-000000000001' }],
  ['get_my_customer_giftcard_history', {}],
  ['get_my_bitrefill_order_history', {}],
]) {
  await negative(`${restBase}/rpc/${name}`, { body }); deniedRest++
}
await negative(`${restBase}/customer_giftcard_orders?select=id&limit=1`, { method:'GET' }); deniedRest++
await negative(`${restBase}/customer_giftcard_dispatch?select=order_id&limit=1`,
  { method:'GET', headers: { 'Accept-Profile':'private' } }); deniedRest++

if (!preflight) {
for (const bearer of [anon, service, 'forged-customer-token']) {
  await negative(functionUrl, { body:{ action:'orders' }, bearer, expected:401 }); deniedHandler++
}
await negative(functionUrl, { body:{ action:'orders' }, bearer:anon,
  headers:{ 'x-tally-api-capability':'invalid-capability' }, expected:401 }); deniedHandler++
await negative(functionUrl, { method:'GET', expected:405 }); deniedHandler++
}

const [after] = await management('/database/query', snapshotQuery)
assert.deepEqual(after, before, 'Denied requests changed gift-card public or private row counts')
console.log(JSON.stringify({ sourceRef, mode:preflight ? 'preflight' : 'deployed',
  handler:functions.find(fn => fn.slug === 'customer-giftcards')?.status || 'not-deployed', launchPaused:true,
  version:functions.find(fn => fn.slug === 'customer-giftcards')?.version,
  serviceRpcGrantsChecked:8, deniedRest, deniedHandler, rowCountsUnchanged:true,
  legacyHistoryOwnedAndSuccessfulOnly:true,
  paidOrProviderCalls:0 }))
