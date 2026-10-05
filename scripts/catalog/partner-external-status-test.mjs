import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../supabase/functions/_shared/partner-external-status.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(code, { exports, setTimeout, clearTimeout, URL, encodeURIComponent, Deno: { env: { get: () => 'server-secret' } } })
const { handlePartnerExternalOrderStatus } = exports
const orderId = '10000000-0000-4000-8000-000000000001'
const partnerId = '20000000-0000-4000-8000-000000000001'
const keyId = '30000000-0000-4000-8000-000000000001'
const auth = { partner: { id: partnerId }, key: { id: keyId, scopes: ['orders:read'] } }

function fixture({ source = 'daisy', section = 'sms', itemType = 'sms', fulfillmentId = 'provider-123', journalState = 'accepted', response = 'STATUS_OK:123456', status = 'processing', quantity = 1, responsePayload = { api_key: 'private-secret', provider_status: 'pending' } } = {}) {
  let reads = 0
  let writes = 0
  let order = { id: orderId, partner_id: partnerId, partner_reference: 'reference-123', status,
    item_type: itemType, item_id: 'amazon-us', quantity, fulfillment_source: source, fulfillment_id: fulfillmentId,
    response_payload: responsePayload, error_message: null }
  const journal = journalState ? { order_id: orderId, partner_id: partnerId, key_id: keyId, section,
    state: journalState, fulfillment_source: source, fulfillment_id: fulfillmentId } : null
  const admin = {
    from(table) {
      const filters = {}
      const query = {
        select() { return query },
        eq(key, value) { filters[key] = value; return query },
        async maybeSingle() {
          if (table === 'api_partner_orders') return { data: filters.partner_id === partnerId && (filters.id === orderId || filters.partner_reference === order.partner_reference) ? order : null, error: null }
          if (table === 'api_partner_external_orders') return { data: filters.partner_id === partnerId && filters.order_id === orderId ? journal : null, error: null }
          throw new Error(`Unexpected table ${table}`)
        },
      }
      return query
    },
    async rpc(name, args) {
      assert.equal(name, 'update_api_partner_external_status', 'no wallet/refund or purchase RPC is allowed')
      assert.equal(args.p_key_id, keyId)
      assert.equal(args.p_order_id, orderId)
      assert.equal(args.p_fulfillment_id, fulfillmentId)
      assert.equal(args.p_status, 'completed')
      writes++
      order = { ...order, status: 'completed', response_payload: { ...order.response_payload, ...args.p_payload_delta } }
      return { data: { success: true, data: { id: order.id, status: order.status, amount_ngn: 100, response_payload: order.response_payload } }, error: null }
    },
  }
  const deps = {
    daisyGet: async (_key, params) => { reads++; assert.equal(params.action, 'getStatus'); return response },
    smmRequest: async params => { reads++; assert.equal(params.action, 'status'); return response },
    getBitrefillClient: () => ({
      getInvoice: async id => { reads++; assert.equal(id, fulfillmentId); return response.invoice },
      getOrder: async id => { reads++; return response.details?.[id] ?? (id === response.invoice.orders[0].id ? response.detail : null) },
    }),
    istarGet: async path => { reads++; assert.equal(path, `/orders/${fulfillmentId}`); return response },
    publicPartnerOrder: value => ({ ...value }),
  }
  return { admin, deps, reads: () => reads, writes: () => writes }
}

let f = fixture()
let result = await handlePartnerExternalOrderStatus(f.admin, { ...auth, partner: { id: 'other-partner' } }, { order_id: orderId }, f.deps)
assert.equal(result.status, 404)
assert.equal(f.reads(), 0)
assert.equal(f.writes(), 0)

f = fixture({ journalState: null })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'processing')
assert.equal(f.reads(), 0, 'legacy orders without accepted journal must remain stored-only')
assert.ok(!JSON.stringify(result).includes('private-secret'))

f = fixture({ itemType: 'product', status: 'completed', journalState: null, responsePayload: {
  product_name: 'Discord account', partner_balance_after: 420,
  accounts: [{ username: 'discord-user', password: 'discord-pass', email: 'mail@example.test',
    email_password: 'mail-pass', two_fa_code: '2fa-key', recovery_email: 'recovery@example.test',
    recovery_email_password: 'recovery-pass', additional_info: { note: 'backup codes', api_key: 'private-secret' },
    provider_token: 'private-secret' }], api_key: 'private-secret',
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.response_payload.accounts[0].username, 'discord-user')
assert.equal(result.body.data.response_payload.accounts[0].password, 'discord-pass')
assert.equal(result.body.data.response_payload.accounts[0].email_password, 'mail-pass')
assert.equal(result.body.data.response_payload.accounts[0].two_fa_code, '2fa-key')
assert.equal(result.body.data.response_payload.accounts[0].additional_info.note, 'backup codes')
assert.ok(!JSON.stringify(result).includes('private-secret'))
assert.equal(f.reads(), 0)
assert.equal(f.writes(), 0)

f = fixture({ itemType: 'product', status: 'processing', journalState: null, responsePayload: {
  accounts: [{ username: 'premature-user', password: 'premature-pass' }],
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.response_payload.accounts, undefined, 'product credentials are only returned for completed orders')

f = fixture({ itemType: 'sms', status: 'active', journalState: null, responsePayload: {
  service_name: 'Telegram', phone_number: '+1234567890', raw_phone_number: '1234567890',
  expires_at: '2026-10-05T12:00:00.000Z', api_key: 'private-secret',
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.response_payload.phone_number, '+1234567890')
assert.equal(result.body.data.response_payload.service_name, 'Telegram')
assert.ok(!JSON.stringify(result).includes('private-secret'))

f = fixture({ response: 'STATUS_OK:123456', status: 'active' })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.equal(result.body.data.item_type, 'sms', 'SQL status result is minimal; public response must retain owned order fields')
assert.equal(result.body.data.response_payload.code, '123456')
assert.equal(f.reads(), 1)
assert.equal(f.writes(), 1)

f = fixture({ response: 'STATUS_CANCEL' })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
assert.equal(result.body.data.status, 'processing')
assert.equal(f.writes(), 0, 'provider failure must not issue a financial mutation')

f = fixture({ source: 'smm', section: 'social_boost', itemType: 'social_boost', response: { status: 'Completed', start_count: 2, remains: 0, api_key: 'private-secret' } })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { partner_reference: 'reference-123' }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.equal(result.body.data.response_payload.start_count, 2)
assert.equal(result.body.data.response_payload.remains, 0)
assert.ok(!JSON.stringify(result).includes('private-secret'))

f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards', fulfillmentId: 'invoice-123', response: {
  invoice: { id: 'invoice-123', status: 'complete', orders: [{ id: 'gift-order-123', product_id: 'amazon-us' }] },
  detail: { id: 'gift-order-123', redemption_info: { code: 'GIFT-123', link: 'https://redeem.example/card', api_key: 'private-secret' } },
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.equal(result.body.data.response_payload.redemption.code, 'GIFT-123')
assert.equal(result.body.data.response_payload.redemptions[0].order_id, 'gift-order-123')
assert.equal(result.body.data.response_payload.redemptions[0].code, 'GIFT-123')
assert.ok(!JSON.stringify(result).includes('private-secret'))
assert.equal(f.reads(), 2)

const twoCardInvoice = { id: 'invoice-123', status: 'complete', orders: [
  { id: 'gift-order-123', product_id: 'amazon-us', quantity: 1 },
  { id: 'gift-order-456', product_id: 'amazon-us', quantity: 1 },
] }
f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards',
  fulfillmentId: 'invoice-123', quantity: 2, response: {
    invoice: twoCardInvoice,
    details: {
      'gift-order-123': { id: 'gift-order-123', product_id: 'amazon-us', redemption_info: { code: 'CARD-ONE', api_key: 'private-secret' } },
      'gift-order-456': { id: 'gift-order-456', product_id: 'amazon-us', redemption_info: { code: 'CARD-TWO', pin: '2468' } },
    },
  } })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.deepEqual(Array.from(result.body.data.response_payload.redemptions, entry => [entry.order_id, entry.code]), [
  ['gift-order-123', 'CARD-ONE'], ['gift-order-456', 'CARD-TWO'],
])
assert.equal(result.body.data.response_payload.redemption, undefined, 'multi-card results should use per-unit redemptions')
assert.ok(!JSON.stringify(result).includes('private-secret'))
assert.equal(f.reads(), 3)
assert.equal(f.writes(), 1)

for (const badResponse of [
  { invoice: twoCardInvoice, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
    'gift-order-456': { id: 'gift-order-456', redemption_info: {} },
  } },
  { invoice: { ...twoCardInvoice, orders: [twoCardInvoice.orders[0]] }, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
  } },
  { invoice: { ...twoCardInvoice, orders: [twoCardInvoice.orders[0],
    { id: 'gift-order-123', product_id: 'amazon-us', quantity: 1 }] }, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
  } },
  { invoice: { ...twoCardInvoice, orders: [twoCardInvoice.orders[0],
    { id: 'gift-order-456', product_id: 'other-product', quantity: 1 }] }, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
  } },
  { invoice: twoCardInvoice, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
    'gift-order-456': { id: 'wrong-order', redemption_info: { code: 'CARD-TWO' } },
  } },
  { invoice: { ...twoCardInvoice, orders: [{ id: 'gift-order-123', product_id: 'amazon-us', quantity: 2 }] }, details: {
    'gift-order-123': { id: 'gift-order-123', redemption_info: { code: 'CARD-ONE' } },
  } },
]) {
  f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards',
    fulfillmentId: 'invoice-123', quantity: 2, response: badResponse })
  result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
  assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
  assert.equal(result.body.data.status, 'processing')
  assert.equal(f.writes(), 0, 'missing or ambiguous per-unit redemption must not complete whole purchase')
}

f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards', fulfillmentId: 'invoice-123', response: {
  invoice: { id: 'invoice-123', status: 'complete', orders: [{ id: 'gift-order-123', product_id: 'other-product' }] },
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
assert.equal(f.reads(), 1)
assert.equal(f.writes(), 0)

f = fixture({ source: 'istar', section: 'telegram_stars', itemType: 'telegram_stars', fulfillmentId: 'telegram-order-123', response: { order_id: 'telegram-order-123', status: 'completed', payload: { token: 'private-secret' } } })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.equal(result.body.data.response_payload.provider_status, 'completed')
assert.ok(!JSON.stringify(result).includes('private-secret'))

f = fixture({ source: 'istar', section: 'telegram_stars', itemType: 'telegram_stars', fulfillmentId: 'telegram-order-123', response: { order_id: 'wrong-order-123', status: 'completed' } })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
assert.equal(f.writes(), 0)

console.log('Partner external status: ownership, journal gate, readonly polls, confirmed completion, ambiguous failure, no financial mutation and payload whitelist passed.')
