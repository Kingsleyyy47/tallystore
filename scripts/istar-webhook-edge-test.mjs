import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const secret = 'local-webhook-secret'
const sourceUrl = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const targetUrl = 'https://ktmlojvchkmzcdbjdyjx.supabase.co'
const source = readFileSync(new URL('../supabase/functions/istar-webhook/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText
const env = { SUPABASE_URL: sourceUrl, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ISTAR_WEBHOOK_SECRET: secret, ISTAR_WEBHOOK_QUEUE_ENABLED: 'true' }
let handler
let enqueueResult = { data: { success: true, event_id: '20000000-0000-4000-8000-000000000001' }, error: null }
const calls = []
let fetchImpl = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
const context = vm.createContext({
  serve: fn => { handler = fn },
  Deno: { env: { get: name => env[name] } },
  createClient: (url, key, options) => {
    assert.equal(url, env.SUPABASE_URL)
    assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(options.auth.persistSession, false)
    return { rpc: async (name, args) => {
      calls.push({ name, args, options })
      return enqueueResult
    } }
  },
  crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL,
  AbortController, ReadableStream, setTimeout, clearTimeout,
  fetch: (...args) => fetchImpl(...args),
})
vm.runInContext(code, context)
const body = JSON.stringify({ event_type: 'order.failed', order: { id: 4820 } })
const sign = raw => crypto.createHmac('sha256', secret).update(raw).digest('hex')
const request = (raw = body, signature = sign(raw)) => new Request(`${sourceUrl}/functions/v1/istar-webhook`, {
  method: 'POST', headers: { 'x-istar-signature': signature }, body: raw,
})

let result = await handler(request())
assert.equal(result.status, 200)
assert.deepEqual(await result.json(), { received: true })
assert.equal(calls.length, 1)
assert.equal(calls[0].name, 'enqueue_istar_webhook_event')
assert.equal(calls[0].args.p_raw_body, body, 'signed body must be persisted without reconstruction')
assert.equal(calls[0].args.p_event_hash, crypto.createHash('sha256').update(body).digest('hex'))
assert.equal(calls[0].args.p_provider_order_id, '4820')
assert.equal(calls[0].args.p_signature, sign(body))

result = await handler(request(body, '0'.repeat(64)))
assert.equal(result.status, 401)
assert.equal(calls.length, 1)
result = await handler(request('{bad'))
assert.equal(result.status, 400)
assert.equal(calls.length, 1)
result = await handler(request(JSON.stringify({ event_type: 'order.refunded', order: { id: 4820 } })))
assert.equal(result.status, 400)
assert.equal(calls.length, 1)
result = await handler(request('x'.repeat(65537)))
assert.equal(result.status, 413)
assert.equal(calls.length, 1)

enqueueResult = { data: null, error: new Error('unavailable') }
result = await handler(request())
assert.equal(result.status, 503, 'uncommitted event must not be ACKed')
enqueueResult = { data: { success: true, event_id: '20000000-0000-4000-8000-000000000001' }, error: null }
result = await handler(request())
assert.equal(result.status, 200, 'retry after uncertain persistence must be deduplicable')
env.ISTAR_WEBHOOK_QUEUE_ENABLED = 'false'
result = await handler(request())
assert.equal(result.status, 503, 'callback launch remains closed by default')
env.ISTAR_WEBHOOK_QUEUE_ENABLED = 'true'

const bounded = vm.runInContext('boundedEnqueueFetch', context)
const controller = new AbortController()
await bounded(`${sourceUrl}/rest/v1/rpc/enqueue_istar_webhook_event`, {}, controller.signal, sourceUrl)
await assert.rejects(bounded('https://attacker.invalid/rest/v1/rpc/enqueue_istar_webhook_event',
  {}, controller.signal, sourceUrl))
await assert.rejects(bounded(`${sourceUrl}/rest/v1/telegram_orders`, {}, controller.signal, sourceUrl))
let cancelled = false
fetchImpl = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }),
  { headers: { 'Content-Type': 'application/json' } })
const slowController = new AbortController()
const slowRequest = bounded(`${sourceUrl}/rest/v1/rpc/enqueue_istar_webhook_event`, {}, slowController.signal, sourceUrl)
await new Promise(resolve => setTimeout(resolve, 5))
slowController.abort()
await slowRequest
assert.equal(cancelled, true, 'deadline must cancel an active database response reader')
cancelled = false
let finishLateFetch
fetchImpl = () => new Promise(resolve => { finishLateFetch = resolve })
const lateController = new AbortController()
const lateRequest = bounded(`${sourceUrl}/rest/v1/rpc/enqueue_istar_webhook_event`, {}, lateController.signal, sourceUrl)
lateController.abort()
finishLateFetch(new Response(new ReadableStream({ cancel() { cancelled = true } })))
await assert.rejects(lateRequest, /DATABASE_RESPONSE_REJECTED/)
assert.equal(cancelled, true, 'late response headers after abort must cancel the body')
fetchImpl = async () => new Response('{}')
env.SUPABASE_URL = targetUrl
result = await handler(request())
assert.equal(result.status, 200, 'reviewed Target origin may persist after cutover')
env.SUPABASE_URL = 'https://attacker.invalid'
result = await handler(request())
assert.equal(result.status, 503, 'other database origins remain disabled')
console.log('iStar ingress: signed raw body, durable enqueue before ACK, duplicate retry, closed gate and fixed database target passed.')
