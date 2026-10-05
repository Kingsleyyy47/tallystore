// Pure validation for Bitrefill phone refills. No customer-supplied price or
// recipient identity is used after the server has constructed a quote.
export type AirtimeQuote = {
  product_id: string
  product_name: string
  operator_id: string
  operator_name: string
  country_code: string
  recipient_phone: string
  package_id: string | null
  unit_value: number
  currency: string
  amount_ngn: number
}

export function e164(value: unknown): string | null {
  const phone = typeof value === 'string' ? value.trim() : ''
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null
}

export function safeId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return id.length <= 180 && /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/.test(id) ? id : null
}

export function safePackageId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return id.length <= 180 && /^[\x20-\x7E]+$/.test(id) && !/["'\\]/.test(id) ? id : null
}

export function safeMoney(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-7 ? n : null
}

export function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export function unwrapData<T = any>(value: any): T {
  return (value?.data ?? value) as T
}

export function checkedOperators(raw: any, requestedPhone: string): Array<{ operator_id: string, operator_name: string, country_code: string }> {
  const data = unwrapData(raw)
  if (raw?.phone_number != null && e164(raw.phone_number) !== requestedPhone) return []
  if (data?.phone_number != null && e164(data.phone_number) !== requestedPhone) return []
  if (raw?.operator_found === false) return []
  const productRecords = Array.isArray(data) ? data : data && typeof data === 'object' && !Array.isArray(data.operators) ? [data] : null
  if (productRecords) return productRecords.slice(0, 20).flatMap((product: any) => {
    if ((product?.type != null && product.type !== 'phone_refill')
      || !String(product?.recipient_type || '').toLowerCase().includes('phone')) return []
    if (product?.id && product?.product_id && product.id !== product.product_id) return []
    const id = safeId(product?.id ?? product?.product_id)
    const name = typeof product?.name === 'string' ? product.name.trim().slice(0, 120) : ''
    const country = String(product?.country || '').toUpperCase()
    return id && name && /^[A-Z]{2}$/.test(country) ? [{ operator_id: id, operator_name: name, country_code: country }] : []
  })
  if (!Array.isArray(data?.operators)) return []
  const country = typeof data.country_code === 'string' && /^[A-Z]{2}$/.test(data.country_code.toUpperCase())
    ? data.country_code.toUpperCase() : ''
  return data.operators.slice(0, 20).flatMap((operator: any) => {
    const id = safeId(operator?.id)
    const name = typeof operator?.name === 'string' ? operator.name.trim().slice(0, 120) : ''
    return id && name ? [{ operator_id: id, operator_name: name, country_code: country }] : []
  })
}

export function productOptions(raw: any, productId: string) {
  const product = unwrapData(raw)
  if (!product || (product.id && product.product_id && product.id !== product.product_id)
    || (product.id ?? product.product_id) !== productId
    || (product.type != null && product.type !== 'phone_refill')
    || !String(product.recipient_type || '').toLowerCase().includes('phone')) return null
  const currency = String(product.currency || '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return null
  const sourcePackages = Array.isArray(product.packages) ? product.packages
    : product.packages && typeof product.packages === 'object' ? Object.values(product.packages) : []
  const packages = sourcePackages.flatMap((p: any) => {
    if (p?.id && p?.package_id && p.id !== p.package_id) return []
    if (p?.amount != null && p?.value != null && Number(p.amount) !== Number(p.value)) return []
    const package_id = safePackageId(p?.package_id ?? p?.id)
    const unit_value = safeMoney(p?.value ?? p?.amount)
    const provider_price = safeMoney(p?.price)
    return package_id && unit_value !== null && provider_price !== null ? [{ package_id, unit_value, provider_price }] : []
  })
  const min = safeMoney(product.range?.min)
  const max = safeMoney(product.range?.max)
  const step = safeMoney(product.range?.step)
  const price_rate = positiveNumber(product.range?.price_rate)
  const range = min !== null && max !== null && step !== null && price_rate !== null && max >= min ? { min, max, step, price_rate } : null
  if (!packages.length && !range) return null
  return {
    product_id: productId,
    product_name: String(product.name || '').trim().slice(0, 120) || productId,
    currency,
    country_code: String(product.country || '').toUpperCase(),
    packages,
    range,
  }
}

export function chooseUnit(options: NonNullable<ReturnType<typeof productOptions>>, packageId: unknown, value: unknown): { package_id: string | null, unit_value: number, provider_price: number } | null {
  if (packageId != null && packageId !== '') {
    const id = safePackageId(packageId)
    const pkg = options.packages.find((p: { package_id: string, unit_value: number, provider_price: number }) => p.package_id === id)
    if (!pkg || (value !== undefined && value !== null && safeMoney(value) !== pkg.unit_value)) return null
    return { package_id: pkg.package_id, unit_value: pkg.unit_value, provider_price: pkg.provider_price }
  }
  const chosen = safeMoney(value)
  const range = options.range
  if (chosen === null || !range || chosen < range.min || chosen > range.max) return null
  const steps = (chosen - range.min) / range.step
  if (Math.abs(steps - Math.round(steps)) > 1e-8) return null
  return { package_id: null, unit_value: chosen, provider_price: Math.ceil(chosen * range.price_rate) }
}

export function verifiedAirtimeDelivery(invoiceRaw: any, orderRaw: any, invoiceId: string, quote: AirtimeQuote): { invoice_id: string, product_id: string, operator_id: string, recipient_phone: string, package_id: string | null, unit_value: number, currency: string, quantity: 1, provider_order_id: string, provider_status: 'complete' } | null {
  const invoice = unwrapData(invoiceRaw)
  const order = unwrapData(orderRaw)
  if (!invoice || invoice.id !== invoiceId || invoice.status !== 'complete') return null
  if (!Array.isArray(invoice.orders) || invoice.orders.length !== 1) return null
  const orderId = invoice.orders[0]?.id
  if (typeof orderId !== 'string' || !orderId || order?.id !== orderId || order.status !== 'delivered') return null
  if (order.product?.id !== quote.product_id || safeMoney(order.product?.value) !== quote.unit_value) return null
  if (e164(order.phone_number) !== quote.recipient_phone) return null
  const summary = invoice.orders[0]
  if (summary.status != null && summary.status !== 'delivered') return null
  if (summary.quantity != null && summary.quantity !== 1) return null
  if (summary.product_id && summary.product_id !== quote.product_id) return null
  if (summary.product?.id && summary.product.id !== quote.product_id) return null
  if (summary.product?.value != null && safeMoney(summary.product.value) !== quote.unit_value) return null
  for (const source of [summary, order]) {
    if (source.package_id != null && source.package_id !== quote.package_id) return null
    if (source.phone_number != null && e164(source.phone_number) !== quote.recipient_phone) return null
    if (source.product?.package_id != null && source.product.package_id !== quote.package_id) return null
    if (source.product?.currency != null && String(source.product.currency).toUpperCase() !== quote.currency) return null
  }
  return {
    invoice_id: invoiceId, product_id: quote.product_id, operator_id: quote.operator_id,
    recipient_phone: quote.recipient_phone, package_id: quote.package_id,
    unit_value: quote.unit_value, currency: quote.currency, quantity: 1,
    provider_order_id: orderId, provider_status: 'complete',
  }
}
