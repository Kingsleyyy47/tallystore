import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../supabase/functions/_shared/partner-bills-gift-telegram.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(code, { exports, setTimeout, clearTimeout })
const { preparePartnerBillsPlan, preparePartnerGiftcardPlan, preparePartnerTelegramPlan } = exports
const orderId = '10000000-0000-4000-8000-000000000001'
const partner = { allowed_sections: ['bills_airtime', 'giftcards', 'telegram_stars'], markup_percent: 10 }
const calls = { airtime: 0, data: 0, giftcard: 0, telegram: 0, recipient: 0 }
let billResponse = { success: true, status: 'success', reference: 'sage-123' }
let invoiceResponse = { id: 'invoice-123', status: 'pending', orders: [{ id: 'gift-order-123' }] }
let telegramResponse = { order_id: 'telegram-order-123', status: 'pending' }
let recipientResponse = { success: true, recipient: 'ABCDEF123456' }
const admin = {
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
    getProductDetails: async () => ({ product_id: 'amazon-us', name: 'Amazon', currency: 'USD', recipient_type: 'email',
      packages: [{ package_id: 'ten', value: 10 }], range: { min: 5, max: 50, step: 5 } }),
    getBalance: async () => ({ balance: 500, currency: 'USD' }),
    createInvoice: async () => { calls.giftcard++; return invoiceResponse },
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
const giftcard = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', quantity: 2, customer_email: 'buyer@example.com', expected_amount_ngn: 23101,
}, deps)
assert.equal(giftcard.amountNgn, 23101)
assert.equal(calls.giftcard, 0)
const acceptedGiftcard = await giftcard.dispatch(orderId)
assert.equal(acceptedGiftcard.id, 'invoice-123')
assert.equal(acceptedGiftcard.status, 'processing')
assert.equal(acceptedGiftcard.payload.provider_order_id, 'gift-order-123')
assert.equal(calls.giftcard, 1)
invoiceResponse = { status: 'pending', message: 'private token abcdef' }
const uncertainGiftcard = await preparePartnerGiftcardPlan(admin, partner, {
  item_id: 'amazon-us', package_id: 'ten', customer_email: 'buyer@example.com',
}, deps)
assert.equal((await uncertainGiftcard.dispatch(orderId)).kind, 'unknown')
assert.ok(!JSON.stringify(await uncertainGiftcard.dispatch(orderId)).includes('private token'))

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

console.log('Partner bills/gift/Telegram plans: server pricing, recipient validation, one paid send, accepted IDs, ambiguous outcomes and redaction passed.')
