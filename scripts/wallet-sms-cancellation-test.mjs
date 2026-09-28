import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const sms = readFileSync(new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'utf8')
const staff = readFileSync(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8')
const customerUi = readFileSync(new URL('../src/pages/SmsNumbersPage.tsx', import.meta.url), 'utf8')
const adminUi = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const staffUi = readFileSync(new URL('../src/pages/StaffAdminPage.tsx', import.meta.url), 'utf8')

function load(source, start, end, names, context) {
  const begin = source.indexOf(start)
  const finish = source.indexOf(end, begin + start.length)
  assert.ok(begin >= 0 && finish > begin, `missing source section ${start}`)
  const code = transformSync(source.slice(begin, finish), { loader: 'ts', format: 'cjs' }).code
  return vm.runInNewContext(`${code}\n({ ${names.join(', ')} })`, context)
}

const staffCancel = load(staff, 'async function daisyCancelNumber(', 'async function updateProductGroupStock(', ['daisyCancelNumber'], {
  Deno: { env: { get: (name) => name === 'DAISYSMS_API_KEY' ? 'test-key' : '' } },
  DEFAULT_DAISY_BASE: 'https://provider.test/api',
  URL,
  fetch: async () => new Response('ACCESS_READY'),
}).daisyCancelNumber
await assert.rejects(staffCancel('123'), /did not confirm cancellation/)

const confirmedStaffCancel = load(staff, 'async function daisyCancelNumber(', 'async function updateProductGroupStock(', ['daisyCancelNumber'], {
  Deno: { env: { get: (name) => name === 'DAISYSMS_API_KEY' ? 'test-key' : '' } },
  DEFAULT_DAISY_BASE: 'https://provider.test/api',
  URL,
  fetch: async () => new Response('ACCESS_CANCEL'),
}).daisyCancelNumber
await confirmedStaffCancel('123')

const noKeyStaffCancel = load(staff, 'async function daisyCancelNumber(', 'async function updateProductGroupStock(', ['daisyCancelNumber'], {
  Deno: { env: { get: () => '' } },
  DEFAULT_DAISY_BASE: 'https://provider.test/api',
  URL,
  fetch: () => { throw new Error('provider call forbidden') },
}).daisyCancelNumber
await assert.rejects(noKeyStaffCancel('123'), /requires provider credentials/)

const order = { id: 'order-1', user_id: 'owner-1', reference: 'SMS-1', status: 'active', provider_request_id: '123', price_ngn: 500 }
const { adminSmsOrderSummary } = load(sms, 'function publicSmsOrder(', 'function smsOtpOrdersEnabled(', ['publicSmsOrder', 'adminSmsOrderSummary'], {})
const staffSummary = adminSmsOrderSummary({
  ...order,
  messages: [{ code: '123456', content: 'private OTP' }],
  provider_payload: { provider_secret: 'internal' },
})
assert.equal(staffSummary.id, order.id)
assert.equal(staffSummary.price_ngn, order.price_ngn)
assert.equal(staffSummary.has_code, true, 'staff needs a code-present flag without seeing the code')
assert.ok(!Object.hasOwn(staffSummary, 'messages'), 'staff order summary must not include customer OTP codes')
assert.ok(!Object.hasOwn(staffSummary, 'provider_payload'), 'staff order summary must not include provider payload')
const { handleAdminSmsOrders } = load(sms, 'async function handleAdminSmsOrders(', '// ── Admin: cancel any SMS', ['handleAdminSmsOrders'], {
  requireStaffPermission: async () => {},
  adminSmsOrderSummary,
  json: (body) => body,
})
const listResult = await handleAdminSmsOrders({
  from(table) {
    if (table === 'sms_orders') return {
      select: () => ({ order: () => ({ limit: async () => ({ data: [{
        ...order,
        messages: [{ code: '123456' }],
        provider_payload: { provider_secret: 'internal' },
      }], error: null }) }) }),
    }
    if (table === 'profiles') return {
      select: () => ({ in: async () => ({ data: [{ id: order.user_id, email: 'customer@example.test', is_staff: false, is_admin: false }] }) }),
    }
    throw new Error(`unexpected table ${table}`)
  },
}, 'staff-1')
assert.equal(listResult.data.length, 1)
assert.equal(listResult.data[0].has_code, true)
assert.ok(!Object.hasOwn(listResult.data[0], 'messages'), 'SMS staff listing exposed OTP messages')
assert.ok(!Object.hasOwn(listResult.data[0], 'provider_payload'), 'SMS staff listing exposed provider payload')
let refundCalls = 0
let revenueCalls = 0

function makeAdmin(cancelled) {
  return {
    from(table) {
      assert.equal(table, 'sms_orders')
      return {
        update(values) {
          assert.equal(values.status, 'cancelled')
          return {
            eq() { return this },
            in() { return this },
            is() { return this },
            select() { return this },
            async maybeSingle() { return { data: cancelled ? { ...order, status: 'cancelled' } : null, error: null } },
          }
        },
        select() {
          return {
            eq() { return this },
            async single() { return { data: { ...order, status: 'cancelled' }, error: null } },
          }
        },
      }
    },
  }
}

const cancelAndRefund = load(sms, 'async function cancelSmsOrderAndRefund(', '// ── Action handlers', ['cancelSmsOrderAndRefund'], {
  recordRevenueEvent: async () => { revenueCalls++ },
  refundWallet: async () => { refundCalls++ },
}).cancelSmsOrderAndRefund
await assert.rejects(
  cancelAndRefund(makeAdmin(true), { ...order, messages: [{ code: '123456' }] }, 'provider_cancelled', 'refund'),
  /code already received/,
)
assert.equal(refundCalls, 0)
await assert.rejects(cancelAndRefund(makeAdmin(false), order, 'provider_cancelled', 'refund'), /changed during cancellation/)
assert.equal(refundCalls, 0)
assert.equal(revenueCalls, 0)
await cancelAndRefund(makeAdmin(true), order, 'provider_cancelled', 'refund')
assert.equal(refundCalls, 1)
assert.equal(revenueCalls, 1)

let adminRefundCalls = 0
function adminHandler(providerConfirmed) {
  return load(sms, 'async function handleAdminCancelSmsOrder(', '// ── Admin: auto-cancel', ['handleAdminCancelSmsOrder'], {
    requireStaffPermission: async () => {},
    TERMINAL_STATUSES: ['completed', 'cancelled', 'expired', 'failed'],
    getDaisyKey: () => 'test-key',
    daisyCancelNumber: async () => ({ cancelled: providerConfirmed, response: providerConfirmed ? 'ACCESS_CANCEL' : 'ACCESS_READY' }),
    cancelSmsOrderAndRefund: async () => { adminRefundCalls++; return { ...order, status: 'cancelled' } },
    adminSmsOrderSummary,
    json: (body, status = 200) => ({ body, status }),
  }).handleAdminCancelSmsOrder
}
const admin = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: order, error: null }) }) }) }) }
const held = await adminHandler(false)(admin, 'admin-1', { order_id: order.id })
assert.equal(held.status, 202)
assert.equal(held.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
assert.equal(adminRefundCalls, 0)
const cancelled = await adminHandler(true)(admin, 'admin-1', { order_id: order.id })
assert.equal(cancelled.status, 200)
assert.equal(adminRefundCalls, 1)

assert.ok(!sms.includes("reason: 'sync_no_activation'"), 'NO_ACTIVATION must not trigger a sync refund')
assert.ok(!sms.includes("reason: 'check_status_no_activation'"), 'NO_ACTIVATION must not trigger a customer refund')
assert.ok(sms.includes(".is('refunded_at', null).select('id').maybeSingle()"), 'SMS webhook must conditionally reject late completion')
assert.ok(sms.includes('const safeToRefund =') || sms.includes('let safeToRefund ='), 'unknown allocation must have an explicit refund decision')
assert.ok(sms.includes("if (!safeToRefund) {\n      return json({ success: false, code: 'SMS_OUTCOME_REVIEW_REQUIRED'"), 'unknown allocation must return review rather than a definite failure')
assert.ok(sms.includes('...adminSmsOrderSummary(o)'), 'staff order list must use the redacted summary')
assert.ok(sms.includes('data: adminSmsOrderSummary(cancelled)'), 'staff cancellation result must use the redacted summary')
for (const [name, source] of [['customer', customerUi], ['admin', adminUi], ['staff', staffUi]]) {
  assert.ok(!source.includes('Cancel & Refund'), `${name} UI must not promise a refund before provider confirmation`)
  assert.ok(source.includes('SMS_OUTCOME_REVIEW_REQUIRED'), `${name} UI must explain unknown SMS outcomes`)
}
assert.ok(customerUi.includes('Refund under review'), 'customer history must not promise an automatic refund')
assert.ok(adminUi.includes('Refund review') && staffUi.includes('Refund review'), 'operators must see unrefunded cancelled orders')
assert.ok(adminUi.includes('const hasCode = order.has_code') && staffUi.includes('const hasCode = order.has_code'), 'operator stale indicators must use redacted code-presence evidence')
assert.ok(adminUi.includes('data?.data?.refunded_at ?') && staffUi.includes('data?.data?.refunded_at ?'), 'operator success text must use actual refund evidence')

console.log('SMS cancellation confirmation and stale-transition tests passed')
