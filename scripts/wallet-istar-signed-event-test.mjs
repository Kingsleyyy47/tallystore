import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source = readFileSync(new URL('../api/webhook-istar.ts', import.meta.url), 'utf8')
const bundle = await build({
  stdin: { contents: source, loader: 'ts', sourcefile: 'webhook-istar.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'supabase-no-network-mock',
    setup(plugin) {
      plugin.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({
        path: 'supabase-mock', namespace: 'test',
      }))
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const createClient = () => globalThis.__istarTestClient',
        loader: 'js',
      }))
    },
  }],
})
const code = bundle.outputFiles[0].text
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const secret = 'local-istar-webhook-test-only'
const previousSecret = process.env.ISTAR_WEBHOOK_SECRET
const previousUrl = process.env.SUPABASE_URL
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
process.env.ISTAR_WEBHOOK_SECRET = secret
process.env.SUPABASE_URL = 'https://example.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-key'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function signedRequest(body, headers = {}, parsedBody = body) {
  return {
    method: 'POST',
    body: parsedBody,
    headers: {
      'x-istar-signature': crypto.createHmac('sha256', secret).update(body).digest('hex'),
      ...headers,
    },
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body)
    },
  }
}

function mockDatabase(currentOrder, readSnapshot = currentOrder) {
  const state = { order: { ...currentOrder }, rpcCalls: [] }
  class Query {
    constructor(table) {
      this.table = table
      this.action = 'read'
      this.filters = []
      this.values = null
    }
    select() { return this }
    insert(values) { this.action = 'insert'; this.values = values; return this }
    update(values) { this.action = 'update'; this.values = values; return this }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this }
    is(key, value) { this.filters.push((row) => row[key] === value); return this }
    result() {
      if (this.table === 'istar_webhook_logs') return { data: { id: 'log-1' }, error: null }
      if (this.table === 'transactions') {
        return { data: { id: 'debit-1', amount: -100, status: 'completed', type: 'purchase' }, error: null }
      }
      if (this.table !== 'telegram_orders') throw new Error(`Unexpected table: ${this.table}`)
      if (this.action === 'read') {
        return { data: this.filters.every((filter) => filter(readSnapshot)) ? { ...readSnapshot } : null, error: null }
      }
      if (!this.filters.every((filter) => filter(state.order))) return { data: null, error: null }
      Object.assign(state.order, this.values)
      return { data: { id: state.order.id }, error: null }
    }
    maybeSingle() { return Promise.resolve(this.result()) }
    single() { return Promise.resolve(this.result()) }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject) }
  }
  globalThis.__istarTestClient = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args })
      return { data: { success: true }, error: null }
    },
  }
  return state
}

try {
  const missingEvent = JSON.stringify({ order: { id: 'provider-order-1' } })
  const forgedHeader = response()
  await handler(signedRequest(missingEvent, { 'x-istar-event': 'order.failed' }), forgedHeader)
  assert.equal(forgedHeader.statusCode, 400,
    'unsigned event header must not determine a refund or order transition')

  const invalidJson = response()
  await handler(signedRequest('{invalid-json', { 'x-istar-event': 'order.failed' }, {
    event_type: 'order.failed', order: { id: 'provider-order-1' },
  }), invalidJson)
  assert.equal(invalidJson.statusCode, 400,
    'parsed adapter body must not replace malformed signed raw JSON')

  const unknownEvent = response()
  await handler(signedRequest(JSON.stringify({
    event_type: 'order.refunded', order: { id: 'provider-order-1' },
  })), unknownEvent)
  assert.equal(unknownEvent.statusCode, 400, 'unsupported signed event must fail closed')

  const parsedOnly = response()
  const req = signedRequest('', { 'x-istar-event': 'order.failed' }, {
    event_type: 'order.failed', order: { id: 'provider-order-1' },
  })
  req.headers['x-istar-signature'] = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(req.body)).digest('hex')
  await handler(req, parsedOnly)
  assert.equal(parsedOnly.statusCode, 401,
    'a reconstructed JSON body must not be accepted as signed raw bytes')

  const order = {
    id: 'local-order-1', istar_order_id: 'provider-order-1',
    user_id: '11111111-1111-4111-8111-111111111111',
    status: 'processing', refunded_at: null, error_message: null,
    price_ngn: 100, idempotency_key: 'purchase-1', reference: 'TG-1',
    order_type: 'stars',
  }
  const failedBody = JSON.stringify({ event_type: 'order.failed', order: { id: order.istar_order_id } })
  const completedBody = JSON.stringify({ event_type: 'order.completed', order: { id: order.istar_order_id } })

  const staleFailure = mockDatabase({ ...order, status: 'completed' }, order)
  const staleFailureResponse = response()
  await handler(signedRequest(failedBody), staleFailureResponse)
  assert.equal(staleFailureResponse.statusCode, 200)
  assert.equal(staleFailure.order.status, 'completed')
  assert.equal(staleFailure.rpcCalls.length, 0,
    'failed callback must not refund after a completion wins the update race')

  const staleCompletion = mockDatabase({
    ...order, status: 'failed', error_message: 'Supplier confirmed order failure',
  }, order)
  const staleCompletionResponse = response()
  await handler(signedRequest(completedBody), staleCompletionResponse)
  assert.equal(staleCompletionResponse.statusCode, 200)
  assert.equal(staleCompletion.order.status, 'failed',
    'completed callback must not overwrite an already recorded failure')

  const unverifiedFailure = mockDatabase({
    ...order, status: 'failed', error_message: 'Cancelled by admin',
  })
  const unverifiedFailureResponse = response()
  await handler(signedRequest(failedBody), unverifiedFailureResponse)
  assert.equal(unverifiedFailureResponse.statusCode, 200)
  assert.equal(unverifiedFailure.rpcCalls.length, 0,
    'a prior local cancellation must not become refundable from a later callback')

  const validFailure = mockDatabase(order)
  const validFailureResponse = response()
  await handler(signedRequest(failedBody), validFailureResponse)
  assert.equal(validFailureResponse.statusCode, 200)
  assert.equal(validFailure.order.status, 'failed')
  assert.ok(validFailure.order.refunded_at)
  assert.equal(validFailure.rpcCalls.length, 1,
    'eligible signed supplier failure must refund exactly once')
  const duplicateFailureResponse = response()
  await handler(signedRequest(failedBody), duplicateFailureResponse)
  assert.equal(validFailure.rpcCalls.length, 1,
    'duplicate signed supplier failure must not issue another refund')
} finally {
  delete globalThis.__istarTestClient
  if (previousSecret === undefined) delete process.env.ISTAR_WEBHOOK_SECRET
  else process.env.ISTAR_WEBHOOK_SECRET = previousSecret
  if (previousUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = previousUrl
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
}

console.log('iStar webhook rejects unsigned events and stale outcome/refund races.')
