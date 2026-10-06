import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { authenticateCustomerRequest } from '../_shared/customer-api-delegation.ts'
import { GiftCardProvider } from '../_shared/customer-giftcard-provider.ts'
import { partnerGiftCardCatalogue as giftCardCatalogue } from '../_shared/partner-giftcard-catalogue.ts'
import {
  parseGiftCardSelection, selectGiftCardDenomination, unwrapGiftCardData, validateCanonicalGiftCardRequest,
  validateGiftCardPurchaseSelection, validateGiftCardQuote, verifyUnpaidGiftCardInvoice,
  verifyBoundUnpaidGiftCardInvoice, readVerifiedGiftCardDelivery,
  type GiftCardQuote, type GiftCardPurchaseSelection,
} from '../_shared/customer-giftcard-contract.ts'

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-tally-api-capability',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
const productId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value)
const providerId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(value)
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const hasControl = (value: string) => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const fields: Record<string, readonly string[]> = {
  catalogue: ['action','start','limit','query','country'],
  details: ['action','product_id'], quote: ['action','product_id','package_id','unit_value','quantity','quote_request_id'],
  purchase: ['action','product_id','package_id','unit_value','quantity','expected_amount_ngn','idempotency_key','quote_id'],
  status: ['action','order_id'], order: ['action','order_id'], orders: ['action'],
}
const safeCodes = new Set(['INVALID_REQUEST','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','UNAUTHORIZED','CUSTOMER_ONLY',
  'GIFT_CARDS_PAUSED','PRICE_UNIT_UNVERIFIED','PRICE_UNAVAILABLE','PRICE_CHANGED','NO_STOCK','PROVIDER_BALANCE_LOW',
  'CATALOG_UNAVAILABLE','ORDER_NOT_FOUND','ORDER_UNAVAILABLE','WALLET_UNAVAILABLE','INSUFFICIENT_FUNDS',
  'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS','INSUFFICIENT_AVAILABLE_FUNDS','WALLET_NOT_ACTIVE','WALLET_AUTHORIZATION_STALE',
  'PROFILE_NOT_FOUND','IDEMPOTENCY_REQUEST_CONFLICT','BINDING_REQUIRES_REVIEW','QUOTE_OUTCOME_UNKNOWN','QUOTE_UNAVAILABLE',
  'QUOTE_EXPIRED','QUOTE_INTENT_CONFLICT','QUOTE_RATE_LIMITED','QUOTE_NOT_AVAILABLE','QUOTE_REQUIRES_REVIEW',
  'INVOICE_QUOTE_NOT_AVAILABLE','INVOICE_QUOTE_MISMATCH'])

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_REQUEST')
  const length = req.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16_384)) throw new Error('REQUEST_TOO_LARGE')
  const reader = req.body?.getReader()
  if (!reader) throw new Error('INVALID_REQUEST')
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')),5000) })
  try {
    let size = 0
    const chunks: Uint8Array[] = []
    for (;;) {
      const part = await Promise.race([reader.read(),deadline])
      if (part.done) break
      if (!part.value.byteLength) throw new Error('INVALID_REQUEST')
      size += part.value.byteLength
      if (size > 16_384) throw new Error('REQUEST_TOO_LARGE')
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength }
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)) } catch { throw new Error('INVALID_REQUEST') }
    const body = object(raw)
    if (!body || typeof body.action !== 'string' || !Object.hasOwn(fields,body.action)
      || Object.keys(body).some(field => !fields[body.action as string].includes(field))) throw new Error('INVALID_REQUEST')
    return body
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function rpc(admin: any, name: string, params: Record<string, unknown>) {
  const { data,error } = await admin.rpc(name,params)
  if (error || !object(data) || data.success !== true) {
    throw new Error(!error && safeCodes.has(data?.code) ? data.code : 'WALLET_UNAVAILABLE')
  }
  return data
}
async function blockedProducts(admin: any): Promise<Set<string>> {
  const { data,error } = await admin.from('app_settings').select('value').eq('key','bitrefill_blocked_products').maybeSingle()
  if (error) throw new Error('CATALOG_UNAVAILABLE')
  if (data === null || data?.value === null || data?.value === undefined || data.value === '') return new Set()
  let rows: unknown
  try { rows = typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { throw new Error('CATALOG_UNAVAILABLE') }
  if (!Array.isArray(rows) || rows.some(row => !object(row) || !productId(row.product_id))) throw new Error('CATALOG_UNAVAILABLE')
  return new Set(rows.map(row => row.product_id))
}
async function product(provider: GiftCardProvider,admin: any,value: unknown) {
  if (!productId(value)) throw new Error('INVALID_REQUEST')
  if ((await blockedProducts(admin)).has(value)) throw new Error('NO_STOCK')
  const parsed = parseGiftCardSelection(await provider.product(value),value)
  if (!parsed) throw new Error('NO_STOCK')
  return parsed
}
function invoicePriceUnit() {
  // Catalogue price candidates cannot establish invoice or account units.
  // Keep quote creation closed until the merchant's actual billing unit is
  // independently verified and configured for this specific invoice path.
  const unit = Deno.env.get('BITREFILL_INVOICE_PRICE_UNIT')
  if (unit !== 'major' && unit !== 'satoshi') throw new Error('PRICE_UNIT_UNVERIFIED')
  return unit
}
type Decimal = { numerator: bigint; denominator: bigint }
// Preserve the provider's declared decimal precision. Do not introduce a
// supplier rounding convention, and do not let binary float multiplication
// move an exact billing total or NGN rounding boundary.
function decimal(value: number): Decimal {
  if (!Number.isFinite(value) || value < 0) throw new Error('PRICE_UNAVAILABLE')
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) throw new Error('PRICE_UNAVAILABLE')
  const fraction = match[2] || ''
  const exponent = Number(match[3] || 0) - fraction.length
  const digits = BigInt(match[1] + fraction)
  return exponent >= 0 ? { numerator:digits * 10n ** BigInt(exponent),denominator:1n }
    : { numerator:digits,denominator:10n ** BigInt(-exponent) }
}
const multiply = (left: Decimal,right: Decimal): Decimal => ({ numerator:left.numerator * right.numerator,denominator:left.denominator * right.denominator })
const add = (left: Decimal,right: Decimal): Decimal => ({ numerator:left.numerator * right.denominator + right.numerator * left.denominator,denominator:left.denominator * right.denominator })
function roundNgnUnit(value: Decimal) {
  const divisor = value.denominator * 10n
  const result = (value.numerator + divisor - 1n) / divisor * 10n
  if (result <= 0n || result > 1_000_000_000n) throw new Error('PRICE_UNAVAILABLE')
  return Number(result)
}
function merchant(raw: unknown, unit: 'major'|'satoshi') {
  const value = object(unwrapGiftCardData(raw))
  const currency = value?.currency
  const amount = typeof value?.balance === 'number' ? value.balance
    : typeof value?.balance === 'string' && /^\d+(?:\.\d+)?$/.test(value.balance) ? Number(value.balance) : NaN
  if (!Number.isFinite(amount) || amount < 0 || (unit === 'major' ? currency !== 'USD' && currency !== 'EUR' && currency !== 'NGN'
    : currency !== 'BTC' || !Number.isSafeInteger(amount))) throw new Error('PRICE_UNAVAILABLE')
  return { currency: currency as GiftCardQuote['billing_currency'],balance: amount }
}
async function rateToNgn(currency: GiftCardQuote['billing_currency'],admin: any): Promise<Decimal> {
  if (currency === 'NGN') return decimal(1)
  if (currency === 'EUR') {
    const { data,error } = await admin.from('app_settings').select('value').eq('key','ngn_eur_rate').maybeSingle()
    const rate = Number(data?.value)
    if (error || !Number.isFinite(rate) || rate <= 0) throw new Error('PRICE_UNAVAILABLE')
    return decimal(rate)
  }
  const { data,error } = await admin.from('app_settings').select('value').eq('key','ngn_usd_rate').maybeSingle()
  if (error) throw new Error('PRICE_UNAVAILABLE')
  let usdRate = Number(data?.value)
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    const response = await fetch('https://open.er-api.com/v6/latest/USD',{ redirect:'error',signal:AbortSignal.timeout(8000) })
    if (!response.ok || response.redirected) throw new Error('PRICE_UNAVAILABLE')
    const rates = await response.json()
    const age = Date.now() - Number(rates?.time_last_update_unix) * 1000
    usdRate = Number(rates?.rates?.NGN)
    if (rates?.result !== 'success' || !Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(age) || age < -300000 || age > 172800000) throw new Error('PRICE_UNAVAILABLE')
  }
  if (currency === 'USD') return decimal(usdRate)
  const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{ redirect:'error',signal:AbortSignal.timeout(8000) })
  if (!response.ok || response.redirected) throw new Error('PRICE_UNAVAILABLE')
  const ticker = await response.json()
  const usd = Number(ticker?.price)
  const age = Date.now() - Date.parse(String(ticker?.time || ''))
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(age) || age < -300000 || age > 300000) throw new Error('PRICE_UNAVAILABLE')
  return multiply(decimal(usdRate),decimal(usd))
}
async function readUnpaidInvoice(provider: GiftCardProvider,invoiceId: string,quantity: number,originalIds: string[]) {
  const invoice = object(unwrapGiftCardData(await provider.invoice(invoiceId)))
  if (!invoice || invoice.id !== invoiceId || invoice.status !== 'unpaid' || !Array.isArray(invoice.orders)
    || invoice.orders.length !== quantity || invoice.orders.some(unit => !object(unit) || !providerId(unit.id))
    || new Set(invoice.orders.map(unit => (unit as Record<string,unknown>).id)).size !== quantity
    || originalIds.length !== quantity || new Set(originalIds).size !== quantity
    || invoice.orders.some(unit => !originalIds.includes((unit as Record<string,unknown>).id as string))) throw new Error('BINDING_REQUIRES_REVIEW')
  const details: unknown[] = []
  // Bound concurrency avoids both a 20-child serial deadline and an
  // unbounded burst against the supplier. A failed GET cannot authorize pay.
  for (let start = 0; start < originalIds.length; start += 5)
    details.push(...await Promise.all(originalIds.slice(start,start + 5).map(childId => provider.order(childId))))
  return { invoice,details }
}
async function makeQuote(provider: GiftCardProvider,admin: any,userId: string,body: Record<string, unknown>) {
  if (typeof body.quote_request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$/.test(body.quote_request_id)) throw new Error('INVALID_REQUEST')
  const selection = validateGiftCardPurchaseSelection({ product_id:body.product_id,
    package_id:body.package_id ?? null,unit_value:body.unit_value,quantity:body.quantity })
  if (!selection) throw new Error('INVALID_REQUEST')
  // This durable claim precedes the one external create POST. A lost claim or
  // create acknowledgement leaves the intent unknown; retry never recreates.
  const began = await rpc(admin,'begin_customer_giftcard_quote',{ p_user_id:userId,p_intent_key:body.quote_request_id,p_selection:selection })
  if (!id(began.quote_id)) throw new Error('QUOTE_UNAVAILABLE')
  if (began.create_allowed !== true) {
    const prior = validateGiftCardQuote(began.quote)
    if (began.finalized === true && prior && typeof began.expires_at === 'string' && Date.parse(began.expires_at) > Date.now())
      return { success:true,quote:publicQuote(prior),quote_id:began.quote_id,expires_at:began.expires_at,idempotent_replay:true }
    throw new Error('QUOTE_OUTCOME_UNKNOWN')
  }
  const unit = invoicePriceUnit()
  const selected = await product(provider,admin,selection.product_id)
  const denomination = selectGiftCardDenomination(selected,selection.package_id,selection.unit_value)
  if (!denomination || denomination.package_id !== selection.package_id
    || denomination.unit_value !== selection.unit_value) throw new Error('INVALID_REQUEST')
  const created = object(unwrapGiftCardData(await provider.createUnpaidInvoice(selection)))
  const invoiceId = created?.id
  if (!providerId(invoiceId) || created?.status !== 'unpaid' || !Array.isArray(created.orders)
    || created.orders.length !== selection.quantity || created.orders.some(child => !object(child) || !providerId(child.id))) throw new Error('QUOTE_OUTCOME_UNKNOWN')
  const originalIds = created.orders.map(child => (child as Record<string,unknown>).id as string)
  if (new Set(originalIds).size !== selection.quantity) throw new Error('QUOTE_OUTCOME_UNKNOWN')
  const { invoice,details } = await readUnpaidInvoice(provider,invoiceId,selection.quantity,originalIds)
  const payment = object(invoice.payment)
  const price = payment?.price
  const currency = payment?.currency
  if (payment?.method !== 'balance' || !positive(price) || price > 1_000_000_000
    || (currency !== 'USD' && currency !== 'EUR' && currency !== 'NGN' && currency !== 'BTC')
    || (currency === 'BTC' && !Number.isSafeInteger(price))
    || (unit === 'satoshi' ? currency !== 'BTC' : currency === 'BTC')) throw new Error('PRICE_UNAVAILABLE')
  const bound = { ...selected,package_id:selection.package_id,unit_value:selection.unit_value,
    quantity:selection.quantity,provider_price:price,billing_currency:currency }
  // Select only the eight fields allowed by the exact invoice contract.
  const invoiceQuote = { product_id:bound.product_id,product_name:bound.product_name,package_id:bound.package_id,
    unit_value:bound.unit_value,currency:bound.currency,quantity:bound.quantity,
    provider_price:bound.provider_price,billing_currency:bound.billing_currency }
  if (!verifyBoundUnpaidGiftCardInvoice(invoice,invoiceId,invoiceQuote,details)) throw new Error('BINDING_REQUIRES_REVIEW')
  const account = merchant(await provider.balance(),unit)
  if (account.currency !== currency) throw new Error('PRICE_UNAVAILABLE')
  if (account.balance < price) {
    await warnLowSupplierBalance(admin)
    throw new Error('PROVIDER_BALANCE_LOW')
  }
  const rate = await rateToNgn(currency,admin)
  const pricing = await rpc(admin,'get_customer_bitrefill_pricing',{ p_kind:'gift_card',p_product_id:selected.product_id,
    p_package_id:selection.package_id,p_unit_value:selection.unit_value,p_currency:selected.currency })
  if (!Number.isFinite(pricing.value) || pricing.value < 0
    || (pricing.mode === 'amount' ? pricing.value > 1_000_000_000 : pricing.mode !== 'percent' || pricing.value > 1000)) throw new Error('PRICE_UNAVAILABLE')
  const supplierUnit = { numerator:decimal(price).numerator,
    denominator:decimal(price).denominator * BigInt(selection.quantity) * (unit === 'satoshi' ? 100_000_000n : 1n) }
  const supplierNgn = multiply(supplierUnit,rate)
  const markup = decimal(pricing.value)
  const adjusted = pricing.mode === 'percent' ? multiply(supplierNgn,add(decimal(1),{
    numerator:markup.numerator,denominator:markup.denominator * 100n })) : add(supplierNgn,markup)
  const unitAmount = roundNgnUnit(adjusted)
  const quote = validateGiftCardQuote({ ...invoiceQuote,amount_ngn:unitAmount * selection.quantity })
  if (!quote) throw new Error('PRICE_UNAVAILABLE')
  const expires = new Date(Date.now() + 5 * 60_000).toISOString()
  const finalized = await rpc(admin,'finalize_customer_giftcard_quote',{ p_user_id:userId,p_quote_id:began.quote_id,
    p_request:selection,p_quote:quote,p_invoice_id:invoiceId,p_child_order_ids:originalIds,p_expires_at:expires })
  if (finalized.success !== true || finalized.quote_id !== began.quote_id || typeof finalized.expires_at !== 'string')
    throw new Error('QUOTE_OUTCOME_UNKNOWN')
  return { success:true,quote:publicQuote(quote),quote_id:began.quote_id,expires_at:finalized.expires_at }
}
function publicQuote(quote: GiftCardQuote) {
  return { product_id:quote.product_id,product_name:quote.product_name,package_id:quote.package_id,unit_value:quote.unit_value,
    currency:quote.currency,quantity:quote.quantity,amount_ngn:quote.amount_ngn,unit_amount_ngn:quote.amount_ngn / quote.quantity }
}
function safeOrder(raw: unknown,userId: string,orderId?: string) {
  const row = object(raw)
  const nominal = row && validateCanonicalGiftCardRequest({ product_id:row.product_id,package_id:row.package_id,
    unit_value:Number(row.unit_value),quantity:row.quantity,expected_amount_ngn:Number(row.amount_ngn) })
  if (!row || !id(row.id) || (orderId !== undefined && row.id !== orderId) || row.user_id !== userId
    || !['pending','processing','completed','failed','review_required'].includes(String(row.status))
    || !nominal || typeof row.product_name !== 'string' || !row.product_name.trim() || row.product_name.length > 120 || hasControl(row.product_name)
    || !Number.isSafeInteger(row.quantity) || (row.quantity as number) < 1 || (row.quantity as number) > 20
    || !positive(Number(row.amount_ngn)) || !positive(Number(row.unit_value)) || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw new Error('ORDER_UNAVAILABLE')
  return { id:row.id,status:row.status,product_id:row.product_id,product_name:row.product_name,package_id:row.package_id ?? null,
    unit_value:Number(row.unit_value),currency:row.currency,quantity:row.quantity,amount_ngn:Number(row.amount_ngn),created_at:row.created_at }
}
function safeRedemptions(raw: unknown,quantity: number) {
  if (!Array.isArray(raw) || raw.length !== quantity) throw new Error('ORDER_UNAVAILABLE')
  const ids = new Set<string>()
  return raw.map(value => {
    const row = object(value)
    if (!row || !providerId(row.order_id) || ids.has(row.order_id) || Object.keys(row).some(key => !['order_id','code','pin','link','instructions','expiration_date'].includes(key))) throw new Error('ORDER_UNAVAILABLE')
    ids.add(row.order_id)
    const result: Record<string,string> = { order_id:row.order_id }
    for (const field of ['code','pin','link','instructions','expiration_date']) if (row[field] !== undefined) {
      const value = row[field]
      if (typeof value !== 'string' || !value.trim() || value.length > (field === 'instructions' ? 1000 : field === 'link' ? 500 : 300) || hasControl(value)) throw new Error('ORDER_UNAVAILABLE')
      result[field] = value
    }
    if (!result.code && !result.link) throw new Error('ORDER_UNAVAILABLE')
    if (result.link) {
      let url: URL
      try { url = new URL(result.link) } catch { throw new Error('ORDER_UNAVAILABLE') }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('ORDER_UNAVAILABLE')
    }
    return result
  })
}
async function readOwnedOrder(admin: any,userId: string,orderId: string) {
  const result = await rpc(admin,'get_customer_giftcard_order',{ p_user_id:userId,p_order_id:orderId })
  const order = safeOrder(result.order,userId,orderId)
  return { state:result.state,response:{ success:true,order,...(order.status === 'completed' && result.state === 'completed' && result.redemptions !== undefined
    ? { redemptions:safeRedemptions(result.redemptions,order.quantity as number) } : {}) } }
}
async function ownedOrder(admin: any,userId: string,orderId: string) {
  return (await readOwnedOrder(admin,userId,orderId)).response
}
async function unknown(admin: any,userId: string,orderId: string) {
  try { await rpc(admin,'record_customer_giftcard_outcome',{ p_user_id:userId,p_order_id:orderId,p_outcome:'unknown',p_evidence:{} }) } catch { /* preserve the hold and one-use claims */ }
  // A response can be lost after the database committed a terminal outcome.
  // Prefer that owned result without granting any new send or release claim.
  const current = await readOwnedOrder(admin,userId,orderId)
  if (current.state === 'completed' && current.response.order.status === 'completed' && 'redemptions' in current.response) return current.response
  if (current.state === 'rejected' && current.response.order.status === 'failed') return { ...current.response,success:false,code:'PURCHASE_REJECTED' }
  return { ...current.response,success:false,outcome_unknown:true }
}
async function rejectLowBalance(admin: any,userId: string,orderId: string) {
  // Record the known supplier condition before releasing the hold, so a lost
  // settlement response cannot skip the staff warning. Alert failure must
  // never prevent the definitive unpaid release.
  await warnLowSupplierBalance(admin)
  await rpc(admin,'record_customer_giftcard_outcome',{ p_user_id:userId,p_order_id:orderId,p_outcome:'rejected',p_evidence:{ reason_code:'INSUFFICIENT_BALANCE' } })
  return { ...(await ownedOrder(admin,userId,orderId)),success:false,code:'PROVIDER_BALANCE_LOW' }
}
async function warnLowSupplierBalance(admin: any) {
  try {
    const { error } = await admin.rpc('record_supplier_balance_alert',
      { p_provider:'bitrefill',p_product_group_id:null,p_source:'customer-giftcards' })
    if (error) console.error('Gift-card supplier warning could not be recorded')
  } catch { console.error('Gift-card supplier warning could not be recorded') }
}
async function complete(provider: GiftCardProvider,admin: any,userId: string,orderId: string,invoiceId: string,quote: GiftCardQuote) {
  const proof = await readVerifiedGiftCardDelivery(provider,invoiceId,quote)
  if (!proof.completed) return false
  const evidence = { ...proof.delivery,invoice_id:invoiceId,package_id:quote.package_id }
  await rpc(admin,'record_customer_giftcard_outcome',{ p_user_id:userId,p_order_id:orderId,p_outcome:'completed',p_evidence:evidence })
  return true
}
async function purchase(body: Record<string,unknown>,admin: any,userId: string) {
  const request = validateCanonicalGiftCardRequest({ product_id:body.product_id,package_id:body.package_id,unit_value:body.unit_value,
    quantity:body.quantity,expected_amount_ngn:body.expected_amount_ngn })
  if (!request || !id(body.quote_id) || typeof body.idempotency_key !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$/.test(body.idempotency_key)) throw new Error('INVALID_REQUEST')
  // Lookup before all provider reads: a retry is anchored to the original
  // approved request, independent of current cost, stock or markup changes.
  const replay = await rpc(admin,'get_customer_giftcard_replay',{ p_user_id:userId,p_idempotency_key:body.idempotency_key,
    p_request:request,p_quote_id:body.quote_id })
  if (replay.existing === true) {
    if (!id(replay.order_id)) throw new Error('ORDER_UNAVAILABLE')
    return { ...(await ownedOrder(admin,userId,replay.order_id)),idempotent_replay:true }
  }
  if (replay.existing !== false) throw new Error('WALLET_UNAVAILABLE')
  if (Deno.env.get('CUSTOMER_GIFTCARDS_ENABLED') !== 'true') throw new Error('GIFT_CARDS_PAUSED')
  const unit = invoicePriceUnit()
  const stored = await rpc(admin,'get_customer_giftcard_invoice_quote',{ p_user_id:userId,p_quote_id:body.quote_id })
  const quote = validateGiftCardQuote(stored.quote)
  const selection = validateGiftCardPurchaseSelection(stored.request)
  const invoiceId = stored.invoice_id
  const originalIds = stored.child_order_ids
  if (stored.status !== 'finalized' || !quote || !selection || !providerId(invoiceId)
    || !Array.isArray(originalIds) || originalIds.length !== quote.quantity
    || originalIds.some(child => !providerId(child)) || new Set(originalIds).size !== quote.quantity
    || typeof stored.expires_at !== 'string' || Date.parse(stored.expires_at) <= Date.now()
    || quote.product_id !== request.product_id || quote.package_id !== request.package_id
    || quote.unit_value !== request.unit_value || quote.quantity !== request.quantity
    || quote.amount_ngn !== request.expected_amount_ngn
    || selection.product_id !== request.product_id || selection.package_id !== request.package_id
    || selection.unit_value !== request.unit_value || selection.quantity !== request.quantity) throw new Error('QUOTE_EXPIRED')
  const provider = new GiftCardProvider(Deno.env.get('BITREFILL_API_KEY') || '')
  const account = merchant(await provider.balance(),unit)
  if (account.currency !== quote.billing_currency) throw new Error('PRICE_UNAVAILABLE')
  if (account.balance < quote.provider_price) {
    await warnLowSupplierBalance(admin)
    throw new Error('PROVIDER_BALANCE_LOW')
  }
  const authorization = await rpc(admin,'authorize_customer_giftcard_purchase',{ p_user_id:userId,p_idempotency_key:body.idempotency_key,
    p_request:request,p_quote:quote,p_expected_amount_ngn:request.expected_amount_ngn,p_quote_id:body.quote_id })
  const orderId = authorization.order_id
  if (!id(orderId)) throw new Error('WALLET_UNAVAILABLE')
  if (authorization.idempotent_replay === true) return { ...(await ownedOrder(admin,userId,orderId)),idempotent_replay:true }
  try {
    if (account.balance < quote.provider_price) return await rejectLowBalance(admin,userId,orderId)
    const claim = await rpc(admin,'claim_customer_giftcard_dispatch',{ p_user_id:userId,p_order_id:orderId })
    if (claim.send_allowed !== true) return unknown(admin,userId,orderId)
    const { invoice,details } = await readUnpaidInvoice(provider,invoiceId,quote.quantity,originalIds)
    if (!verifyUnpaidGiftCardInvoice(invoice,invoiceId,quote,details)) return unknown(admin,userId,orderId)
    await rpc(admin,'bind_customer_giftcard_invoice',{ p_user_id:userId,p_order_id:orderId,p_invoice_id:invoiceId,p_quote:quote,p_provider_status:'unpaid' })
    const freshBalance = merchant(await provider.balance(),unit)
    if (freshBalance.currency !== quote.billing_currency) return unknown(admin,userId,orderId)
    if (freshBalance.balance < quote.provider_price) return await rejectLowBalance(admin,userId,orderId)
    const claimPayment = await rpc(admin,'claim_customer_giftcard_payment',{ p_user_id:userId,p_order_id:orderId,p_invoice_id:invoiceId })
    if (claimPayment.pay_allowed !== true) return unknown(admin,userId,orderId)
    await provider.pay(invoiceId)
    if (await complete(provider,admin,userId,orderId,invoiceId,quote)) return ownedOrder(admin,userId,orderId)
  } catch { /* A timeout, provider error or failed DB write never authorizes another POST or release. */ }
  return unknown(admin,userId,orderId)
}
async function handle(body: Record<string,unknown>,admin: any,userId: string) {
  if (body.action === 'catalogue') {
    const start = body.start === undefined ? 0 : body.start
    const limit = body.limit === undefined ? 20 : body.limit
    if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 || start > 1_000_000 ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      (body.query !== undefined && (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 100 || hasControl(body.query))) ||
      (body.country !== undefined && (typeof body.country !== 'string' || !/^[A-Z]{2}$/.test(body.country)))) throw new Error('INVALID_REQUEST')
    const blocked = await blockedProducts(admin)
    const provider = new GiftCardProvider(Deno.env.get('BITREFILL_API_KEY') || '')
    const raw = unwrapGiftCardData(await provider.catalogue({ start:start as number,limit:limit as number,
      query:body.query as string | undefined,country:body.country as string | undefined }))
    if (!Array.isArray(raw) || raw.length > limit) throw new Error('CATALOG_UNAVAILABLE')
    const countries = new Map<string,string[]>()
    for (const item of raw) {
      const row = object(item)
      if (!row) continue
      const id = row.product_id ?? row.id
      const values = Array.isArray(row.countries) ? row.countries : typeof row.country === 'string' ? [row.country] : []
      if (typeof id === 'string') countries.set(id,[...new Set(values.filter(value => typeof value === 'string' && /^[A-Z]{2}$/.test(value)))] as string[])
    }
    const products = giftCardCatalogue(raw,blocked).flatMap(item => {
      const locations = countries.get(item.id) || []
      if (body.country !== undefined && !locations.includes(body.country as string)) return []
      return [{ ...item,countries:locations }]
    })
    // Pagination describes the scanned provider page, including filtered rows.
    // Never return or follow a supplier-supplied URL or fabricate a retail price.
    return { success:true,products,pagination:{ start,limit,next_start:raw.length === limit && start + limit <= 1_000_000 ? start + limit : null } }
  }
  if (body.action === 'purchase') return purchase(body,admin,userId)
  if (body.action === 'orders') {
    const { data,error } = await admin.from('customer_giftcard_orders')
      .select('id,user_id,status,product_id,product_name,package_id,unit_value,currency,quantity,amount_ngn,created_at')
      .eq('user_id',userId).order('created_at',{ ascending:false }).limit(50)
    if (error || !Array.isArray(data)) throw new Error('ORDER_UNAVAILABLE')
    return { success:true,orders:data.map(row => safeOrder(row,userId)) }
  }
  if (body.action === 'order' || body.action === 'status') {
    if (!id(body.order_id)) throw new Error('INVALID_REQUEST')
    const current = await ownedOrder(admin,userId,body.order_id)
    if (body.action === 'status' && ['processing','review_required'].includes(String(current.order.status))) {
      try {
        const binding = await rpc(admin,'get_customer_giftcard_reconciliation',{ p_user_id:userId,p_order_id:body.order_id })
        const quote = validateGiftCardQuote(binding.quote)
        if (quote && binding.order_id === body.order_id && binding.payment_claimed === true && providerId(binding.invoice_id)
          && (binding.state === 'paying' || binding.state === 'unknown')) {
          const provider = new GiftCardProvider(Deno.env.get('BITREFILL_API_KEY') || '')
          await complete(provider,admin,userId,body.order_id,binding.invoice_id,quote)
        }
      } catch { /* An owned status read can only reconcile original paid delivery. */ }
      return ownedOrder(admin,userId,body.order_id)
    }
    return current
  }
  if (body.action === 'quote') {
    if (Deno.env.get('CUSTOMER_GIFTCARDS_ENABLED') !== 'true') throw new Error('GIFT_CARDS_PAUSED')
    const provider = new GiftCardProvider(Deno.env.get('BITREFILL_API_KEY') || '')
    return makeQuote(provider,admin,userId,body)
  }
  const provider = new GiftCardProvider(Deno.env.get('BITREFILL_API_KEY') || '')
  if (!productId(body.product_id)) throw new Error('INVALID_REQUEST')
  if ((await blockedProducts(admin)).has(body.product_id)) throw new Error('NO_STOCK')
  const parsed = parseGiftCardSelection(await provider.product(body.product_id),body.product_id)
  if (!parsed) throw new Error('NO_STOCK')
  return { success:true,product:{ product_id:parsed.product_id,product_name:parsed.product_name,currency:parsed.currency,
    packages:parsed.packages.map(unit => ({ package_id:unit.package_id,unit_value:unit.unit_value })),
    range:parsed.range && { min:parsed.range.min,max:parsed.range.max,step:parsed.range.step } } }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null,{ headers })
  if (req.method !== 'POST') return send({ success:false,code:'METHOD_NOT_ALLOWED' },405)
  try {
    const authorization = req.headers.get('Authorization') || ''
    const delegatedRequest = req.headers.has('x-tally-api-capability') ? req.clone() : null
    if (!/^Bearer\s+[^\s]+$/i.test(authorization)) throw new Error('UNAUTHORIZED')
    const token = authorization.replace(/^Bearer\s+/i,'')
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anonKey || !serviceKey) throw new Error('WALLET_UNAVAILABLE')
    if (delegatedRequest ? token !== serviceKey : token === serviceKey) throw new Error('UNAUTHORIZED')
    let body: Record<string, unknown>
    try { body = await readBody(req) }
    catch (error) { if (delegatedRequest?.body) void delegatedRequest.body.cancel().catch(() => {}); throw error }
    const admin = createClient(url,serviceKey,{ auth:{ persistSession:false } })
    let userId: string
    if (delegatedRequest) {
      try { userId = (await authenticateCustomerRequest(delegatedRequest,admin,'giftcards','customer-giftcards')).id }
      catch { throw new Error('UNAUTHORIZED') }
    } else {
      const client = createClient(url,anonKey,{ auth:{ persistSession:false } })
      const { data:{ user },error } = await client.auth.getUser(token)
      if (error || !user || !id(user.id)) throw new Error('UNAUTHORIZED')
      userId = user.id
    }
    if (!id(userId)) throw new Error('UNAUTHORIZED')
    const { data:profile,error:profileError } = await admin.from('profiles').select('is_admin,is_staff,account_suspended').eq('id',userId).maybeSingle()
    if (profileError || !profile || profile.account_suspended === true) throw new Error('UNAUTHORIZED')
    if (profile.is_admin === true || profile.is_staff === true) throw new Error('CUSTOMER_ONLY')
    return send(await handle(body,admin,userId))
  } catch (error) {
    const code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'GIFT_CARDS_UNAVAILABLE'
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'CUSTOMER_ONLY' ? 403 : code === 'REQUEST_TOO_LARGE' ? 413
      : code === 'REQUEST_TIMEOUT' ? 408 : code === 'INVALID_REQUEST' ? 400 : code === 'ORDER_NOT_FOUND' ? 404
      : ['PRICE_CHANGED','IDEMPOTENCY_REQUEST_CONFLICT','INSUFFICIENT_FUNDS','INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS',
        'INSUFFICIENT_AVAILABLE_FUNDS','QUOTE_OUTCOME_UNKNOWN','QUOTE_INTENT_CONFLICT','QUOTE_NOT_AVAILABLE',
        'QUOTE_EXPIRED','INVOICE_QUOTE_NOT_AVAILABLE','INVOICE_QUOTE_MISMATCH'].includes(code) ? 409
      : code === 'QUOTE_RATE_LIMITED' ? 429 : 503
    return send({ success:false,code,error:code === 'GIFT_CARDS_UNAVAILABLE' ? 'Gift cards are temporarily unavailable.' : code },status)
  }
}
Deno.serve(handler)
