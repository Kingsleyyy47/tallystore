import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { configuredSuppliers } from '../../supabase/functions/_shared/supplier-purchase.mjs'

// Run the actual Edge handler and supplier configuration parser. Replace only
// authentication and database transport; fetching a supplier is prohibited.
const source = readFileSync('supabase/functions/supplier-catalog-maintenance/index.ts', 'utf8').replace(/^import[^\n]*\n/gm, '')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const productId = '20000000-0000-4000-8000-000000000001'
const mapped = { id: productId, is_active: true, auto_fulfill_enabled: true, muabanvia_product_id: 'private-provider-product', paused: false }
const defaults = { SUPPLIER_CATALOG_SECRET: 'private-cron-secret', TALLYSTORE_OWNER_USER_ID: 'owner', LIVE_ACCOUNT_FULFILLMENT_ENABLED: 'true', MUABANVIA_API_KEY: 'private-provider-key' }

async function request(options = {}) {
  let handler
  let clients = 0
  const calls = []
  const queries = []
  const env = { ...defaults, ...options.env }
  const products = options.products ?? [mapped]
  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'reset_supplier_product_fallback') return { data: options.reset ?? { success: true }, error: options.resetError ?? null }
      assert.equal(name, 'refresh_supplier_product_availability')
      const product = products.find(item => item.id === args.p_product_group_id)
      return { data: { success: true, updated: product?.changed === true, supplier_fallback_enabled: args.p_fallback_enabled && !product?.paused && !product?.blocked, availability_status: product?.paused ? 'PAUSED' : 'AVAILABLE', api_key: 'private-provider-key', provider_product_id: 'private-provider-product' }, error: options.refreshError ?? null }
    },
    from: table => {
      if (table === 'profiles') {
        const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: options.profile ?? { is_admin: true, account_suspended: false }, error: options.profileError ?? null }) }
        return chain
      }
      assert.equal(table, 'product_groups')
      const filters = {}
      const chain = {
        select: fields => { filters.fields = fields; return chain },
        eq: (field, value) => { filters[field] = value; return chain },
        order: field => { assert.equal(field, 'id'); return chain },
        limit: count => { assert.equal(count, 250); filters.limit = count; return chain },
        gt: (field, value) => { assert.equal(field, 'id'); filters.after = value; return chain },
        single: async () => ({ data: products.find(item => item.id === filters.id), error: null }),
        then: (resolve, reject) => {
          queries.push({ ...filters })
          assert.equal(filters.is_active, true)
          return Promise.resolve({ data: products.filter(item => item.is_active && (!filters.after || item.id > filters.after)).sort((a,b) => a.id.localeCompare(b.id)).slice(0, filters.limit), error: options.queryError ?? null }).then(resolve, reject)
        },
      }
      return chain
    },
  }
  vm.runInNewContext(code, {
    Request, Response, Headers, URL, configuredSuppliers,
    console: { error() {} },
    fetch: () => { throw new Error('Maintenance must never contact a supplier') },
    Deno: { env: { get: key => env[key] } },
    serve: callback => { handler = callback },
    createClient: () => ++clients === 1 ? admin : { auth: { getUser: async token => { assert.equal(token, 'owner-test-token'); return { data: { user: options.authenticated === false ? null : { id: options.userId ?? 'owner' } }, error: options.authError ?? null } } } },
  })
  const method = options.method ?? 'POST'
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  const response = await handler(new Request('https://local/functions/v1/supplier-catalog-maintenance', { method, headers, ...(method === 'POST' ? { body: options.rawBody ?? JSON.stringify(options.body ?? { action: 'refresh' }) } : {}) }))
  const result = await response.json()
  for (const secret of ['private-cron-secret', 'private-provider-key', 'private-provider-product']) assert.equal(JSON.stringify(result).includes(secret), false)
  return { status: response.status, result, calls, queries }
}

const cron = { 'x-cron-secret': defaults.SUPPLIER_CATALOG_SECRET }
const owner = { Authorization: 'Bearer owner-test-token' }
for (const headers of [{}, { 'x-cron-secret': 'incorrect' }]) {
  const result = await request({ headers })
  assert.equal(result.status, 401); assert.equal(result.calls.length, 0)
}
for (const options of [{ userId: 'customer' }, { authenticated: false }, { authError: {} }, { profile: { is_admin: false } }, { profile: { is_admin: true, account_suspended: true } }, { profileError: {} }]) {
  const result = await request({ headers: owner, ...options })
  assert.equal(result.status, 403); assert.equal(result.calls.length, 0)
}
for (const headers of [cron, owner]) {
  const result = await request({ headers, products: [mapped, { ...mapped, id: '20000000-0000-4000-8000-000000000002', muabanvia_product_id: null }, { ...mapped, id: '20000000-0000-4000-8000-000000000003', paused: true }, { ...mapped, id: '20000000-0000-4000-8000-000000000004', blocked: true }, { ...mapped, id: '20000000-0000-4000-8000-000000000005', is_active: false }] })
  assert.equal(result.status, 200)
  assert.deepEqual(result.result, { success: true, processed: 4, ready: 1, paused: 1, updated: 0, failed: 0 })
  assert.deepEqual(result.calls.map(item => item.args.p_fallback_enabled), [true, false, true, true])
}
for (const env of [{ LIVE_ACCOUNT_FULFILLMENT_ENABLED: 'false' }, { MUABANVIA_API_KEY: '' }, { MUABANVIA_BASE_URL: 'http://muabanvia.org/api/buy_product' }, { MUABANVIA_BASE_URL: 'https://attacker.invalid/api/buy_product' }, { MUABANVIA_BASE_URL: 'https://muabanvia.org/?api_key=private-provider-key' }]) {
  const result = await request({ headers: cron, env })
  assert.equal(result.status, 200); assert.equal(result.calls[0].args.p_fallback_enabled, false)
}
const paged = await request({ headers: cron, products: Array.from({ length: 251 }, (_, index) => ({ ...mapped, id: `20000000-0000-4000-8000-${String(index).padStart(12,'0')}` })) })
assert.equal(paged.result.processed, 251); assert.equal(paged.queries.length, 2)
assert.equal(new Set(paged.calls.map(call => call.args.p_product_group_id)).size, 251)
const resetBody = { action: 'reset_fallback', product_group_id: productId }
const deniedReset = await request({ headers: cron, body: resetBody })
assert.equal(deniedReset.status, 403); assert.equal(deniedReset.calls.length, 0)
for (const [reset, status] of [[{ success: false, code: 'PRODUCT_NOT_FOUND' },404], [{ success: false, code: 'SUPPLIER_RECONCILIATION_PENDING' },409]]) {
  const result = await request({ headers: owner, body: resetBody, reset })
  assert.equal(result.status, status); assert.equal(result.calls.length, 1)
}
const reset = await request({ headers: owner, body: resetBody })
assert.equal(reset.status, 200); assert.deepEqual(reset.calls.map(call => call.name), ['reset_supplier_product_fallback','refresh_supplier_product_availability'])
assert.deepEqual(reset.result, { success: true, reset: 1, processed: 1, ready: 1, paused: 0, updated: 0, failed: 0 })
assert.equal((await request({ headers: cron, products: [{ ...mapped, changed: true }] })).result.updated, 1)
for (const [options, status] of [[{ rawBody: '{' },400], [{ rawBody: '[]' },400], [{ rawBody: 'x'.repeat(8193) },413], [{ body: { action: 'buy' } },400], [{ body: { action: 'reset_fallback', product_group_id: 'bad' }, headers: owner },400], [{ method: 'GET' },405], [{ refreshError: { message: 'private-provider-key' } },503], [{ queryError: { message: 'private-provider-product' } },503]]) {
  assert.equal((await request({ headers: cron, ...options })).status, status)
}
console.log('Supplier catalog maintenance: verified owner/cron auth, reset restriction, live/config gates, full active paging, safe counts and no supplier requests passed.')
