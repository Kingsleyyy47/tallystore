import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source = readFileSync(new URL('../api/webhook-istar.ts', import.meta.url), 'utf8')
assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|ISTAR_WEBHOOK_SECRET|createClient/.test(source))
assert.deepEqual([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map(match => match[1]), ['VITE_SUPABASE_URL'])
const bundled = await build({ stdin: { contents: source, loader: 'ts' }, bundle: true,
  platform: 'node', format: 'esm', write: false })
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const originalFetch = globalThis.fetch
const originalProject = process.env.VITE_SUPABASE_URL
process.env.VITE_SUPABASE_URL = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const body = Buffer.from('{ "event_type" : "order.failed", "order": { "id": "TEST_ORDER" } }\n')
const signature = crypto.createHmac('sha256', 'TEST_ONLY_WEBHOOK_SECRET').update(body).digest('hex')
const calls = []
let upstream = () => new Response('{"success":true}', { status: 200 })
globalThis.fetch = async (url, options) => {
  calls.push({ url, options })
  return upstream()
}
const response = () => ({ headers: {}, statusCode: 200, body: null,
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this },
  status(value) { this.statusCode = value; return this },
  json(value) { this.body = value; return this },
})
const request = (overrides = {}) => ({ method: 'POST', url: '/api/webhook-istar',
  body, headers: { 'x-istar-signature': signature,
    authorization: 'UNTRUSTED_CALLER_BEARER', 'x-istar-event': 'UNTRUSTED_EVENT',
    'content-type': 'text/plain', 'x-forwarded-host': 'attacker.invalid' },
  ...overrides,
})
async function run(req = request()) {
  const res = response()
  await handler(req, res)
  assert.equal(res.headers['cache-control'], 'no-store')
  return res
}
try {
  assert.equal((await run()).statusCode, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/istar-webhook')
  assert.deepEqual(calls[0].options.body, body, 'raw whitespace and trailing newline must survive proxy')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.credentials, 'omit')
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json',
    'Content-Type': 'application/json', 'x-istar-signature': signature })

  process.env.VITE_SUPABASE_URL = 'https://ktmlojvchkmzcdbjdyjx.supabase.co'
  assert.equal((await run()).statusCode, 200)
  assert.equal(calls.at(-1).url, 'https://ktmlojvchkmzcdbjdyjx.supabase.co/functions/v1/istar-webhook')
  for (const origin of [undefined, 'https://attacker.invalid', 'https://dssvvswvqnxanyzfhixf.supabase.co.attacker.invalid']) {
    if (origin === undefined) delete process.env.VITE_SUPABASE_URL
    else process.env.VITE_SUPABASE_URL = origin
    const count = calls.length
    assert.equal((await run()).statusCode, 503)
    assert.equal(calls.length, count)
  }
  process.env.VITE_SUPABASE_URL = 'https://dssvvswvqnxanyzfhixf.supabase.co'

  const beforeInvalid = calls.length
  assert.equal((await run(request({ method: 'GET' }))).statusCode, 405)
  assert.equal((await run(request({ url: 'https://[' }))).statusCode, 400)
  assert.equal((await run(request({ url: '/api/webhook-istar?token=TEST_QUERY_SECRET' }))).statusCode, 400)
  assert.equal((await run(request({ headers: {} }))).statusCode, 401)
  assert.equal((await run(request({ headers: { 'x-istar-signature': [signature, signature] } }))).statusCode, 401)
  assert.equal((await run(request({ body: { event_type: 'order.failed' } }))).statusCode, 400)
  assert.equal((await run(request({ body: Buffer.alloc(65537) }))).statusCode, 413)
  assert.equal(calls.length, beforeInvalid, 'invalid local requests must not reach Supabase')

  const reqStream = request({ body: undefined })
  reqStream[Symbol.asyncIterator] = async function* () { yield body.subarray(0, 7); yield body.subarray(7) }
  assert.equal((await run(reqStream)).statusCode, 200)
  assert.deepEqual(calls.at(-1).options.body, body)
  const largeStream = request({ body: undefined })
  largeStream[Symbol.asyncIterator] = async function* () { yield Buffer.alloc(32768); yield Buffer.alloc(32769) }
  assert.equal((await run(largeStream)).statusCode, 413)

  upstream = () => new Response('PRIVATE_DATABASE_ERROR', { status: 500 })
  const error = await run()
  assert.equal(error.statusCode, 500)
  assert.ok(!JSON.stringify(error.body).includes('PRIVATE_DATABASE_ERROR'))
  upstream = () => new Response('', { status: 302, headers: { Location: 'https://attacker.invalid' } })
  assert.equal((await run()).statusCode, 502)
  upstream = () => new Response('{"message":"PRIVATE_PROVIDER_SECRET"}', { status: 200 })
  assert.equal((await run()).statusCode, 502)
  upstream = () => new Response('x'.repeat(32769), { status: 200 })
  assert.equal((await run()).statusCode, 502)
  upstream = () => new Response('{}', { status: 200, headers: { 'Content-Length': '32769' } })
  assert.equal((await run()).statusCode, 502)
  upstream = () => new Response('{"success":true,"secret":"PRIVATE_VALUE"}', { status: 200 })
  assert.deepEqual((await run()).body, { success: true })
  upstream = () => new Response('{"received":true,"event_id":"PRIVATE_VALUE"}', { status: 200 })
  assert.deepEqual((await run()).body, { received: true }, 'persisted queue ACK is projected without private fields')
  upstream = () => { throw new Error('PRIVATE_TRANSPORT_SECRET') }
  assert.equal((await run()).statusCode, 502)

  // Exercise the real handler's timer scheduling without waiting wall-clock
  // seconds; preserve its configured intervals and fire each timer promptly.
  const originalSetTimeout = globalThis.setTimeout
  const intervals = []
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    intervals.push(milliseconds)
    return originalSetTimeout(callback, 5, ...args)
  }
  try {
    const stalledBody = request({ body: undefined })
    stalledBody[Symbol.asyncIterator] = async function* () { await new Promise(() => {}); yield body }
    assert.equal((await run(stalledBody)).statusCode, 408)
    upstream = () => new Promise(() => {})
    assert.equal((await run()).statusCode, 502)
    assert.equal(calls.at(-1).options.signal.aborted, true)
    assert.deepEqual(intervals, [5000, 4000], 'body and upstream response fit the supplier ten-second budget')
    let bodyCancelled = false
    upstream = () => new Response(new ReadableStream({
      pull() { return new Promise(() => {}) }, cancel() { bodyCancelled = true; return new Promise(() => {}) },
    }))
    assert.equal((await run()).statusCode, 502)
    assert.equal(bodyCancelled, true, 'stalled upstream reader is cancelled even when fetch ignores abort')
    let lateCancelled = false
    upstream = () => new Promise(resolve => originalSetTimeout(() => resolve(new Response(new ReadableStream({
      cancel() { lateCancelled = true },
    }))), 20))
    const beforeLate = calls.length
    assert.equal((await run()).statusCode, 502)
    await new Promise(resolve => originalSetTimeout(resolve, 35))
    assert.equal(lateCancelled, true, 'headers arriving after timeout cannot start another reader')
    assert.equal(calls.length, beforeLate + 1, 'uncertain callbacks are never resent by the proxy')
  } finally { globalThis.setTimeout = originalSetTimeout }
} finally {
  globalThis.fetch = originalFetch
  if (originalProject === undefined) delete process.env.VITE_SUPABASE_URL
  else process.env.VITE_SUPABASE_URL = originalProject
}
console.log('iStar public proxy: exact raw bytes, reviewed project selection, header isolation, deadlines, bounds, reader cancellation and sanitized responses pass.')
