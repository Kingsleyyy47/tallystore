// Read-only preparation for partner external purchases. The caller must reserve
// partner funds and journal the order before invoking dispatch exactly once.
export type PartnerExternalOutcome =
  | { kind: 'accepted'; source: 'sagecloud' | 'bitrefill' | 'istar'; id: string; status: 'processing' | 'completed'; payload: Record<string, unknown> }
  | { kind: 'rejected'; reason: 'NO_STOCK' | 'INSUFFICIENT_BALANCE' | 'PRICE_CHANGED' | 'INVALID_RECIPIENT' }
  | { kind: 'unknown' }

export type PartnerExternalSection = 'bills_airtime' | 'giftcards' | 'telegram_stars'
export type PartnerPurchasePlan = {
  section: PartnerExternalSection
  itemId: string
  itemName: string
  quantity: number
  amountNgn: number
  requestPayload: Record<string, unknown>
  dispatch: (orderId: string) => Promise<PartnerExternalOutcome>
}

type Admin = any
type Partner = { id?: string; allowed_sections?: string[]; markup_percent?: number; [key: string]: unknown }
type Body = Record<string, unknown>
type Network = 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE'
export type PartnerExternalDeps = {
  hasSection: (partner: Partner, section: string) => boolean
  partnerMarkup: (partner: Partner, amount: number) => number
  sageCloudClient: () => {
    getBalanceAmount: () => Promise<number>
    getDataPlans: (provider: `${Network}DATA`) => Promise<any>
    purchaseAirtime: (body: Record<string, unknown>) => Promise<any>
    purchaseData: (body: Record<string, unknown>) => Promise<any>
  }
  getBitrefillClient: () => {
    getProductDetails: (id: string) => Promise<any>
    getBalance: () => Promise<any>
    createInvoice: (body: Record<string, unknown>) => Promise<any>
    payInvoice?: (invoiceId: string) => Promise<any>
  }
  getBlockedBitrefillIds: (admin: Admin) => Promise<Set<string>>
  getBitrefillMarkupPct: (admin: Admin) => Promise<number>
  convertToNgn: (admin: Admin, amount: number, currency?: string) => Promise<number>
  getTelegramStarPricing: (admin: Admin) => Promise<any>
  calculateTelegramStarsPrice: (quantity: number, config: any) => number
  getTelegramPremiumPricing: (admin: Admin) => Promise<any>
  calculateTelegramPremiumPrice: (months: number, config: any) => number
  istarGet: (path: string) => Promise<any>
  istarPost: (path: string, body: Record<string, unknown>, idempotencyKey: string) => Promise<any>
}

const NETWORKS = new Set(['MTN', 'GLO', 'AIRTEL', '9MOBILE'])
type Deps = PartnerExternalDeps
const PROVIDER_WAIT_MS = 20_000

function fail(code: string): never { throw new Error(code) }
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}
function number(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return NaN
  return Number(value)
}
function positiveInteger(value: unknown, min: number, max: number): number {
  const parsed = number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail('INVALID_QUANTITY')
  return parsed
}
function validMoney(value: unknown): number {
  const parsed = number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-7) fail('PRICE_CHANGED')
  return parsed
}
function amountNgn(partner: Partner, providerAmount: number, deps: Deps): number {
  if (!Number.isFinite(providerAmount) || providerAmount <= 0) fail('PRICE_UNAVAILABLE')
  let marked: number
  try { marked = deps.partnerMarkup(partner, providerAmount) } catch { fail('PRICE_UNAVAILABLE') }
  if (!Number.isSafeInteger(marked) || marked <= 0 || marked > 1_000_000) fail('PRICE_UNAVAILABLE')
  return marked
}
function expectedPrice(body: Body, amount: number) {
  if (body.expected_amount_ngn !== undefined && validMoney(body.expected_amount_ngn) !== amount) fail('PRICE_CHANGED')
}
function sectionAllowed(partner: Partner, section: PartnerExternalSection, deps: Deps) {
  if (!deps.hasSection(partner, section)) fail('SECTION_UNAVAILABLE')
}
function providerId(value: unknown): string | null {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value, 160)
  return id && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(id) ? id : null
}
function orderReference(orderId: string, prefix: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) fail('INVALID_ORDER')
  return `${prefix}${orderId}`
}
async function onceWithDeadline(call: () => Promise<any>): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider timeout')), PROVIDER_WAIT_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
function oneDispatch(call: (orderId: string) => Promise<PartnerExternalOutcome>) {
  let used = false
  return async (orderId: string): Promise<PartnerExternalOutcome> => {
    if (used) return { kind: 'unknown' }
    // Reject malformed internal order IDs before consuming the one send chance.
    orderReference(orderId, '')
    used = true
    try { return await call(orderId) } catch { return { kind: 'unknown' } }
  }
}
function cleanNigerianPhone(value: unknown): string {
  const candidate = text(value, 24)
  if (!candidate || !/^0\d{10}$/.test(candidate)) fail('INVALID_RECIPIENT')
  return candidate
}
function cleanRecipientPhone(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const candidate = text(value, 24)
  if (!candidate || !/^\+?[0-9]{8,16}$/.test(candidate)) fail('INVALID_RECIPIENT')
  return candidate
}
function cleanEmail(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const candidate = text(value, 254)
  if (!candidate || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) fail('INVALID_RECIPIENT')
  return candidate
}

export async function preparePartnerBillsPlan(admin: Admin, partner: Partner, body: Body, deps: Deps): Promise<PartnerPurchasePlan> {
  sectionAllowed(partner, 'bills_airtime', deps)
  if (body.quantity !== undefined) positiveInteger(body.quantity, 1, 1)
  const itemParts = String(body.item_id || '').split(':')
  const subtype = text(body.transaction_type || body.service || itemParts[0], 40)?.toLowerCase()
  if (subtype !== 'airtime' && subtype !== 'data') fail('INVALID_ITEM')
  const networkText = text(body.service_provider || body.provider || itemParts[1], 20)?.toUpperCase()
  if (!networkText || !NETWORKS.has(networkText)) fail('INVALID_ITEM')
  const network = networkText as Network
  const phone = cleanNigerianPhone(body.phone || body.customer_phone)
  const client = deps.sageCloudClient()
  const code = subtype === 'data' ? text(body.data_plan_code || itemParts[2], 80) : null
  if (subtype === 'data' && (!code || !/^[A-Za-z0-9._-]+$/.test(code))) fail('INVALID_ITEM')
  const itemId = subtype === 'data' ? `data:${network}:${code}` : `airtime:${network}`
  if (body.item_id !== undefined && body.item_id !== itemId) fail('INVALID_ITEM')

  let providerAmount: number
  let itemName = `${network} Airtime`
  if (subtype === 'airtime') {
    providerAmount = positiveInteger(body.amount_ngn ?? body.amount, 50, 50_000)
  } else {
    let lookup: any
    try { lookup = await client.getDataPlans(`${network}DATA`) } catch { fail('PRICE_UNAVAILABLE') }
    if (lookup?.success !== true || !Array.isArray(lookup.data)) fail('PRICE_UNAVAILABLE')
    const plan = lookup.data.find((entry: any) => String(entry?.code) === code)
    providerAmount = number(plan?.price)
    if (!plan || !Number.isSafeInteger(providerAmount) || providerAmount <= 0) fail('PRICE_UNAVAILABLE')
    itemName = `${network} ${text(plan.description, 100) || text(plan.value, 100) || 'Data'}`
  }
  const charge = amountNgn(partner, providerAmount, deps)
  if (subtype === 'data' && body.amount_ngn !== undefined && validMoney(body.amount_ngn) !== charge) fail('PRICE_CHANGED')
  expectedPrice(body, charge)
  let balance: number
  try { balance = Number(await client.getBalanceAmount()) } catch { fail('PROVIDER_BALANCE_UNAVAILABLE') }
  if (!Number.isFinite(balance) || balance < providerAmount) fail('PROVIDER_BALANCE_UNAVAILABLE')
  const requestPayload = { transaction_type: subtype, provider: network, phone, provider_amount_ngn: providerAmount, ...(code ? { data_plan_code: code } : {}) }
  return {
    section: 'bills_airtime', itemId, itemName, quantity: 1, amountNgn: charge, requestPayload,
    dispatch: oneDispatch(async (orderId) => {
      const reference = orderReference(orderId, 'PARTNER-BILLS-')
      const response = await onceWithDeadline(() => subtype === 'airtime'
        ? client.purchaseAirtime({ reference, network, service: `${network}VTU`, phone, amount: String(providerAmount) })
        : client.purchaseData({ reference, type: `${network}DATA`, code, network, phone, provider: network }))
      const actualId = providerId(response?.reference)
      if (response?.success !== true || String(response?.status || '').toLowerCase() !== 'success' || !actualId) return { kind: 'unknown' }
      return { kind: 'accepted', source: 'sagecloud', id: actualId, status: 'completed', payload: { provider_reference: actualId, provider_status: 'success', transaction_type: subtype } }
    }),
  }
}

export async function preparePartnerGiftcardPlan(admin: Admin, partner: Partner, body: Body, deps: Deps): Promise<PartnerPurchasePlan> {
  sectionAllowed(partner, 'giftcards', deps)
  const productId = text(body.item_id || body.product_id, 180)
  if (!productId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(productId)) fail('INVALID_ITEM')
  const quantity = positiveInteger(body.quantity ?? 1, 1, 20)
  const packageId = text(body.package_id, 180)
  if (!packageId && body.value === undefined) fail('INVALID_ITEM')
  let blocked: Set<string>
  try { blocked = await deps.getBlockedBitrefillIds(admin) } catch { fail('CATALOG_UNAVAILABLE') }
  if (blocked.has(productId)) fail('NO_STOCK')
  const client = deps.getBitrefillClient()
  let product: any
  try { product = await client.getProductDetails(productId) } catch { fail('PRICE_UNAVAILABLE') }
  if (!product || product.product_id !== productId || !text(product.name, 200)) fail('PRICE_UNAVAILABLE')
  const currency = text(product.currency || 'USD', 8)?.toUpperCase()
  if (currency !== 'USD' && currency !== 'NGN') fail('PRICE_UNAVAILABLE')
  let unitValue: number
  if (packageId) {
    const pkg = Array.isArray(product.packages) ? product.packages.find((entry: any) => entry?.package_id === packageId) : null
    if (!pkg) fail('NO_STOCK')
    unitValue = validMoney(pkg.value)
    if (body.value !== undefined && validMoney(body.value) !== unitValue) fail('PRICE_CHANGED')
  } else {
    unitValue = validMoney(body.value)
    const min = number(product.range?.min)
    const max = number(product.range?.max)
    const step = number(product.range?.step)
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0
      || unitValue < min || unitValue > max || Math.abs((unitValue - min) / step - Math.round((unitValue - min) / step)) > 1e-8) fail('INVALID_ITEM')
  }
  const recipientPhone = cleanRecipientPhone(body.recipient_phone || body.phone)
  const recipientEmail = cleanEmail(body.customer_email)
  const recipientType = String(product.recipient_type || '').toLowerCase()
  if (recipientType.includes('phone') && !recipientPhone) fail('INVALID_RECIPIENT')
  if (recipientType.includes('email') && !recipientEmail) fail('INVALID_RECIPIENT')
  const providerTotal = unitValue * quantity
  const markupPct = Number(await deps.getBitrefillMarkupPct(admin))
  if (!Number.isFinite(markupPct) || markupPct < 0 || markupPct > 100) fail('PRICE_UNAVAILABLE')
  let converted: number
  try { converted = await deps.convertToNgn(admin, providerTotal, currency) } catch { fail('PRICE_UNAVAILABLE') }
  const charge = amountNgn(partner, Math.ceil(converted * (1 + markupPct / 100)), deps)
  expectedPrice(body, charge)
  let balance: any
  try { balance = await client.getBalance() } catch { fail('PROVIDER_BALANCE_UNAVAILABLE') }
  const balanceAmount = number(balance?.balance)
  const balanceCurrency = text(balance?.currency, 8)?.toUpperCase()
  if (!Number.isFinite(balanceAmount) || balanceAmount < 0 || !balanceCurrency) fail('PROVIDER_BALANCE_UNAVAILABLE')
  let balanceNgn: number
  try { balanceNgn = await deps.convertToNgn(admin, balanceAmount, balanceCurrency) } catch { fail('PROVIDER_BALANCE_UNAVAILABLE') }
  if (!Number.isFinite(balanceNgn) || balanceNgn < converted) fail('PROVIDER_BALANCE_UNAVAILABLE')
  const requestPayload = { product_id: productId, package_id: packageId || null, value: unitValue, quantity, provider_currency: currency, recipient_phone: recipientPhone || null, customer_email: recipientEmail || null }
  return {
    section: 'giftcards', itemId: productId, itemName: product.name, quantity, amountNgn: charge, requestPayload,
    dispatch: oneDispatch(async (orderId) => {
      // The paid endpoint is unavailable until the caller wires the explicit
      // two-step client. Creating an unpaid invoice alone cannot fulfill.
      const payInvoice = client.payInvoice
      if (typeof payInvoice !== 'function') return { kind: 'unknown' }
      const invoice = await onceWithDeadline(() => client.createInvoice({
        products: [{ product_id: productId, package_id: packageId || undefined, value: packageId ? undefined : unitValue, quantity, phone_number: recipientPhone }],
        payment_method: 'balance', auto_pay: false, email: recipientEmail,
      }))
      const actualId = providerId(invoice?.id)
      if (!actualId || String(invoice?.status || '').toLowerCase() !== 'unpaid') return { kind: 'unknown' }
      const bound = await onceWithDeadline(() => admin.rpc('bind_api_partner_bitrefill_invoice', {
        p_order_id: orderId, p_partner_id: partner.id, p_invoice_id: actualId,
        p_invoice_status: 'unpaid', p_item_id: productId, p_quantity: quantity,
        p_amount_ngn: charge,
      }))
      if (bound?.error || bound?.data?.success !== true || bound.data.pay_allowed !== true
        || bound.data.idempotent_replay === true || bound.data.order_id !== orderId) return { kind: 'unknown' }
      // This is the sole paid request. A lost response is unknown; the bound
      // invoice ID supports owner-only read reconciliation without a resend.
      const paid = await onceWithDeadline(() => payInvoice(actualId))
      if (providerId(paid?.id) !== actualId
        || !['pending', 'complete', 'payment_detected', 'payment_confirmed'].includes(String(paid?.status || '').toLowerCase())) return { kind: 'unknown' }
      const providerOrderId = quantity === 1 ? providerId(paid?.orders?.[0]?.id) : null
      return { kind: 'accepted', source: 'bitrefill', id: actualId, status: 'processing', payload: {
        invoice_id: actualId, provider_order_id: providerOrderId,
        provider_status: String(paid.status).toLowerCase(),
      } }
    }),
  }
}

export async function preparePartnerTelegramPlan(admin: Admin, partner: Partner, body: Body, deps: Deps): Promise<PartnerPurchasePlan> {
  sectionAllowed(partner, 'telegram_stars', deps)
  const itemIdInput = text(body.item_id, 180)
  const subtype = String(body.telegram_type || body.subtype || itemIdInput?.split(':')[0] || '').toLowerCase()
  if (subtype !== 'stars' && subtype !== 'premium') fail('INVALID_ITEM')
  const username = text(body.username, 33)?.replace(/^@/, '')
  const recipientHash = text(body.recipient_hash, 500)
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username) || !recipientHash || !/^[A-Za-z0-9_-]{6,500}$/.test(recipientHash)) fail('INVALID_RECIPIENT')
  let itemId: string
  let itemName: string
  let quantity: number
  let amount: number
  let path: string
  let providerBody: Record<string, unknown>
  let recipientPath: string
  if (subtype === 'stars') {
    quantity = positiveInteger(body.quantity ?? itemIdInput?.split(':')[1], 50, 1_000_000)
    itemId = `stars:${quantity}`
    if (itemIdInput && itemIdInput !== itemId) fail('INVALID_ITEM')
    const config = await deps.getTelegramStarPricing(admin)
    if (!Number.isFinite(Number(config?.cost_per_star_usdt)) || Number(config.cost_per_star_usdt) <= 0 || !Number.isFinite(Number(config?.usdt_to_ngn)) || Number(config.usdt_to_ngn) <= 0) fail('PRICE_UNAVAILABLE')
    const walletType = String(config.wallet_type || '').toUpperCase()
    if (walletType !== 'TON' && walletType !== 'USDT') fail('PRICE_UNAVAILABLE')
    amount = amountNgn(partner, deps.calculateTelegramStarsPrice(quantity, config), deps)
    itemName = `${quantity.toLocaleString()} Telegram Stars`
    path = '/orders/star'
    recipientPath = `/star/recipient/search?username=${encodeURIComponent(username)}&quantity=${quantity}`
    providerBody = { username, recipient_hash: recipientHash, quantity, wallet_type: walletType }
  } else {
    if (body.quantity !== undefined) positiveInteger(body.quantity, 1, 1)
    const productId = text(body.product_id || itemIdInput?.replace(/^premium:/, ''), 180)
    if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) fail('INVALID_ITEM')
    itemId = `premium:${productId}`
    if (itemIdInput && itemIdInput !== itemId) fail('INVALID_ITEM')
    const { data: product, error } = await admin.from('telegram_products').select('id,months,label,price_ngn').eq('id', productId).eq('product_type', 'premium').eq('is_active', true).single()
    if (error || !product || ![3, 6, 12].includes(Number(product.months))) fail('NO_STOCK')
    const [config, walletRow] = await Promise.all([
      deps.getTelegramPremiumPricing(admin),
      admin.from('app_settings').select('value').eq('key', 'telegram_wallet_type').maybeSingle(),
    ])
    const walletType = String(walletRow?.data?.value || 'USDT').toUpperCase()
    if (walletType !== 'TON' && walletType !== 'USDT') fail('PRICE_UNAVAILABLE')
    const liveAmount = deps.calculateTelegramPremiumPrice(Number(product.months), config)
    const providerAmount = Number.isFinite(liveAmount) && liveAmount > 0 ? liveAmount : Number(product.price_ngn)
    amount = amountNgn(partner, providerAmount, deps)
    quantity = 1
    itemName = text(product.label, 150) || `${product.months}-Month Telegram Premium`
    path = '/orders/premium'
    recipientPath = `/premium/recipient/search?username=${encodeURIComponent(username)}&months=${product.months}`
    providerBody = { username, recipient_hash: recipientHash, months: product.months, wallet_type: walletType }
  }
  expectedPrice(body, amount)
  let recipient: any
  try { recipient = await deps.istarGet(recipientPath) } catch { fail('INVALID_RECIPIENT') }
  if (recipient?.success !== true || recipient?.recipient !== recipientHash) fail('INVALID_RECIPIENT')
  const requestPayload = { telegram_type: subtype, username, recipient_hash: recipientHash, item_id: itemId, quantity, wallet_type: providerBody.wallet_type }
  return {
    section: 'telegram_stars', itemId, itemName, quantity, amountNgn: amount, requestPayload,
    dispatch: oneDispatch(async (orderId) => {
      const result = await onceWithDeadline(() => deps.istarPost(path, providerBody, orderReference(orderId, 'PARTNER-TG-')))
      const actualId = providerId(result?.order_id)
      if (!actualId || !['pending', 'processing', 'completed'].includes(String(result?.status || '').toLowerCase())) return { kind: 'unknown' }
      return { kind: 'accepted', source: 'istar', id: actualId, status: 'processing', payload: { provider_order_id: actualId, provider_status: String(result.status).toLowerCase(), telegram_type: subtype } }
    }),
  }
}
