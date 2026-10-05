import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../supabase/functions/process-purchase/index.ts', import.meta.url), 'utf8')
  .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText
const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000001'

function fixture(mode, { supplier = true, balance = 1000 } = {}) {
  let handler
  let paidCalls = 0
  let authorizationCalls = 0
  let blocked = 0
  let cancelled = 0
  let captured = 0
  let proofCalls = 0
  const orders = new Map()
  const product = {
    id: productId, category_id: 'category', name: 'Fixture product', price: 100,
    is_active: true, is_sellable: true, availability_status: 'UNLIMITED',
    quantity_discount_tiers: [], auto_fulfill_enabled: true, supplier_fallback_blocked: false,
    supplier_fallback_ready: true,
    muabanvia_product_id: 'supplier-42', categories: { name: 'Fixture category' },
  }

  const admin = {
    from(table) {
      const filters = {}
      let selected
      const chain = {
        select(fields) { selected = fields; return chain },
        eq(key, value) { filters[key] = value; return chain },
        in(key, values) { filters[key] = values; return chain },
        upsert: async () => ({ error: null }),
        insert: async () => ({ error: null }),
        async single() {
          if (table === 'profiles') return { data: selected === 'financial_security_version'
            ? { financial_security_version: 1 }
            : { is_staff: false, is_admin: false, account_suspended: false }, error: null }
          if (table === 'orders') {
            const row = orders.get(filters.idempotency_key)
            return { data: row || null, error: row ? null : { code: 'PGRST116' } }
          }
          if (table === 'product_groups') return { data: product, error: null }
          throw new Error(`Unexpected single table ${table}`)
        },
        async maybeSingle() {
          if (table === 'transactions') return { data: null, error: null }
          if (table === 'orders') return { data: orders.get(filters.idempotency_key) || null, error: null }
          throw new Error(`Unexpected maybeSingle table ${table}`)
        },
        then(resolve, reject) {
          if (table === 'individual_accounts') {
            const rows = filters.id.map((id, index) => ({ id, username: `user-${index}`, password: 'secret' }))
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
          }
          throw new Error(`Unexpected awaited table ${table}`)
        },
      }
      return chain
    },
    async rpc(name, args) {
      if (name === 'wallet_financial_truth_internal') return { data: { confirmed_spendable: balance, spending_blocked: false }, error: null }
      if (name === 'get_tally_circle_purchase_status') return {
        data: { enabled: false, is_member: false, discount_percent: 0 }, error: null,
      }
      if (name === 'authorize_product_purchase') {
        authorizationCalls += 1
        if (supplier) return { data: { success: false, code: 'INSUFFICIENT_STOCK', available: 1 }, error: null }
        const row = { id: 'local-order', user_id: userId, product_group_id: productId, amount: 100,
          status: 'processing', idempotency_key: args.p_idempotency_key,
          wallet_reservation_id: 'local-hold', financial_authorization_status: 'funds_held',
          account_details: { quantity: 1, financial_authorization: 'reserve_first' } }
        orders.set(args.p_idempotency_key, row)
        return { data: { success: true, order_id: row.id, reservation_id: row.wallet_reservation_id,
          account_ids: ['local-account'] }, error: null }
      }
      if (name === 'authorize_supplier_product_purchase') {
        authorizationCalls += 1
        const row = { id: 'supplier-order', user_id: userId, product_group_id: productId, amount: 200,
          status: 'processing', idempotency_key: args.p_idempotency_key,
          wallet_reservation_id: 'supplier-hold', financial_authorization_status: 'funds_held',
          account_details: { quantity: 2, financial_authorization: 'supplier_reserve_first',
            supplier_configured_providers: ['muabanvia'] } }
        orders.set(args.p_idempotency_key, row)
        return { data: { success: true, order_id: row.id, reservation_id: row.wallet_reservation_id,
          account_ids: ['local-account'], supplier_quantity: 1 }, error: null }
      }
      if (name === 'cancel_exhausted_supplier_purchase') {
        cancelled += 1
        const row = [...orders.values()][0]
        row.status = 'cancelled'; row.financial_authorization_status = 'released'; row.release_proven = true
        return { data: { success: true }, error: null }
      }
      if (name === 'block_supplier_product_fallback') {
        blocked += 1
        product.supplier_fallback_blocked = true
        product.is_sellable = false
        product.availability_status = 'UNAVAILABLE'
        return { data: { success: true }, error: null }
      }
      if (name === 'complete_product_purchase') {
        captured += 1
        const row = [...orders.values()][0]
        if (mode === 'completion-error') return { data: null, error: { message: 'DB completion failed' } }
        row.status = 'completed'; row.financial_authorization_status = 'captured'
        row.capture_proven = true; row.account_details = args.p_account_details
        if (mode === 'committed-response-lost') return { data: null, error: { message: 'Response lost' } }
        return { data: { success: true, balance_after: 800, account_details: args.p_account_details }, error: null }
      }
      if (name === 'refresh_supplier_product_availability') return { data: { success: true }, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    },
  }

  const context = {
    Request, Response, Headers, URL, URLSearchParams, FormData, TextEncoder, crypto, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: key => key === 'LIVE_ACCOUNT_FULFILLMENT_ENABLED' ? 'true' : 'test-only' } },
    serve: callback => { handler = callback },
    createClient: () => admin,
    ngnMinorUnits: value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null,
    authenticateCustomerRequest: async () => ({ id: userId }),
    getCustomerPurchaseStatus: async (client, actor, requestKey, group, orderId) => {
      proofCalls += 1
      assert.equal(client, admin); assert.equal(actor, userId); assert.equal(group, productId)
      const row = orders.get(requestKey)
      if (!row) return { state: 'unknown' }
      assert.equal(row.user_id, actor); assert.equal(row.product_group_id, group)
      assert.equal(row.idempotency_key, requestKey); assert.equal(row.id, orderId)
      if (row.status === 'completed' && row.financial_authorization_status === 'captured' && row.capture_proven) {
        assert.equal(captured, 1); return { state: 'completed', order_id: row.id }
      }
      if (row.status === 'cancelled' && row.financial_authorization_status === 'released' && row.release_proven) {
        assert.equal(cancelled, 1); assert.equal(captured, 0); return { state: 'released', order_id: row.id }
      }
      return { state: 'pending', order_id: row.id }
    },
    configuredSuppliers: () => [{ name: 'muabanvia', productId: 'supplier-42' }],
    fulfillSupplierShortfall: async () => {
      paidCalls += 1
      if (mode === 'supplier-throws') throw new Error('journal write failed after paid send')
      if (mode === 'exhausted') return { outcome: 'exhausted' }
      if (mode === 'unknown') return { outcome: 'unknown' }
      return { outcome: 'succeeded', accountIds: ['local-account', 'supplier-account'] }
    },
  }
  vm.runInNewContext(code, context)
  const request = async (key = 'fixture-request-key') => {
    const response = await handler(new Request('https://local/functions/v1/process-purchase', {
      method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_group_id: productId, quantity: supplier ? 2 : 1,
        idempotency_key: key, expected_amount_ngn: supplier ? 200 : 100 }),
    }))
    return response.json()
  }
  return { request, paidCalls: () => paidCalls, authorizationCalls: () => authorizationCalls,
    blocked: () => blocked, cancelled: () => cancelled, captured: () => captured, proofCalls: () => proofCalls }
}

let f = fixture('success', { balance: 0 })
assert.equal((await f.request()).success, false)
assert.equal(f.paidCalls(), 0)
assert.equal(f.authorizationCalls(), 0)

f = fixture('success')
assert.equal((await f.request()).success, true)
assert.equal(f.paidCalls(), 1)
assert.equal(f.captured(), 1)

f = fixture('exhausted')
const exhausted = await f.request()
assert.equal(exhausted.success, false)
assert.equal(f.cancelled(), 1)
assert.equal(f.blocked(), 0)
assert.equal(f.captured(), 0)
assert.equal(f.proofCalls(), 1, 'definitive exhaustion uses owned release proof')

f = fixture('unknown')
const unknown = await f.request()
assert.equal(unknown.code, 'SUPPLIER_CONFIRMATION_PENDING')
assert.equal(unknown.order_id, 'supplier-order')
assert.equal(f.blocked(), 1)
assert.equal(f.captured(), 0)
assert.equal((await f.request('another-request-key')).success, false)
assert.equal(f.paidCalls(), 1)

f = fixture('supplier-throws')
const journalFailure = await f.request()
assert.equal(journalFailure.code, 'SUPPLIER_CONFIRMATION_PENDING')
assert.equal(journalFailure.order_id, 'supplier-order')
assert.equal(f.blocked(), 1)

f = fixture('completion-error')
assert.equal((await f.request()).code, 'SUPPLIER_CONFIRMATION_PENDING')
assert.equal(f.captured(), 1)
assert.equal(f.blocked(), 1)

f = fixture('committed-response-lost')
const completed = await f.request()
assert.equal(completed.success, true)
assert.equal(completed.order_id, 'supplier-order')
assert.equal(completed.accounts, undefined, 'catch must not deliver credentials from unverified response')
assert.equal(f.proofCalls(), 1)
assert.equal((await f.request()).idempotency_hit, true)
assert.equal(f.captured(), 1, 'completed replay cannot capture again')
assert.equal(f.paidCalls(), 1, 'completed replay cannot dispatch again')
assert.equal(f.proofCalls(), 2)

f = fixture('completion-error', { supplier: false })
assert.equal((await f.request()).code, 'PURCHASE_CONFIRMATION_PENDING')
assert.equal(f.blocked(), 0)

console.log('Purchase handler: low funds, supplier success/exhaustion/unknown, journal and completion failures, idempotent state checks passed.')
