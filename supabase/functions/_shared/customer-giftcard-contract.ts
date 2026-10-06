import { readBoundBitrefillDelivery, type BoundBitrefillDelivery } from './partner-bitrefill-delivery.ts'

// This module validates provider identities and shapes only. Package prices and
// range price rates are candidates until the handler verifies the merchant
// billing unit. Never infer the billing currency from denomination currency.
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const CURRENCY = /^[A-Z]{3}$/
const QUOTE_KEYS = ['product_id', 'product_name', 'package_id', 'unit_value', 'currency',
  'quantity', 'amount_ngn', 'provider_price', 'billing_currency'] as const
const BOUND_INVOICE_KEYS = ['product_id', 'product_name', 'package_id', 'unit_value', 'currency',
  'quantity', 'provider_price', 'billing_currency'] as const
const REQUEST_KEYS = ['product_id', 'package_id', 'unit_value', 'quantity', 'expected_amount_ngn'] as const
const SELECTION_KEYS = ['product_id', 'package_id', 'unit_value', 'quantity'] as const

export type GiftCardQuote = {
  product_id: string
  product_name: string
  package_id: string | null
  unit_value: number
  currency: string
  quantity: number
  amount_ngn: number
  provider_price: number
  billing_currency: 'USD' | 'EUR' | 'NGN' | 'BTC'
}
export type BoundGiftCardInvoiceQuote = Omit<GiftCardQuote, 'amount_ngn'>
export type GiftCardPurchaseSelection = Omit<CanonicalGiftCardRequest, 'expected_amount_ngn'>
export type CanonicalGiftCardRequest = {
  product_id: string
  package_id: string | null
  unit_value: number
  quantity: number
  expected_amount_ngn: number
}
export type GiftCardSelection = {
  product_id: string
  product_name: string
  currency: string
  packages: { package_id: string; unit_value: number }[]
  range: { min: number; max: number; step: number } | null
}
export type GiftCardProduct = Omit<GiftCardSelection, 'packages' | 'range'> & {
  packages: { package_id: string; unit_value: number; unit_price_candidate: number }[]
  range: { min: number; max: number; step: number; price_rate_candidate: number } | null
}
export type GiftCardUnit = { package_id: string | null; unit_value: number; unit_price_candidate: number }

export function unwrapGiftCardData(value: unknown): unknown {
  const source = object(value)
  return source && Object.hasOwn(source, 'data') ? source.data : value
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function denomination(value: unknown): value is number {
  return positive(value) && value <= 1_000_000_000 && Math.abs(Math.round(value * 100) - value * 100) < 1e-7
}
function packageId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 180
    && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126)
    && !/["'\\]/.test(value)
}
function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
    && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
}

export function parseGiftCardSelection(raw: unknown, expectedId: string): GiftCardSelection | null {
  if (!PRODUCT_ID.test(expectedId)) return null
  const source = object(unwrapGiftCardData(raw))
  if (!source || source.type !== 'gift_card' || source.in_stock !== true
    || (source.id !== undefined && source.id !== expectedId)
    || (source.product_id !== undefined && source.product_id !== expectedId)
    || (source.id === undefined && source.product_id === undefined)
    || !validName(source.name) || typeof source.currency !== 'string' || !CURRENCY.test(source.currency)
    || (source.recipient_type !== undefined && source.recipient_type !== null
      && source.recipient_type !== '' && source.recipient_type !== 'none')) return null
  const packageMap = object(source.packages)
  const entries = Array.isArray(source.packages) ? source.packages
    : packageMap ? Object.values(packageMap) : []
  if (entries.length > 100) return null
  const seen = new Set<string>()
  const packages: GiftCardSelection['packages'] = []
  for (const entry of entries) {
    const candidate = object(entry)
    if (!candidate || (candidate.id !== undefined && candidate.package_id !== undefined && candidate.id !== candidate.package_id)
      || (candidate.value !== undefined && candidate.amount !== undefined && candidate.value !== candidate.amount)) return null
    const id = candidate.package_id ?? candidate.id
    const value = candidate.value ?? candidate.amount
    if (!packageId(id) || !denomination(value) || seen.has(id)) return null
    seen.add(id)
    packages.push({ package_id: id, unit_value: value })
  }
  let range: GiftCardSelection['range'] = null
  if (source.range !== undefined && source.range !== null) {
    const candidate = object(source.range)
    if (!candidate || !denomination(candidate.min) || !denomination(candidate.max)
      || !denomination(candidate.step) || candidate.max < candidate.min) return null
    range = { min: candidate.min, max: candidate.max, step: candidate.step }
  }
  if (!packages.length && !range) return null
  return { product_id: expectedId, product_name: source.name, currency: source.currency, packages, range }
}

// Face value and denomination selection do not establish a merchant price.
// Invoice-priced callers can use this contract without undocumented price fields.
export function parseGiftCardProduct(raw: unknown, expectedId: string): GiftCardProduct | null {
  const selection = parseGiftCardSelection(raw, expectedId)
  const source = object(unwrapGiftCardData(raw))
  if (!selection || !source) return null
  const entries = Array.isArray(source.packages) ? source.packages : Object.values(object(source.packages) || {})
  const packages: GiftCardProduct['packages'] = []
  for (let i = 0; i < selection.packages.length; i++) {
    const candidate = object(entries[i])
    if (!candidate || !positive(candidate.price)) return null
    packages.push({ ...selection.packages[i], unit_price_candidate: candidate.price })
  }
  const candidate = object(source.range)
  if (selection.range && (!candidate || !positive(candidate.price_rate))) return null
  return { ...selection, packages, range: selection.range
    ? { ...selection.range, price_rate_candidate: candidate!.price_rate as number } : null }
}

export function selectGiftCardDenomination(product: GiftCardSelection, rawPackageId: unknown,
  rawUnitValue: unknown): { package_id: string | null; unit_value: number } | null {
  if (!PRODUCT_ID.test(product.product_id) || !CURRENCY.test(product.currency)) return null
  if (rawPackageId !== null && rawPackageId !== undefined && rawPackageId !== '') {
    if (!packageId(rawPackageId)) return null
    const chosen = product.packages.find(entry => entry.package_id === rawPackageId)
    if (!chosen || (rawUnitValue !== undefined && rawUnitValue !== null && rawUnitValue !== chosen.unit_value)) return null
    return { package_id: chosen.package_id, unit_value: chosen.unit_value }
  }
  if (!denomination(rawUnitValue) || !product.range) return null
  const { min, max, step } = product.range
  const steps = (rawUnitValue - min) / step
  if (rawUnitValue < min || rawUnitValue > max || Math.abs(steps - Math.round(steps)) > 1e-8) return null
  return { package_id: null, unit_value: rawUnitValue }
}

export function selectGiftCardUnit(product: GiftCardProduct, rawPackageId: unknown, rawUnitValue: unknown): GiftCardUnit | null {
  const selected = selectGiftCardDenomination(product, rawPackageId, rawUnitValue)
  if (!selected) return null
  const candidate = selected.package_id !== null
    ? product.packages.find(entry => entry.package_id === selected.package_id)?.unit_price_candidate
    : product.range && selected.unit_value * product.range.price_rate_candidate
  if (!positive(candidate)) return null
  return { ...selected, unit_price_candidate: candidate }
}

export function validateGiftCardQuote(raw: unknown): GiftCardQuote | null {
  const quote = object(raw)
  if (!quote || !sameKeys(quote, QUOTE_KEYS)
    || typeof quote.product_id !== 'string' || !PRODUCT_ID.test(quote.product_id)
    || !validName(quote.product_name)
    || (quote.package_id !== null && !packageId(quote.package_id))
    || !denomination(quote.unit_value)
    || typeof quote.currency !== 'string' || !CURRENCY.test(quote.currency)
    || !Number.isSafeInteger(quote.quantity) || (quote.quantity as number) < 1 || (quote.quantity as number) > 20
    || !Number.isSafeInteger(quote.amount_ngn) || (quote.amount_ngn as number) < 10
    || (quote.amount_ngn as number) > 1_000_000_000 || (quote.amount_ngn as number) % 10 !== 0
    || !positive(quote.provider_price) || quote.provider_price > 1_000_000_000
    || (quote.billing_currency !== 'USD' && quote.billing_currency !== 'EUR'
      && quote.billing_currency !== 'NGN' && quote.billing_currency !== 'BTC')
    || (quote.billing_currency === 'BTC' && !Number.isSafeInteger(quote.provider_price))) return null
  return quote as GiftCardQuote
}
export function validateBoundGiftCardInvoiceQuote(raw: unknown): BoundGiftCardInvoiceQuote | null {
  const quote = object(raw)
  if (!quote || !sameKeys(quote, BOUND_INVOICE_KEYS)
    || typeof quote.product_id !== 'string' || !PRODUCT_ID.test(quote.product_id)
    || !validName(quote.product_name)
    || (quote.package_id !== null && !packageId(quote.package_id))
    || !denomination(quote.unit_value)
    || typeof quote.currency !== 'string' || !CURRENCY.test(quote.currency)
    || !Number.isSafeInteger(quote.quantity) || (quote.quantity as number) < 1 || (quote.quantity as number) > 20
    || !positive(quote.provider_price) || quote.provider_price > 1_000_000_000
    || (quote.billing_currency !== 'USD' && quote.billing_currency !== 'EUR'
      && quote.billing_currency !== 'NGN' && quote.billing_currency !== 'BTC')
    || (quote.billing_currency === 'BTC' && !Number.isSafeInteger(quote.provider_price))) return null
  return quote as BoundGiftCardInvoiceQuote
}

export function canonicalGiftCardRequest(rawQuote: unknown): CanonicalGiftCardRequest | null {
  const quote = validateGiftCardQuote(rawQuote)
  return quote ? { product_id: quote.product_id, package_id: quote.package_id,
    unit_value: quote.unit_value, quantity: quote.quantity, expected_amount_ngn: quote.amount_ngn } : null
}

export function validateGiftCardPurchaseSelection(raw: unknown): GiftCardPurchaseSelection | null {
  const selection = object(raw)
  if (!selection || !sameKeys(selection, SELECTION_KEYS)
    || typeof selection.product_id !== 'string' || !PRODUCT_ID.test(selection.product_id)
    || (selection.package_id !== null && !packageId(selection.package_id))
    || !denomination(selection.unit_value)
    || !Number.isSafeInteger(selection.quantity) || (selection.quantity as number) < 1
    || (selection.quantity as number) > 20) return null
  return selection as GiftCardPurchaseSelection
}
export function validateCanonicalGiftCardRequest(raw: unknown): CanonicalGiftCardRequest | null {
  const request = object(raw)
  if (!request || !sameKeys(request, REQUEST_KEYS)
    || typeof request.product_id !== 'string' || !PRODUCT_ID.test(request.product_id)
    || (request.package_id !== null && !packageId(request.package_id))
    || !denomination(request.unit_value)
    || !Number.isSafeInteger(request.quantity) || (request.quantity as number) < 1 || (request.quantity as number) > 20
    || !Number.isSafeInteger(request.expected_amount_ngn) || (request.expected_amount_ngn as number) < 10
    || (request.expected_amount_ngn as number) > 1_000_000_000 || (request.expected_amount_ngn as number) % 10 !== 0) return null
  return request as CanonicalGiftCardRequest
}

function boundChild(raw: unknown, quote: BoundGiftCardInvoiceQuote, requireIdentity: boolean): string | null {
  const child = object(raw)
  const nested = child && object(child.product)
  const id = child?.id
  if (!child || typeof id !== 'string' || !PROVIDER_ID.test(id)
    || (child.status !== undefined && child.status !== 'created' && child.status !== 'unpaid')
    || (child.quantity !== undefined && child.quantity !== 1)
    || (child.product !== undefined && !nested)
    || (child.product_id !== undefined && nested?.id !== undefined && child.product_id !== nested.id)
    || (child.value !== undefined && nested?.value !== undefined && child.value !== nested.value)
    || (child.package_id !== undefined && nested?.package_id !== undefined && child.package_id !== nested.package_id)
    || (child.currency !== undefined && nested?.currency !== undefined && child.currency !== nested.currency)) return null
  const productId = nested?.id ?? child.product_id
  const value = nested?.value ?? child.value
  const selectedPackage = nested?.package_id ?? child.package_id
  const currency = nested?.currency ?? child.currency
  if ((requireIdentity && (productId === undefined || value === undefined))
    || (productId !== undefined && productId !== quote.product_id)
    || (value !== undefined && value !== quote.unit_value)
    || (selectedPackage !== undefined && selectedPackage !== null && selectedPackage !== quote.package_id)
    || (currency !== undefined && currency !== quote.currency)) return null
  return id
}

// The official invoice example only promises child id/status. Read each unpaid
// child order separately before pay; an invoice summary alone is insufficient.
export function verifyUnpaidGiftCardInvoice(raw: unknown, invoiceId: string, rawQuote: unknown,
  rawChildDetails: unknown[]): boolean {
  const quote = validateGiftCardQuote(rawQuote)
  if (!quote) return false
  return verifyBoundUnpaidGiftCardInvoice(raw, invoiceId, {
    product_id: quote.product_id, product_name: quote.product_name,
    package_id: quote.package_id, unit_value: quote.unit_value,
    currency: quote.currency, quantity: quote.quantity,
    provider_price: quote.provider_price, billing_currency: quote.billing_currency,
  }, rawChildDetails)
}

// The provider's already-created unpaid invoice is the price authority for a
// partner quote. The caller must price and reserve from this exact total, then
// re-read and verify the same invoice immediately before its single pay call.
export function verifyBoundUnpaidGiftCardInvoice(raw: unknown, invoiceId: string, rawQuote: unknown,
  rawChildDetails: unknown[]): boolean {
  const quote = validateBoundGiftCardInvoiceQuote(rawQuote)
  const invoice = object(unwrapGiftCardData(raw))
  if (!quote || !PROVIDER_ID.test(invoiceId) || !invoice || invoice.id !== invoiceId || invoice.status !== 'unpaid') return false
  const payment = object(invoice.payment)
  if (!payment || payment.method !== 'balance' || payment.currency !== quote.billing_currency
    || payment.price !== quote.provider_price) return false
  if (!Array.isArray(invoice.orders) || invoice.orders.length !== quote.quantity
    || !Array.isArray(rawChildDetails) || rawChildDetails.length !== quote.quantity) return false
  const ids = new Set<string>()
  for (const child of invoice.orders) {
    const id = boundChild(child, quote, false)
    if (!id || ids.has(id)) return false
    ids.add(id)
  }
  const detailIds = new Set<string>()
  for (const rawDetail of rawChildDetails) {
    const id = boundChild(unwrapGiftCardData(rawDetail), quote, true)
    if (!id || !ids.has(id) || detailIds.has(id)) return false
    detailIds.add(id)
  }
  return true
}

export async function readVerifiedGiftCardDelivery(
  provider: { invoice: (id: string) => Promise<unknown>; order: (id: string) => Promise<unknown> },
  invoiceId: string, rawQuote: unknown,
): Promise<BoundBitrefillDelivery> {
  const quote = validateGiftCardQuote(rawQuote)
  if (!quote) return { completed: false, review: true }
  return readBoundBitrefillDelivery({
    getInvoice: async id => unwrapGiftCardData(await provider.invoice(id)),
    getOrder: async id => unwrapGiftCardData(await provider.order(id)),
  }, invoiceId, { itemId: quote.product_id, quantity: quote.quantity,
    unitValue: quote.unit_value, currency: quote.currency, packageId: quote.package_id })
}
