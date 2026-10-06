import assert from 'node:assert/strict'
import { giftCardInvoiceRetailTotal as quote } from '../../supabase/functions/_shared/partner-giftcard-price.ts'
assert.equal(quote(19, 1000, 2, { mode: 'percent', value: 5 }), 19960)
assert.equal(quote(19, 1000, 2, { mode: 'amount', value: 25 }), 19060)
assert.equal(quote(19.99, 1000, 3, { mode: 'percent', value: 0 }), 20010,
  'quantity division retains exact rational cost rather than rounding supplier currency')
assert.equal(quote(0.1, 1000, 1, { mode: 'percent', value: 10 }), 110,
  'binary floating-point noise must not add an extra ₦10')
assert.equal(quote(1e-3, 10000, 1, { mode: 'amount', value: 0 }), 10)
for (const args of [[NaN, 1000, 1], [1, Infinity, 1], [1, 1000, 0], [1, 1000, 21]]) {
  assert.throws(() => quote(...args, { mode: 'percent', value: 5 }), /PRICE_UNAVAILABLE/)
}
for (const rule of [{ mode: 'guess', value: 1 }, { mode: 'percent', value: -1 },
  { mode: 'percent', value: 1001 }, { mode: 'amount', value: '25' }]) {
  assert.throws(() => quote(1, 1000, 1, rule), /PRICE_UNAVAILABLE/)
}
console.log('Partner gift-card pricing: fixed/percentage rules, per-unit ₦10 rounding and exact invoice/quantity arithmetic passed.')
