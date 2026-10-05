// Exercise the actual purchase/status wrappers with a fake clock and isolated SDK.
// No browser account, project, supplier, or payment endpoint is used.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = await readFile(resolve(import.meta.dirname, '../../src/lib/supabase.ts'), 'utf8')
const file = ts.createSourceFile('supabase.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const names = ['processPurchaseSecure', 'getCustomerPurchaseAttemptStatus']
const declarations = names.map(name => {
  const node = file.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node, `Missing ${name} in source`)
  return node.getText(file).replace(/^export\s+/, '')
})
const compiled = ts.transpileModule(declarations.join('\n\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  return {
    setTimeout(callback, ms) { const id = ++nextId; timers.set(id, { at: now + ms, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now && timers.delete(id)) timer.callback()
      }
    },
    pending() { return timers.size },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function fixture({ session = async () => ({ data: { session: { user: { id: 'synthetic-user-id' } } } }), invoke }) {
  const clock = fakeClock()
  const calls = []
  const sdk = { auth: { getSession: session }, functions: { invoke: (...args) => { calls.push(args); return invoke(...args) } } }
  const wrappers = new Function('supabase', 'window', 'Response', 'generateIdempotencyKey', 'console',
    `${compiled}\nreturn { processPurchaseSecure, getCustomerPurchaseAttemptStatus };`)(
      sdk, clock, Response, () => 'generated-synthetic-key', { error() {} },
    )
  return { ...wrappers, clock, calls }
}

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }
const buy = wrapper => wrapper('synthetic-product', 1, undefined, undefined, undefined, 200, 'original-synthetic-key')
const completed = { success: true, state: 'completed', order_id: '11111111-1111-4111-8111-111111111111', quantity: 1, amount_ngn: 200 }

{
  const network = deferred()
  const f = fixture({ invoke: () => network.promise })
  const resultPromise = buy(f.processPurchaseSecure)
  await flush()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][1].body.idempotency_key, 'original-synthetic-key')
  assert.equal('signal' in f.calls[0][1], false, 'SDK ignores invoke-level signal')
  f.clock.advance(44_999)
  await flush()
  assert.equal(f.clock.pending(), 1)
  f.clock.advance(1)
  const result = await resultPromise
  assert.equal(result.success, false)
  assert.equal(result.code, 'PURCHASE_STATUS_UNKNOWN')
  assert.notEqual(result.retry_safe, true, 'Uncertain purchase became retryable')
  assert.equal(f.clock.pending(), 0)
  network.resolve({ data: { success: true, order_id: completed.order_id }, error: null })
  await flush()
  assert.equal(f.calls.length, 1, 'Late response dispatched a duplicate purchase')
}

{
  const auth = deferred()
  const f = fixture({ session: () => auth.promise, invoke: () => { throw new Error('Purchase dispatched after deadline') } })
  const resultPromise = buy(f.processPurchaseSecure)
  f.clock.advance(45_000)
  assert.equal((await resultPromise).code, 'PURCHASE_STATUS_UNKNOWN')
  auth.resolve({ data: { session: { user: { id: 'synthetic-user-id' } } } })
  await flush()
  assert.equal(f.calls.length, 0, 'Late session lookup started a paid call')
}

{
  const f = fixture({ invoke: async () => ({ data: { success: false, error: 'Out of stock', code: 'OUT_OF_STOCK', retry_safe: true }, error: null }) })
  const result = await buy(f.processPurchaseSecure)
  assert.equal(result.retry_safe, true, 'Definitive rejection lost retry_safe')
  assert.equal(result.code, 'OUT_OF_STOCK')
  assert.equal(f.clock.pending(), 0)
}

{
  const f = fixture({ invoke: async () => ({ data: { success: true, order_id: completed.order_id, amount: 200, account_details: { accounts: [{ username: 'synthetic-user' }] } }, error: null }) })
  const result = await buy(f.processPurchaseSecure)
  assert.equal(result.success, true)
  assert.equal(result.order_id, completed.order_id)
  assert.equal(result.account_details.accounts[0].username, 'synthetic-user')
  assert.equal(f.clock.pending(), 0)
}

{
  const network = deferred()
  const f = fixture({ invoke: () => network.promise })
  const resultPromise = f.getCustomerPurchaseAttemptStatus('synthetic-product', 'original-synthetic-key')
  assert.equal(f.calls[0][1].body.action, 'get_status')
  f.clock.advance(12_000)
  assert.deepEqual(await resultPromise, { state: 'unknown' })
  assert.equal(f.clock.pending(), 0)
  network.resolve({ data: completed, error: null })
  await flush()
  assert.equal(f.calls.length, 1, 'Late status response started another request')
}

{
  const f = fixture({ invoke: async () => ({ data: completed, error: null }) })
  const result = await f.getCustomerPurchaseAttemptStatus('synthetic-product', 'original-synthetic-key')
  assert.deepEqual(result, { state: 'completed', order_id: completed.order_id, quantity: 1, amount_ngn: 200 })
  assert.equal(f.clock.pending(), 0)
}

{
  const f = fixture({ invoke: async () => ({ data: { state: 'completed', order_id: completed.order_id }, error: null }) })
  assert.deepEqual(await f.getCustomerPurchaseAttemptStatus('synthetic-product', 'original-synthetic-key'), { state: 'unknown' })
}

process.stdout.write('Purchase and status deadline tests passed (never-resolving and late SDK calls, definitive/success responses).\n')
