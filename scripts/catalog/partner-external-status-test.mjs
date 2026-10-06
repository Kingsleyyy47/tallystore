import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { canonicalIstarOrderId, validateIstarOrderReceipt } from '../../supabase/functions/_shared/istar-order-contract.ts'

const source = readFileSync(new URL('../../supabase/functions/_shared/partner-external-status.ts', import.meta.url), 'utf8')
const deliverySource = readFileSync(new URL('../../supabase/functions/_shared/partner-bitrefill-delivery.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const deliveryCode = ts.transpileModule(deliverySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const deliveryExports = {}
vm.runInNewContext(deliveryCode, { exports: deliveryExports, setTimeout, clearTimeout, URL })
const exports = {}
vm.runInNewContext(code, { exports, setTimeout, clearTimeout, URL, encodeURIComponent,
  require: specifier => {
    if (specifier === './partner-bitrefill-delivery.ts') return deliveryExports
    assert.equal(specifier, './istar-order-contract.ts')
    return { canonicalIstarOrderId, validateIstarOrderReceipt }
  }, Deno: { env: { get: () => 'server-secret' } } })
const { handlePartnerExternalOrderStatus } = exports
const orderId = '10000000-0000-4000-8000-000000000001'
const partnerId = '20000000-0000-4000-8000-000000000001'
const keyId = '30000000-0000-4000-8000-000000000001'
const auth = { partner: { id: partnerId }, key: { id: keyId, scopes: ['orders:read'] } }

function fixture({ source = 'daisy', section = 'sms', itemType = 'sms', fulfillmentId = 'provider-123', journalState = 'accepted', response = 'STATUS_OK:123456', status = 'processing', quantity = 1, requestPayload, responsePayload = { api_key: 'private-secret', provider_status: 'pending' }, boundReceipt } = {}) {
  let reads = 0
  let writes = 0
  let boundReads = 0
  const storedRequest = requestPayload ?? (source === 'istar'
    ? { telegram_type:'stars',username:'example_user',recipient_hash:'ABCDEF123456',
      item_id:'stars:100',quantity:100,wallet_type:'USDT' }
    : { value:50, provider_currency:'USD', package_id:null })
  const originalReceipt = boundReceipt === undefined
    ? { order_id:'4820',status:'processing',order_type:'star',username:'example_user',
      quantity:100,amount:'1',wallet_type:'USDT' } : boundReceipt
  let order = { id: orderId, partner_id: partnerId, partner_reference: 'reference-123', status,
    item_type: itemType, item_id: source === 'istar' ? 'stars:100' : 'amazon-us',
    quantity: source === 'istar' ? 100 : quantity,
    fulfillment_source: source, fulfillment_id: fulfillmentId,
    request_payload: storedRequest,
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
      if (name === 'get_api_partner_istar_receipt') {
        boundReads++
        assert.equal(args.p_key_id,keyId);assert.equal(args.p_order_id,orderId)
        return { data: originalReceipt ? { success:true,order_id:orderId,
          provider_receipt:originalReceipt,request_payload:storedRequest }
          : { success:false,code:'ISTAR_RECEIPT_REVIEW_REQUIRED' }, error:null }
      }
      if (name === 'complete_api_partner_istar_order') {
        assert.equal(args.p_key_id,keyId);assert.equal(args.p_order_id,orderId)
        assert.equal(args.p_provider_receipt.order_id,fulfillmentId)
        assert.equal(args.p_provider_receipt.amount,'1')
        assert.equal(args.p_provider_receipt.quantity,100)
        writes++
        order={...order,status:'completed',response_payload:{...order.response_payload,provider_status:'completed'}}
        return { data:{success:true,data:{id:order.id,status:order.status,
          amount_ngn:100,response_payload:order.response_payload}},error:null }
      }
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
  return { admin, deps, reads: () => reads, writes: () => writes, boundReads: () => boundReads }
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
  accounts: [{ username: 'discord-user', password: 'discord-pass', email: 'synthetic-mail',
    email_password: 'mail-pass', two_fa_code: '2fa-key', recovery_email: 'synthetic-recovery',
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
  detail: { id: 'gift-order-123', status: 'delivered', product: { id: 'amazon-us', value: 50 }, redemption_info: { code: 'GIFT-123', link: 'https://redeem.example/card', api_key: 'private-secret' } },
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
      'gift-order-123': { id: 'gift-order-123', status: 'delivered', product: { id: 'amazon-us', value: 50 }, redemption_info: { code: 'CARD-ONE', api_key: 'private-secret' } },
      'gift-order-456': { id: 'gift-order-456', status: 'delivered', product_id: 'amazon-us', value: 50, redemption_info: { code: 'CARD-TWO', pin: '2468' } },
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

const verifiedTwoDetails = {
  'gift-order-123': { id: 'gift-order-123', status: 'delivered', product: { id: 'amazon-us', value: 50 }, redemption_info: { code: 'CARD-ONE' } },
  'gift-order-456': { id: 'gift-order-456', status: 'delivered', product: { id: 'amazon-us', value: 50 }, redemption_info: { code: 'CARD-TWO' } },
}
for (const [name, badDetails] of [
  ['wrong denomination', { ...verifiedTwoDetails, 'gift-order-456': { ...verifiedTwoDetails['gift-order-456'], product: { id: 'amazon-us', value: 100 } } }],
  ['failed unit', { ...verifiedTwoDetails, 'gift-order-456': { ...verifiedTwoDetails['gift-order-456'], status: 'failed' } }],
  ['PIN only', { ...verifiedTwoDetails, 'gift-order-456': { ...verifiedTwoDetails['gift-order-456'], redemption_info: { pin: '2468' } } }],
  ['credentialed link', { ...verifiedTwoDetails, 'gift-order-456': { ...verifiedTwoDetails['gift-order-456'], redemption_info: { link: 'https://user:pass@example.invalid/card' } } }],
  ['conflicting flat product', { ...verifiedTwoDetails, 'gift-order-456': { ...verifiedTwoDetails['gift-order-456'], product_id: 'other-product' } }],
]) {
  f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards', fulfillmentId: 'invoice-123', quantity: 2,
    response: { invoice: { ...twoCardInvoice, orders: [{ id: 'gift-order-123' }, { id: 'gift-order-456' }] }, details: badDetails } })
  result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
  assert.equal(result.body.code, 'RECONCILIATION_REQUIRED', `${name} was accepted`)
  assert.equal(f.writes(), 0, `${name} changed financial state`)
}

for (const missingQuote of [
  { provider_currency: 'USD' },
  { value: 50 },
]) {
  f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards', fulfillmentId: 'invoice-123', quantity: 2,
    requestPayload: missingQuote,
    response: { invoice: { ...twoCardInvoice, orders: [{ id: 'gift-order-123' }, { id: 'gift-order-456' }] }, details: verifiedTwoDetails } })
  result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
  assert.equal(result.body.code, 'RECONCILIATION_REQUIRED', 'Missing original quote completed an order')
  assert.equal(f.writes(), 0)
}

f = fixture({ source: 'bitrefill', section: 'giftcards', itemType: 'giftcards', fulfillmentId: 'invoice-123', response: {
  invoice: { id: 'invoice-123', status: 'complete', orders: [{ id: 'gift-order-123', product_id: 'other-product' }] },
} })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
assert.equal(f.reads(), 1)
assert.equal(f.writes(), 0)

const completeIstar = { order_id:'4820',status:'completed',username:'example_user',quantity:100,
  amount:1,wallet_type:'USDT',payload:{token:'private-secret'} }
f = fixture({ source: 'istar', section: 'telegram_stars', itemType: 'telegram_stars', fulfillmentId: '4820', response: completeIstar })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.data.status, 'completed')
assert.equal(result.body.data.response_payload.provider_status, 'completed')
assert.ok(!JSON.stringify(result).includes('private-secret'))
assert.equal(f.boundReads(),1)
assert.equal(f.reads(),1)
assert.equal(f.writes(),1)

f = fixture({ source:'istar',section:'telegram_stars',itemType:'telegram_stars',
  fulfillmentId:'4820',response:completeIstar,boundReceipt:null })
result = await handlePartnerExternalOrderStatus(f.admin,auth,{order_id:orderId},f.deps)
assert.equal(result.body.code,'RECONCILIATION_REQUIRED','legacy order without bound receipt must be held')
assert.equal(f.boundReads(),1);assert.equal(f.reads(),0);assert.equal(f.writes(),0)

for(const invalid of [
  {order_id:'4820',status:'completed'},
  {...completeIstar,amount:1.01},
  {...completeIstar,wallet_type:'TON'},
  {...completeIstar,quantity:101},
  {...completeIstar,username:'other_user'},
  {...completeIstar,recipient_hash:'other_hash'},
  {...completeIstar,order_type:'premium'},
  {...completeIstar,payload:{username:'other_user'}},
  {...completeIstar,payload:{recipient:'other_hash'}},
  {...completeIstar,payload:{quantity:999}},
  {...completeIstar,payload:{amount:'99'}},
  {...completeIstar,payload:{wallet_type:'TON'}},
  {...completeIstar,payload:{order_type:'premium'}},
]){
  f=fixture({source:'istar',section:'telegram_stars',itemType:'telegram_stars',
    fulfillmentId:'4820',response:invalid})
  result=await handlePartnerExternalOrderStatus(f.admin,auth,{order_id:orderId},f.deps)
  assert.equal(result.body.code,'RECONCILIATION_REQUIRED',`invalid iStar completion was accepted: ${JSON.stringify(invalid)}`)
  assert.equal(f.writes(),0,'invalid iStar completion must not post order status')
}

f = fixture({ source: 'istar', section: 'telegram_stars', itemType: 'telegram_stars', fulfillmentId: '4820', response: { order_id: '4930', status: 'completed' } })
result = await handlePartnerExternalOrderStatus(f.admin, auth, { order_id: orderId }, f.deps)
assert.equal(result.body.code, 'RECONCILIATION_REQUIRED')
assert.equal(f.writes(), 0)

console.log('Partner external status: ownership, journal gate, readonly polls, confirmed completion, ambiguous failure, no financial mutation and payload whitelist passed.')
