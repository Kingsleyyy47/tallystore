import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const partnerId = '20000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const eventId = '40000000-0000-4000-8000-000000000001'
const nonce = '50000000-0000-4000-8000-000000000001'
const claim = { success: true, send_allowed: true, event_id: eventId, claim_nonce: nonce,
  event_type: 'partner.order.completed', key_scopes: ['orders:read'],
  partner: { id: partnerId, is_active: true, owner_reviewed_at: '2026-10-05',
    webhook_url: 'https://hooks.example.com/receive', webhook_secret: 'tly_whsec_' + 'a'.repeat(64) },
  order: { id: orderId, partner_id: partnerId, status: 'completed', item_type: 'product',
    amount_ngn: 100, currency: 'NGN' } }

async function runDispatch({ claimResult = claim, delivered = { state: 'delivered', code: 'WEBHOOK_DELIVERED', http_status: 204 }, finishError = null } = {}) {
  const calls = []
  let sends = 0
  const exports = {}
  vm.runInNewContext(compile('supabase/functions/_shared/partner-webhook-dispatch.ts'), {
    exports, setTimeout, clearTimeout, require: name => {
      assert.equal(name, './partner-webhook-delivery.ts')
      return { deliverPartnerWebhookSafely: async () => { sends++; return delivered } }
    },
  })
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args })
    return name === 'claim_api_partner_webhook_event'
      ? { data: claimResult, error: null }
      : { data: finishError ? null : { success: true }, error: finishError }
  } }
  const result = await exports.dispatchPartnerWebhookEvent(admin, eventId, {})
  return { result, calls, sends }
}

let test = await runDispatch()
assert.equal(test.result, 'delivered')
assert.equal(test.sends, 1)
assert.deepEqual(test.calls.map(call => call.name), ['claim_api_partner_webhook_event', 'finish_api_partner_webhook_event'])
assert.equal(test.calls[1].args.p_claim_nonce, nonce)
assert.equal(test.calls[1].args.p_code, 'WEBHOOK_DELIVERED')
assert.equal(test.calls[1].args.p_http_status, 204)
assert.ok(!JSON.stringify(test.calls[1]).includes('tly_whsec_'))

test = await runDispatch({ claimResult: { success: true, send_allowed: false } })
assert.equal(test.result, 'skipped'); assert.equal(test.sends, 0); assert.equal(test.calls.length, 1)
{
  const exports = {}
  vm.runInNewContext(compile('supabase/functions/_shared/partner-webhook-dispatch.ts'), {
    exports, setTimeout, clearTimeout, require: () => ({ deliverPartnerWebhookSafely: async () => {
      throw new Error('Must not send without pinned transport')
    } }),
  })
  let calls = 0
  assert.equal(await exports.dispatchPartnerWebhookEvent({ rpc: async () => { calls++; return { data: claim } } }, eventId, null), 'skipped')
  assert.equal(calls, 0)
}
test = await runDispatch({ claimResult: { ...claim, event_id: orderId } })
assert.equal(test.result, 'outcome_unknown'); assert.equal(test.sends, 0)
test = await runDispatch({ delivered: { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' } })
assert.equal(test.result, 'outcome_unknown'); assert.equal(test.sends, 1)
assert.equal(test.calls[1].args.p_outcome, 'outcome_unknown')
test = await runDispatch({ finishError: { message: 'PRIVATE_DATABASE_ERROR' } })
assert.equal(test.result, 'outcome_unknown'); assert.equal(test.sends, 1)

// The same event can be selected by an immediate request and a worker. Only
// the first committed claim grants a POST, even if its finish call fails.
{
  const exports = {}
  let sends = 0
  let claims = 0
  vm.runInNewContext(compile('supabase/functions/_shared/partner-webhook-dispatch.ts'), {
    exports, setTimeout, clearTimeout, require: () => ({ deliverPartnerWebhookSafely: async () => {
      sends++; return { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' }
    } }),
  })
  const admin = { rpc: async name => name === 'claim_api_partner_webhook_event'
    ? { data: ++claims === 1 ? claim : { success: true, send_allowed: false }, error: null }
    : { data: null, error: { message: 'save failed' } } }
  assert.equal(await exports.dispatchPartnerWebhookEvent(admin, eventId, {}), 'outcome_unknown')
  assert.equal(await exports.dispatchPartnerWebhookEvent(admin, eventId, {}), 'skipped')
  assert.equal(sends, 1)
}

const workerSource = compile('supabase/functions/partner-webhook-worker/index.ts')
async function runWorker({ method = 'POST', secret = 's'.repeat(40), enabled = 'true',
  raw = '{"limit":2}', contentType = 'application/json', list = [{ event_id: eventId }],
  dispatchResult = 'delivered', transportReady = true, streamChunks = null, hangStream = false } = {}) {
  let handler
  let clients = 0
  let sends = 0
  const env = { PARTNER_WEBHOOK_WORKER_ENABLED: enabled, PARTNER_WEBHOOK_WORKER_SECRET: 's'.repeat(40),
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', SUPABASE_URL: 'https://supabase.example.com' }
  vm.runInNewContext(workerSource, {
    exports: {}, crypto: webcrypto, TextEncoder, TextDecoder, Request, Response, setTimeout, clearTimeout, Date,
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => {
        clients++
        return { rpc: async (rpcName, args) => {
          assert.equal(rpcName, 'list_queued_api_partner_webhook_events')
          assert.equal(args.p_limit, 2)
          return { data: { success: true, events: list }, error: null }
        } }
      } }
      if (name === '../_shared/partner-webhook-dispatch.ts') return {
        dispatchPartnerWebhookEvent: async () => { sends++; return dispatchResult },
      }
      if (name === '../_shared/partner-webhook-transport.ts') return {
        createRuntimePinnedWebhookTransport: () => transportReady ? {} : null,
      }
      throw new Error('unexpected import')
    },
  })
  const body = streamChunks || hangStream ? new ReadableStream({ start(controller) {
    for (const chunk of streamChunks) controller.enqueue(new TextEncoder().encode(chunk))
    if (!hangStream) controller.close()
  } }) : raw
  const response = await handler(new Request('https://worker.example.com/', { method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': contentType },
    ...(method === 'POST' ? { body } : {}), ...(streamChunks || hangStream ? { duplex: 'half' } : {}) }))
  return { status: response.status, data: await response.json(), clients, sends }
}

let worker = await runWorker({ enabled: 'false' })
assert.equal(worker.status, 503); assert.equal(worker.clients, 0)
worker = await runWorker({ secret: 'wrong' })
assert.equal(worker.status, 401); assert.equal(worker.clients, 0)
worker = await runWorker({ secret: 'anon-jwt-placeholder' })
assert.equal(worker.status, 401); assert.equal(worker.clients, 0)
worker = await runWorker({ method: 'GET' })
assert.equal(worker.status, 405); assert.equal(worker.clients, 0)
worker = await runWorker({ transportReady: false })
assert.equal(worker.status, 503); assert.equal(worker.clients, 0)
for (const raw of ['{"limit":21}', '{"limit":1,"url":"https://hooks.example.com"}', 'null', '{"limit":1.5}']) {
  worker = await runWorker({ raw })
  assert.equal(worker.status, 400); assert.equal(worker.clients, 0)
}
worker = await runWorker({ streamChunks: ['{"limit":2}', 'x'.repeat(600)] })
assert.equal(worker.status, 400); assert.equal(worker.clients, 0)
worker = await runWorker({ streamChunks: ['{"limit":2}'], hangStream: true })
assert.equal(worker.status, 400); assert.equal(worker.clients, 0)
worker = await runWorker({ list: [{ event_id: eventId }, { event_id: 'invalid' }] })
assert.equal(worker.status, 200); assert.equal(worker.data.delivered, 1)
assert.equal(worker.data.skipped, 1); assert.equal(worker.sends, 1)
assert.ok(!JSON.stringify(worker.data).includes(eventId))
assert.ok(!JSON.stringify(worker.data).includes('test-service-key'))
console.log('Partner webhook outbox runtime: auth, bounded input, one claim/finish, ambiguous outcome and redacted worker counts passed.')
