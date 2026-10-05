// Read-only Bitrefill reconciliation. An invoice is not a delivery receipt:
// every unit must be bound to the original quote and individually delivered.
export type BitrefillDeliveryClient = {
  getInvoice: (id: string) => Promise<unknown>
  getOrder: (id: string) => Promise<unknown>
}

export type BoundBitrefillQuote = {
  itemId: string
  quantity: number
  unitValue: number
  currency: string
  packageId?: string | null
}

type Redemption = {
  order_id: string
  code?: string
  pin?: string
  link?: string
  instructions?: string
  expiration_date?: string
}

export type BoundBitrefillDelivery =
  | { completed: true; delivery: {
    item_id: string; quantity: number; unit_value: number; currency: string
    provider_status: 'complete'; redemptions: Redemption[]
  } }
  | { completed: false; review: boolean }

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/
const DEADLINE_MS = 15_000
const review = (): BoundBitrefillDelivery => ({ completed: false, review: true })
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown, max = 300): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max && ![...trimmed].some(char => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127
  }) ? trimmed : null
}
const positiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

function boundProduct(raw: Record<string, unknown>, quote: BoundBitrefillQuote, requireIdentity: boolean): boolean {
  const nested = raw.product === undefined ? null : record(raw.product)
  if (raw.product !== undefined && !nested) return false
  const flatId = raw.product_id
  const nestedId = nested?.id
  const flatValue = raw.value
  const nestedValue = nested?.value
  const flatCurrency = raw.currency
  const nestedCurrency = nested?.currency
  const flatPackage = raw.package_id
  const nestedPackage = nested?.package_id
  if (flatId !== undefined && nestedId !== undefined && flatId !== nestedId) return false
  if (flatValue !== undefined && nestedValue !== undefined && flatValue !== nestedValue) return false
  if (flatCurrency !== undefined && nestedCurrency !== undefined && String(flatCurrency).toUpperCase() !== String(nestedCurrency).toUpperCase()) return false
  if (flatPackage !== undefined && nestedPackage !== undefined && flatPackage !== nestedPackage) return false
  const itemId = nestedId ?? flatId
  const value = nestedValue ?? flatValue
  if (requireIdentity && (itemId === undefined || value === undefined)) return false
  if (itemId !== undefined && itemId !== quote.itemId) return false
  if (value !== undefined && positiveNumber(value) !== quote.unitValue) return false
  const currency = nestedCurrency ?? flatCurrency
  if (currency !== undefined && currency !== null && (typeof currency !== 'string' || !text(currency, 20) ||
    currency.trim().toUpperCase() !== quote.currency.trim().toUpperCase())) return false
  const packageId = nestedPackage ?? flatPackage
  if (packageId !== undefined && packageId !== null && (typeof packageId !== 'string' || !text(packageId, 180) ||
    packageId !== quote.packageId)) return false
  if (raw.quantity !== undefined && raw.quantity !== 1) return false
  return true
}

function redemption(raw: unknown, orderId: string): Redemption | null {
  const data = record(raw)
  if (!data) return null
  const code = text(data.code)
  let link: string | null = null
  if (typeof data.link === 'string' && data.link.length <= 500) {
    try {
      const url = new URL(data.link.trim())
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) link = url.toString()
    } catch { /* Invalid links cannot prove delivery. */ }
  }
  if (!code && !link) return null
  const result: Redemption = { order_id: orderId }
  if (code) result.code = code
  if (link) result.link = link
  for (const field of ['pin', 'instructions', 'expiration_date'] as const) {
    const optional = text(data[field], field === 'instructions' ? 1000 : 300)
    if (optional) result[field] = optional
  }
  return result
}

export async function readBoundBitrefillDelivery(
  client: BitrefillDeliveryClient,
  invoiceId: string,
  quote: BoundBitrefillQuote,
): Promise<BoundBitrefillDelivery> {
  if (!ID.test(invoiceId) || !PRODUCT_ID.test(quote.itemId) || !Number.isSafeInteger(quote.quantity) ||
    quote.quantity < 1 || quote.quantity > 20 || positiveNumber(quote.unitValue) === null ||
    !text(quote.currency, 20) ||
    (quote.packageId !== undefined && quote.packageId !== null && !text(quote.packageId, 180))) return review()

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const timedOut = Symbol('bitrefill-deadline')
  const deadline = new Promise<typeof timedOut>(resolve => {
    timeoutId = setTimeout(() => { expired = true; resolve(timedOut) }, DEADLINE_MS)
  })
  const read = async (call: () => Promise<unknown>): Promise<unknown | typeof timedOut> => {
    if (expired) return timedOut
    const value = await Promise.race([Promise.resolve().then(call), deadline])
    return expired ? timedOut : value
  }

  try {
    const invoice = record(await read(() => client.getInvoice(invoiceId)))
    if (!invoice || invoice.id !== invoiceId) return review()
    const status = String(invoice.status || '').toLowerCase()
    if (status !== 'complete') return { completed: false,
      review: !['unpaid', 'payment_detected', 'payment_confirmed', 'pending'].includes(status) }
    if (!Array.isArray(invoice.orders) || invoice.orders.length !== quote.quantity) return review()

    const ids = new Set<string>()
    const redemptions: Redemption[] = []
    for (const item of invoice.orders) {
      const summary = record(item)
      const orderId = summary?.id
      if (!summary || typeof orderId !== 'string' || !ID.test(orderId) || ids.has(orderId) ||
        (summary.status !== undefined && String(summary.status).toLowerCase() !== 'delivered') ||
        !boundProduct(summary, quote, false)) return review()
      ids.add(orderId)
      const detail = record(await read(() => client.getOrder(orderId)))
      if (!detail || detail.id !== orderId || String(detail.status || '').toLowerCase() !== 'delivered' ||
        !boundProduct(detail, quote, true)) return review()
      const unit = redemption(detail.redemption_info, orderId)
      if (!unit) return review()
      redemptions.push(unit)
    }
    if (expired) return review()
    return { completed: true, delivery: {
      item_id: quote.itemId, quantity: quote.quantity, unit_value: quote.unitValue,
      currency: quote.currency.trim().toUpperCase(),
      provider_status: 'complete', redemptions,
    } }
  } catch {
    return review()
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
