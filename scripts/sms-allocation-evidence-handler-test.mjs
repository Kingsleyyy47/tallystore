// Actual allocation transport/parser/handler with synthetic HTTP and database
// adapters only. No project, supplier, customer wallet or credential is used.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { smsTestSource, actualSmsFunctions } from './sms-candidate-test-input.mjs'

const source = await smsTestSource('SMS_REPAIR_SMS_PREFIX', new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'smsbus')
const names = ['daisyRequest', 'daisyGetNumber', 'handleCreateOtp', 'publicSmsOrder', 'friendlyError']
const code = transformSync(actualSmsFunctions(source, names), { loader: 'ts', format: 'cjs' }).code
const key = 'synthetic-secret-never-expose'
const customer = 'synthetic-customer'
const service = 'synthetic-service'
class DaisySmsError extends Error { constructor(code, message) { super(message); this.code = code } }
let groups = 0

function fixture(options = {}) {
  const state = { rows: structuredClone(options.rows || []), transactions: [], trace: [], logs: [], debits: 0, paid: 0, refunds: 0, cancellations: 0, guardQueries: 0 }
  const fresh = value => structuredClone(value)
  const admin = {
    from(table) {
      assert.ok(['sms_orders', 'transactions'].includes(table))
      const predicates = []
      let selected = '*', update, inserted, unknownFilter = false
      const rows = () => table === 'sms_orders' ? state.rows : state.transactions
      const matching = () => rows().filter(row => predicates.every(predicate => predicate(row)))
      const query = {
        select(value = '*') { selected = value; return this },
        eq(field, value) { predicates.push(row => row[field] === value); return this },
        is(field, value) { predicates.push(row => (row[field] ?? null) === value); return this },
        in(field, values) { predicates.push(row => values.includes(row[field])); return this },
        or(value) {
          assert.equal(table, 'sms_orders'); unknownFilter = true; state.guardQueries++
          const errors = value.match(/error_code\.in\.\(([^)]+)\)/)?.[1].split(',')
          assert.ok(errors)
          predicates.push(row => row.provider_request_id == null || errors.includes(row.error_code))
          return this
        },
        order() { return this },
        insert(values) { inserted = values; return this },
        update(values) { update = values; return this },
        async limit(n) {
          assert.equal(unknownFilter, true, 'unexpected unbounded fixture query')
          if (options.guardError) return { data: null, error: { code: 'SYNTHETIC_READ_FAILURE' } }
          return { data: matching().slice(0, n).map(row => selected === 'id,reference' ? { id: row.id, reference: row.reference } : fresh(row)), error: null }
        },
        async maybeSingle() { return this.single() },
        async single() {
          if (inserted) {
            assert.equal(table, 'sms_orders'); assert.equal(state.debits, 1)
            state.trace.push('insert-order')
            const row = { id: `fixture-${state.rows.length + 1}`, messages: [], provider_request_id: null, refunded_at: null, last_provider_response: {}, ...fresh(inserted) }
            state.rows.push(row)
            return { data: fresh(row), error: null }
          }
          const row = matching()[0]
          if (!update) return { data: row ? fresh(row) : null, error: null }
          assert.ok(row, 'update must target an existing owned order')
          const savingReply = !!update.last_provider_response?.allocation_reply && !update.last_provider_response?.allocation_failure
          state.trace.push(savingReply ? 'save-private-reply' : update.error_code ? 'save-allocation-failure' : 'activate-order')
          if (savingReply && options.captureFailure) return { data: null, error: { code: 'SYNTHETIC_CAPTURE_FAILURE' } }
          Object.assign(row, fresh(update))
          return { data: fresh(row), error: null }
        },
      }
      return query
    },
    async rpc() { state.refunds++; throw new Error('Unknown allocations must not be refunded by this handler') },
  }
  const globals = {
    URL, Headers, Response, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, DaisySmsError,
    DEFAULT_DAISY_BASE: 'https://supplier.fixture.invalid/handler_api.php',
    Deno: { env: { get: () => undefined } },
    fetch: async url => {
      const request = new URL(url)
      assert.equal(request.origin, 'https://supplier.fixture.invalid')
      assert.equal(request.searchParams.get('action'), 'getNumber')
      state.paid++; state.trace.push('paid-send')
      if (options.transportFailure) throw new DaisySmsError('TIMEOUT', 'Synthetic timeout')
      return new Response(options.reply ?? 'ACCESS_NUMBER:fixture-activation:+15551234567', {
        status: options.httpStatus || 200,
        headers: { 'x-price': options.priceHeader ?? '0.40', 'x-unrelated-secret': 'never-retain-this-header', ...(options.headers || {}) },
      })
    },
    console: { error: (...values) => state.logs.push(values), warn: (...values) => state.logs.push(values) },
    getDaisyKey: () => key,
    assertPurchasingCustomer: async () => {},
    sanitizeRevenueRequestContext: () => null,
    getWalletRequestForensics: async () => ({}),
    buildSmsCatalog: async () => ({ products: [{ service_code: service, service_name: 'Synthetic SMS', is_enabled: true,
      available_count: 20, price_ngn: 1000, provider_cost_usd: 0.40 }], exchangeRate: 1000, globalMarginNgn: 600,
      roundAutoPricesToNearestTen: true }),
    recordRevenueEvent: async () => {},
    generateReference: () => 'SMS-SYNTHETIC-NEW',
    DAISY_COUNTRY: 187,
    debitWallet: async (_admin, userId, amount, reference, _description, idempotencyKey) => {
      state.debits++; state.trace.push('wallet-debit')
      state.transactions.push({ user_id: userId, amount: -amount, reference, idempotency_key: idempotencyKey })
      return { prev: 5000, next: 4000 }
    },
    priceSmsService: () => ({ providerCostNgn: 400, pricingMode: 'owner_markup' }),
    daisyCancelNumber: async () => { state.cancellations++; throw new Error('No cancellation is allowed without a parsed allocation') },
    refundWallet: async () => { state.refunds++; throw new Error('Unknown allocation refund forbidden') },
    json: (body, status = 200) => ({ body, status }),
  }
  const actual = vm.runInNewContext(`${code}\n({ handleCreateOtp })`, globals)
  return {
    state,
    invoke: (changes = {}, userId = customer) => actual.handleCreateOtp(admin, userId, {
      service_id: service, expected_price_ngn: 1000, idempotency_key: 'synthetic-key-one', ...changes,
    }, new Request('https://store.fixture.invalid/sms')),
  }
}
const unknown = changes => ({ id: 'earlier-unknown', reference: 'SMS-EARLIER-UNKNOWN', user_id: customer,
  service_id: service, order_type: 'otp', status: 'processing', provider_request_id: null,
  price_ngn: 1000, messages: [], error_code: 'PARSE_ERROR', refunded_at: null,
  idempotency_key: 'earlier-synthetic-key', ...changes })
function privateReply(f) { return f.state.rows.at(-1).last_provider_response?.allocation_reply }
function assertPrivate(result, f) {
  const exposed = JSON.stringify({ result, logs: f.state.logs })
  for (const secret of [key, 'UNFAMILIAR_PRIVATE_REPLY', 'never-retain-this-header', 'supplier.fixture.invalid']) assert.ok(!exposed.includes(secret), `private material leaked: ${secret}`)
  assert.ok(!exposed.includes('allocation_reply'))
}

{
  const f = fixture(); const result = await f.invoke()
  assert.equal(result.body.success, true); assert.equal(f.state.paid, 1); assert.equal(f.state.debits, 1)
  assert.equal(privateReply(f).body, 'ACCESS_NUMBER:fixture-activation:+15551234567')
  assert.equal(privateReply(f).http_status, 200); assert.equal(privateReply(f).price_header, '0.40')
  assert.equal(privateReply(f).body_complete, true)
  assert.deepEqual(f.state.trace, ['wallet-debit', 'insert-order', 'paid-send', 'save-private-reply', 'activate-order'])
  assertPrivate(result, f); groups++
}
{
  const f = fixture({ reply: `UNFAMILIAR_PRIVATE_REPLY key=${key}` }); const result = await f.invoke()
  assert.equal(result.status, 202); assert.equal(result.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
  assert.equal(f.state.rows[0].error_code, 'PARSE_ERROR'); assert.equal(f.state.rows[0].provider_request_id, null)
  assert.equal(privateReply(f).body, 'UNFAMILIAR_PRIVATE_REPLY key=[redacted-api-key]')
  assert.deepEqual([f.state.debits, f.state.paid, f.state.refunds, f.state.cancellations], [1, 1, 0, 0])
  assertPrivate(result, f)
  const guardQueries = f.state.guardQueries
  const replay = await f.invoke()
  assert.equal(replay.status, 202); assert.equal(f.state.guardQueries, guardQueries, 'existing-key response must precede the new-key guard')
  const another = await f.invoke({ idempotency_key: 'synthetic-key-two' })
  assert.equal(another.status, 409); assert.equal(another.body.code, 'SMS_PREVIOUS_ALLOCATION_REVIEW_REQUIRED')
  assert.deepEqual([f.state.debits, f.state.paid], [1, 1]); assertPrivate(another, f); groups++
}
for (const earlier of [unknown({}), unknown({ provider_request_id: 'known-activation', error_code: 'SMS_OUTCOME_REVIEW_REQUIRED' })]) {
  const f = fixture({ rows: [earlier] }); const result = await f.invoke()
  assert.equal(result.status, 409); assert.equal(result.body.order_id, earlier.id)
  assert.deepEqual([f.state.debits, f.state.paid, f.state.refunds], [0, 0, 0]); groups++
}
for (const earlier of [unknown({ user_id: 'another-customer' }), unknown({ service_id: 'another-service' }),
  unknown({ status: 'cancelled', refunded_at: '2026-10-25T00:00:00Z' }),
  unknown({ status: 'waiting', provider_request_id: 'healthy-activation', error_code: null })]) {
  const f = fixture({ rows: [earlier] }); const result = await f.invoke()
  assert.equal(result.body.success, true); assert.equal(f.state.debits, 1); assert.equal(f.state.paid, 1); groups++
}
{
  const f = fixture(); await f.invoke(); const before = f.state.guardQueries
  const replay = await f.invoke()
  assert.equal(replay.body.idempotency_hit, true); assert.equal(f.state.guardQueries, before)
  assert.deepEqual([f.state.debits, f.state.paid], [1, 1]); groups++
}
{
  const f = fixture({ guardError: true })
  await assert.rejects(f.invoke(), /Could not verify previous SMS purchase outcomes/)
  assert.deepEqual([f.state.debits, f.state.paid], [0, 0]); groups++
}
{
  const f = fixture({ captureFailure: true }); const result = await f.invoke()
  assert.equal(result.status, 202); assert.equal(result.body.code, 'SMS_OUTCOME_REVIEW_REQUIRED')
  assert.equal(f.state.rows[0].provider_request_id, null, 'parser must not produce an allocation before evidence is durable')
  assert.equal(privateReply(f).body, 'ACCESS_NUMBER:fixture-activation:+15551234567', 'failure persistence must retain the observed reply')
  assert.deepEqual([f.state.paid, f.state.refunds, f.state.cancellations], [1, 0, 0])
  assert.ok(!f.state.trace.includes('activate-order')); assertPrivate(result, f); groups++
}
for (const httpStatus of [500, 429]) {
  const f = fixture({ httpStatus, reply: 'UNFAMILIAR_PRIVATE_REPLY' }); const result = await f.invoke()
  assert.equal(result.status, 202); assert.equal(privateReply(f).http_status, httpStatus)
  assert.equal(privateReply(f).body_complete, httpStatus !== 429)
  assert.equal(privateReply(f).body, httpStatus === 429 ? '' : 'UNFAMILIAR_PRIVATE_REPLY')
  assert.deepEqual([f.state.paid, f.state.refunds, f.state.cancellations], [1, 0, 0]); assertPrivate(result, f); groups++
}
{
  const f = fixture({ transportFailure: true }); const result = await f.invoke()
  assert.equal(result.status, 202); assert.equal(f.state.rows[0].error_code, 'TIMEOUT')
  assert.equal(privateReply(f), undefined); assert.deepEqual([f.state.paid, f.state.refunds], [1, 0]); groups++
}
{
  const f = fixture({ headers: { 'content-length': '262145' }, reply: 'UNFAMILIAR_PRIVATE_REPLY' }); const result = await f.invoke()
  assert.equal(result.status, 202); assert.equal(f.state.rows[0].error_code, 'INVALID_RESPONSE')
  assert.equal(privateReply(f).http_status, 200); assert.equal(privateReply(f).body_complete, false); assert.equal(privateReply(f).body, '')
  assert.deepEqual([f.state.paid, f.state.refunds], [1, 0]); assertPrivate(result, f); groups++
}

console.log(`Actual SMS allocation evidence/customer guard: ${groups} synthetic scenario groups passed`)
