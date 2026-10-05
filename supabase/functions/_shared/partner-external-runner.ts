export type PartnerExternalSection = 'sms' | 'social_boost' | 'bills_airtime' | 'giftcards' | 'telegram_stars'
export type PartnerProviderOutcome =
  | { kind: 'accepted'; source: 'daisy' | 'smm' | 'sagecloud' | 'bitrefill' | 'istar'; id: string; status: 'active' | 'processing' | 'completed'; payload: Record<string, unknown> }
  | { kind: 'rejected'; reason: 'NO_STOCK' | 'INSUFFICIENT_BALANCE' | 'PRICE_CHANGED' | 'INVALID_RECIPIENT' }
  | { kind: 'unknown' }
export type PartnerPurchasePlan = {
  section: PartnerExternalSection
  itemId: string
  itemName: string
  quantity: number
  amountNgn: number
  requestPayload: Record<string, unknown>
  dispatch: (orderId: string) => Promise<PartnerProviderOutcome>
}

const sections = new Set(['sms', 'social_boost', 'bills_airtime', 'giftcards', 'telegram_stars'])
const reasons = new Set(['NO_STOCK', 'INSUFFICIENT_BALANCE', 'PRICE_CHANGED', 'INVALID_RECIPIENT'])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const statuses = new Set(['pending', 'processing', 'active', 'completed', 'failed', 'cancelled'])
const overrides = new Set(['gatewaymode', 'force', 'forcepurchase', 'skipbalance', 'skipbalancecheck', 'skipdebit', 'unlimitedcredit', 'fundingtype', 'checkoutorderid', 'existingcheckoutorder', 'paymentorderid'])
const privateField = /(?:apikey|authorization|password|secret|requestpayload|requestbody|headers|accesskey|accesstoken|privatekey|error)|(?:provider|vendor)(?:response|message|data|payload)|^raw|^(?:message|token|key|request|api)$/i
function keyName(key: string) { return key.replace(/[^a-z0-9]/gi, '').toLowerCase() }
function boundedText(value: unknown, max: number, required = false): string | null {
  if (value == null) { if (required) throw new Error('Invalid input'); return null }
  // eslint-disable-next-line no-control-regex -- Control bytes must not enter partner request identities.
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid input')
  const text = value.trim()
  if (!text && required) throw new Error('Invalid input')
  return text || null
}
function minorUnits(value: unknown): number | null {
  if (!['number', 'string'].includes(typeof value)) return null
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  if (whole.length > 10) return null
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return minor > 0n && minor <= 100000000000n ? Number(minor) : null
}
function canonical(value: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 12) throw new Error('Invalid input')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Invalid input')
  seen.add(value)
  let result: string
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new Error('Invalid input')
    result = `[${value.map(item => canonical(item, depth + 1, seen)).join(',')}]`
  } else {
    if (Object.prototype.toString.call(value) !== '[object Object]') throw new Error('Invalid input')
    const keys = Object.keys(value).sort()
    if (keys.length > 1000 || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Invalid input')
    result = `{${keys.map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1, seen)}`).join(',')}}`
  }
  seen.delete(value)
  return result
}
function publicPayload(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8) throw new Error('Invalid outcome')
  const clean: Record<string, unknown> = {}
  function safe(item: unknown, level: number): unknown {
    if (level > 8) throw new Error('Invalid outcome')
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'string') { if (item.length > 8192) throw new Error('Invalid outcome'); return item }
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (Array.isArray(item)) { if (item.length > 1000) throw new Error('Invalid outcome'); return item.map(entry => safe(entry, level + 1)) }
    return publicPayload(item, level + 1)
  }
  const entries = Object.entries(value)
  if (entries.length > 1000) throw new Error('Invalid outcome')
  for (const [key, item] of entries) {
    if (privateField.test(keyName(key)) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue
    clean[key] = safe(item, depth)
  }
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 16384) throw new Error('Invalid outcome')
  return clean
}
function normalizedOutcome(value: unknown, section: PartnerExternalSection): PartnerProviderOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'unknown' }
  const outcome = value as Record<string, unknown>
  if (outcome.kind === 'rejected' && typeof outcome.reason === 'string' && reasons.has(outcome.reason)
    && Object.keys(outcome).every(key => ['kind', 'reason'].includes(key))) return { kind: 'rejected', reason: outcome.reason as 'NO_STOCK' }
  if (outcome.kind !== 'accepted') return { kind: 'unknown' }
  if (Object.keys(outcome).some(key => !['kind', 'source', 'id', 'status', 'payload'].includes(key))) return { kind: 'unknown' }
  const allowed: Record<PartnerExternalSection, { source: string; statuses: string[] }> = {
    sms: { source: 'daisy', statuses: ['active', 'completed'] },
    social_boost: { source: 'smm', statuses: ['processing', 'completed'] },
    bills_airtime: { source: 'sagecloud', statuses: ['completed'] },
    giftcards: { source: 'bitrefill', statuses: ['processing', 'completed'] },
    telegram_stars: { source: 'istar', statuses: ['processing', 'completed'] },
  }
  try {
    const id = boundedText(outcome.id, 200, true)!
    if (outcome.source !== allowed[section].source || !allowed[section].statuses.includes(String(outcome.status))) return { kind: 'unknown' }
    return { kind: 'accepted', source: outcome.source as 'daisy', id, status: outcome.status as 'active', payload: publicPayload(outcome.payload) }
  } catch { return { kind: 'unknown' } }
}
function safeSummary(data: unknown, plan: PartnerPurchasePlan, orderId?: string, pending = false) {
  const stored = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  let payload: Record<string, unknown> = {}
  if (!pending) { try { payload = publicPayload(stored.response_payload ?? {}) } catch { /* Never forward malformed stored provider data. */ } }
  return {
    ...(typeof stored.id === 'string' && uuid.test(stored.id) ? { id: stored.id } : orderId ? { id: orderId } : {}),
    status: pending ? 'processing' : statuses.has(String(stored.status)) ? stored.status : 'processing',
    amount_ngn: plan.amountNgn, item_type: plan.section, item_id: plan.itemId,
    quantity: plan.quantity, response_payload: payload,
  }
}
function failure(code: string, data?: Record<string, unknown>) {
  const known = new Set(['INVALID_REQUEST', 'PRICE_CHANGED', 'INVALID_KEY', 'PARTNER_DISABLED', 'IDEMPOTENCY_CONFLICT', 'INSUFFICIENT_PARTNER_BALANCE', 'LEGACY_ORDER_REVIEW_REQUIRED', 'ORDER_NOT_FOUND', 'DISPATCH_AUTHORIZATION_STALE'])
  const safeCode = known.has(code) ? code : 'PARTNER_PURCHASE_UNAVAILABLE'
  return { body: { success: false, code: safeCode, ...(data ? { data } : {}) }, status: safeCode === 'INSUFFICIENT_PARTNER_BALANCE' ? 402 : ['INVALID_KEY', 'PARTNER_DISABLED'].includes(safeCode) ? 403 : safeCode === 'INVALID_REQUEST' ? 400 : safeCode === 'ORDER_NOT_FOUND' ? 404 : safeCode === 'PARTNER_PURCHASE_UNAVAILABLE' ? 503 : 409 }
}

export async function executePartnerExternalPurchase(
  admin: any, auth: { key: any; partner: any }, body: Record<string, unknown>, plan: PartnerPurchasePlan,
): Promise<{ body: Record<string, unknown>; status?: number }> {
  let args: Record<string, unknown>
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !sections.has(plan.section) || !uuid.test(auth?.key?.id ?? '') || typeof plan.dispatch !== 'function') return failure('INVALID_REQUEST')
    if (Object.keys(body).some(key => overrides.has(keyName(key)) || keyName(key).startsWith('force') || /skip.*(?:balance|debit|fund)/.test(keyName(key)))
      || String(body.payment_mode ?? '').trim().toLowerCase() === 'gateway') return failure('INVALID_REQUEST')
    if (!Number.isInteger(plan.quantity) || plan.quantity < 1 || plan.quantity > 1000000 || (['sms', 'bills_airtime'].includes(plan.section) && plan.quantity !== 1) || (plan.section === 'giftcards' && plan.quantity > 20)) return failure('INVALID_REQUEST')
    const amount = minorUnits(plan.amountNgn)
    const expected = minorUnits(body.expected_amount_ngn)
    if (amount === null || expected === null) return failure('INVALID_REQUEST')
    if (amount !== expected) return failure('PRICE_CHANGED')
    const itemId = boundedText(plan.itemId, 180, true)!
    const itemName = boundedText(plan.itemName, 180, true)!
    const idempotency = boundedText(body.idempotency_key, 160, true)!
    if (idempotency.length < 10) return failure('INVALID_REQUEST')
    const reference = boundedText(body.partner_reference ?? body.reference, 180)
    const email = boundedText(body.customer_email, 254)
    const phone = boundedText(body.customer_phone, 80)
    if (!plan.requestPayload || typeof plan.requestPayload !== 'object' || Array.isArray(plan.requestPayload)) return failure('INVALID_REQUEST')
    const request = canonical(plan.requestPayload)
    if (new TextEncoder().encode(request).length > 16384) return failure('INVALID_REQUEST')
    const input = canonical({ section: plan.section, itemId, quantity: plan.quantity, amountNgn: amount / 100,
      requestPayload: JSON.parse(request), expected_amount_ngn: expected / 100, partner_reference: reference, customer_email: email, customer_phone: phone })
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
    const fingerprint = [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')
    plan = { ...plan, itemId, itemName, amountNgn: amount / 100 }
    args = { p_key_id: auth.key.id, p_section: plan.section, p_item_type: plan.section,
      p_item_id: itemId, p_item_name: itemName, p_quantity: plan.quantity,
      p_amount_ngn: amount / 100, p_expected_amount_ngn: expected / 100,
      p_idempotency_key: idempotency, p_request_fingerprint: fingerprint,
      p_request_payload: JSON.parse(request), p_partner_reference: reference, p_customer_email: email, p_customer_phone: phone }
  } catch { return failure('INVALID_REQUEST') }
  let reserved: any
  try {
    const result = await admin.rpc('reserve_api_partner_external_order', args)
    if (result.error || !result.data) return failure('PARTNER_PURCHASE_UNAVAILABLE')
    reserved = result.data
    if (reserved.success !== true) return failure(String(reserved.code))
  } catch { return failure('PARTNER_PURCHASE_UNAVAILABLE') }
  const orderId = reserved.order_id
  if (typeof orderId !== 'string' || !uuid.test(orderId)) return failure('PARTNER_PURCHASE_UNAVAILABLE')
  const stored = () => ({ body: { success: true, idempotent_replay: reserved.idempotent_replay === true,
    data: safeSummary(reserved.data, plan, orderId) }, status: ['pending', 'processing'].includes(String(reserved.data?.status)) ? 202 : 200 })
  if (reserved.dispatch_state !== 'prepared') return stored()
  let claim: any
  try {
    const result = await admin.rpc('claim_api_partner_external_dispatch', { p_order_id: orderId, p_key_id: auth.key.id })
    if (result.error || !result.data) return failure('PARTNER_PURCHASE_UNAVAILABLE', safeSummary(null, plan, orderId, true))
    claim = result.data
  } catch { return failure('PARTNER_PURCHASE_UNAVAILABLE', safeSummary(null, plan, orderId, true)) }
  if (claim.success !== true || claim.send_allowed !== true || claim.order_id !== orderId || claim.dispatch_state !== 'sending') {
    // A competing claim may already have settled. Read its persisted result;
    // this reserve replay performs no paid dispatch and cannot refund funds.
    try {
      const refreshed = await admin.rpc('reserve_api_partner_external_order', args)
      if (!refreshed.error && refreshed.data?.success === true) reserved = refreshed.data
    } catch { /* Retain the original safe summary if the replay read fails. */ }
    if (claim.code === 'DISPATCH_AUTHORIZATION_STALE' || claim.code === 'ORDER_NOT_FOUND') return failure(String(claim.code), safeSummary(reserved.data, plan, orderId))
    return stored()
  }
  let outcome: PartnerProviderOutcome = { kind: 'unknown' }
  try { outcome = normalizedOutcome(await plan.dispatch(orderId), plan.section) } catch { /* A transport failure never proves non-delivery. */ }
  const outcomeArgs = {
    p_order_id: orderId, p_outcome: outcome.kind,
    p_fulfillment_source: outcome.kind === 'accepted' ? outcome.source : null,
    p_fulfillment_id: outcome.kind === 'accepted' ? outcome.id : null,
    p_public_payload: outcome.kind === 'accepted' ? outcome.payload : {},
    p_status: outcome.kind === 'accepted' ? outcome.status : outcome.kind === 'rejected' ? 'failed' : 'processing',
    p_reason_code: outcome.kind === 'rejected' ? outcome.reason : null,
  }
  try {
    const recorded = await admin.rpc('record_api_partner_external_outcome', outcomeArgs)
    if (!recorded.error && recorded.data?.success === true) {
      return { body: { success: outcome.kind !== 'rejected', idempotent_replay: false, data: safeSummary(recorded.data.data, plan, orderId),
        ...(outcome.kind === 'rejected' ? { code: outcome.reason } : outcome.kind === 'unknown' ? { code: 'PURCHASE_OUTCOME_UNKNOWN' } : {}) }, status: outcome.kind === 'unknown' ? 202 : outcome.kind === 'rejected' ? 409 : 200 }
    }
  } catch { /* Paid dispatch is never replayed or refunded after a save failure. */ }
  return { body: { success: false, code: 'PURCHASE_OUTCOME_UNKNOWN', data: safeSummary(null, plan, orderId, true) }, status: 202 }
}
