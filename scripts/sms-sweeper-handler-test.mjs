// Local VM tests of the actual SMS sweep and early request authorization.
// All database and provider calls are synthetic; no Supabase or Daisy host is used.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { smsTestSource, actualSmsFunctions } from './sms-candidate-test-input.mjs'

const source = await smsTestSource('SMS_REPAIR_SMS_PREFIX', new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'smsbus')
let groups = 0
function actual(start, end, names, globals) {
  const code = transformSync(actualSmsFunctions(source, names), { loader: 'ts', format: 'cjs' }).code
  return vm.runInNewContext(`${code}\n({ ${names.join(', ')} })`, globals)
}
class DaisySmsError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
function row(id, changes = {}) {
  return { id, user_id: 'owner-fixture', reference: `SMS-${id}`, order_type: 'otp',
    status: 'processing', provider_request_id: `activation-${id}`, price_ngn: 300,
    messages: [], refunded_at: null, error_code: null, last_provider_response: {},
    created_at: '2026-10-18T00:00:00Z', ...changes }
}
function fixture(rows, options = {}) {
  const state = { rows: new Map(rows.map(x => [x.id, structuredClone(x)])), calls: [], query: [], refunds: 0, paid: 0 }
  const db = {
    from(table) {
      assert.equal(table, 'sms_orders')
      return {
        select() {
          const filters = []
          const field = (row, key) => key.split(/->>?/).reduce((value, part) => value?.[part], row) ?? null
          return {
            eq(key, value) { state.query.push(['eq', key, value]); this.id = key === 'id' ? value : this.id; filters.push(row => field(row, key) === value); return this },
            neq(key, value) { state.query.push(['neq', key, value]); filters.push(row => field(row, key) !== value); return this },
            in(key, values) { state.query.push(['in', key, Array.from(values)]); filters.push(row => values.includes(field(row, key))); return this },
            is(key, value) { state.query.push(['is', key, value]); filters.push(row => field(row, key) === value); return this },
            not(key, operator, value) { state.query.push(['not', key, operator, value]); assert.equal(operator, 'is'); filters.push(row => field(row, key) !== value); return this },
            lt(key, value) { state.query.push(['lt', key, value]); filters.push(row => field(row, key) < value); return this },
            order(key, value) { state.query.push(['order', key, value.ascending]); return this },
            async limit(n) { state.query.push(['limit', n]); return { data: [...state.rows.values()].filter(row => filters.every(filter => filter(row))).slice(0, n).map(row => structuredClone(row)), error: null } },
            async single() { return { data: structuredClone(state.rows.get(this.id)), error: null } },
          }
        },
        update(values) {
          const filters = {}
          return {
            eq(key, value) { filters[key] = value; return this },
            in() { return this }, is() { return this },
            then(resolve, reject) {
              state.calls.push(['update', structuredClone(values)])
              const current = state.rows.get(filters.id)
              assert.ok(current, 'updated unknown order')
              Object.assign(current, structuredClone(values))
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
        },
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'cancel_sms_order_and_refund')
      const current = state.rows.get(args.p_order_id)
      assert.equal(current.last_provider_response.sms_cancellation.response, args.p_evidence.response,
        'refund RPC was called before durable provider proof')
      state.calls.push(['atomic-rpc', args.p_evidence.response])
      state.refunds++
      Object.assign(current, { status: 'cancelled', refunded_at: '2026-10-18T01:00:00Z', refund_amount_ngn: 300, refund_reference: `refund-${current.id}` })
      return { data: { success: true, idempotent_replay: false }, error: null }
    },
  }
  const globals = {
    Date: options.clock || Date, DaisySmsError,
    getDaisyKey: () => options.noKey ? '' : 'synthetic-key',
    daisyGetStatus: async (_key, _id, timeoutMs) => {
      state.calls.push(['status', timeoutMs])
      assert.equal(timeoutMs, 3000, 'scheduled supplier reads must use the bounded read timeout')
      if (options.noActivation) throw new DaisySmsError('NO_ACTIVATION', 'synthetic')
      if (options.rateLimited) throw new DaisySmsError('RATE_LIMIT_EXCEEDED', 'synthetic')
      return { status: options.status || 'waiting' }
    },
    daisyCancelNumber: async () => { state.calls.push(['provider-cancel']); return { cancelled: options.cancelled !== false, response: 'ACCESS_CANCEL' } },
    daisyGetNumber: () => { state.paid++; throw new Error('paid number call forbidden') },
    reconcileOtpOrderStatus: async () => { state.calls.push(['complete']); return { status: 'completed' } },
    recordRevenueEvent: async () => {}, recordSmsRefundRevenueEvents: async () => {},
    json: (body, status = 200) => ({ body, status }),
  }
  Object.assign(globals, actual('async function cancelSmsOrderAndRefund(', '// ── Action handlers',
    ['cancelSmsOrderAndRefund', 'savedSmsCancellation'], globals))
  const { handleSweepStaleSms } = actual('async function handleSweepStaleSms(', '// ── DaisySMS webhook', ['handleSweepStaleSms'], globals)
  return { state, db, sweep: () => handleSweepStaleSms(db) }
}

// The service queue is bounded and selects only undelivered OTP orders with a
// real activation, no error, and age above three minutes.
{
  const f = fixture([row('one')])
  const result = await f.sweep()
  assert.equal(result.body.processed_count, 1)
  assert.equal(result.body.cancelled_count, 1)
  assert.equal(f.state.refunds, 1)
  assert.deepEqual(f.state.calls.map(x => x[0]), ['status', 'provider-cancel', 'update', 'atomic-rpc'])
  assert.ok(f.state.query.some(x => x[0] === 'eq' && x[1] === 'order_type' && x[2] === 'otp'))
  assert.ok(f.state.query.some(x => x[0] === 'in' && x[1] === 'status' && x[2].includes('processing')))
  assert.ok(f.state.query.some(x => x[0] === 'is' && x[1] === 'error_code' && x[2] === null))
  assert.ok(f.state.query.some(x => x[0] === 'is' && x[1] === 'refunded_at' && x[2] === null))
  assert.ok(f.state.query.some(x => x[0] === 'not' && x[1] === 'provider_request_id' && x[2] === 'is' && x[3] === null))
  assert.ok(f.state.query.some(x => x[0] === 'lt' && x[1] === 'created_at' && Date.parse(x[2]) <= Date.now() - 180000))
  assert.ok(f.state.query.some(x => x[0] === 'limit' && x[1] === 10))
  assert.equal(f.state.paid, 0)
  groups++
}
{
  const f = fixture([row('cancelled')], { status: 'cancelled' })
  const result = await f.sweep()
  assert.equal(result.body.cancelled_count, 1)
  assert.deepEqual(f.state.calls.map(x => x[0]), ['status', 'update', 'atomic-rpc'])
  assert.equal(f.state.calls[2][1], 'STATUS_CANCEL')
  groups++
}
{
  const f = fixture([row('ready')], { status: 'ok' })
  const result = await f.sweep()
  assert.equal(result.body.completed_count, 1)
  assert.equal(f.state.refunds, 0)
  assert.deepEqual(f.state.calls.map(x => x[0]), ['status', 'complete'])
  groups++
}
{
  const f = fixture([row('missing')], { noActivation: true })
  const result = await f.sweep()
  assert.equal(result.body.review_count, 1)
  assert.equal(f.state.refunds, 0)
  assert.equal(f.state.rows.get('missing').error_code, 'SMS_OUTCOME_REVIEW_REQUIRED')
  assert.deepEqual(f.state.calls.map(x => x[0]), ['status', 'update'])
  groups++
}
{
  const f = fixture([row('saved', { last_provider_response: { sms_cancellation: {
    provider: 'daisysms', activation_id: 'activation-saved', response: 'ACCESS_CANCEL',
  } } })])
  const result = await f.sweep()
  assert.equal(result.body.cancelled_count, 1)
  assert.equal(f.state.refunds, 1)
  assert.deepEqual(f.state.calls.map(x => x[0]), ['update', 'atomic-rpc'], 'saved proof must not repeat supplier requests')
  groups++
}
{
  const f = fixture([row('code', { messages: [{ code: '123456' }] })])
  const result = await f.sweep()
  assert.equal(result.body.review_count, 1)
  assert.deepEqual(f.state.calls, [])
  assert.equal(f.state.refunds, 0)
  groups++
}
{
  // The query is limited to ten and an elapsed eight seconds stops further work.
  let ticks = 0
  class DeadlineDate extends Date {
    static now() { return ++ticks <= 2 ? Date.parse('2026-10-24T00:00:00Z') : Date.parse('2026-10-24T00:00:08.001Z') }
  }
  const f = fixture(Array.from({ length: 12 }, (_, i) => row(`queued-${i}`)), { clock: DeadlineDate })
  const result = await f.sweep()
  assert.equal(result.body.processed_count, 0)
  assert.equal(f.state.refunds, 0)
  assert.deepEqual(f.state.calls, [])
  assert.ok(f.state.query.some(x => x[0] === 'limit' && x[1] === 10))
  groups++
}

const fixedNow = Date.parse('2026-10-24T00:00:00Z')
class FixedDate extends Date { static now() { return fixedNow } }
const createdAgo = milliseconds => new Date(fixedNow - milliseconds).toISOString()
// The server observes status before 30 minutes, but must not force cancellation
// of a waiting activation before the exact 30-minute boundary.
for (const ageMs of [3 * 60_000 + 1, 29 * 60_000 + 59_999, 30 * 60_000]) {
  const f = fixture([row(`boundary-${ageMs}`, { created_at: createdAgo(ageMs) })], { clock: FixedDate })
  const result = await f.sweep()
  assert.equal(result.body.processed_count, 1)
  assert.equal(f.state.calls.filter(call => call[0] === 'status').length, 1)
  assert.equal(f.state.calls.filter(call => call[0] === 'provider-cancel').length, ageMs >= 30 * 60_000 ? 1 : 0)
  assert.equal(f.state.refunds, ageMs >= 30 * 60_000 ? 1 : 0)
  groups++
}
for (const status of ['cancelled', 'ok']) {
  const f = fixture([row(`early-${status}`, { created_at: createdAgo(4 * 60_000) })], { clock: FixedDate, status })
  const result = await f.sweep()
  assert.equal(result.body.cancelled_count, status === 'cancelled' ? 1 : 0)
  assert.equal(result.body.completed_count, status === 'ok' ? 1 : 0)
  assert.equal(f.state.calls.filter(call => call[0] === 'provider-cancel').length, 0)
  groups++
}
// Durable acknowledgement recovery does not depend on the age, active status,
// provider key or absence of an error from the original failed refund.
{
  const f = fixture([row('recovery-error', {
    status: 'cancelled', error_code: 'REFUND_REVIEW_REQUIRED', created_at: createdAgo(60_000),
    last_provider_response: { sms_cancellation: { provider: 'daisysms', activation_id: 'activation-recovery-error', response: 'ACCESS_CANCEL' } },
  })], { clock: FixedDate, noKey: true })
  const result = await f.sweep()
  assert.equal(result.body.cancelled_count, 1)
  assert.equal(f.state.refunds, 1)
  assert.deepEqual(f.state.calls.map(call => call[0]), ['update', 'atomic-rpc'])
  groups++
}
{
  const f = fixture([
    row('unknown-allocation', { provider_request_id: null, error_code: 'PARSE_ERROR' }),
    row('old-review', { error_code: 'SMS_OUTCOME_REVIEW_REQUIRED' }),
    row('already-delivered', { status: 'completed', messages: [{ code: '123456' }] }),
  ], { clock: FixedDate })
  const result = await f.sweep()
  assert.equal(result.body.processed_count, 0)
  assert.deepEqual(f.state.calls, [])
  assert.equal(f.state.refunds, 0)
  groups++
}
{
  const f = fixture([row('throttle-one'), row('throttle-two')], { clock: FixedDate, rateLimited: true })
  const result = await f.sweep()
  assert.equal(result.body.failed_count, 1)
  assert.equal(result.body.processed_count, 1)
  assert.deepEqual(f.state.calls.map(call => call[0]), ['status'])
  assert.equal(f.state.refunds, 0)
  groups++
}
{
  const f = fixture([row('bad-proof', {
    created_at: createdAgo(60_000),
    last_provider_response: { sms_cancellation: { provider: 'daisysms', activation_id: 'different-activation', response: 'ACCESS_CANCEL' } },
  })], { clock: FixedDate })
  const result = await f.sweep()
  assert.equal(result.body.processed_count, 0)
  assert.deepEqual(f.state.calls, [])
  assert.equal(f.state.refunds, 0)
  groups++
}

// Evaluate the actual top-level dispatcher. Authorization must return before
// client construction, database reads, or provider calls for ordinary callers.
function registration() {
  let handler
  const state = { clients: 0, sweeps: 0, auth: 0 }
  const { constantTimeEquals } = actual('function constantTimeEquals(', 'function verifyDaisyWebhook(',
    ['constantTimeEquals'], { TextEncoder })
  const globals = {
    serve: callback => { handler = callback },
    URL, Response, Request,
    corsHeaders: {},
    Deno: { env: { get: name => ({
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-secret',
      PAYMENT_RECOVERY_CRON_SECRET: 'fixture-cron-secret',
      SUPABASE_URL: 'https://project.fixture.invalid',
    })[name] || '' } },
    constantTimeEquals,
    createClient: () => { state.clients++; return {} },
    handleSweepStaleSms: async () => { state.sweeps++; return new Response(JSON.stringify({ success: true })) },
    requireAuth: async () => { state.auth++; throw new Error('ordinary auth path reached') },
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
  }
  actual('serve(async (req) => {', null, [], globals)
  return { handler, state }
}
for (const headers of [{}, { Authorization: 'Bearer customer-jwt' }, { Authorization: 'Bearer wrong', 'x-cron-secret': 'wrong' }]) {
  const { handler, state } = registration()
  const response = await handler(new Request('https://edge.fixture.invalid/smsbus', {
    method: 'POST', headers, body: JSON.stringify({ action: 'sweep_stale_sms' }),
  }))
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error, 'Unauthorized')
  assert.deepEqual(state, { clients: 0, sweeps: 0, auth: 0 })
}
groups++
for (const headers of [{ Authorization: 'Bearer fixture-service-secret' }, { 'x-cron-secret': 'fixture-cron-secret' }]) {
  const { handler, state } = registration()
  const response = await handler(new Request('https://edge.fixture.invalid/smsbus', {
    method: 'POST', headers, body: JSON.stringify({ action: 'sweep_stale_sms' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(state, { clients: 1, sweeps: 1, auth: 0 })
}
groups++

assert.ok(!actualSmsFunctions(source, ['handleSweepStaleSms']).includes('daisyGetNumber('),
  'sweeper must not buy a provider number')
console.log(`Actual SMS sweeper/auth: ${groups} synthetic scenario groups passed`)
