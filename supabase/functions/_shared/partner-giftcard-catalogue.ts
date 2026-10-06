import { parseGiftCardSelection, unwrapGiftCardData } from './customer-giftcard-contract.ts'

// A denomination is not a price. Exact NGN totals come from a verified unpaid
// invoice through action=quote, followed by an expected-amount purchase check.
export function partnerGiftCardCatalogue(raw: unknown, blockedIds: Set<string>) {
  const unwrapped = unwrapGiftCardData(raw)
  if (!Array.isArray(unwrapped) || unwrapped.length > 100) throw new Error('CATALOG_UNAVAILABLE')
  return unwrapped.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const id = candidate.product_id ?? candidate.id
    if (typeof id !== 'string' || blockedIds.has(id)) return []
    const product = parseGiftCardSelection(candidate, id)
    if (!product) return []
    return [{
      type: 'giftcards', section: 'giftcards', id, name: product.product_name,
      category: 'Gift Cards', currency: 'NGN', provider_currency: product.currency,
      availability: 'available', stock: { status: 'provider_checked', available_quantity: null },
      price_ngn: null, price_min_ngn: null, price_max_ngn: null,
      price_basis: 'live_quote', quote_required: true,
      packages: product.packages.map(item => ({ package_id: item.package_id,
        value: item.unit_value, currency: product.currency, price_ngn: null })),
      range: product.range ? { ...product.range, currency: product.currency } : null,
    }]
  })
}
