import { deliverPartnerWebhookSafely, type PinnedWebhookTransport } from './partner-webhook-delivery.ts'

type Admin = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: unknown }> }
export type DispatchResult = 'delivered' | 'rejected' | 'outcome_unknown' | 'skipped'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENTS = new Set(['partner.order.completed', 'partner.order.refunded'])
const CODES = new Set(['WEBHOOK_DELIVERED', 'WEBHOOK_NOT_AUTHORIZED', 'WEBHOOK_SECRET_MISSING',
  'PINNED_EGRESS_REQUIRED', 'WEBHOOK_DNS_UNSAFE', 'WEBHOOK_REDIRECT_REFUSED',
  'WEBHOOK_RESPONSE_TOO_LARGE', 'WEBHOOK_HTTP_FAILURE', 'WEBHOOK_TRANSPORT_UNAVAILABLE'])
async function deadline<T>(call: () => PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(call), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('webhook RPC deadline')), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

// The claim commits before any outbound POST. A failed claim/finish, including
// an ambiguous network response, never authorizes a second delivery attempt.
export async function dispatchPartnerWebhookEvent(admin: Admin, eventId: string,
  transport: PinnedWebhookTransport | null): Promise<DispatchResult> {
  if (!UUID.test(eventId) || !transport) return 'skipped'
  let claim: any
  try {
    const result = await deadline(() => admin.rpc('claim_api_partner_webhook_event', { p_event_id: eventId }), 5_000)
    if (result.error || !result.data) return 'skipped'
    claim = result.data
  } catch { return 'skipped' }
  if (claim.success !== true || claim.send_allowed !== true) return 'skipped'
  // A malformed service result is ambiguous after a successful claim. Preserve
  // the claim and record an unknown outcome without constructing a callback.
  const valid = claim.event_id === eventId && UUID.test(String(claim.claim_nonce || ''))
    && EVENTS.has(claim.event_type) && claim.partner && claim.order
    && Array.isArray(claim.key_scopes)
  let outcome: { state: 'delivered' | 'rejected' | 'outcome_unknown'; code: string; http_status?: number }
  if (!valid) outcome = { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' }
  else {
    try {
      outcome = await deliverPartnerWebhookSafely({ partner: claim.partner, order: claim.order,
        eventType: claim.event_type, keyScopes: claim.key_scopes, transport: transport || undefined })
    } catch { outcome = { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' } }
  }
  if (!CODES.has(outcome.code)) outcome = { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' }
  if (!valid) return 'outcome_unknown' // No trustworthy nonce can finish this claim.
  try {
    const finished = await deadline(() => admin.rpc('finish_api_partner_webhook_event', {
      p_event_id: eventId, p_claim_nonce: claim.claim_nonce,
      p_outcome: outcome.state, p_code: outcome.code, p_http_status: outcome.http_status ?? null,
    }), 5_000)
    if (finished.error || finished.data?.success !== true) return 'outcome_unknown'
  } catch { return 'outcome_unknown' }
  return outcome.state
}
