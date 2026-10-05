import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'

// This probe uses the source project's Management query API in read-only
// transactions. It never prints identifiers, account details, metadata values,
// SQL result rows, environment values, or HTTP response bodies.
const ref = 'dssvvswvqnxanyzfhixf'
const tokens = readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => line.startsWith('SUPABASE_ACCESS_TOKEN='))
  .map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''))
if (!tokens.length) throw new Error('Source Management credential unavailable')
let workingToken
async function query(sql) {
  const candidates = workingToken ? [workingToken] : tokens
  for (const token of candidates) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${sql}; COMMIT;` }),
      signal: AbortSignal.timeout(30000),
    })
    if (response.ok) { workingToken = token; return response.json() }
    if (response.status !== 401 && response.status !== 403) throw new Error(`Read-only query HTTP ${response.status}`)
  }
  throw new Error('Source Management credential rejected')
}

const source = readFileSync('supabase/functions/_shared/customer-purchase-status.ts', 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports })
const { getCustomerPurchaseStatus } = exports
const modern = `o.wallet_reservation_id IS NOT NULL AND starts_with(o.idempotency_key,'purchase_')`
const snapshotSql = `SELECT
  (SELECT count(*) FROM public.orders o WHERE ${modern}) AS modern_orders,
  (SELECT coalesce(sum(o.amount),0) FROM public.orders o WHERE ${modern}) AS modern_order_amount_ngn,
  (SELECT count(*) FROM public.wallet_reservations r WHERE starts_with(r.idempotency_key,'product:reservation:purchase_')) AS reservations,
  (SELECT coalesce(sum(r.amount),0) FROM public.wallet_reservations r WHERE starts_with(r.idempotency_key,'product:reservation:purchase_')) AS reservation_amount_ngn,
  (SELECT count(*) FROM public.transactions t WHERE starts_with(t.idempotency_key,'purchase:purchase_') AND t.type='purchase') AS purchase_debits,
  (SELECT coalesce(sum(t.amount),0) FROM public.transactions t WHERE starts_with(t.idempotency_key,'purchase:purchase_') AND t.type='purchase') AS purchase_debit_amount_ngn`
const before = (await query(snapshotSql))[0]
const allPurchaseStatusCounts = await query(`SELECT coalesce(o.status,'NULL') AS order_status,
  coalesce(o.financial_authorization_status,'NULL') AS authorization_status,
  count(*) AS orders, count(*) FILTER(WHERE o.wallet_reservation_id IS NOT NULL) AS linked_reservations
  FROM public.orders o WHERE starts_with(o.idempotency_key,'purchase_')
  GROUP BY o.status,o.financial_authorization_status ORDER BY 1,2`)
const count = Number(before.modern_orders)
if (!Number.isSafeInteger(count) || count < 0 || count > 5000) throw new Error('Modern order count outside bounded read-only probe')

const orders = await query(`SELECT o.id,o.user_id,o.product_group_id,o.idempotency_key,o.amount,o.status,
  jsonb_build_object('quantity',o.account_details->>'quantity') AS account_details,
  o.wallet_reservation_id,o.financial_authorization_status
  FROM public.orders o WHERE ${modern} ORDER BY o.created_at DESC LIMIT 5000`)
const reservations = await query(`SELECT r.id,r.user_id,r.order_table,r.order_id,r.idempotency_key,
  r.amount,r.currency,r.status,r.captured_at,r.released_at,
  jsonb_build_object('capture_idempotency_key',r.metadata->>'capture_idempotency_key',
    'capture_transaction_id',r.metadata->>'capture_transaction_id') AS metadata
  FROM public.wallet_reservations r JOIN public.orders o ON o.wallet_reservation_id=r.id
  WHERE ${modern}`)
const transactions = await query(`SELECT t.id,t.user_id,t.type,t.amount,t.status,t.balance_type,t.idempotency_key,
  jsonb_build_object('source_order_table',t.metadata->>'source_order_table',
    'source_order_id',t.metadata->>'source_order_id',
    'source_order_idempotency_key',t.metadata->>'source_order_idempotency_key',
    'wallet_reservation_id',t.metadata->>'wallet_reservation_id',
    'reservation_idempotency_key',t.metadata->>'reservation_idempotency_key') AS metadata
  FROM public.transactions t JOIN public.orders o ON t.user_id=o.user_id
    AND t.idempotency_key='purchase:'||o.idempotency_key
  WHERE ${modern}`)
const attempts = await query(`SELECT a.order_id,a.reservation_id,a.status
  FROM public.supplier_purchase_attempts a JOIN public.orders o ON a.order_id=o.id
  WHERE ${modern}`)
assert.equal(orders.length, count, 'bounded probe must classify every modern order')

const tables = { orders, wallet_reservations: reservations, transactions,
  supplier_purchase_attempts: attempts }
function admin() {
  return { from(table) {
    assert.ok(Object.hasOwn(tables, table))
    const filters = []
    const matching = () => tables[table].filter(row => filters.every(([column, value]) => row[column] === value))
    const builder = {
      select() { return builder },
      eq(column, value) { filters.push([column, value]); return builder },
      async maybeSingle() {
        const rows = matching()
        return rows.length > 1 ? { data: null, error: { code: 'DUPLICATE' } }
          : { data: rows[0] ?? null, error: null }
      },
      then(resolve, reject) { return Promise.resolve({ data: matching(), error: null }).then(resolve, reject) },
    }
    return builder
  } }
}
const db = admin()
const states = { completed: 0, released: 0, pending: 0, review_required: 0, unknown: 0 }
const statusPairs = {}
for (const order of orders) {
  const result = await getCustomerPurchaseStatus(db, order.user_id, order.idempotency_key,
    order.product_group_id, order.id)
  assert.ok(Object.hasOwn(states, result.state))
  states[result.state]++
  const pair = `${order.status}/${order.financial_authorization_status}`
  statusPairs[pair] ??= {}
  statusPairs[pair][result.state] = (statusPairs[pair][result.state] || 0) + 1
}
const after = (await query(snapshotSql))[0]
const unchanged = Object.keys(before).every(key => String(before[key]) === String(after[key]))
console.log(JSON.stringify({ project: ref, rowsProjected: { orders: orders.length,
  reservations: reservations.length, transactions: transactions.length, supplierAttempts: attempts.length },
  classifications: states, byOrderFinancialStatus: statusPairs, allPurchaseStatusCounts,
  financialAggregateComparison: { before, after, unchanged },
  note: 'No identifiers, credentials, raw metadata or row values emitted; all queries ran in read-only transactions.' }))
