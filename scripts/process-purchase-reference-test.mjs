import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { randomUUID, webcrypto } from 'node:crypto'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'

// Execute the actual entrypoint and actual read-only completion proof helper.
// Every DB operation is an isolated synthetic mock; no HTTP/provider calls.
const source = readFileSync('supabase/functions/process-purchase/index.ts', 'utf8').replace(/^import .*$/gm, '')
const transpile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const proofExports = {}
vm.runInNewContext(transpile(readFileSync('supabase/functions/_shared/customer-purchase-status.ts', 'utf8')),
  { exports: proofExports })
const user = '10000000-0000-4000-8000-000000000001'
const foreign = '10000000-0000-4000-8000-000000000002'
const product = '20000000-0000-4000-8000-000000000001'
const firstKey = `purchase_${user.slice(0, 8)}_${product.slice(0, 8)}_1_1791180000000_${randomUUID()}`
const secondKey = `purchase_${user.slice(0, 8)}_${product.slice(0, 8)}_1_1791180000001_${randomUUID()}`
assert.notEqual(firstKey, secondKey)
assert.equal(firstKey.slice(0, 24), secondKey.slice(0, 24), 'Fixture exercises the actual old prefix collision')

function fixture(codeSource = source) {
  let handler, requestUser, authorizations = 0, captures = 0, supplierCalls = 0, networkCalls = 0
  const orders = [], reservations = [], ledger = [], inventory = [], queryLog = [], captureArguments = []
  const balances = new Map([[user, 1000], [foreign, 1000]])
  const rowsFor = table => ({ orders, wallet_reservations: reservations, transactions: ledger,
    individual_accounts: inventory, supplier_purchase_attempts: [] })[table]
  const project = (row, select) => {
    if (row == null || select === '*') return row
    assert.equal(typeof select, 'string')
    return Object.fromEntries(select.split(',').map(s => s.trim()).filter(s => Object.hasOwn(row, s)).map(s => [s, row[s]]))
  }
  const db = {
    from(table) {
      const filters = [], q = { table, select: null, filters }
      const chain = {
        select(fields) { q.select = fields; return chain },
        eq(key, value) { filters.push([key, value]); return chain },
        in(key, value) { filters.push([key, value]); return chain },
        async insert() { assert.equal(table, 'revenue_events'); return { data: null, error: null } },
        async upsert() { assert.equal(table, 'revenue_events'); return { data: null, error: null } },
        async single() {
          queryLog.push(q)
          if (table === 'profiles') {
            assert.ok(filters.some(([k, v]) => k === 'id' && v === requestUser), 'Profile read is owned')
            return { data: { is_admin: false, is_staff: false, account_suspended: false, financial_security_version: 1 }, error: null }
          }
          assert.equal(table, 'product_groups')
          assert.ok(filters.some(([k, v]) => k === 'id' && v === product))
          return { data: { id: product, name: 'Synthetic product', price: 100, category_id: product,
            is_active: true, is_sellable: true, availability_status: 'AVAILABLE', categories: { name: 'Synthetic category' } }, error: null }
        },
        async maybeSingle() {
          queryLog.push(q)
          assert.ok(['orders', 'transactions', 'wallet_reservations'].includes(table))
          assert.ok(filters.some(([k, v]) => k === 'user_id' && v === requestUser), `${table} requires actual owned query filter`)
          const matches = rowsFor(table).filter(row => filters.every(([k, v]) => row[k] === v))
          assert.ok(matches.length <= 1)
          return { data: project(matches[0] ?? null, q.select), error: null }
        },
        then(resolve, reject) {
          queryLog.push(q)
          assert.ok(['individual_accounts', 'supplier_purchase_attempts'].includes(table))
          if (table === 'individual_accounts') {
            assert.ok(filters.some(([k, v]) => k === 'status' && v === 'reserved'))
            assert.ok(filters.some(([k, v]) => k === 'id' && Array.isArray(v)))
          } else assert.ok(filters.some(([k]) => k === 'order_id'))
          const matches = rowsFor(table).filter(row => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
          return Promise.resolve({ data: matches.map(row => project(row, q.select)), error: null }).then(resolve, reject)
        },
      }
      return chain
    },
    async rpc(name, args) {
      if (name === 'wallet_financial_truth_internal') {
        assert.equal(args.p_user_id, requestUser)
        const held = reservations.filter(r => r.user_id === requestUser && r.status === 'active').reduce((n, r) => n + r.amount, 0)
        return { data: { confirmed_spendable: balances.get(requestUser) - held, spending_blocked: false }, error: null }
      }
      if (name === 'get_tally_circle_purchase_status') {
        assert.equal(args.p_user_id, requestUser)
        return { data: { enabled: false, is_member: false, discount_percent: 0 }, error: null }
      }
      if (name === 'authorize_product_purchase') {
        authorizations++
        assert.equal(args.p_user_id, requestUser)
        assert.equal(args.p_product_group_id, product)
        assert.equal(args.p_quantity, 1)
        assert.equal(args.p_amount, 100)
        // Existing global request/reservation identity cannot be reassigned to
        // another customer, even when its owned read found no order.
        const existing = orders.find(o => o.idempotency_key === args.p_idempotency_key)
        if (existing?.user_id !== requestUser && existing) return { data: { success: false, code: 'IDEMPOTENCY_CONFLICT' }, error: null }
        assert.equal(existing, undefined)
        const order = { id: randomUUID(), user_id: requestUser, product_group_id: product, idempotency_key: args.p_idempotency_key,
          amount: 100, status: 'processing', wallet_reservation_id: randomUUID(), financial_authorization_status: 'funds_held',
          financial_security_version: 1, account_details: { quantity: 1 } }
        const account = { id: randomUUID(), product_group_id: product, status: 'reserved', username: 'SYNTHETIC_USER', password: 'SYNTHETIC_PASSWORD' }
        orders.push(order); inventory.push(account)
        reservations.push({ id: order.wallet_reservation_id, user_id: requestUser, order_table: 'orders', order_id: order.id,
          idempotency_key: `product:reservation:${args.p_idempotency_key}`, amount: 100, currency: 'NGN', status: 'active', metadata: {} })
        return { data: { success: true, order_id: order.id, reservation_id: order.wallet_reservation_id, account_ids: [account.id] }, error: null }
      }
      if (name === 'complete_product_purchase') {
        captures++; captureArguments.push(args)
        assert.equal(args.p_user_id, requestUser)
        const order = orders.find(o => o.id === args.p_order_id && o.user_id === requestUser)
        assert.ok(order)
        const reservation = reservations.find(r => r.id === args.p_reservation_id && r.order_id === order.id && r.user_id === requestUser)
        assert.ok(reservation); assert.equal(reservation.status, 'active')
        assert.equal(args.p_capture_idempotency_key, `purchase:${order.idempotency_key}`)
        const account = inventory.find(a => Array.from(args.p_account_ids).includes(a.id))
        assert.ok(account); assert.equal(account.status, 'reserved')
        if (ledger.some(t => t.reference === args.p_reference)) return { data: null,
          error: { code: '23505', message: 'duplicate key violates transactions_reference_key' } }
        const transaction = { id: randomUUID(), user_id: requestUser, type: 'purchase', status: 'completed', amount: -100,
          balance_type: 'wallet', idempotency_key: args.p_capture_idempotency_key, reference: args.p_reference,
          metadata: { source_order_table: 'orders', source_order_id: order.id, source_order_idempotency_key: order.idempotency_key,
            wallet_reservation_id: reservation.id, reservation_idempotency_key: reservation.idempotency_key } }
        // Atomic synthetic capture: reference uniqueness checked before all
        // changes; a collision retains the previously committed hold.
        ledger.push(transaction); balances.set(requestUser, balances.get(requestUser) - 100)
        reservation.status = 'captured'; reservation.captured_at = '2026-10-05T12:00:00Z'
        reservation.metadata = { capture_idempotency_key: args.p_capture_idempotency_key, capture_transaction_id: transaction.id }
        order.status = 'completed'; order.financial_authorization_status = 'captured'; order.account_details = args.p_account_details
        account.status = 'sold'
        return { data: { success: true, balance_after: balances.get(requestUser), account_details: args.p_account_details }, error: null }
      }
      assert.equal(name, 'refresh_supplier_product_availability')
      assert.equal(args.p_product_group_id, product)
      return { data: { success: true }, error: null }
    },
  }
  vm.runInNewContext(transpile(codeSource), { exports: {}, serve: fn => { handler = fn }, createClient: () => db,
    authenticateCustomerRequest: async req => {
      requestUser = { 'Bearer synthetic-owner': user, 'Bearer synthetic-other': foreign }[req.headers.get('Authorization')]
      if (!requestUser) throw Error('Unauthorized')
      return { id: requestUser }
    },
    getCustomerPurchaseStatus: proofExports.getCustomerPurchaseStatus,
    configuredSuppliers: () => [], fulfillSupplierShortfall: () => { supplierCalls++; throw Error('Unexpected paid provider call') },
    fetch: () => { networkCalls++; throw Error('Unexpected network call') }, ngnMinorUnits,
    Deno: { env: { get: () => undefined } }, Error, Request, Response, Headers, URL, TextEncoder,
    crypto: webcrypto, console: { log() {}, error() {} },
  })
  const request = async (key, identity = 'owner', extra = {}) => {
    const response = await handler(new Request('https://fixture.invalid/process-purchase', { method: 'POST',
      headers: { Authorization: `Bearer synthetic-${identity}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_group_id: product, quantity: 1, expected_amount_ngn: 100, idempotency_key: key, ...extra }) }))
    return { status: response.status, body: await response.json() }
  }
  return { request, orders, ledger, reservations, captureArguments, queryLog, balances,
    counts: () => ({ authorizations, captures, supplierCalls, networkCalls }) }
}

const f = fixture()
const first = await f.request(firstKey), second = await f.request(secondKey)
assert.equal(first.body.success, true); assert.equal(second.body.success, true)
assert.notEqual(first.body.order_id, second.body.order_id)
assert.equal(f.ledger.length, 2)
assert.equal(new Set(f.ledger.map(t => t.reference)).size, 2)
for (const args of f.captureArguments) assert.equal(args.p_reference, `PUR-${args.p_order_id}`)
assert.equal(f.balances.get(user), 800)
const beforeReplay = f.counts()
const replay = await f.request(firstKey)
assert.equal(replay.body.success, true); assert.equal(replay.body.idempotency_hit, true)
assert.equal(replay.body.order_id, first.body.order_id)
assert.deepEqual(f.counts(), beforeReplay)
assert.equal(f.ledger.length, 2)
assert.equal(replay.body.accounts, undefined)
assert.ok(f.queryLog.some(q => q.table === 'transactions' && q.select.includes('metadata')
  && q.filters.some(([k, v]) => k === 'user_id' && v === user)), 'Replay uses actual owned ledger proof helper')
const mutation = await f.request(firstKey, 'owner', { quantity: 2, expected_amount_ngn: 200 })
assert.equal(mutation.status, 409); assert.equal(mutation.body.code, 'IDEMPOTENCY_REQUEST_CONFLICT')
assert.deepEqual(f.counts(), beforeReplay)

const crossRead = await f.request(firstKey, 'other', { action: 'get_status', order_id: first.body.order_id })
assert.notEqual(crossRead.body.state, 'completed'); assert.equal(crossRead.body.order_id, undefined)
assert.deepEqual(f.counts(), beforeReplay)
const crossPurchase = await f.request(firstKey, 'other', { user_id: user })
assert.equal(crossPurchase.body.success, false)
assert.equal(crossPurchase.body.order_id, undefined)
assert.equal(crossPurchase.body.accounts, undefined)
assert.equal(f.counts().captures, beforeReplay.captures)
assert.equal(f.ledger.length, 2); assert.equal(f.balances.get(foreign), 1000)
assert.equal(f.counts().supplierCalls, 0); assert.equal(f.counts().networkCalls, 0)

// Regression sensitivity: execute the same actual handler with only the old
// expression reinstated in memory. The second purchase must fail exactly at
// reference uniqueness and retain its original hold, with one ledger debit.
const oldExpression = 'p_reference: `PUR-${idempotency_key.substring(0, 24)}`'
const fixedExpression = 'p_reference: `PUR-${orderId}`'
assert.equal(source.split(fixedExpression).length, 2)
const old = fixture(source.replace(fixedExpression, oldExpression))
assert.equal((await old.request(firstKey)).body.success, true)
const collision = await old.request(secondKey)
assert.equal(collision.body.success, false)
assert.equal(collision.body.code, 'PURCHASE_CONFIRMATION_PENDING')
assert.equal(old.ledger.length, 1)
assert.equal(old.reservations.filter(r => r.status === 'active').length, 1)
assert.equal(old.balances.get(user), 900)
assert.equal(old.counts().supplierCalls, 0); assert.equal(old.counts().networkCalls, 0)
console.log('Actual purchase handler: colliding request prefixes now yield distinct order references; completed replay proves owned capture without another authorization; mutation/foreign replay denied; old-expression sensitivity retains the failed hold. No provider/network calls.')
