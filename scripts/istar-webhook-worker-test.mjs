import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceUrl = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const targetUrl = 'https://ktmlojvchkmzcdbjdyjx.supabase.co'
const source = readFileSync(new URL('../supabase/functions/istar-webhook-worker/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText
const env = { SUPABASE_URL: sourceUrl, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ISTAR_API_KEY: 'test-provider-key', ISTAR_WEBHOOK_QUEUE_ENABLED: 'true',
  ISTAR_WEBHOOK_WORKER_TOKEN: 'test-worker-token-at-least-32-characters-long' }
const event = { id: '10000000-0000-4000-8000-000000000001',
  lease_token: '20000000-0000-4000-8000-000000000001', provider_order_id: '4820' }
const receipt = { order_id: '4820', status: 'failed', refund_transaction_id: 4821 }
let handler
let claimed = [event]
let settlement = { success: true }
let providerError = false
const calls = []
const providerCalls = []
const context = vm.createContext({
  serve: fn => { handler = fn },
  Deno: { env: { get: name => env[name] } },
  IStarProvider: class {
    constructor(options) { assert.equal(options.apiKey, env.ISTAR_API_KEY) }
    async get(path) {
      providerCalls.push(path)
      if (providerError) throw new Error('private provider outage')
      return receipt
    }
  },
  createClient: (url, key, options) => {
    assert.equal(url, env.SUPABASE_URL)
    assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(options.auth.persistSession, false)
    return { rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: name === 'claim_istar_webhook_events' ? claimed
        : name === 'settle_istar_webhook_event' ? settlement : { success: true }, error: null }
    } }
  },
  crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL,
  AbortController, setTimeout, clearTimeout,
  fetch: async () => { throw new Error('direct network forbidden in test') },
})
vm.runInContext(code, context)
const request = token => new Request(`${sourceUrl}/functions/v1/istar-webhook-worker`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` },
})

let result = await handler(request('wrong'))
assert.equal(result.status, 401)
assert.equal(calls.length, 0)
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal(result.status, 200)
assert.equal((await result.json()).processed, 1)
assert.deepEqual(providerCalls, ['/orders/4820'])
assert.equal(calls[0].name, 'claim_istar_webhook_events')
assert.equal(calls[1].name, 'settle_istar_webhook_event')
assert.equal(calls[1].args.p_lease_token, event.lease_token)
assert.equal(calls[1].args.p_receipt, receipt)

calls.length = 0
settlement = { success: false, code: 'ISTAR_REFUND_UNPROVEN' }
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal((await result.json()).deferred, 1)
assert.equal(calls.at(-1).name, 'defer_istar_webhook_event')
assert.equal(calls.at(-1).args.p_manual_review, false)

calls.length = 0
providerError = true
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal((await result.json()).deferred, 1)
assert.equal(calls.at(-1).args.p_manual_review, false)
providerError = false
claimed = []
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal((await result.json()).processed, 0)
env.ISTAR_WEBHOOK_QUEUE_ENABLED = 'false'
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal(result.status, 503)
env.ISTAR_WEBHOOK_QUEUE_ENABLED = 'true'
env.SUPABASE_URL = targetUrl
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal(result.status, 200)
env.SUPABASE_URL = 'https://attacker.invalid'
result = await handler(request(env.ISTAR_WEBHOOK_WORKER_TOKEN))
assert.equal(result.status, 503)
console.log('iStar worker: private token, leased claim, provider read-only check, settlement and retry/review paths passed.')
