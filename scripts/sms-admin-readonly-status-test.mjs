import assert from 'node:assert/strict'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { smsTestSource, actualSmsFunctions } from './sms-candidate-test-input.mjs'
const source = await smsTestSource('SMS_REPAIR_SMS_PREFIX', new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'smsbus')
const id = 'a71af6e5-fd7f-4c5f-8e11-f99581c9da44'
class DaisySmsError extends Error { constructor(code, message) { super(message); this.code = code } }
let groups = 0
function fixture(options = {}) {
  const calls = [], writes = [], profile = options.profile || { is_admin: true, account_suspended: false }
  const row = { id, order_type: 'otp', provider: 'smsbus', status: 'waiting', provider_request_id: 'saved-activation', messages: [], refunded_at: null, ...options.row }
  const admin = {
    from(table) {
      calls.push(['from', table])
      return { select(columns) { calls.push(['select', table, columns]); return {
        eq(key, value) { calls.push(['eq', table, key, value]); return this },
        async single() { return { data: table === 'profiles' ? profile : options.missing ? null : row, error: null } },
      } }, update() { writes.push('update'); throw new Error('Write forbidden') } }
    },
    rpc() { writes.push('rpc'); throw new Error('Financial RPC forbidden') },
  }
  const globals = { DaisySmsError, Error, Date,
    getDaisyKey: () => options.noKey ? '' : 'synthetic-key',
    daisyGetStatus: async (key, activation) => {
      calls.push(['getStatus', key, activation])
      if (options.failure) throw options.failure
      return options.status || { status: 'waiting' }
    },
    daisyCancelNumber() { writes.push('cancel'); throw new Error('Cancellation forbidden') },
    daisyMarkDone() { writes.push('done'); throw new Error('Provider mutation forbidden') },
    json: (body, status = 200) => ({ body, status }),
  }
  const text = transformSync(actualSmsFunctions(source, ['requireAdminUser', 'handleAdminCheckSmsOrder']), { loader: 'ts', format: 'cjs' }).code
  const { handleAdminCheckSmsOrder } = vm.runInNewContext(`${text}\n({handleAdminCheckSmsOrder})`, globals)
  return { admin, calls, writes, run: body => handleAdminCheckSmsOrder(admin, 'admin-fixture', body || { order_id: id }) }
}
for (const profile of [{ is_admin: false, is_staff: true }, { is_admin: false }, { is_admin: true, account_suspended: true }]) {
  const f = fixture({ profile })
  await assert.rejects(f.run(), /Admin access required/)
  assert.equal(f.calls.some(x => x[0] === 'getStatus' || x[1] === 'sms_orders'), false)
  assert.deepEqual(f.writes, [])
  groups++
}
for (const [status, expected] of [[{ status: 'waiting' }, 'waiting'], [{ status: 'cancelled' }, 'cancelled'], [{ status: 'ok', code: 'sensitive-code-123456' }, 'code_received']]) {
  const f = fixture({ status })
  const r = await f.run({ order_id: id, provider_request_id: 'attacker-activation', activation_id: 'attacker-activation' })
  assert.equal(r.body.success, true)
  assert.equal(r.body.data.provider_state, expected)
  assert.equal(r.body.data.read_only, true)
  assert.equal(f.calls.filter(x => x[0] === 'getStatus').length, 1)
  assert.equal(f.calls.find(x => x[0] === 'getStatus')[2], 'saved-activation')
  assert.doesNotMatch(JSON.stringify(r.body), /synthetic-key|saved-activation|attacker-activation|sensitive-code|123456/)
  assert.deepEqual(f.writes, [])
  groups++
}
for (const [options, expected] of [
  [{ row: { provider_request_id: null } }, 'not_recorded'],
  [{ noKey: true }, 'unavailable'],
  [{ row: { order_type: 'rental' } }, 'unavailable'],
  [{ row: { provider: 'other-provider' } }, 'unavailable'],
]) {
  const f = fixture(options), r = await f.run()
  assert.equal(r.body.data.provider_state, expected)
  assert.equal(f.calls.some(x => x[0] === 'getStatus'), false)
  assert.deepEqual(f.writes, [])
  groups++
}
for (const [failure, expected] of [[new DaisySmsError('NO_ACTIVATION', 'sensitive-provider-response'), 'not_found'], [new Error('sensitive-token-and-provider-body'), 'unavailable']]) {
  const f = fixture({ failure }), r = await f.run()
  assert.equal(r.body.data.provider_state, expected)
  assert.doesNotMatch(JSON.stringify(r.body), /sensitive/)
  if (expected === 'not_found') assert.match(r.body.data.note, /does not prove/)
  assert.deepEqual(f.writes, [])
  groups++
}
for (const body of [{ order_id: 'not-a-uuid' }, { order_id: id + '?other=1' }, { order_id: 123 }]) {
  const f = fixture()
  await assert.rejects(f.run(body), /order_id is required/)
  assert.equal(f.calls.some(x => x[1] === 'sms_orders' || x[0] === 'getStatus'), false)
  assert.deepEqual(f.writes, [])
  groups++
}
{
  const f = fixture({ missing: true })
  await assert.rejects(f.run(), /SMS order not found/)
  assert.equal(f.calls.some(x => x[0] === 'getStatus'), false)
  assert.deepEqual(f.writes, [])
  groups++
}
console.log(`Actual SMS admin read-only status handler: ${groups} synthetic scenario groups passed`)
