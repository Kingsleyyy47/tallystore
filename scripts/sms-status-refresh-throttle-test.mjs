// Actual handler/transport functions; all provider and database access synthetic.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import { smsTestSource, actualSmsFunctions } from './sms-candidate-test-input.mjs'
const source = await smsTestSource('SMS_REPAIR_SMS_PREFIX', new URL('../supabase/functions/smsbus/index.ts', import.meta.url), 'smsbus')
class DaisySmsError extends Error { constructor(code, message) { super(message); this.code = code } }
const terminal = ['completed', 'cancelled', 'expired', 'failed']
const row = (id, changes = {}) => ({ id, user_id: 'owned-customer', reference: `SMS-${id}`, order_type: 'otp', status: 'waiting', provider_request_id: `activation-${id}`, messages: [], refunded_at: null, ...changes })
let groups = 0
function actual(names, globals) {
  const code = transformSync(actualSmsFunctions(source, names), { loader: 'ts', format: 'cjs' }).code
  return vm.runInNewContext(`${code}\n({${names.join(',')}})`, globals)
}
function batchFixture(options = {}) {
  const calls = [], state = { clock: options.clock || 0, inFlight: 0, maximum: 0, refunds: 0, reads: 0 }
  class Clock extends Date { static now() { return state.clock } }
  const globals = { Date: Clock, DaisySmsError, TERMINAL_STATUSES: terminal,
    savedSmsCancellation: order => order.saved ? 'STATUS_CANCEL' : null,
    setTimeout: (callback, ms) => { state.clock += ms; queueMicrotask(callback); return 1 },
    reconcileOtpOrderStatus: async (_admin, _key, order, timeout) => {
      calls.push({ id: order.id, timeout, saved: !!order.saved })
      if (order.saved) { state.refunds++; return { ...order, status: 'cancelled', refunded_at: 'synthetic-confirmation' } }
      state.inFlight++; state.maximum = Math.max(state.maximum, state.inFlight); state.reads++
      await Promise.resolve()
      state.inFlight--
      if (options.throttle) throw new DaisySmsError('RATE_LIMIT_EXCEEDED', 'synthetic')
      state.clock += options.cost || 0
      return order
    },
    daisyGetStatus: async (_key, activation, timeout) => { calls.push({ activation, timeout }); state.reads++; if (options.throttle) throw new DaisySmsError('RATE_LIMIT_EXCEEDED', 'synthetic'); return options.status || { status: 'waiting' } },
    cancelSmsOrderAndRefund: async (_admin, order, proof) => { assert.equal(proof, 'STATUS_CANCEL'); state.refunds++; return { ...order, status: 'cancelled', refunded_at: 'synthetic-confirmation' } },
  }
  const { reconcileSmsOrdersBounded } = actual(['reconcileSmsOrdersBounded'], globals)
  return { calls, state, run: (orders, cancelOnly = false) => reconcileSmsOrdersBounded({}, 'synthetic-key', orders, cancelOnly) }
}
{
  const f = batchFixture(), rows = Array.from({ length: 35 }, (_, i) => row(String(i)))
  const r = await f.run(rows)
  assert.equal(r.checked, 10); assert.equal(f.state.maximum, 1)
  assert.equal(f.calls.length, 10); assert.equal(r.orders.length, 35)
  assert.ok(f.calls.every(x => x.timeout > 0 && x.timeout <= 3000))
  assert.deepEqual(r.orders.map(x => x.id), rows.map(x => x.id))
  assert.equal(f.state.refunds, 0); groups++
}
{
  const f = batchFixture({ throttle: true }), rows = [row('1'), row('2')]
  const r = await f.run(rows)
  assert.equal(r.checked, 1); assert.equal(r.throttled, true); assert.equal(f.calls.length, 1)
  assert.equal(f.state.refunds, 0); assert.deepEqual(r.orders, rows); groups++
}
{
  const visited = new Set(), rows = Array.from({ length: 12 }, (_, i) => row(String(i)))
  for (let period = 0; period < rows.length; period++) {
    const f = batchFixture({ clock: period * 30000, cost: 8000 })
    const r = await f.run(rows)
    assert.equal(r.checked, 1, 'Another read started after the elapsed budget')
    visited.add(f.calls[0].id)
  }
  assert.equal(visited.size, 12, 'Slow/old rows starved other rows across poll periods'); groups++
}
{
  const f = batchFixture(), rows = [row('same'), row('same'), row('terminal', { status: 'completed' }), row('no-activation', { provider_request_id: null })]
  const r = await f.run(rows)
  assert.equal(f.calls.length, 1); assert.equal(r.orders.length, rows.length); groups++
}
{
  const f = batchFixture(), rows = Array.from({ length: 24 }, (_, i) => row(String(i), { saved: true, status: 'cancelled' }))
  const r = await f.run(rows)
  assert.equal(f.state.refunds, 24); assert.equal(r.checked, 0)
  assert.ok(r.orders.every(x => x.refunded_at)); groups++
}
for (const [options, expected] of [[{ throttle: true }, 0], [{ status: { status: 'waiting' } }, 0], [{ status: { status: 'ok', code: 'private-code' } }, 0], [{ status: { status: 'cancelled' } }, 1]]) {
  const f = batchFixture(options), r = await f.run([row('cancel-only')], true)
  assert.equal(f.state.refunds, expected)
  assert.equal(r.throttled, !!options.throttle); groups++
}
// The actual read parser and reconciler must stop before any database write on
// a throttle response; no cancellation or allocation function is available.
{
  let reads = 0
  const globals = { Date, DaisySmsError, TERMINAL_STATUSES: terminal,
    savedSmsCancellation: () => null,
    daisyGet: async (_key, params, timeout) => { assert.equal(params.action, 'getStatus'); assert.ok(timeout <= 3000); reads++; return 'RATE_LIMIT_EXCEEDED' },
    setTimeout,
  }
  const { reconcileSmsOrdersBounded } = actual(['daisyGetStatus', 'reconcileOtpOrderStatus', 'reconcileSmsOrdersBounded'], globals)
  const admin = { from() { throw new Error('Unexpected DB write/read after throttle') }, rpc() { throw new Error('Unexpected financial operation') } }
  const r = await reconcileSmsOrdersBounded(admin, 'synthetic-key', [row('throttle-actual'), row('not-checked')])
  assert.equal(r.checked, 1); assert.equal(r.throttled, true); assert.equal(reads, 1); groups++
}
// Real transport receives a short aborting deadline only for bounded reads.
// The paid allocation call still has its existing 12-second deadline and is
// attempted exactly once when an explicit throttle response is returned.
{
  const delays = [], calls = []; let responseText = 'STATUS_WAIT_CODE', responseStatus = 200
  const globals = { URL, Headers, Response, AbortController, TextDecoder, Uint8Array, DaisySmsError,
    DEFAULT_DAISY_BASE: 'https://supplier.fixture.invalid/handler_api.php', Deno: { env: { get: () => undefined } },
    setTimeout: (_callback, ms) => { delays.push(ms); return 1 }, clearTimeout() {},
    fetch: async (url, options) => { calls.push({ action: new URL(url).searchParams.get('action'), options }); return new Response(responseText, { status: responseStatus }) },
  }
  const f = actual(['daisyRequest', 'daisyGet', 'daisyGetStatus', 'daisyGetNumber'], globals)
  await f.daisyGetStatus('synthetic-key', 'saved-activation', 1750)
  assert.equal(delays.at(-1), 1750)
  await f.daisyGetStatus('synthetic-key', 'saved-activation')
  assert.equal(delays.at(-1), 12000)
  responseText = 'RATE_LIMIT_EXCEEDED'
  const before = calls.length
  await assert.rejects(f.daisyGetNumber('synthetic-key', 'test-service'), error => error.code === 'RATE_LIMIT_EXCEEDED')
  assert.equal(calls.length - before, 1); assert.equal(delays.at(-1), 12000)
  responseStatus = 429; responseText = 'untrusted-sensitive-provider-body'
  const before429 = calls.length
  await assert.rejects(f.daisyGetNumber('synthetic-key', 'test-service'), error => error.code === 'RATE_LIMIT_EXCEEDED' && !error.message.includes(responseText))
  assert.equal(calls.length - before429, 1); assert.equal(delays.at(-1), 12000)
  assert.ok(calls.every(x => x.options.signal.aborted && x.options.redirect === 'error'))
  groups++
}
// Evaluate the actual allocation-refund decision expression, without executing
// a paid order. A throttled allocation remains unknown and is never refunded
// merely because it is a typed Daisy error.
{
  const fn = actualSmsFunctions(source, ['handleCreateOtp'])
  const ast = ts.createSourceFile('create.ts', fn, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const expressions = {}
  function visit(node) { if (ts.isVariableDeclaration(node) && ['definitiveAllocationDecline', 'safeToRefund'].includes(node.name.getText(ast))) expressions[node.name.getText(ast)] = node.initializer.getText(ast); ts.forEachChild(node, visit) }
  visit(ast)
  assert.ok(expressions.definitiveAllocationDecline && expressions.safeToRefund)
  const code = transformSync(`const definitiveAllocationDecline=${expressions.definitiveAllocationDecline};const safeToRefund=${expressions.safeToRefund};({definitiveAllocationDecline,safeToRefund})`, { loader: 'ts', format: 'cjs' }).code
  const result = vm.runInNewContext(code, { DaisySmsError, err: new DaisySmsError('RATE_LIMIT_EXCEEDED', 'synthetic'), providerRequestStarted: true, providerCancellationConfirmed: false })
  assert.equal(result.definitiveAllocationDecline, false); assert.equal(result.safeToRefund, false); groups++
}
// History preserves the exact owned 50-row query and display shape, while the
// compatibility cancellation sync uses the same owned bounded runner.
{
  const calls = [], rows = [row('one'), row('two')]
  const admin = { from(table) { assert.equal(table, 'sms_orders'); return { select(value) { assert.equal(value, '*'); return {
    eq(key, value) { assert.deepEqual([key, value], ['user_id', 'owned-customer']); return this },
    order(key, value) { assert.equal(key, 'created_at'); assert.equal(value.ascending, false); return this },
    async limit(n) { assert.equal(n, 50); return { data: rows, error: null } },
  } } } } }
  const { handleOrders } = actual(['handleOrders'], { getDaisyKey: () => 'synthetic-key',
    reconcileSmsOrdersBounded: async (_admin, _key, owned) => { calls.push(owned); return { orders: owned, checked: 2, throttled: false } },
    publicSmsOrder: x => ({ id: x.id }), json: body => body,
  })
  const r = await handleOrders(admin, 'owned-customer')
  assert.equal(calls.length, 1); assert.deepEqual(r.data.map(x => x.id), ['one', 'two']); groups++
}
{
  const page = readFileSync(new URL('../src/pages/SmsNumbersPage.tsx', import.meta.url), 'utf8')
  assert.equal(/invokeSms(?:Read)?\([^\n]*['"]sync_cancelled['"]/.test(page), false, 'Catalog still starts a duplicate cancellation batch')
  assert.ok(page.includes("invokeSmsRead<SmsOrder[]>('orders')")); groups++
}
console.log(`Actual SMS bounded status refresh/transport: ${groups} synthetic scenario groups passed`)
