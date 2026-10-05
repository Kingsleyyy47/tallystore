import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { AirtimeProvider } from '../_shared/customer-airtime-provider.ts'
import { checkedOperators, chooseUnit, e164, productOptions, safeId, safeMoney, safePackageId, unwrapData, verifiedAirtimeDelivery, type AirtimeQuote } from '../_shared/customer-airtime-contract.ts'
import { authenticateCustomerRequest } from '../_shared/customer-api-delegation.ts'

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const uuid = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s)
const safeOrder = (row: any) => row && ({ id: row.id, status: row.status, recipient_phone: row.recipient_phone, product_name: row.product_name, amount_ngn: row.amount_ngn, currency: row.currency, created_at: row.created_at })

const API_ACTION_FIELDS: Record<string, readonly string[]> = {
  check_phone: ['action', 'phone_number'],
  quote: ['action', 'phone_number', 'operator_id', 'product_id', 'package_id', 'unit_value'],
  purchase: ['action', 'phone_number', 'operator_id', 'product_id', 'package_id', 'unit_value', 'idempotency_key', 'expected_amount_ngn'],
  status: ['action', 'order_id'],
  orders: ['action'],
}

// Read only a bounded clone. The original bytes remain available for the HMAC
// body's hash check; a tee cancellation must never delay a timeout response.
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const maximum = 16 * 1024
  const length = req.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new Error('REQUEST_TOO_LARGE')
  const reader = req.clone().body?.getReader()
  if (!reader) throw new Error('INVALID_REQUEST')
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 5000) })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const part = await Promise.race([reader.read(), expired])
      if (part.done) break
      if (part.value.byteLength === 0) throw new Error('INVALID_REQUEST')
      size += part.value.byteLength
      if (size > maximum) throw new Error('REQUEST_TOO_LARGE')
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    let body: unknown
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('INVALID_REQUEST') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_REQUEST')
    return body as Record<string, unknown>
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function merchantBalance(value: unknown, currency: string): number | null {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 && (currency !== 'BTC' || Number.isSafeInteger(number)) ? number : null
}

async function rateToNgn(currency: string, admin: any): Promise<number> {
  if (currency === 'NGN') return 1
  if (currency === 'BTC') {
    const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker', { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('PRICE_UNAVAILABLE')
    const ticker = await response.json()
    const usd = Number(ticker?.price)
    const age = Date.now() - Date.parse(String(ticker?.time || ''))
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(age) || age < -300000 || age > 300000) throw new Error('PRICE_UNAVAILABLE')
    return usd * await rateToNgn('USD', admin)
  }
  if (currency === 'USD') {
    const { data, error } = await admin.from('app_settings').select('value').eq('key', 'ngn_usd_rate').maybeSingle()
    if (error) throw new Error('PRICE_UNAVAILABLE')
    const override = Number(data?.value)
    if (Number.isFinite(override) && override > 0) return override
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('PRICE_UNAVAILABLE')
  const response = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { redirect: 'error', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('PRICE_UNAVAILABLE')
  const payload = await response.json()
  const rate = Number(payload?.rates?.NGN)
  if (payload?.result !== 'success' || !Number.isFinite(rate) || rate <= 0) throw new Error('PRICE_UNAVAILABLE')
  return rate
}

async function blockedProducts(admin: any): Promise<Set<string>> {
  const { data, error } = await admin.from('app_settings').select('value').eq('key', 'bitrefill_blocked_products').maybeSingle()
  if (error) throw new Error('CATALOG_UNAVAILABLE')
  if (!data?.value) return new Set()
  let entries: any
  try { entries = typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { throw new Error('CATALOG_UNAVAILABLE') }
  if (!Array.isArray(entries)) throw new Error('CATALOG_UNAVAILABLE')
  return new Set(entries.map((entry: any) => String(entry?.product_id || '')).filter(Boolean))
}

async function makeQuote(provider: AirtimeProvider, admin: any, body: any): Promise<{ quote: AirtimeQuote, providerPrice: number, billingCurrency: string, merchantAvailable: number }> {
  const phone = e164(body.phone_number)
  const operatorId = safeId(body.operator_id)
  const productId = safeId(body.product_id)
  if (!phone || !operatorId || !productId || operatorId !== productId) throw new Error('INVALID_RECIPIENT')
  const [phoneRaw, productRaw, blocked] = await Promise.all([
    provider.checkPhone(phone), provider.product(productId), blockedProducts(admin),
  ])
  if (blocked.has(productId)) throw new Error('NO_STOCK')
  const operator = checkedOperators(phoneRaw, phone).find(item => item.operator_id === operatorId)
  const options = productOptions(productRaw, productId)
  const unit = options && chooseUnit(options, body.package_id, body.unit_value)
  if (!operator || !options || !unit) throw new Error('NO_STOCK')
  const country = /^[A-Z]{2}$/.test(options.country_code) ? options.country_code : operator.country_code
  if (!/^[A-Z]{2}$/.test(country) || (operator.country_code && operator.country_code !== country)) throw new Error('INVALID_RECIPIENT')
  const [balanceRaw, pricing] = await Promise.all([
    provider.balance(),
    rpc(admin, 'get_customer_bitrefill_pricing', {
      p_kind: 'airtime', p_product_id: productId, p_package_id: unit.package_id,
      p_unit_value: unit.unit_value, p_currency: options.currency,
    }),
  ])
  const balance = unwrapData(balanceRaw)
  const billingCurrency = String(balance?.currency || '').toUpperCase()
  // Never convert the face value as though it were the supplier's price.
  // Unsupported billing currencies remain unavailable until a verified rate exists.
  if (billingCurrency !== 'USD' && billingCurrency !== 'NGN' && billingCurrency !== 'BTC') throw new Error('PRICE_UNAVAILABLE')
  if (billingCurrency === 'BTC' && (!Number.isSafeInteger(unit.provider_price) || unit.provider_price > 1_000_000_000)) throw new Error('PRICE_UNAVAILABLE')
  const merchantAvailable = merchantBalance(balance?.balance, billingCurrency)
  if (merchantAvailable === null) throw new Error('PRICE_UNAVAILABLE')
  const rate = await rateToNgn(billingCurrency, admin)
  const supplierPrice = billingCurrency === 'BTC' ? unit.provider_price / 100_000_000 : unit.provider_price
  const adjustment = Number(pricing.value)
  if (!Number.isFinite(adjustment) || adjustment < 0 || adjustment > 1_000_000_000) throw new Error('PRICE_UNAVAILABLE')
  const supplierNgn = supplierPrice * rate
  const adjusted = pricing.mode === 'percent' ? supplierNgn * (1 + adjustment / 100)
    : pricing.mode === 'amount' ? supplierNgn + adjustment : NaN
  const amount = Math.ceil(adjusted / 10) * 10
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('PRICE_UNAVAILABLE')
  const quote: AirtimeQuote = {
    product_id: productId, product_name: options.product_name,
    operator_id: operatorId, operator_name: operator.operator_name,
    country_code: country, recipient_phone: phone,
    package_id: unit.package_id, unit_value: unit.unit_value,
    currency: options.currency, amount_ngn: amount,
  }
  return { quote, providerPrice: unit.provider_price, billingCurrency, merchantAvailable }
}

function invoiceIsExactUnpaid(raw: any, invoiceId: string, quote: AirtimeQuote): boolean {
  const invoice = unwrapData(raw)
  if (!invoice || invoice.id !== invoiceId || invoice.status !== 'unpaid') return false
  if (!Array.isArray(invoice.orders) || invoice.orders.length !== 1 || !safeId(invoice.orders[0]?.id)) return false
  const unit = invoice.orders[0]
  if (unit.product_id && unit.product_id !== quote.product_id) return false
  if (unit.product?.id && unit.product.id !== quote.product_id) return false
  if (unit.product?.value != null && safeMoney(unit.product.value) !== quote.unit_value) return false
  if (unit.phone_number && e164(unit.phone_number) !== quote.recipient_phone) return false
  if (unit.package_id != null && unit.package_id !== quote.package_id) return false
  return true
}

function unpaidOrderMatches(raw: any, orderId: string, quote: AirtimeQuote): boolean {
  const order = unwrapData(raw)
  if (!order || order.id !== orderId || !['created', 'unpaid', 'pending'].includes(order.status)) return false
  const nestedId = order.product?.id
  const flatId = order.product_id
  if (nestedId && flatId && nestedId !== flatId) return false
  if ((nestedId ?? flatId) !== quote.product_id) return false
  const nestedValue = order.product?.value
  const flatValue = order.value
  if (nestedValue != null && flatValue != null && safeMoney(nestedValue) !== safeMoney(flatValue)) return false
  if (safeMoney(nestedValue ?? flatValue) !== quote.unit_value) return false
  if (e164(order.phone_number) !== quote.recipient_phone) return false
  if (order.package_id != null && order.package_id !== quote.package_id) return false
  if (order.product?.package_id != null && order.product.package_id !== quote.package_id) return false
  return true
}

// A priced invoice is checked before payment. Unknown/missing price fails closed.
function invoiceCostNgn(raw: any, billingCurrency: string, rate: number, expectedProviderPrice: number): number | null {
  const invoice = unwrapData(raw)
  const payment = invoice?.payment
  const rawPrice = payment?.price
  const price = typeof rawPrice === 'number' ? rawPrice
    : typeof rawPrice === 'string' && /^\d+(?:\.\d+)?$/.test(rawPrice) ? Number(rawPrice) : NaN
  const currency = String(payment?.currency || '').toUpperCase().replace(/^XBT$/, 'BTC')
  if (!Number.isFinite(price) || price <= 0 || currency !== billingCurrency) return null
  // Existing Bitrefill merchant integration and product.price use satoshis.
  // A fractional BTC amount is ambiguous and cannot authorize a payment.
  if (currency === 'BTC' && (!Number.isSafeInteger(price) || price > 1_000_000_000)) return null
  if (Math.abs(price - expectedProviderPrice) > Math.max(2, expectedProviderPrice * 0.03)) return null
  return (currency === 'BTC' ? price / 100_000_000 : price) * rate
}

async function rpc(admin: any, name: string, params: Record<string, unknown>): Promise<any> {
  const { data, error } = await admin.rpc(name, params)
  if (error || !data || data.success !== true) throw new Error(data?.code || 'WALLET_UNAVAILABLE')
  return data
}

async function orderRow(admin: any, userId: string, orderId: string): Promise<any> {
  const { data, error } = await admin.from('customer_airtime_orders').select('id,status,recipient_phone,product_name,amount_ngn,currency,created_at').eq('id', orderId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error('ORDER_UNAVAILABLE')
  return data
}

async function unknown(admin: any, userId: string, orderId: string) {
  try { await rpc(admin, 'record_customer_airtime_outcome', { p_user_id: userId, p_order_id: orderId, p_outcome: 'unknown', p_evidence: {} }) } catch { /* preserve hold for manual reconciliation */ }
  return { success: false, outcome_unknown: true, order: safeOrder(await orderRow(admin, userId, orderId)) }
}

async function rejectLowMerchantBalance(admin: any, userId: string, orderId: string) {
  await rpc(admin, 'record_customer_airtime_outcome', { p_user_id: userId, p_order_id: orderId,
    p_outcome: 'rejected', p_evidence: { reason_code: 'INSUFFICIENT_BALANCE' } })
  // Operational alert is redacted: no amount, invoice, recipient or key.
  const { error } = await admin.rpc('record_supplier_balance_alert', {
    p_provider: 'bitrefill', p_product_group_id: null, p_source: 'customer-airtime',
  })
  if (error) console.error('Could not record Bitrefill supplier balance alert')
  return { success: false, code: 'PROVIDER_BALANCE_LOW', order: safeOrder(await orderRow(admin, userId, orderId)) }
}

async function tryComplete(provider: AirtimeProvider, admin: any, userId: string, orderId: string, invoiceId: string, quote: AirtimeQuote) {
  const invoice = await provider.invoice(invoiceId)
  const summary = unwrapData(invoice)
  if (summary?.id !== invoiceId || summary?.status !== 'complete' || !Array.isArray(summary.orders) || summary.orders.length !== 1 || !safeId(summary.orders[0]?.id)) return false
  const detail = await provider.order(summary.orders[0].id)
  const evidence = verifiedAirtimeDelivery(invoice, detail, invoiceId, quote)
  if (!evidence) return false
  await rpc(admin, 'record_customer_airtime_outcome', { p_user_id: userId, p_order_id: orderId, p_outcome: 'completed', p_evidence: evidence })
  return true
}

async function handle(body: any, admin: any, provider: AirtimeProvider, userId: string): Promise<any> {
  const action = String(body?.action || '')
  if (action === 'admin_pricing_get') {
    if (body.kind !== 'airtime' && body.kind !== 'gift_card' && body.kind !== 'sms') throw new Error('INVALID_PRICING_KIND')
    return rpc(admin, 'list_customer_bitrefill_pricing', { p_owner_user_id: userId, p_kind: body.kind })
  }
  if (action === 'admin_pricing_set') {
    if (body.kind !== 'airtime' && body.kind !== 'gift_card' && body.kind !== 'sms') throw new Error('INVALID_PRICING_KIND')
    if (body.remove !== true && body.scope !== 'global') {
      if (body.scope !== 'product' && body.scope !== 'denomination') throw new Error('INVALID_PRICING')
      const optionsResult = await handle({ action: 'admin_product_options', kind: body.kind, product_id: body.product_id }, admin, provider, userId)
      const options = optionsResult.product
      if (body.scope === 'denomination') {
        if (body.kind === 'sms' || body.currency !== options.currency) throw new Error('INVALID_PRICING')
        const selected = chooseUnit({ ...options,
          packages: options.packages.map((p: { package_id: string, unit_value: number }) => ({ ...p, provider_price: 1 })),
          range: options.range && { ...options.range, price_rate: 1 },
        }, body.package_id, body.unit_value)
        if (!selected || selected.package_id !== (body.package_id ?? null)
          || selected.unit_value !== body.unit_value) throw new Error('INVALID_PRICING')
      }
    }
    return rpc(admin, 'set_customer_bitrefill_pricing', {
      p_owner_user_id: userId, p_kind: body.kind, p_scope: body.scope,
      p_product_id: body.product_id ?? null, p_package_id: body.package_id ?? null,
      p_unit_value: body.unit_value ?? null, p_currency: body.currency ?? null,
      p_mode: body.mode ?? null, p_value: body.value ?? null, p_remove: body.remove === true,
    })
  }
  if (action === 'admin_product_options') {
    if (body.kind !== 'airtime' && body.kind !== 'gift_card' && body.kind !== 'sms') throw new Error('INVALID_PRICING_KIND')
    const productId = safeId(body.product_id)
    if (!productId) throw new Error('INVALID_PRODUCT')
    // Owner proof precedes the provider lookup and any product details.
    await rpc(admin, 'list_customer_bitrefill_pricing', { p_owner_user_id: userId, p_kind: body.kind })
    if (body.kind === 'sms') {
      const { data: service, error } = await admin.from('sms_product_settings').select('service_code,service_name').eq('service_code', productId).maybeSingle()
      if (error || !service || service.service_code !== productId) throw new Error('INVALID_PRODUCT')
      return { success: true, product: { product_id: productId, product_name: String(service.service_name || productId).slice(0, 120), currency: 'USD', packages: [], range: null } }
    }
    const raw = unwrapData(await provider.product(productId))
    if ((raw?.id ?? raw?.product_id) !== productId) throw new Error('INVALID_PRODUCT')
    if (body.kind === 'airtime' && !String(raw.recipient_type || '').toLowerCase().includes('phone')) throw new Error('INVALID_PRODUCT')
    if (body.kind === 'gift_card' && (raw.type && raw.type !== 'gift_card' || String(raw.recipient_type || '').toLowerCase().includes('phone'))) throw new Error('INVALID_PRODUCT')
    const currency = String(raw.currency || '').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_PRODUCT')
    const entries = Array.isArray(raw.packages) ? raw.packages : raw.packages && typeof raw.packages === 'object' ? Object.values(raw.packages) : []
    const packages = entries.flatMap((item: any) => {
      const package_id = safePackageId(item?.package_id ?? item?.id)
      const unit_value = safeMoney(item?.value ?? item?.amount)
      return package_id && unit_value !== null ? [{ package_id, unit_value }] : []
    })
    const min = safeMoney(raw.range?.min)
    const max = safeMoney(raw.range?.max)
    const step = safeMoney(raw.range?.step)
    const range = min !== null && max !== null && step !== null && max >= min ? { min, max, step } : null
    if (!packages.length && !range) throw new Error('INVALID_PRODUCT')
    return { success: true, product: { product_id: productId, product_name: String(raw.name || productId).slice(0, 120), currency, packages, range } }
  }
  if (action === 'check_phone') {
    const phone = e164(body.phone_number)
    if (!phone) throw new Error('INVALID_RECIPIENT')
    const operators = checkedOperators(await provider.checkPhone(phone), phone)
    const blocked = await blockedProducts(admin)
    const products = await Promise.all(operators.slice(0, 8).filter(o => !blocked.has(o.operator_id)).map(async operator => {
      try {
        const options = productOptions(await provider.product(operator.operator_id), operator.operator_id)
        if (!options) return null
        const country = /^[A-Z]{2}$/.test(options.country_code) ? options.country_code : operator.country_code
        if (!/^[A-Z]{2}$/.test(country)) return null
        const publicOptions = {
          product_id: options.product_id, product_name: options.product_name, currency: options.currency,
          packages: options.packages.map((p: { package_id: string, unit_value: number }) => ({ package_id: p.package_id, unit_value: p.unit_value })),
          range: options.range && { min: options.range.min, max: options.range.max, step: options.range.step },
        }
        return { operator_id: operator.operator_id, operator_name: operator.operator_name, country_code: country, products: [publicOptions] }
      } catch { return null }
    }))
    const available = products.filter(Boolean) as Array<{ country_code: string }>
    const countryCode = available.length && available.every(p => p.country_code === available[0].country_code) ? available[0].country_code : ''
    return { success: true, recipient_phone: phone, country_code: countryCode, operators: available }
  }
  if (action === 'quote') return { success: true, quote: (await makeQuote(provider, admin, body)).quote }
  if (action === 'orders') {
    const { data, error } = await admin.from('customer_airtime_orders').select('id,status,recipient_phone,product_name,amount_ngn,currency,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error('ORDER_UNAVAILABLE')
    return { success: true, orders: (data || []).map(safeOrder) }
  }
  if (action === 'status') {
    if (!uuid(body.order_id)) throw new Error('INVALID_ORDER')
    const row = await orderRow(admin, userId, body.order_id)
    if (!row) throw new Error('ORDER_NOT_FOUND')
    if (row.status === 'processing' || row.status === 'review_required') {
      try {
        const binding = await rpc(admin, 'get_customer_airtime_reconciliation', { p_user_id: userId, p_order_id: body.order_id })
        if (binding.payment_claimed === true && safeId(binding.invoice_id)
          && (binding.state === 'paying' || binding.state === 'unknown')) {
          await tryComplete(provider, admin, userId, body.order_id, binding.invoice_id, binding.quote)
        }
      } catch { /* a status read never starts another provider payment */ }
    }
    return { success: true, order: safeOrder(await orderRow(admin, userId, body.order_id)) }
  }
  if (action !== 'purchase') throw new Error('INVALID_ACTION')
  if (typeof body.idempotency_key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$/.test(body.idempotency_key)) throw new Error('INVALID_KEY')
  const { quote, providerPrice, billingCurrency: quotedBillingCurrency, merchantAvailable } = await makeQuote(provider, admin, body)
  if (Number(body.expected_amount_ngn) !== quote.amount_ngn) throw new Error('PRICE_CHANGED')
  const auth = await rpc(admin, 'authorize_customer_airtime_purchase', {
    p_user_id: userId, p_idempotency_key: body.idempotency_key,
    p_quote: quote, p_expected_amount_ngn: quote.amount_ngn,
  })
  const orderId = String(auth.order_id || '')
  if (!uuid(orderId)) throw new Error('WALLET_UNAVAILABLE')
  if (auth.idempotent_replay) return { success: true, idempotent_replay: true, order: safeOrder(await orderRow(admin, userId, orderId)) }
  if (merchantAvailable < providerPrice) return rejectLowMerchantBalance(admin, userId, orderId)
  const claim = await rpc(admin, 'claim_customer_airtime_dispatch', { p_user_id: userId, p_order_id: orderId })
  if (!claim.send_allowed) return unknown(admin, userId, orderId)
  let created: any
  try { created = await provider.createUnpaidInvoice(quote.product_id, quote.package_id, quote.unit_value, quote.recipient_phone) }
  catch { return unknown(admin, userId, orderId) }
  const invoice = unwrapData(created)
  const invoiceId = safeId(invoice?.id)
  if (!invoiceId || !invoiceIsExactUnpaid(created, invoiceId, quote)) return unknown(admin, userId, orderId)
  try {
    await rpc(admin, 'bind_customer_airtime_invoice', { p_user_id: userId, p_order_id: orderId, p_invoice_id: invoiceId, p_quote: quote, p_provider_status: 'unpaid' })
  } catch { return unknown(admin, userId, orderId) }
  // Verify the provider's exact unpaid invoice and payment price before pay.
  try {
    const checked = await provider.invoice(invoiceId)
    if (!invoiceIsExactUnpaid(checked, invoiceId, quote)) return unknown(admin, userId, orderId)
    const detail = await provider.order(unwrapData<any>(checked).orders[0].id)
    if (!unpaidOrderMatches(detail, unwrapData<any>(checked).orders[0].id, quote)) return unknown(admin, userId, orderId)
    const freshBalance = unwrapData(await provider.balance())
    const billingCurrency = String(freshBalance?.currency || '').toUpperCase()
    if (billingCurrency !== 'USD' && billingCurrency !== 'NGN' && billingCurrency !== 'BTC') return unknown(admin, userId, orderId)
    if (billingCurrency !== quotedBillingCurrency) return unknown(admin, userId, orderId)
    const available = merchantBalance(freshBalance?.balance, billingCurrency)
    if (available === null) return unknown(admin, userId, orderId)
    const rate = await rateToNgn(billingCurrency, admin)
    const cost = invoiceCostNgn(checked, billingCurrency, rate, providerPrice)
    if (cost === null) return unknown(admin, userId, orderId)
    if (available < Number(unwrapData<any>(checked).payment.price)) return rejectLowMerchantBalance(admin, userId, orderId)
    if (cost > quote.amount_ngn) {
      await rpc(admin, 'record_customer_airtime_outcome', { p_user_id: userId, p_order_id: orderId,
        p_outcome: 'rejected', p_evidence: { reason_code: 'PRICE_CHANGED' } })
      return { success: false, code: 'PRICE_CHANGED', order: safeOrder(await orderRow(admin, userId, orderId)) }
    }
  } catch { return unknown(admin, userId, orderId) }
  let paymentClaim: any
  try { paymentClaim = await rpc(admin, 'claim_customer_airtime_payment', { p_user_id: userId, p_order_id: orderId, p_invoice_id: invoiceId }) }
  catch { return unknown(admin, userId, orderId) }
  if (!paymentClaim.pay_allowed) return unknown(admin, userId, orderId)
  try { await provider.pay(invoiceId) }
  catch { return unknown(admin, userId, orderId) }
  try {
    if (await tryComplete(provider, admin, userId, orderId, invoiceId, quote)) return { success: true, order: safeOrder(await orderRow(admin, userId, orderId)) }
  } catch { /* one sent payment, no automatic retry */ }
  return unknown(admin, userId, orderId)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return send({ success: false, error: 'Method not allowed' }, 405)
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const delegated = req.headers.has('x-tally-api-capability')
    if (delegated && Deno.env.get('CUSTOMER_API_ENABLED') !== 'true') return send({ success: false, error: 'Unauthorized' }, 401)
    if (!delegated && !authHeader.startsWith('Bearer ')) return send({ success: false, error: 'Unauthorized' }, 401)
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anonKey || !serviceKey) throw new Error('SERVICE_UNAVAILABLE')
    if (!delegated && authHeader.replace(/^Bearer\s+/, '').trim() === serviceKey) return send({ success: false, error: 'Unauthorized' }, 401)
    const body = await readBody(req)
    if (delegated) {
      const fields = typeof body.action === 'string' && Object.prototype.hasOwnProperty.call(API_ACTION_FIELDS, body.action) && API_ACTION_FIELDS[body.action]
      if (!fields) return send({ success: false, code: 'CUSTOMER_API_ACTION_DENIED', error: 'Action is not available.' }, 403)
      if (Object.keys(body).some(field => !fields.includes(field))) return send({ success: false, code: 'INVALID_REQUEST', error: 'Invalid request.' }, 400)
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    let user: { id: string }
    try { user = await authenticateCustomerRequest(req, admin, 'airtime', 'customer-airtime') }
    catch { return send({ success: false, error: 'Unauthorized' }, 401) }
    // Dedicated activation gate. Legacy purchase-bitrefill remains paused.
    if ((body?.action === 'purchase') && Deno.env.get('CUSTOMER_AIRTIME_ENABLED') !== 'true') return send({ success: false, code: 'AIRTIME_PAUSED', error: 'Airtime checkout is temporarily unavailable.' }, 503)
    if (body?.action === 'admin_pricing_get'
      || (body?.action === 'admin_pricing_set'
        && (body.remove === true || body.scope === 'global' || body.kind === 'sms'))) {
      return send(await handle(body, admin, null as unknown as AirtimeProvider, user.id))
    }
    const provider = new AirtimeProvider(Deno.env.get('BITREFILL_API_KEY') || '')
    return send(await handle(body, admin, provider, user.id))
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'AIRTIME_UNAVAILABLE'
    const status = code === 'REQUEST_TOO_LARGE' ? 413 : code === 'REQUEST_TIMEOUT' ? 408 : code.startsWith('INVALID_') ? 400 : code === 'ORDER_NOT_FOUND' ? 404 : code === 'PRICE_CHANGED' ? 409 : 503
    return send({ success: false, code, error: code === 'AIRTIME_UNAVAILABLE' ? 'Airtime is temporarily unavailable.' : code }, status)
  }
})
