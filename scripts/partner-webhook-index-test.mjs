import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = (file, module = ts.ModuleKind.None) => ts.transpileModule(
  readFileSync(file, 'utf8').replace(module === ts.ModuleKind.None ? /^import .*$/gm : /$^/, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module } },
).outputText
const partnerId = '20000000-0000-4000-8000-000000000001'
const keyId = '10000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const nonce = '40000000-0000-4000-8000-000000000001'
const eventId = eventType => {
  const hash = createHash('sha256').update(`partner-webhook-v2:${partnerId}:${orderId}:${eventType}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}`
    + `-${((parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const deliveries = []
const dispatchExports = {}
vm.runInNewContext(compile('supabase/functions/_shared/partner-webhook-dispatch.ts', ts.ModuleKind.CommonJS), {
  exports: dispatchExports, setTimeout, clearTimeout,
  require: name => {
    assert.equal(name, './partner-webhook-delivery.ts')
    return { deliverPartnerWebhookSafely: async input => {
      deliveries.push(input)
      return { state: 'delivered', code: 'WEBHOOK_DELIVERED', http_status: 204 }
    } }
  },
})
const context = vm.createContext({
  serve() {}, createClient() {}, partnerMarkup() {}, executePartnerExternalPurchase() {},
  preparePartnerSmsPlan() {}, preparePartnerSocialPlan() {}, preparePartnerBillsPlan() {},
  preparePartnerGiftcardPlan() {}, preparePartnerTelegramPlan() {}, handlePartnerExternalOrderStatus() {},
  dispatchPartnerWebhookEvent: dispatchExports.dispatchPartnerWebhookEvent,
  createRuntimePinnedWebhookTransport: () => context.transportReady ? {} : null,
  transportReady: true, Deno: { env: { get: () => '' } }, URL, Request, Response, TextEncoder, TextDecoder,
  Uint8Array, crypto: webcrypto, setTimeout, clearTimeout,
})
vm.runInContext(compile('supabase/functions/partner-api/index.ts'), context)
const deliver = vm.runInContext('deliverPartnerWebhook', context)

async function scenario({ eventType = 'partner.order.completed', allowed = true,
  transportReady = true, claimed = new Set() } = {}) {
  const calls = []
  deliveries.length = 0
  context.transportReady = transportReady
  const admin = {
    from() { throw new Error('Webhook index must use outbox RPC, never direct delivery table writes') },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'claim_api_partner_webhook_event') {
        if (!allowed || claimed.has(args.p_event_id)) return { data: { success: true, send_allowed: false }, error: null }
        claimed.add(args.p_event_id)
        return { data: { success: true, send_allowed: true,
          event_id: args.p_event_id, event_type: eventType, claim_nonce: nonce,
          partner: { id: partnerId, is_active: true, owner_reviewed_at: '2026-10-05',
            webhook_url: 'https://hooks.example.com/x', webhook_secret: 'tly_whsec_' + 'a'.repeat(64) },
          order: { id: orderId, partner_id: partnerId, status: eventType === 'partner.order.refunded' ? 'failed' : 'completed',
            item_type: 'product', amount_ngn: 120, currency: 'NGN' }, key_scopes: ['orders:create', 'orders:read'],
        }, error: null }
      }
      assert.equal(name, 'finish_api_partner_webhook_event')
      return { data: { success: true, idempotent_replay: false, state: 'delivered' }, error: null }
    },
  }
  await deliver(admin, { partner: { id: partnerId }, key: { id: keyId } }, orderId, eventType)
  return { calls, deliveries: [...deliveries] }
}

let result = await scenario()
assert.deepEqual(result.calls.map(call => call.name), ['claim_api_partner_webhook_event', 'finish_api_partner_webhook_event'])
assert.equal(result.calls[0].args.p_event_id, eventId('partner.order.completed'))
assert.equal(result.calls[1].args.p_claim_nonce, nonce)
assert.equal(result.deliveries.length, 1)
assert.equal(result.deliveries[0].eventType, 'partner.order.completed')
assert.deepEqual([...result.deliveries[0].keyScopes], ['orders:create', 'orders:read'])

result = await scenario({ eventType: 'partner.order.refunded' })
assert.equal(result.calls[0].args.p_event_id, eventId('partner.order.refunded'))
assert.equal(result.deliveries.length, 1)
result = await scenario({ allowed: false })
assert.equal(result.calls.length, 1); assert.equal(result.deliveries.length, 0)
result = await scenario({ transportReady: false })
assert.equal(result.calls.length, 0, 'missing pinned transport must leave event queued')
assert.equal(result.deliveries.length, 0)
const claimed = new Set()
result = await scenario({ claimed })
assert.equal(result.deliveries.length, 1)
result = await scenario({ claimed })
assert.equal(result.calls.length, 1); assert.equal(result.deliveries.length, 0)
console.log('Partner webhook index: deterministic outbox ID, shared one-claim dispatcher, completion/refund and no direct table writes passed.')
