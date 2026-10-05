import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/_shared/customer-purchase-status.ts', 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports })
const { getCustomerPurchaseStatus } = exports

const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000002'
const orderId = '30000000-0000-4000-8000-000000000003'
const reservationId = '40000000-0000-4000-8000-000000000004'
const transactionId = '50000000-0000-4000-8000-000000000005'
const key = 'purchase_original_request_123456'
const order = { id: orderId, user_id: userId, product_group_id: productId,
  idempotency_key: key, amount: '100.00', status: 'completed',
  financial_authorization_status: 'captured', wallet_reservation_id: reservationId,
  account_details: { quantity: 2, accounts: [{ password: 'PRIVATE_CREDENTIAL' }] } }
const reservation = { id: reservationId, user_id: userId, order_table: 'orders', order_id: orderId,
  idempotency_key: `product:reservation:${key}`, amount: '100.00', currency: 'NGN',
  status: 'captured', captured_at: '2026-10-05T12:00:00Z', released_at: null,
  metadata: { capture_idempotency_key: `purchase:${key}`, capture_transaction_id: transactionId } }
const ledger = { id: transactionId, user_id: userId, type: 'purchase', amount: '-100.00',
  status: 'completed', balance_type: 'wallet', idempotency_key: `purchase:${key}`,
  metadata: { source_order_table: 'orders', source_order_id: orderId,
    source_order_idempotency_key: key, wallet_reservation_id: reservationId,
    reservation_idempotency_key: `product:reservation:${key}` } }

function fixture({ orders = [order], wallet_reservations = [reservation],
  transactions = [ledger], supplier_purchase_attempts = [], failTable } = {}) {
  const reads = []
  const tables = { orders, wallet_reservations, transactions, supplier_purchase_attempts }
  const admin = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `unexpected table: ${table}`)
    reads.push(table)
    const filters = []
    const query = {
      select() { return query },
      eq(column, value) { filters.push([column, value]); return query },
      async maybeSingle() {
        if (failTable === table) return { data: null, error: { message: 'PRIVATE_DATABASE_ERROR' } }
        const rows = tables[table].filter(row => filters.every(([column, value]) => row[column] === value))
        return rows.length > 1 ? { data: null, error: { message: 'duplicate' } }
          : { data: rows[0] ?? null, error: null }
      },
      then(resolve, reject) {
        const result = failTable === table ? { data: null, error: { message: 'PRIVATE_DATABASE_ERROR' } }
          : { data: tables[table].filter(row => filters.every(([column, value]) => row[column] === value)), error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return query
  } }
  return { admin, reads }
}

async function check(options, expected, args = [userId, key, productId, orderId]) {
  const f = fixture(options)
  const result = await getCustomerPurchaseStatus(f.admin, ...args)
  assert.equal(result.state, expected)
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
  assert.equal(JSON.stringify(result).includes('metadata'), false)
  assert.equal(JSON.stringify(result).includes('password'), false)
  return { result, reads: f.reads }
}

let current = await check({}, 'completed')
assert.equal(current.result.order_id, orderId)
assert.equal(current.result.quantity, 2)
assert.equal(current.result.amount_ngn, 100)
assert.deepEqual([...current.reads].sort(), ['orders', 'supplier_purchase_attempts', 'transactions', 'wallet_reservations'])

await check({ orders: [], wallet_reservations: [], transactions: [] }, 'unknown')
await check({ orders: [], wallet_reservations: [], transactions: [ledger] }, 'review_required')
await check({ orders: [], wallet_reservations: [reservation], transactions: [] }, 'review_required')
await check({ failTable: 'orders' }, 'review_required')
await check({ failTable: 'wallet_reservations' }, 'review_required')
await check({ orders: [order] }, 'review_required', [userId, key, productId, '60000000-0000-4000-8000-000000000006'])
await check({ orders: [order] }, 'review_required', [userId, key, '60000000-0000-4000-8000-000000000006'])
await check({ orders: [order], transactions: [] }, 'review_required')
await check({ orders: [order], transactions: [{ ...ledger, amount: '-99.00' }] }, 'review_required')
await check({ orders: [order], transactions: [{ ...ledger, metadata: { ...ledger.metadata, source_order_id: 'wrong' } }] }, 'review_required')
await check({ orders: [order], wallet_reservations: [{ ...reservation, metadata: { ...reservation.metadata, capture_transaction_id: 'wrong' } }] }, 'review_required')
await check({ orders: [order], supplier_purchase_attempts: [{ order_id: orderId,
  reservation_id: reservationId, status: 'unknown' }] }, 'review_required')

const closed = { ...order, status: 'cancelled', financial_authorization_status: 'released' }
const released = { ...reservation, status: 'released', captured_at: null,
  released_at: '2026-10-05T12:00:00Z', metadata: {} }
current = await check({ orders: [closed], wallet_reservations: [released], transactions: [] }, 'released')
assert.equal(current.result.order_id, orderId)
await check({ orders: [closed], wallet_reservations: [released], transactions: [ledger] }, 'review_required')
await check({ orders: [closed], wallet_reservations: [{ ...released, status: 'active' }], transactions: [] }, 'review_required')
for (const state of ['prepared', 'sending', 'succeeded', 'unknown']) {
  await check({ orders: [closed], wallet_reservations: [released], transactions: [],
    supplier_purchase_attempts: [{ order_id: orderId, reservation_id: reservationId, status: state }] }, 'review_required')
}
await check({ orders: [closed], wallet_reservations: [released], transactions: [],
  supplier_purchase_attempts: [{ order_id: orderId, reservation_id: reservationId, status: 'rejected' }] }, 'released')

const pending = { ...order, status: 'processing', financial_authorization_status: 'outcome_unknown' }
await check({ orders: [pending], wallet_reservations: [{ ...reservation, status: 'active',
  captured_at: null, metadata: {} }], transactions: [], supplier_purchase_attempts: [{
    order_id: orderId, reservation_id: reservationId, status: 'sending',
  }] }, 'pending')

console.log('Customer purchase status: exact owned order, captured ledger, released reserve, unresolved supplier and absent-order safety passed')
