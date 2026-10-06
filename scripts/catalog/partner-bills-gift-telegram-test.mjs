import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parseGiftCardSelection, selectGiftCardDenomination, unwrapGiftCardData,
  verifyBoundUnpaidGiftCardInvoice } from '../../supabase/functions/_shared/customer-giftcard-contract.ts'
import { giftCardInvoiceRetailTotal } from '../../supabase/functions/_shared/partner-giftcard-price.ts'

const source = readFileSync(new URL('../../supabase/functions/_shared/partner-bills-gift-telegram.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(code, { exports, setTimeout, clearTimeout,
  require: specifier => {
    if (specifier === './partner-giftcard-price.ts') return { giftCardInvoiceRetailTotal }
    assert.equal(specifier, './customer-giftcard-contract.ts')
    return { parseGiftCardSelection, selectGiftCardDenomination, unwrapGiftCardData,
      verifyBoundUnpaidGiftCardInvoice }
  } })
const { preparePartnerBillsPlan, preparePartnerGiftcardPlan, preparePartnerTelegramPlan } = exports
const orderId = '10000000-0000-4000-8000-000000000001'
const partner = { id: '30000000-0000-4000-8000-000000000001', allowed_sections: ['bills_airtime', 'giftcards', 'telegram_stars'], markup_percent: 10 }
const calls = { airtime: 0, data: 0, giftcard: 0, giftcardBind: 0, giftcardPay: 0, telegram: 0, recipient: 0 }
let billResponse = { success: true, status: 'success', reference: 'sage-123' }
let invoiceResponse = null
let invoiceCreateMutation = null
let invoiceReadMutation = null
let invoiceReadCount = 0
let childMutation = null
let invoiceSelection = null
let paidResponse = { id: 'invoice-123', status: 'pending', orders: [{ id: 'gift-order-123' }] }
let bindResponse = { success: true, idempotent_replay: false, pay_allowed: true, order_id: orderId }
let telegramResponse = { order_id: 'telegram-order-123', status: 'pending' }
let recipientResponse = { success: true, recipient: 'ABCDEF123456' }
let giftProductResponse = { product_id: 'amazon-us', name: 'Amazon', type: 'gift_card', in_stock: true,
  currency: 'USD', recipient_type: 'none', packages: [{ package_id: 'ten', value: 10, price: 6.7 }],
  range: { min: 5, max: 50, step: 5, price_rate: 0.95 } }
let giftPricingRule = { mode: 'percent', value: 5, source: 'global' }
const admin = {
  async rpc(name, args) {
    if (name === 'get_customer_bitrefill_pricing') {
      assert.equal(args.p_kind, 'gift_card'); assert.equal(args.p_product_id, 'amazon-us')
      assert.equal(args.p_unit_value, invoiceSelection.value ?? 10)
      assert.equal(args.p_package_id, invoiceSelection.package_id ?? null)
      return { data: giftPricingRule, error: null }
    }
    assert.equal(name, 'bind_api_partner_bitrefill_invoice')
    assert.equal(args.p_order_id, orderId)
    assert.equal(args.p_partner_id, partner.id)
    calls.giftcardBind++
    return { data: bindResponse, error: null }
  },
  from(table) {
    const query = {
      select() { return query }, eq() { return query },
      async single() { return table === 'telegram_products'
        ? { data: { id: '20000000-0000-4000-8000-000000000001', months: 3, label: '3-Month Telegram Premium', price_ngn: 5000 }, error: null }
        : { data: null, error: null } },
      async maybeSingle() { return { data: { value: 'USDT' }, error: null } },
    }
    return query
  },
}
const deps = {
  hasSection: (p, section) => p.allowed_sections.includes(section),
  partnerMarkup: (p, amount) => Math.ceil(amount * (1 + p.markup_percent / 100)),
  sageCloudClient: () => ({
    getBalanceAmount: async () => 100000,
    getDataPlans: async () => ({ success: true, data: [{ code: 'PLAN.1', price: '400', description: '1 GB' }] }),
    purchaseAirtime: async () => { calls.airtime++; return billResponse },
    purchaseData: async () => { calls.data++; return billResponse },
  }),
  getBitrefillClient: () => ({
    getProductDetails: async () => giftProductResponse,
    getBalance: async () => ({ balance: 500, currency: 'USD' }),
    createInvoice: async input => {
      assert.equal(input.auto_pay, false); assert.equal(input.payment_method, 'balance')
      calls.giftcard++; invoiceReadCount = 0; invoiceSelection = input.products[0]
      invoiceResponse = { id: 'invoice-123', status: 'unpaid',
        payment: { method: 'balance', currency: 'USD', price: 9.5 * invoiceSelection.quantity },
        orders: Array.from({ length: invoiceSelection.quantity }, (_, i) => ({ id: `gift-order-${i + 1}`, status: 'created' })) }
      if (invoiceCreateMutation) invoiceResponse = invoiceCreateMutation(invoiceResponse)
      return invoiceResponse
    },
    getInvoice: async () => { invoiceReadCount++
      return invoiceReadMutation && invoiceReadCount === 2
        ? invoiceReadMutation(invoiceResponse) : invoiceResponse },
    getOrder: async id => {
      const detail = { id, status: 'created', product: { id: 'amazon-us',
        value: invoiceSelection.value ?? 10, currency: giftProductResponse.currency,
        ...(invoiceSelection.package_id ? { package_id: invoiceSelection.package_id } : {}) } }
      return childMutation ? childMutation(detail) : detail
    },
    payInvoice: async id => { assert.equal(id, 'invoice-123'); calls.giftcardPay++; return paidResponse },
  }),
  getBlockedBitrefillIds: async () => new Set(),
  getBitrefillMarkupPct: async () => 5,
  convertToNgn: async (_admin, amount, currency) => currency === 'USD' ? amount * 1000 : amount,
  getTelegramStarPricing: async () => ({ cost_per_star_usdt: 0.01, usdt_to_ngn: 1000, wallet_type: 'USDT' }),
  calculateTelegramStarsPrice: quantity => quantity * 10,
  getTelegramPremiumPricing: async () => ({ costs: { '3': 5 }, usdt_to_ngn: 1000 }),
  calculateTelegramPremiumPrice: () => 5000,
  istarGet: async () => { calls.recipient++; return recipientResponse },
  istarPost: async () => { calls.telegram++; return telegramResponse },
}

const airtime = await preparePartnerBillsPlan(admin, partner, {
  item_id: 'airtime:MTN', phone: '08012345678', amount_ngn: 1000, expected_amount_ngn: 1100,
}, deps)
assert.equal(airtime.amountNgn, 1100)
assert.equal(calls.airtime, 0, 'preparation must not send paid request')
assert.equal((await airtime.dispatch(orderId)).id, 'sage-123')
assert.equal((await airtime.dispatch(orderId)).kind, 'unknown', 'second paid send must be blocked')
assert.equal(calls.airtime, 1)
await assert.rejects(preparePartnerBillsPlan(admin, partner, {
  item_id: 'data:MTN:PLAN.1', phone: '08012345678', amount_ngn: 400,
}, deps), /PRICE_CHANGED/)
const dataPlan = await preparePartnerBillsPlan(admin, partner, {
  item_id: 'data:MTN:PLAN.1', phone: '08012345678', amount_ngn: 441,
}, deps)
assert.equal(dataPlan.amountNgn, 441)
assert.equal(calls.data, 0)
await assert.rejects(preparePartnerBillsPlan(admin, partner, {
  item_id: 'airtime:MTN', phone: '08012345678', amount_ngn: 1000, quantity: Infinity,
}, deps), /INVALID_QUANTITY/)
billResponse = { success: false, status: 'failed', message: 'provider secret token' }
assert.equal((await dataPlan.dispatch(orderId)).kind, 'unknown', 'boolean false is not confirmed no-dispatch rejection')
assert.equal(calls.data, 1)

await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'invalid',
}, deps), /INVALID_RECIPIENT/)
const validGiftProduct = giftProductResponse
const priorGiftCalls = calls.giftcard
for (const changed of [
  { type: 'phone_refill' }, { type: 'esim' }, { in_stock: false },
  { recipient_type: 'phone_number' }, { recipient_type: 'email' },
  { product_id: 'foreign-product' }, { currency: 'INVALID' },
]) {
  giftProductResponse = { ...validGiftProduct, ...changed }
  await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
    item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
  }, deps), /NO_STOCK|PRICE_UNAVAILABLE/)
}
giftProductResponse = validGiftProduct
giftProductResponse = { ...validGiftProduct, currency: 'EUR', packages: [{ package_id: 'ten', value: 10 }],
  range: { min: 5, max: 50, step: 5 } }
const documentedSelection = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, deps)
assert.equal(documentedSelection.amountNgn, 10978, 'documented denominations need no guessed catalog billing units')
assert.equal(calls.giftcardPay, 0)
giftProductResponse = validGiftProduct
for (const selection of [
  { package_id: 'other' }, { package_id: 'ten', value: 15 },
  { package_id: '  ' }, { value: 12 }, { value: '10' },
]) await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', customer_email: 'buyer@example.com', ...selection,
}, deps), /INVALID_ITEM/)
assert.equal(calls.giftcard, priorGiftCalls + 1, 'only documented valid selection created an unpaid invoice')
const rangedGiftcard = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', value: 15, quantity: 1, customer_email: 'buyer@example.com',
}, deps)
assert.equal(rangedGiftcard.requestPayload.value, 15)
assert.equal(rangedGiftcard.requestPayload.package_id, null)
assert.equal(calls.giftcard, priorGiftCalls + 2, 'preparation creates only an unpaid invoice')
assert.equal(calls.giftcardPay, 0)
const giftcard = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', quantity: 2, customer_email: 'buyer@example.com', expected_amount_ngn: 21956,
}, deps)
assert.equal(giftcard.amountNgn, 21956, 'invoice cost and configured markup round each retail unit to ₦10')
assert.equal(calls.giftcard, priorGiftCalls + 3)
assert.equal(calls.giftcardPay, 0, 'unpaid invoice creation never pays')
const acceptedGiftcard = await giftcard.dispatch(orderId)
assert.equal(acceptedGiftcard.id, 'invoice-123')
assert.equal(acceptedGiftcard.status, 'processing')
assert.equal(acceptedGiftcard.payload.provider_order_id, null, 'two-card invoice must not imply one delivered order')
assert.equal(calls.giftcard, priorGiftCalls + 3, 'dispatch uses the already verified invoice')
assert.equal(calls.giftcardBind, 1)
assert.equal(calls.giftcardPay, 1)
giftPricingRule = { mode: 'amount', value: 25, source: 'denomination' }
const fixedMarkupGiftcard = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', quantity: 2, customer_email: 'buyer@example.com',
  expected_amount_ngn: 20966,
}, deps)
assert.equal(fixedMarkupGiftcard.amountNgn, 20966)
await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', quantity: 2, customer_email: 'buyer@example.com',
  expected_amount_ngn: 21956,
}, deps), /PRICE_CHANGED/)
assert.equal(calls.giftcardPay, 1, 'changed configured markup cannot spend before expected price matches')
giftPricingRule = { mode: 'percent', value: 5, source: 'global' }
const beforeRejectedInvoices = calls.giftcard
for (const mutate of [
  invoice => ({ ...invoice, id: 'invalid invoice id' }),
  invoice => ({ ...invoice, status: 'pending' }),
  invoice => ({ ...invoice, payment: { ...invoice.payment, method: 'bitcoin' } }),
  invoice => ({ ...invoice, payment: { ...invoice.payment, currency: 'BTC' } }),
  invoice => ({ ...invoice, payment: { ...invoice.payment, price: '19' } }),
  invoice => ({ ...invoice, orders: [invoice.orders[0], invoice.orders[0]] }),
  invoice => ({ ...invoice, orders: invoice.orders.slice(0, 1) }),
]) {
  invoiceCreateMutation = mutate
  await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
    item_id: 'amazon-us', package_id: 'ten', quantity: 2, customer_email: 'buyer@example.com',
  }, deps), /PRICE_UNAVAILABLE/)
  assert.equal(calls.giftcardPay, 1, 'bad unpaid invoice cannot reach payment')
}
invoiceCreateMutation = null
assert.equal(calls.giftcard, beforeRejectedInvoices + 7)
for (const mutate of [
  detail => ({ ...detail, product: { ...detail.product, id: 'foreign-product' } }),
  detail => ({ ...detail, product: { ...detail.product, value: 20 } }),
  detail => ({ ...detail, product: { ...detail.product, package_id: 'foreign-package' } }),
  detail => ({ ...detail, product: { ...detail.product, currency: 'EUR' } }),
]) {
  childMutation = mutate
  await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
    item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
  }, deps), /PRICE_UNAVAILABLE/)
  assert.equal(calls.giftcardPay, 1)
}
childMutation = null
for (const mutate of [
  invoice => ({ ...invoice, payment: { ...invoice.payment, price: 11 } }),
  invoice => ({ ...invoice, payment: { ...invoice.payment, currency: 'NGN' } }),
  invoice => ({ ...invoice, orders: [{ id: 'foreign-order' }] }),
]) {
  invoiceReadMutation = mutate
  const stale = await preparePartnerGiftcardPlan(admin, partner, {
    item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
  }, deps)
  assert.equal((await stale.dispatch(orderId)).kind, 'unknown')
  assert.equal(calls.giftcardPay, 1, 'changed invoice after bind cannot reach payment')
}
invoiceReadMutation = null
bindResponse = { success: false, code: 'PRIVATE_DATABASE_ERROR' }
const noBind = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, deps)
assert.equal((await noBind.dispatch(orderId)).kind, 'unknown')
assert.equal(calls.giftcardPay, 1, 'binding failure cannot pay')
bindResponse = { success: true, idempotent_replay: true, pay_allowed: false, order_id: orderId }
const replayBind = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, deps)
assert.equal((await replayBind.dispatch(orderId)).kind, 'unknown')
assert.equal(calls.giftcardPay, 1, 'binding replay cannot pay again')
bindResponse = { success: true, idempotent_replay: false, pay_allowed: true, order_id: orderId }
paidResponse = { id: 'foreign-invoice', status: 'complete', private_message: 'private token abcdef' }
const wrongPaidInvoice = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, deps)
assert.equal((await wrongPaidInvoice.dispatch(orderId)).kind, 'unknown')
assert.equal(calls.giftcardPay, 2)
assert.equal((await wrongPaidInvoice.dispatch(orderId)).kind, 'unknown')
assert.equal(calls.giftcardPay, 2, 'lost/mismatched paid response never retries')
const beforeUnwired = calls.giftcard
await assert.rejects(preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, { ...deps, getBitrefillClient: () => {
  const client = deps.getBitrefillClient()
  delete client.payInvoice
  return client
} }), /PRICE_UNAVAILABLE/)
assert.equal(calls.giftcard, beforeUnwired, 'unwired paid client cannot create an orphan invoice')

recipientResponse = { success: true, recipient: 'DIFFERENT123' }
await assert.rejects(preparePartnerTelegramPlan(admin, partner, {
  item_id: 'stars:100', username: '@example_user', recipient_hash: 'ABCDEF123456', quantity: 100,
}, deps), /INVALID_RECIPIENT/)
assert.equal(calls.telegram, 0)
recipientResponse = { success: true, recipient: 'ABCDEF123456' }
const telegram = await preparePartnerTelegramPlan(admin, partner, {
  item_id: 'stars:100', username: '@example_user', recipient_hash: 'ABCDEF123456', quantity: 100, expected_amount_ngn: 1100,
}, deps)
assert.equal(telegram.amountNgn, 1100)
assert.equal(calls.telegram, 0)
const acceptedTelegram = await telegram.dispatch(orderId)
assert.equal(acceptedTelegram.id, 'telegram-order-123')
assert.equal(acceptedTelegram.status, 'processing')
assert.equal(calls.telegram, 1)
telegramResponse = { success: false, error: 'api key secret' }
const ambiguousTelegram = await preparePartnerTelegramPlan(admin, partner, {
  item_id: 'premium:20000000-0000-4000-8000-000000000001', username: '@example_user', recipient_hash: 'ABCDEF123456',
}, deps)
assert.equal((await ambiguousTelegram.dispatch(orderId)).kind, 'unknown')
assert.ok(!JSON.stringify(await ambiguousTelegram.dispatch(orderId)).includes('api key secret'))

console.log('Partner bills/gift/Telegram plans: server pricing, recipient validation, unpaid Bitrefill invoice bound before one paid send, ambiguous outcomes and redaction passed.')
