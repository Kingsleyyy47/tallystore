import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/partner-api/index.ts', 'utf8').replace(/^import .*$/gm, '')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText
const partnerId = '20000000-0000-4000-8000-000000000001'
const keyId = '10000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const context = vm.createContext({
  serve() {}, createClient() {}, partnerMarkup() {}, executePartnerExternalPurchase() {},
  preparePartnerSmsPlan() {}, preparePartnerSocialPlan() {}, preparePartnerBillsPlan() {},
  preparePartnerGiftcardPlan() {}, preparePartnerTelegramPlan() {}, handlePartnerExternalOrderStatus() {},
  validatePartnerWebhookUrl: value => value === 'https://hooks.example.com/x' ? { url: value, hostname: 'hooks.example.com' } : null,
  createRuntimePinnedWebhookTransport: () => ({ transport: true }),
  deliverPartnerWebhookSafely: async input => { context.deliveries.push(input); return { state: 'delivered', code: 'WEBHOOK_DELIVERED', http_status: 204 } },
  deliveries: [], Deno: { env: { get: () => '' } }, URL, Request, Response, TextEncoder, TextDecoder,
  Uint8Array, crypto: webcrypto, setTimeout, clearTimeout,
})
vm.runInContext(compiled, context)
const deliver = vm.runInContext('deliverPartnerWebhook', context)

async function scenario({ scopes = ['orders:create', 'orders:read'], reviewed = true,
  status = 'completed', obligation = true, release = true, refunded = false,
  orderPartner = partnerId, claims = new Set() } = {}) {
  const calls = { tables: [], inserts: [], updates: [], logs: [] }
  context.deliveries.length = 0
  const rows = {
    api_partner_keys: { id: keyId, partner_id: partnerId, scopes, revoked_at: null },
    api_partners: { id: partnerId, is_active: true, owner_reviewed_at: reviewed ? '2026-10-05' : null,
      webhook_url: 'https://hooks.example.com/x', webhook_secret: 'tly_whsec_' + 'a'.repeat(64) },
    api_partner_orders: { id: orderId, partner_id: orderPartner, status, item_type: 'product',
      amount_ngn: 120, currency: 'NGN', refunded_at: refunded ? '2026-10-05' : null,
      refund_amount_ngn: refunded ? 120 : null, partner_reference: 'fixture-ref' },
    api_partner_obligations: obligation ? { order_id: orderId, partner_id: partnerId, amount_ngn: 120 } : null,
    api_partner_external_events: release ? { order_id: orderId, partner_id: partnerId, amount_ngn: 120 } : null,
  }
  const admin = { from(table) {
    calls.tables.push(table)
    const query = {
      select() { return this }, eq(column, value) {
        if (table === 'api_partner_orders' && column === 'partner_id' && value !== rows.api_partner_orders.partner_id) this.mismatch = true
        if (['api_partner_obligations', 'api_partner_external_events'].includes(table)
          && rows[table] && column in rows[table] && value !== rows[table][column]) this.mismatch = true
        return this
      }, is() { return this },
      insert(payload) {
        calls.inserts.push({ table, payload }); this.inserted = payload
        if (table === 'api_partner_webhook_deliveries') {
          if (claims.has(payload.id)) this.duplicate = true
          else claims.add(payload.id)
        }
        return this
      },
      update(payload) { calls.updates.push({ table, payload }); return this },
      async maybeSingle() { return { data: this.mismatch || this.duplicate ? null : this.inserted ?? rows[table],
        error: this.duplicate ? { code: '23505' } : null } },
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve) },
    }
    return query
  } }
  await deliver(admin, { partner: { id: partnerId }, key: { id: keyId } }, orderId,
    refunded ? 'partner.order.refunded' : 'partner.order.completed')
  return { ...calls, deliveries: [...context.deliveries] }
}

for (const opts of [
  { scopes: ['orders:create'] }, { reviewed: false }, { status: 'processing' },
  { obligation: false }, { orderPartner: '50000000-0000-4000-8000-000000000001' },
  { refunded: true, status: 'failed', release: false },
]) {
  const result = await scenario(opts)
  assert.equal(result.deliveries.length, 0, 'unproven or unauthorized order must not be sent')
  assert.equal(result.inserts.length, 0, 'unproven or unauthorized order must not create delivery')
}
let result = await scenario()
assert.equal(result.deliveries.length, 1)
assert.deepEqual([...result.deliveries[0].keyScopes], ['orders:create', 'orders:read'])
assert.equal(result.deliveries[0].eventType, 'partner.order.completed')
assert.deepEqual(Object.keys(result.inserts[0].payload.payload).sort(), ['event', 'order_id'])
assert.equal(result.updates[0].payload.response_body, null)
result = await scenario({ refunded: true, status: 'failed' })
assert.equal(result.deliveries.length, 1)
assert.equal(result.deliveries[0].eventType, 'partner.order.refunded')
const claims = new Set()
result = await scenario({ claims })
assert.equal(result.deliveries.length, 1)
result = await scenario({ claims })
assert.equal(result.deliveries.length, 0, 'duplicate primary-key claim must prevent a second POST')
result = await scenario({ status: 'completed' })
assert.equal(result.tables.includes('api_partner_external_events'), false, 'completed proof uses captured obligation')
console.log('Partner webhook index integration: fresh owner/key/order gates, captured/refunded proof and minimal audit passed.')
