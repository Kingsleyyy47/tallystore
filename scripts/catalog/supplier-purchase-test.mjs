import assert from 'node:assert/strict'
import { configuredSuppliers, normalizeSupplierOutcome, fulfillSupplierShortfall } from '../../supabase/functions/_shared/supplier-purchase.mjs'

const product = { id: 'product', auto_fulfill_enabled: true, muabanvia_product_id: '1', shopclone_product_id: '2' }
const env = { MUABANVIA_API_KEY: 'test-key-a', SHOPCLONE_API_KEY: 'test-key-b' }
const suppliers = configuredSuppliers(product, name => env[name])
assert.equal(suppliers.length, 2)
assert.equal(configuredSuppliers(product, name => name === 'MUABANVIA_BASE_URL' ? 'https://attacker.invalid/api' : env[name]).length, 1)
assert.equal(configuredSuppliers({ ...product, auto_fulfill_enabled: false }, name => env[name]).length, 0)
const success = { status: 'success', trans_id: 'fixture-ref', data: ['fixture-user|fixture-password'] }
assert.equal(normalizeSupplierOutcome(success, 200, 1).outcome, 'succeeded')
for (const raw of [null, {}, { status: 'error', msg: 'Unknown failure' }, { status: 'success', data: success.data }, { ...success, data: [] }, { ...success, data: ['fixture-user|'] }, { status: 'error', msg: 'Insufficient balance but order may be processing' }, { status: 'error', code: 'NO_STOCK', data: success.data }]) {
  assert.equal(normalizeSupplierOutcome(raw, 200, 1).outcome, 'unknown')
}
assert.equal(normalizeSupplierOutcome(success, 504, 1).outcome, 'unknown')
assert.equal(normalizeSupplierOutcome({ status: 'error', code: 'NO_STOCK' }, 200, 1).reason, 'no_stock')
assert.equal(normalizeSupplierOutcome({ status: 'error', msg: 'Insufficient balance' }, 200, 1).reason, 'insufficient_balance')
assert.equal(normalizeSupplierOutcome({ ...success, data: [...success.data, ...success.data] }, 200, 2).outcome, 'unknown')

function fixture(overrides = {}) {
  let sends = 0
  const calls = []
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args })
    const override = overrides[name]
    if (override) return override(args)
    return { data: { success: true, attempt_id: `attempt-${calls.length}`, send_allowed: true, account_ids: ['account'] }, error: null }
  } }
  const input = { orderId: 'order', reservationId: 'hold', quantity: 1, product, suppliers, idempotencyKey: 'request', allowPaidSend: overrides.allowPaidSend ?? true }
  const fetcher = async (...args) => {
    sends += 1
    if (overrides.fetch) return overrides.fetch(...args)
    return new Response(JSON.stringify(success))
  }
  return { run: () => fulfillSupplierShortfall(admin, input, fetcher), calls, sends: () => sends }
}

let f = fixture()
assert.equal((await f.run()).outcome, 'succeeded')
assert.equal(f.sends(), 1)
assert(f.calls.findIndex(call => call.name === 'mark_supplier_purchase_sending') < f.calls.findIndex(call => call.name === 'record_supplier_purchase_outcome'))
f = fixture({ fetch: async () => { throw new Error('timeout') } })
assert.equal((await f.run()).outcome, 'unknown')
assert.equal(f.sends(), 1, 'timeout must never buy from another provider')
assert.equal(f.calls.find(call => call.name === 'record_supplier_purchase_outcome').args.p_outcome, 'unknown')
f = fixture({ fetch: async () => new Response(JSON.stringify({ status: 'error', code: 'NO_STOCK' })) })
assert.equal((await f.run()).outcome, 'exhausted')
assert.equal(f.sends(), 6, 'at most three confirmed no-stock attempts per configured provider')
f = fixture({ fetch: async () => new Response(JSON.stringify({ status: 'error', msg: 'Insufficient balance' })) })
assert.equal((await f.run()).outcome, 'exhausted')
assert.equal(f.sends(), 2, 'low balance is not retried against the same provider')
assert.equal(f.calls.filter(call => call.name === 'record_supplier_balance_alert').length, 2)
assert(f.calls.filter(call => call.name === 'record_supplier_balance_alert').every(call => !JSON.stringify(call).includes('test-key')))
f = fixture({ mark_supplier_purchase_sending: async () => ({ data: { success: true, send_allowed: false } }) })
assert.equal((await f.run()).outcome, 'unknown')
assert.equal(f.sends(), 0, 'a concurrent claim cannot send')
f = fixture({ begin_supplier_purchase_attempt: async () => ({ data: { success: true, outcome: 'succeeded', attempt_id: 'prior' } }) })
assert.equal((await f.run()).outcome, 'succeeded')
assert.equal(f.sends(), 0, 'a completed supplier attempt settles without buying again')
f = fixture({ allowPaidSend: false })
assert.equal((await f.run()).outcome, 'unknown')
assert.equal(f.sends(), 0, 'disabling live fulfillment also stops a resumed prepared request')
f = fixture({ allowPaidSend: false, begin_supplier_purchase_attempt: async () => ({ data: { success: true, outcome: 'succeeded', attempt_id: 'prior' } }) })
assert.equal((await f.run()).outcome, 'succeeded')
assert.equal(f.sends(), 0, 'a paused supplier can still attach already purchased credentials')
f = fixture({ record_supplier_purchase_outcome: async () => ({ error: new Error('DB unavailable') }) })
await assert.rejects(f.run())
assert.equal(f.sends(), 1)
assert(!f.calls.some(call => call.name === 'attach_supplier_purchase_accounts'), 'failed persistence cannot deliver credentials')
console.log('Supplier purchase: confirmed retries, unknown isolation, replay settlement, claim exclusion and response validation passed.')
