// Pure gift-card contract and mocked HTTP client tests. No live provider or paid requests.
import assert from 'node:assert/strict'
import {
  parseGiftCardProduct, selectGiftCardUnit, validateGiftCardQuote,
  canonicalGiftCardRequest, validateCanonicalGiftCardRequest,
  verifyUnpaidGiftCardInvoice, readVerifiedGiftCardDelivery,
} from '../supabase/functions/_shared/customer-giftcard-contract.ts'
import { GiftCardProvider } from '../supabase/functions/_shared/customer-giftcard-provider.ts'

const productRaw = { data: { id: 'amazon-us', name: 'Amazon US', type: 'gift_card', in_stock: true,
  currency: 'USD', recipient_type: 'none',
  packages: [{ package_id: 'amazon-us<&>25', value: 25, price: 2450 },
    { id: 'amazon-us<&>50', value: 50, price: 4800 }],
  range: { min: 10, max: 200, step: 5, price_rate: 97 } } }
const product = parseGiftCardProduct(productRaw, 'amazon-us')
assert.ok(product)
assert.equal(product.packages.length, 2)
assert.deepEqual(selectGiftCardUnit(product, 'amazon-us<&>25', 25),
  { package_id: 'amazon-us<&>25', unit_value: 25, unit_price_candidate: 2450 })
assert.deepEqual(selectGiftCardUnit(product, null, 15),
  { package_id: null, unit_value: 15, unit_price_candidate: 1455 })
assert.equal(selectGiftCardUnit(product, 'amazon-us<&>25', 50), null)
assert.equal(selectGiftCardUnit(product, null, 12), null)
assert.equal(selectGiftCardUnit(product, 'invented-package', undefined), null)
for (const changed of [
  { type: 'phone_refill' }, { type: 'esim' }, { type: 'bill_payment' },
  { in_stock: false }, { recipient_type: 'phone_number' },
  { id: 'other-product' }, { product_id: 'other-product' }, { currency: 'USD-BTC' },
  { packages: [{ id: 'a', package_id: 'b', value: 25, price: 2450 }] },
  { packages: [{ package_id: 'amazon-us<&>25', value: 25, price: 2450 },
    { package_id: 'amazon-us<&>25', value: 25, price: 2450 }] },
  { packages: [{ package_id: '   ', value: 25, price: 2450 }] },
  { packages: [{ package_id: 'amazon-us<&>25', value: 25, amount: 50, price: 2450 }] },
  { packages: [], range: { min: 10, max: 20, step: 5, price_rate: 0 } },
]) assert.equal(parseGiftCardProduct({ data: { ...productRaw.data, ...changed } }, 'amazon-us'), null,
  `Malformed or non-gift-card catalog data must fail: ${JSON.stringify(changed)}`)

const quote = { product_id: 'amazon-us', product_name: 'Amazon US', package_id: 'amazon-us<&>25',
  unit_value: 25, currency: 'USD', quantity: 2, amount_ngn: 100000,
  provider_price: 4900, billing_currency: 'BTC' }
assert.deepEqual(validateGiftCardQuote(quote), quote)
const request = canonicalGiftCardRequest(quote)
assert.deepEqual(request, { product_id: 'amazon-us', package_id: 'amazon-us<&>25',
  unit_value: 25, quantity: 2, expected_amount_ngn: 100000 })
assert.deepEqual(Object.keys(request), ['product_id', 'package_id', 'unit_value', 'quantity', 'expected_amount_ngn'])
assert.deepEqual(validateCanonicalGiftCardRequest(request), request)
for (const changed of [
  { quantity: 0 }, { quantity: 21 }, { quantity: 1.5 }, { amount_ngn: 100001 },
  { amount_ngn: 1_000_000_010 }, { provider_price: 4900.25 }, { provider_price: 0 },
  { provider_price: 1_000_000_001 },
  { billing_currency: 'AUD' }, { currency: 'btc' }, { unit_value: -1 }, { package_id: 'bad\npackage' },
  { package_id: '   ' },
  { recipient_phone: '+15551234567' },
]) assert.equal(validateGiftCardQuote({ ...quote, ...changed }), null,
  `Malformed quote must fail: ${JSON.stringify(changed)}`)
assert.equal(validateCanonicalGiftCardRequest({ ...request, provider_price: 4900 }), null,
  'Client request must contain exactly five keys and no supplier price')
assert.equal(validateCanonicalGiftCardRequest({ ...request, quantity: 21 }), null)
assert.deepEqual(validateGiftCardQuote({ ...quote,billing_currency:'EUR',provider_price:49.25 })?.billing_currency,'EUR',
  'EUR balance invoices are valid; conversion still needs an owner-configured rate')

const child = (id) => ({ id, status: 'created', product: { id: 'amazon-us', value: 25,
  currency: 'USD', package_id: 'amazon-us<&>25' } })
const unpaid = { data: { id: 'invoice-123', status: 'unpaid',
  payment: { method: 'balance', price: 4900, currency: 'BTC' },
  orders: [{ id: 'order-1', status: 'created' }, { id: 'order-2', status: 'created' }] } }
const unpaidDetails = ['order-1', 'order-2'].map(id => ({ data: { id, status: 'created',
  product: { id: 'amazon-us', value: 25 } } }))
assert.equal(verifyUnpaidGiftCardInvoice(unpaid, 'invoice-123', quote, unpaidDetails), true,
  'Documented summary-only invoice and minimal product/value order details are acceptable once all children bind')
for (const changed of [
  { status: 'complete' }, { id: 'other-invoice' },
  { orders: [child('order-1')] },
  { orders: [child('order-1'), child('order-1')] },
  { orders: [child('order-1'), { ...child('order-2'), product: { ...child('order-2').product, id: 'other' } }] },
  { orders: [child('order-1'), { ...child('order-2'), product: { ...child('order-2').product, value: 50 } }] },
  { orders: [child('order-1'), { ...child('order-2'), product: { ...child('order-2').product, currency: 'EUR' } }] },
  { orders: [child('order-1'), { ...child('order-2'), product: { ...child('order-2').product, package_id: 'wrong' } }] },
  { orders: [child('order-1'), { ...child('order-2'), quantity: 2 }] },
  { orders: [child('order-1'), { ...child('order-2'), status: 'failed' }] },
  { payment: { method: 'bitcoin', price: 4900, currency: 'BTC' } },
  { payment: { method: 'balance', price: 4899, currency: 'BTC' } },
  { payment: { method: 'balance', price: 4900, currency: 'USD' } },
]) assert.equal(verifyUnpaidGiftCardInvoice({ data: { ...unpaid.data, ...changed } }, 'invoice-123', quote, unpaidDetails), false,
  `Unpaid invoice must bind every child and the exact balance payment: ${JSON.stringify(changed)}`)
assert.equal(verifyUnpaidGiftCardInvoice(unpaid, 'invoice-123', quote, []), false,
  'Missing child details cannot prove an unpaid invoice is bound')
for (const details of [
  [unpaidDetails[0]],
  [unpaidDetails[0], unpaidDetails[0]],
  [unpaidDetails[0], { data: { ...child('order-2'), product: { id: 'other', value: 25 } } }],
  [unpaidDetails[0], { data: { ...child('order-2'), product: { id: 'amazon-us', value: 50 } } }],
  [unpaidDetails[0], { data: { ...child('order-2'), product: { id: 'amazon-us', value: 25, package_id: 'other' } } }],
  [unpaidDetails[0], { data: { ...child('order-2'), status: 'failed' } }],
  [unpaidDetails[0], { data: { id: 'order-2', status: 'created', product: { id: 'amazon-us' } } }],
]) assert.equal(verifyUnpaidGiftCardInvoice(unpaid, 'invoice-123', quote, details), false,
  'Each child detail must be distinct, pending, and bound to the exact product/value')

const completeInvoice = { data: { id: 'invoice-123', status: 'complete',
  orders: [child('order-1'), child('order-2')].map(item => ({ ...item, status: 'delivered' })) } }
const detail = id => ({ data: { id, status: 'delivered', product: { id: 'amazon-us', value: 25,
  currency: 'USD', package_id: 'amazon-us<&>25' }, redemption_info: { code: `CODE-${id}`, pin: `PIN-${id}` } } })
const deliveredClient = { invoice: async () => completeInvoice, order: async id => detail(id) }
const delivered = await readVerifiedGiftCardDelivery(deliveredClient, 'invoice-123', quote)
assert.equal(delivered.completed, true)
if (delivered.completed) {
  assert.equal(delivered.delivery.redemptions.length, 2)
  assert.deepEqual(delivered.delivery.redemptions.map(item => item.code), ['CODE-order-1', 'CODE-order-2'])
}
for (const badClient of [
  { invoice: async () => ({ data: { ...completeInvoice.data, orders: [child('order-1')] } }), order: deliveredClient.order },
  { invoice: async () => ({ data: { ...completeInvoice.data, orders: [child('order-1'), child('order-1')] } }), order: deliveredClient.order },
  { invoice: async () => ({ data: { ...completeInvoice.data, orders: [{ ...child('order-1'), status: 'failed' }, child('order-2')] } }), order: deliveredClient.order },
  { invoice: deliveredClient.invoice, order: async id => id === 'order-2' ? { data: { ...detail(id).data, status: 'failed' } } : detail(id) },
  { invoice: deliveredClient.invoice, order: async id => id === 'order-2' ? { data: { ...detail(id).data, product: { id: 'other', value: 25 } } } : detail(id) },
  { invoice: deliveredClient.invoice, order: async id => id === 'order-2' ? { data: { ...detail(id).data, redemption_info: {} } } : detail(id) },
]) assert.equal((await readVerifiedGiftCardDelivery(badClient, 'invoice-123', quote)).completed, false,
  'Partial, duplicate, failed, unbound, or credential-free delivery must remain held')

const calls = []
const mockedFetch = async (url, init) => {
  calls.push({ url, init })
  return new Response('{}')
}
const provider = new GiftCardProvider('synthetic-secret', mockedFetch)
const selectionRequest={product_id:request.product_id,package_id:request.package_id,
  unit_value:request.unit_value,quantity:request.quantity}
await provider.createUnpaidInvoice(selectionRequest)
assert.equal(calls.length, 1)
assert.equal(calls[0].url, 'https://api.bitrefill.com/v2/invoices')
assert.equal(calls[0].init.redirect, 'error')
assert.equal(calls[0].init.method, 'POST')
assert.deepEqual(JSON.parse(calls[0].init.body), { products: [{ product_id: 'amazon-us', quantity: 2,
  package_id: 'amazon-us<&>25' }], payment_method: 'balance', auto_pay: false })
assert.equal(Object.hasOwn(JSON.parse(calls[0].init.body).products[0], 'phone_number'), false)
await provider.createUnpaidInvoice({ ...selectionRequest, package_id: null, unit_value: 15 })
assert.deepEqual(JSON.parse(calls.at(-1).init.body), { products: [{ product_id: 'amazon-us', quantity: 2, value: 15 }],
  payment_method: 'balance', auto_pay: false })
await provider.pay('invoice-123')
assert.equal(calls.at(-1).url, 'https://api.bitrefill.com/v2/invoices/invoice-123/pay')
assert.deepEqual(JSON.parse(calls.at(-1).init.body), {})
assert.equal(calls.filter(call => call.url.endsWith('/pay')).length, 1, 'Provider must not retry the paid request')
await provider.product('amazon-us'); await provider.balance(); await provider.invoice('invoice-123'); await provider.order('order-1')
assert.deepEqual(calls.slice(-4).map(call => call.init.method), ['GET', 'GET', 'GET', 'GET'])
assert.throws(() => provider.product('../outside'))
assert.throws(() => provider.pay('bad/id'))
assert.throws(() => provider.createUnpaidInvoice({ ...selectionRequest, quantity: 21 }))
assert.throws(() => provider.createUnpaidInvoice(request),
  'Provider invoice creation accepts only selection, never customer-asserted NGN price')

for (const response of [
  new Response('{}', { status: 503 }),
  { ok: true, redirected: true },
  new Response('{}', { headers: { 'content-length': '1000001' } }),
  new Response('x'.repeat(1_000_001)),
  new Response('not JSON'),
]) {
  const one = new GiftCardProvider('synthetic-secret', async () => response)
  await assert.rejects(() => one.invoice('invoice-123'))
}
let oversizedStreamCancelled = false
const oversizedStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(700_000))
    controller.enqueue(new Uint8Array(400_001))
  },
  cancel() { oversizedStreamCancelled = true },
})
const oversized = new GiftCardProvider('synthetic-secret', async () => new Response(oversizedStream))
await assert.rejects(() => oversized.invoice('invoice-123'), /too large/)
assert.equal(oversizedStreamCancelled, true, 'Oversized streamed responses must cancel before buffering more bytes')
const realSetTimeout = globalThis.setTimeout
try {
  globalThis.setTimeout = (callback, milliseconds, ...args) => realSetTimeout(callback, milliseconds >= 12_000 ? 5 : milliseconds, ...args)
  let attempted = 0
  let aborted = false
  const hung = new GiftCardProvider('synthetic-secret', async (_url, init) => {
    attempted++
    init.signal.addEventListener('abort', () => { aborted = true })
    return new Promise(() => {})
  })
  await assert.rejects(() => hung.pay('invoice-123'), /deadline/)
  assert.equal(attempted, 1, 'Timeout must not retry a paid request')
  assert.equal(aborted, true)
  let hungBodyCancelled = false
  const body = new ReadableStream({ cancel() { hungBodyCancelled = true } })
  const hungBody = new GiftCardProvider('synthetic-secret', async () => new Response(body))
  await assert.rejects(() => hungBody.invoice('invoice-123'), /deadline/)
  assert.equal(hungBodyCancelled, true, 'Deadline must cancel a stalled response body reader')
} finally { globalThis.setTimeout = realSetTimeout }

console.log('Customer gift-card pure contract and mocked provider tests passed')
