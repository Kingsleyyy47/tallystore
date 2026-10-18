// Actual SMS handler functions with synthetic provider/DB responses only.
// No Supabase project, DaisySMS host, wallet endpoint, or paid call is reachable.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { smsTestSource, actualSmsFunctions } from './sms-candidate-test-input.mjs'

const sms = await smsTestSource('SMS_REPAIR_SMS_PREFIX', new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'smsbus')
const staff = await smsTestSource('SMS_REPAIR_STAFF_PREFIX', new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'manage-staff')
const own = (value) => structuredClone(value)
let checks = 0

function actual(source, start, end, exports, globals) {
  const compiled = transformSync(actualSmsFunctions(source, exports), { loader: 'ts', format: 'cjs' }).code
  return vm.runInNewContext(`${compiled}\n({ ${exports.join(', ')} })`, globals)
}

class DaisySmsError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const order = (id = 'order-1', overrides = {}) => ({
  id, user_id: 'customer-fixture', reference: `SMS-${id}`, order_type: 'otp',
  service_id: 'fixture-service', status: 'processing', provider_request_id: `activation-${id}`,
  phone_number: '+15550000001', messages: [], price_ngn: 300,
  last_provider_response: {}, refunded_at: null, ...overrides,
})
function database(initial, { rpcFailure = false } = {}) {
  const state = { order: own(initial), events: [], rpcFailure }
  const admin = {
    from(table) {
      assert.equal(table, 'sms_orders')
      return {
        select() {
          return {
            eq() { return this },
            async single() { return { data: own(state.order), error: null } },
          }
        },
        update(values) {
          const filters = {}
          return {
            eq(key, value) { filters[key] = value; return this },
            then(resolve, reject) {
              state.events.push(['save-proof', own(values)])
              assert.equal(filters.id, state.order.id)
              assert.equal(filters.provider_request_id, state.order.provider_request_id)
              state.order = { ...state.order, ...own(values) }
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
        },
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'cancel_sms_order_and_refund')
      state.events.push(['atomic-rpc', own(args), state.order.status])
      assert.ok(state.order.last_provider_response?.sms_cancellation, 'RPC ran before durable provider proof')
      if (state.rpcFailure) return { data: null, error: { code: 'FIXTURE_RPC_FAILURE' } }
      state.order.status = 'cancelled'
      state.order.refunded_at = '2026-10-18T00:00:00Z'
      state.order.refund_amount_ngn = state.order.price_ngn
      state.order.refund_reference = `REFUND-${state.order.reference}`
      return { data: { success: true, idempotent_replay: false }, error: null }
    },
  }
  return { admin, state }
}
function customerScenario(initial, controls = {}) {
  const { admin, state } = database(initial, controls)
  const calls = { status: 0, cancel: 0, oldWallet: 0, check: 0 }
  const globals = {
    DaisySmsError,
    TERMINAL_STATUSES: ['completed', 'cancelled', 'expired', 'failed'],
    getDaisyKey: () => 'synthetic-key',
    daisyGetStatus: async () => {
      calls.status++
      if (controls.noActivation) throw new DaisySmsError('NO_ACTIVATION', 'synthetic')
      return controls.status || { status: 'waiting' }
    },
    daisyCancelNumber: async () => { calls.cancel++; return { cancelled: true, response: 'ACCESS_CANCEL' } },
    refundWallet: () => { calls.oldWallet++; throw new Error('Legacy refund path invoked') },
    publicSmsOrder: own,
    recordRevenueEvent: async () => {},
    recordSmsRefundRevenueEvents: async () => {},
    handleCheckOtp: async () => { calls.check++; return { checked: true } },
    json: (body, status = 200) => ({ body, status }),
  }
  const { cancelSmsOrderAndRefund, savedSmsCancellation } = actual(
    sms, 'async function cancelSmsOrderAndRefund(', '// ── Action handlers',
    ['cancelSmsOrderAndRefund', 'savedSmsCancellation'], globals,
  )
  globals.cancelSmsOrderAndRefund = cancelSmsOrderAndRefund
  globals.savedSmsCancellation = savedSmsCancellation
  const { handleCancelOtp } = actual(
    sms, 'async function handleCancelOtp(', '// ── Admin: fetch all SMS',
    ['handleCancelOtp'], globals,
  )
  return { admin, state, calls, handleCancelOtp }
}

{
  const c = customerScenario(order())
  const result = await c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'order-1' })
  assert.equal(result.status, 200)
  assert.equal(c.state.order.status, 'cancelled')
  assert.ok(c.state.order.refunded_at)
  assert.deepEqual(c.state.events.map(e => e[0]), ['save-proof', 'atomic-rpc'])
  assert.equal(c.state.events[1][2], 'processing', 'Order status changed before atomic RPC')
  assert.equal(c.calls.cancel, 1)
  assert.equal(c.calls.oldWallet, 0)
  checks++
}
{
  const c = customerScenario(order(), { rpcFailure: true })
  await assert.rejects(c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'order-1' }), /review/)
  assert.equal(c.state.order.status, 'processing')
  assert.equal(c.state.order.refunded_at, null)
  assert.equal(c.state.order.last_provider_response.sms_cancellation.response, 'ACCESS_CANCEL')
  assert.equal(c.calls.oldWallet, 0)
  c.state.rpcFailure = false
  const recovered = await c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'order-1' })
  assert.equal(recovered.status, 200)
  assert.equal(c.calls.cancel, 1, 'Saved proof recovery repeated provider cancellation')
  assert.equal(c.calls.status, 1, 'Saved proof recovery repeated provider status')
  assert.equal(c.state.order.status, 'cancelled')
  checks++
}
{
  const c = customerScenario(order('missing', { provider_request_id: null, phone_number: null }))
  const held = await c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'missing' })
  assert.equal(held.status, 202)
  assert.equal(held.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
  assert.equal(c.calls.status + c.calls.cancel, 0)
  assert.deepEqual(c.state.events, [])
  checks++
}
{
  const c = customerScenario(order(), { noActivation: true })
  const held = await c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'order-1' })
  assert.equal(held.status, 202)
  assert.equal(held.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
  assert.equal(c.calls.cancel, 0)
  assert.deepEqual(c.state.events, [])
  checks++
}
{
  const c = customerScenario(order(), { status: { status: 'ok', code: '123456' } })
  const result = await c.handleCancelOtp(c.admin, 'customer-fixture', { order_id: 'order-1' })
  assert.equal(result.checked, true)
  assert.equal(c.calls.check, 1)
  assert.equal(c.calls.cancel, 0)
  assert.deepEqual(c.state.events, [])
  checks++
}

// Staff approval helper uses the same atomic RPC; a processing order is not
// filtered by a separate status allowlist before the provider proof is saved.
{
  const { admin, state } = database(order('staff'))
  let oldWallet = 0
  const globals = {
    recordSmsRefundRevenueEvents: async () => {},
    applyWalletTransaction: () => { oldWallet++; throw new Error('Legacy wallet path invoked') },
  }
  const { refundSmsOrderWallet } = actual(
    staff, 'async function refundSmsOrderWallet(', 'async function applySmsPendingAction(',
    ['refundSmsOrderWallet'], globals,
  )
  const result = await refundSmsOrderWallet(admin, own(state.order), 'Synthetic staff refund', {}, 'ACCESS_CANCEL')
  assert.equal(result.refunded, true)
  assert.equal(state.events[1][2], 'processing')
  assert.equal(state.order.status, 'cancelled')
  assert.equal(oldWallet, 0)
  checks++
}
{
  const { admin, state } = database(order('staff-route'))
  let providerCalls = 0
  let oldWallet = 0
  const { refundSmsOrderWallet } = actual(
    staff, 'async function refundSmsOrderWallet(', 'async function applySmsPendingAction(',
    ['refundSmsOrderWallet'], {
      recordSmsRefundRevenueEvents: async () => {},
      applyWalletTransaction: () => { oldWallet++; throw new Error('Legacy wallet path invoked') },
    },
  )
  const { applySmsPendingAction } = actual(
    staff, 'async function applySmsPendingAction(', 'const STAFF_ACTIONS_BY_PERMISSION:',
    ['applySmsPendingAction'], {
      daisyCancelNumber: async () => { providerCalls++; return 'ACCESS_CANCEL' },
      refundSmsOrderWallet,
    },
  )
  await applySmsPendingAction(admin, {
    action_type: 'sms_cancel_order', action_data: { order_id: 'staff-route' },
    reviewed_by: 'synthetic-owner', staff_id: 'synthetic-staff', id: 'approval-1',
  })
  assert.equal(providerCalls, 1)
  assert.deepEqual(state.events.map(e => e[0]), ['save-proof', 'atomic-rpc'])
  assert.equal(state.events[1][2], 'processing', 'Staff route filtered processing before atomic RPC')
  assert.equal(state.order.status, 'cancelled')
  assert.equal(oldWallet, 0)
  checks++
}

// Test the actual bounded batch function with distinct confirmed/review/failed
// cases. Individual errors must not disappear into a false zero-cancelled claim.
{
  const rows = [
    order('batch-ok'), order('batch-missing', { provider_request_id: null }),
    order('batch-code'), order('batch-error'),
  ]
  const calls = []
  const globals = {
    requireStaffPermission: async () => {},
    getDaisyKey: () => 'synthetic-key',
    TERMINAL_STATUSES: ['completed', 'cancelled', 'expired', 'failed'],
    DaisySmsError,
    daisyGetStatus: async (_key, activationId) => {
      if (activationId.endsWith('code')) return { status: 'ok', code: '123456' }
      if (activationId.endsWith('error')) throw new Error('Synthetic status failure')
      return { status: 'waiting' }
    },
    daisyCancelNumber: async () => ({ cancelled: true, response: 'ACCESS_CANCEL' }),
    cancelSmsOrderAndRefund: async (_admin, row) => { calls.push(row.id) },
    json: (body, status = 200) => ({ body, status }),
  }
  const { handleAdminAutoCancelStale } = actual(
    sms, 'async function handleAdminAutoCancelStale(', '// ── Sync cancelled',
    ['handleAdminAutoCancelStale'], globals,
  )
  const admin = { from: () => ({
    select: () => ({
      not() { return this },
      async lt() { return { data: rows, error: null } },
    }),
  }) }
  const result = await handleAdminAutoCancelStale(admin, 'staff-fixture')
  assert.deepEqual([result.body.cancelled_count, result.body.review_count, result.body.failed_count], [1, 2, 1])
  assert.deepEqual(calls, ['batch-ok'])
  checks++
}

// Exercise the provider allocation parser itself, not a rewritten imitation.
{
  const outputs = [
    { text: 'ACCESS_NUMBER:4820:15551234567', headers: new Headers() },
    { text: 'ACCESS_NUMBER:req_ABC-9:+15551234567', headers: new Headers({ 'x-price': '0.44' }) },
    { text: 'BAD_SERVICE', headers: new Headers() },
  ]
  const globals = {
    daisyRequest: async (_key, params) => {
      assert.equal(params.action, 'getNumber')
      return outputs.shift()
    },
    DaisySmsError,
  }
  const { daisyGetNumber } = actual(sms, 'async function daisyGetNumber(', 'type DaisyStatus', ['daisyGetNumber'], globals)
  const numeric = await daisyGetNumber('synthetic-key', 'svc')
  assert.equal(numeric.activationId, '4820')
  assert.equal(numeric.phoneNumber, '15551234567')
  assert.equal(numeric.priceUsd, undefined, 'Missing price header became a fabricated cost')
  const opaque = await daisyGetNumber('synthetic-key', 'svc')
  assert.equal(opaque.activationId, 'req_ABC-9')
  assert.equal(opaque.phoneNumber, '15551234567')
  assert.equal(opaque.priceUsd, 0.44)
  await assert.rejects(daisyGetNumber('synthetic-key', 'svc'), error => error.code === 'BAD_SERVICE')
  checks++
}

console.log(`Actual SMS cancellation/allocation handlers: ${checks} synthetic scenario groups passed`)
