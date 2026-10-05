import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'

const source = readFileSync('supabase/functions/process-purchase/index.ts', 'utf8').replace(/^import .*$/gm, '')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000002'
const key = 'purchase_original_fixture_request'

async function run(mode, action) {
  let handler, authorized = 0, statusCalls = 0, orderReads = 0
  const calls = []
  const db = {
    from(table) {
      calls.push(table)
      const query = {
        select() { return query }, eq() { return query },
        async insert() { return { data: null, error: null } },
        async upsert() { return { data: null, error: null } },
        async single() {
          if (table === 'profiles') return { data: { is_admin: false, is_staff: false, account_suspended: false, financial_security_version: 1 }, error: null }
          assert.equal(table, 'product_groups')
          return { data: { id: productId, name: 'Synthetic product', price: 100, category_id: productId, is_active: true, is_sellable: true }, error: null }
        },
        async maybeSingle() {
          if (table === 'orders') {
            orderReads++
            return mode === 'lookup_error' || (mode === 'transport_error_lookup_error' && orderReads > 1)
              ? { data: null, error: { message: 'PRIVATE_DATABASE_ERROR' } }
              : { data: null, error: null }
          }
          assert.equal(table, 'transactions')
          return { data: null, error: null }
        },
      }
      return query
    },
    async rpc(name) {
      calls.push(name)
      if (name === 'wallet_financial_truth_internal') return { data: { confirmed_spendable: 1000, spending_blocked: false }, error: null }
      if (name === 'tally_circle_qualified_count') return { data: 0, error: null }
      assert.equal(name, 'authorize_product_purchase')
      authorized++
      if (mode.startsWith('transport_error')) return { data: null, error: { message: 'PRIVATE_DATABASE_ERROR' } }
      if (mode === 'malformed') return { data: {}, error: null }
      if (mode === 'denied') return { data: { success: false, code: 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS' }, error: null }
      throw Error('Unexpected authorization in test')
    },
  }
  vm.runInNewContext(code, { exports: {}, serve: fn => { handler = fn }, createClient: () => db,
    authenticateCustomerRequest: async () => { if (mode === 'unauthenticated') throw Error('Unauthorized'); return { id: userId } },
    getCustomerPurchaseStatus: async (_admin, user, requestKey, product) => {
      assert.equal(user, userId); assert.equal(requestKey, key); assert.equal(product, productId)
      statusCalls++; return { state: 'unknown' }
    },
    configuredSuppliers: () => [], fulfillSupplierShortfall: () => { throw Error('Read recovery must never send') },
    ngnMinorUnits, Deno: { env: { get: () => undefined } }, Error, Request, Response, URL, TextEncoder,
    crypto: webcrypto, console: { log() {}, error() {} },
  })
  const response = await handler(new Request('https://fixture.invalid/process-purchase', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, product_group_id: productId,
      quantity: 1, expected_amount_ngn: 100, idempotency_key: key }) }))
  return { status: response.status, body: await response.json(), authorized, statusCalls, calls }
}

for (const mode of ['transport_error', 'transport_error_lookup_error', 'malformed']) {
  const result = await run(mode)
  assert.equal(result.authorized, 1)
  assert.equal(result.body.code, 'PURCHASE_STATUS_UNKNOWN')
  assert.notEqual(result.body.retry_safe, true)
  assert.equal(JSON.stringify(result.body).includes('PRIVATE_'), false)
}
let result = await run('denied')
assert.equal(result.authorized, 1)
assert.equal(result.body.retry_safe, true)
result = await run('lookup_error')
assert.equal(result.authorized, 0)
assert.equal(result.body.retry_safe, true)
result = await run('status', 'get_status')
assert.equal(result.authorized, 0)
assert.equal(result.statusCalls, 1)
assert.deepEqual(result.calls, [])
assert.equal(result.body.state, 'unknown')
result = await run('unauthenticated', 'get_status')
assert.equal(result.status, 401)
assert.equal(result.authorized, 0)
assert.equal(result.statusCalls, 0)
console.log('Actual purchase entrypoint: status cannot authorize/dispatch; lost authorization response retains original attempt; definitive pre-hold denial can retry; unauthenticated status denied.')
