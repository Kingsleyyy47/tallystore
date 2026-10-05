// Status polling for accepted, journaled partner external purchases only.
// This module never makes a purchase, changes a balance, or issues a refund.
import { readBoundBitrefillDelivery } from './partner-bitrefill-delivery.ts'
declare const Deno: { env: { get: (key: string) => string | undefined } }
type Admin = any
type Auth = { partner: { id: string }; key: { id: string; scopes?: string[] } }
type Body = Record<string, unknown>
export type PartnerExternalStatusDeps = {
  daisyGet: (apiKey: string, params: Record<string, string>) => Promise<string>
  smmRequest: (params: Record<string, string | number>) => Promise<any>
  getBitrefillClient: () => { getInvoice: (id: string) => Promise<any>; getOrder: (id: string) => Promise<any> }
  istarGet: (path: string) => Promise<any>
  publicPartnerOrder: (order: any) => Record<string, unknown>
}
type Result = { body: Record<string, unknown>; status?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const POLL_TIMEOUT_MS = 15_000

function validId(value: unknown): string | null {
  return typeof value === 'string' && PROVIDER_ID.test(value) ? value : null
}
function safeText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}
function safeRedemption(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const key of ['code', 'pin', 'instructions', 'expiration_date'] as const) {
    const text = safeText(raw[key], key === 'instructions' ? 1000 : 300)
    if (text) result[key] = text
  }
  const link = safeText(raw.link, 500)
  if (link) {
    try {
      const url = new URL(link)
      if (url.protocol === 'https:') result.link = url.toString()
    } catch { /* Invalid redemption URL is omitted. */ }
  }
  return Object.keys(result).length ? result : null
}
function safeAdditionalInfo(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length <= 4000 ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null || depth >= 3) return null
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeAdditionalInfo(item, depth + 1))
  if (typeof value !== 'object') return null
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (key.length > 80 || /api.?key|access.?token|secret|webhook|authorization|private.?key/i.test(key)) continue
    output[key] = safeAdditionalInfo(item, depth + 1)
  }
  return output
}
function safePayload(value: unknown, itemType: unknown, completed: boolean): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const key of ['provider_status', 'invoice_id', 'provider_order_id', 'fulfillment_id'] as const) {
    const text = safeText(raw[key], 160)
    if (text) output[key] = text
  }
  for (const key of ['start_count', 'remains'] as const) {
    const parsed = Number(raw[key])
    if (raw[key] !== null && raw[key] !== undefined && Number.isSafeInteger(parsed) && parsed >= 0) output[key] = parsed
  }
  if (itemType === 'product' && completed) {
    const productName = safeText(raw.product_name, 300)
    if (productName) output.product_name = productName
    if (Array.isArray(raw.accounts)) {
      output.accounts = raw.accounts.slice(0, 100).filter((account) => account && typeof account === 'object' && !Array.isArray(account)).map((account) => {
        const source = account as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const key of ['username', 'password', 'email', 'email_password', 'two_fa_code', 'recovery_email', 'recovery_email_password'] as const) {
          const text = safeText(source[key], 4000)
          if (text) result[key] = text
        }
        if (source.additional_info !== undefined) result.additional_info = safeAdditionalInfo(source.additional_info)
        return result
      })
    }
  }
  if (itemType === 'sms') {
    for (const key of ['service_name', 'phone_number', 'raw_phone_number', 'expires_at'] as const) {
      const text = safeText(raw[key], 200)
      if (text) output[key] = text
    }
  }
  if (itemType === 'bills_airtime') {
    for (const key of ['transaction_type', 'provider', 'phone'] as const) {
      const text = safeText(raw[key], 200)
      if (text) output[key] = text
    }
  }
  if (itemType === 'giftcards') {
    for (const key of ['bitrefill_order_id', 'provider_currency'] as const) {
      const text = safeText(raw[key], 160)
      if (text) output[key] = text
    }
  }
  if (itemType === 'telegram_stars') {
    for (const key of ['telegram_type', 'username', 'recipient_name'] as const) {
      const text = safeText(raw[key], 300)
      if (text) output[key] = text
    }
  }
  if (['bills_airtime', 'giftcards', 'telegram_stars'].includes(String(itemType))) {
    for (const key of ['provider_amount', 'provider_amount_ngn', 'partner_balance_after'] as const) {
      const number = raw[key]
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) output[key] = number
    }
  }
  if (itemType === 'product') {
    const balance = raw.partner_balance_after
    if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0) output.partner_balance_after = balance
    if (raw.funding_type === 'wallet' || raw.funding_type === 'credit') output.funding_type = raw.funding_type
  }
  if (completed) {
    const code = safeText(raw.code, 32)
    if (code && /^[A-Za-z0-9_-]+$/.test(code)) output.code = code
    const redemption = safeRedemption(raw.redemption)
    if (redemption) output.redemption = redemption
    if (itemType === 'giftcards' && Array.isArray(raw.redemptions)) {
      const redemptions = raw.redemptions.slice(0, 20).map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const item = entry as Record<string, unknown>
        const orderId = validId(item.order_id)
        const safe = safeRedemption(item)
        return orderId && safe ? { order_id: orderId, ...safe } : null
      }).filter((entry) => entry !== null)
      if (redemptions.length === raw.redemptions.length) output.redemptions = redemptions
    }
  }
  return output
}
function publicSummary(order: any, deps: PartnerExternalStatusDeps) {
  const summary = deps.publicPartnerOrder(order)
  const completed = String(summary.status || '') === 'completed'
  return {
    ...summary,
    response_payload: safePayload(summary.response_payload, summary.item_type, completed),
    error_message: summary.error_message ? 'Order requires support review.' : null,
  }
}
function stored(order: any, deps: PartnerExternalStatusDeps, review = false): Result {
  return { body: {
    success: true,
    data: publicSummary(order, deps),
    ...(review ? { code: 'RECONCILIATION_REQUIRED', message: 'Order status needs support review.' } : {}),
  } }
}
async function deadline<T>(call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('poll timed out')), POLL_TIMEOUT_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
type Poll = { completed: true; delta: Record<string, unknown> } | { completed: false; review: boolean }

async function pollVendor(order: any, journal: any, deps: PartnerExternalStatusDeps): Promise<Poll> {
  const source = journal.fulfillment_source
  const id = validId(journal.fulfillment_id)
  if (!id) return { completed: false, review: true }
  if (source === 'daisy' && order.item_type === 'sms' && journal.section === 'sms') {
    const apiKey = Deno.env.get('DAISYSMS_API_KEY') || ''
    if (!apiKey) return { completed: false, review: true }
    const response = await deps.daisyGet(apiKey, { action: 'getStatus', id })
    if (typeof response !== 'string') return { completed: false, review: true }
    if (response.startsWith('STATUS_OK:')) {
      const code = response.slice('STATUS_OK:'.length)
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) return { completed: false, review: true }
      return { completed: true, delta: { code, provider_status: 'completed' } }
    }
    return { completed: false, review: response === 'STATUS_CANCEL' || response === 'NO_ACTIVATION' || !response.startsWith('STATUS_WAIT') }
  }
  if (source === 'smm' && order.item_type === 'social_boost' && journal.section === 'social_boost') {
    const response = await deps.smmRequest({ action: 'status', order: id })
    const status = String(response?.status || '').toLowerCase()
    if (status === 'completed') {
      const delta: Record<string, unknown> = { provider_status: 'Completed' }
      for (const key of ['start_count', 'remains'] as const) {
        const parsed = Number(response?.[key])
        if (response?.[key] !== undefined && response?.[key] !== null && Number.isSafeInteger(parsed) && parsed >= 0) delta[key] = parsed
      }
      return { completed: true, delta }
    }
    if (['pending', 'in progress', 'processing', 'partial'].includes(status)) return { completed: false, review: status === 'partial' }
    return { completed: false, review: true }
  }
  if (source === 'bitrefill' && order.item_type === 'giftcards' && journal.section === 'giftcards') {
    const client = deps.getBitrefillClient()
    const result = await readBoundBitrefillDelivery(client, id, {
      itemId: order.item_id, quantity: order.quantity, unitValue: order.request_payload?.value,
      currency: order.request_payload?.provider_currency, packageId: order.request_payload?.package_id,
    })
    if (result.completed === false) return { completed: false, review: result.review }
    const redemptions = result.delivery.redemptions
    return { completed: true, delta: { provider_status: result.delivery.provider_status, redemptions,
      ...(result.delivery.quantity === 1 ? { redemption: redemptions[0] } : {}) } }
  }
  if (source === 'istar' && order.item_type === 'telegram_stars' && journal.section === 'telegram_stars') {
    const providerOrder = await deps.istarGet(`/orders/${encodeURIComponent(id)}`)
    if (!providerOrder || providerOrder.order_id !== id) return { completed: false, review: true }
    const status = String(providerOrder.status || '').toLowerCase()
    if (status === 'completed') return { completed: true, delta: { provider_status: 'completed' } }
    return { completed: false, review: !['pending', 'processing'].includes(status) }
  }
  return { completed: false, review: true }
}

export async function handlePartnerExternalOrderStatus(admin: Admin, auth: Auth, body: Body, deps: PartnerExternalStatusDeps): Promise<Result> {
  if (!Array.isArray(auth.key?.scopes) || !auth.key.scopes.includes('orders:read')) return { body: { success: false, code: 'MISSING_SCOPE' }, status: 403 }
  const requestedId = typeof body.order_id === 'string' && UUID.test(body.order_id) ? body.order_id : null
  const reference = safeText(body.partner_reference || body.reference, 180)
  if (!requestedId && !reference) return { body: { success: false, code: 'INVALID_ORDER' }, status: 400 }
  let orderQuery = admin.from('api_partner_orders').select('*').eq('partner_id', auth.partner.id)
  orderQuery = requestedId ? orderQuery.eq('id', requestedId) : orderQuery.eq('partner_reference', reference)
  const { data: order, error: orderError } = await orderQuery.maybeSingle()
  if (orderError || !order) return { body: { success: false, code: 'ORDER_NOT_FOUND' }, status: 404 }
  if (order.status !== 'processing' && order.status !== 'active') return stored(order, deps)

  const { data: journal, error: journalError } = await admin.from('api_partner_external_orders')
    .select('order_id,partner_id,key_id,section,state,fulfillment_source,fulfillment_id')
    .eq('order_id', order.id).eq('partner_id', auth.partner.id).maybeSingle()
  if (journalError) return stored(order, deps, true)
  if (!journal || journal.state !== 'accepted') return stored(order, deps)
  if (journal.fulfillment_source !== order.fulfillment_source || journal.fulfillment_id !== order.fulfillment_id) return stored(order, deps, true)

  let poll: Poll
  try { poll = await deadline(() => pollVendor(order, journal, deps)) } catch { return stored(order, deps, true) }
  if (poll.completed === false) return stored(order, deps, poll.review)

  const { data: updated, error: updateError } = await admin.rpc('update_api_partner_external_status', {
    p_key_id: auth.key.id,
    p_order_id: order.id,
    p_source: journal.fulfillment_source,
    p_fulfillment_id: journal.fulfillment_id,
    p_status: 'completed',
    p_payload_delta: poll.delta,
  })
  if (updateError || updated?.success !== true || !updated.data) return stored(order, deps, true)
  return { body: { success: true, data: publicSummary({ ...order, ...updated.data }, deps) } }
}
