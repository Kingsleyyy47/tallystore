import assert from 'node:assert/strict'
import { partnerGiftCardCatalogue } from '../../supabase/functions/_shared/partner-giftcard-catalogue.ts'
const gift = { product_id: 'amazon-us', name: 'Amazon', type: 'gift_card', in_stock: true,
  currency: 'USD', packages: [{ package_id: 'amazon-us<&>10', value: 10, price: 6.7 }],
  range: { min: 5, max: 50, step: 5, price_rate: 0.95 },
  api_key: 'PRIVATE_SUPPLIER_VALUE' }
const items = partnerGiftCardCatalogue({ data: [gift,
  { ...gift, product_id: 'phone', type: 'phone_refill' },
  { ...gift, product_id: 'esim', type: 'esim' },
  { ...gift, product_id: 'sold', in_stock: false },
  { ...gift, product_id: 'blocked' },
  { ...gift, product_id: 'requires-phone', recipient_type: 'phone_number' },
] }, new Set(['blocked']))
assert.equal(items.length, 1)
assert.equal(items[0].price_ngn, null)
assert.equal(items[0].price_basis, 'live_quote')
assert.deepEqual(items[0].packages, [{ package_id: 'amazon-us<&>10', value: 10, currency: 'USD', price_ngn: null }])
assert.deepEqual(items[0].range, { min: 5, max: 50, step: 5, currency: 'USD' })
assert.equal(JSON.stringify(items).includes('PRIVATE_'), false)
assert.equal(JSON.stringify(items).includes('6.7'), false, 'undocumented catalog billing amount is not a selling price')
assert.equal(partnerGiftCardCatalogue([{ ...gift, currency: 'EUR',
  packages: [{ package_id: 'ten', value: 10 }], range: { min: 5, max: 50, step: 5 } }], new Set()).length, 1)
for (const malformed of [{ data: 'invalid' }, null, Array(101).fill(gift)]) {
  assert.throws(() => partnerGiftCardCatalogue(malformed, new Set()), /CATALOG_UNAVAILABLE/)
}
console.log('Partner gift-card catalogue: exact denominations, invoice quote requirement, stock/type/blocked filtering and private-price redaction passed.')
