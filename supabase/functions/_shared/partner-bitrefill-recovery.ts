import { readBoundBitrefillDelivery } from './partner-bitrefill-delivery.ts'

const OWNER = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
type Result = { body: Record<string, unknown>; status: number }
type Client = { getInvoice: (id: string) => Promise<any>; getOrder: (id: string) => Promise<any> }
const denied = (code: string, status: number): Result => ({ body: { success: false, code }, status })
const DENIALS = new Set(['OWNER_DENIED', 'ORDER_NOT_FOUND', 'BINDING_MISMATCH',
  'EVIDENCE_CONFLICT', 'EVIDENCE_MISMATCH', 'RECEIPT_CONFLICT', 'DECISION_CONFLICT',
  'NOT_RECOVERABLE', 'INVALID_EVIDENCE', 'INVALID_DELIVERY'])

async function deadline<T>(call: () => PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(call), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('deadline')), milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

function validBody(body: Record<string, unknown>, action: string, keys: string[]): boolean {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && body.action === action && Object.keys(body).every(key => keys.includes(key))
    && typeof body.order_id === 'string' && UUID.test(body.order_id)
}

// GET supplier delivery details, then save private normalized evidence only.
// The response excludes provider credentials and the customer's redemptions.
export async function reviewPartnerBitrefillDelivery(admin: any, ownerId: string,
  body: Record<string, unknown>, client: Client): Promise<Result> {
  if (ownerId !== OWNER) return denied('PARTNER_OWNER_REQUIRED', 403)
  if (!validBody(body, 'admin_review_bitrefill_delivery', ['action', 'order_id'])) return denied('INVALID_REQUEST', 400)
  try {
    return await deadline(async () => {
      const bound: any = await deadline(() => admin.rpc('get_api_partner_bitrefill_bound_invoice', {
        p_order_id: body.order_id, p_owner_user_id: ownerId,
      }), 8_000)
      if (bound.error || bound.data?.success !== true) return denied('PARTNER_API_UNAVAILABLE', 503)
      if (bound.data.bound !== true) return denied('DELIVERY_NOT_VERIFIED', 409)
      if (bound.data.order_id !== body.order_id || typeof bound.data.invoice_id !== 'string'
        || !PROVIDER_ID.test(bound.data.invoice_id)) return denied('PARTNER_API_UNAVAILABLE', 503)
      const read: any = await deadline(() => admin.from('api_partner_orders')
        .select('id,partner_id,item_type,item_id,quantity,amount_ngn,request_payload,status')
        .eq('id', body.order_id).maybeSingle(), 8_000)
      const order = read.data
      if (read.error || !order || order.id !== body.order_id || order.item_type !== 'giftcards'
        || order.status !== 'processing' || typeof order.amount_ngn !== 'number' || !Number.isFinite(order.amount_ngn)
        || order.amount_ngn <= 0) return denied('NOT_RECOVERABLE', 409)
      const evidence = await readBoundBitrefillDelivery(client, bound.data.invoice_id, {
        itemId: order.item_id, quantity: order.quantity, unitValue: order.request_payload?.value,
        currency: order.request_payload?.provider_currency, packageId: order.request_payload?.package_id,
      })
      if (!evidence.completed) return denied('DELIVERY_NOT_VERIFIED', 409)
      const saved: any = await deadline(() => admin.rpc('record_api_partner_bitrefill_delivery_evidence', {
        p_order_id: order.id, p_owner_user_id: ownerId,
        p_invoice_id: bound.data.invoice_id, p_delivery: evidence.delivery,
      }), 8_000)
      const result = saved.data
      if (saved.error || result?.success !== true) return denied(DENIALS.has(result?.code)
        ? result.code : 'PARTNER_API_UNAVAILABLE', result?.code === 'OWNER_DENIED' ? 403 : 409)
      if (result.order_id !== order.id || typeof result.evidence_proof_hash !== 'string'
        || !HASH.test(result.evidence_proof_hash) || result.quantity !== order.quantity
        || result.amount_ngn !== order.amount_ngn || !['prepaid', 'unlimited_credit'].includes(result.funding_type)
        || typeof result.idempotent_replay !== 'boolean') return denied('PARTNER_API_UNAVAILABLE', 503)
      return { body: { success: true, order_id: result.order_id,
        evidence_proof_hash: result.evidence_proof_hash, quantity: result.quantity,
        amount_ngn: result.amount_ngn, funding_type: result.funding_type,
        idempotent_replay: result.idempotent_replay }, status: 200 }
    }, 25_000)
  } catch { return denied('DELIVERY_NOT_VERIFIED', 409) }
}

// Financial confirmation consumes only immutable server evidence, never an
// amount, status, invoice ID, redemption, or outcome supplied by the browser.
export async function confirmPartnerBitrefillDelivery(admin: any, ownerId: string,
  body: Record<string, unknown>): Promise<Result> {
  if (ownerId !== OWNER) return denied('PARTNER_OWNER_REQUIRED', 403)
  if (!validBody(body, 'admin_confirm_bitrefill_delivery', ['action', 'order_id', 'evidence_proof_hash'])
    || typeof body.evidence_proof_hash !== 'string' || !HASH.test(body.evidence_proof_hash)) return denied('INVALID_REQUEST', 400)
  try {
    const response: any = await deadline(() => admin.rpc('reconcile_api_partner_bitrefill_delivery', {
      p_order_id: body.order_id, p_owner_user_id: ownerId, p_evidence_proof_hash: body.evidence_proof_hash,
    }), 20_000)
    const result = response.data
    if (response.error || !result) return denied('RECOVERY_OUTCOME_UNKNOWN', 202)
    if (result.success !== true) return DENIALS.has(result.code)
      ? denied(result.code, result.code === 'OWNER_DENIED' ? 403 : 409)
      : denied('RECOVERY_OUTCOME_UNKNOWN', 202)
    if (result.order_id !== body.order_id || result.decision !== 'accepted'
      || typeof result.idempotent_replay !== 'boolean') return denied('RECOVERY_OUTCOME_UNKNOWN', 202)
    return { body: { success: true, order_id: result.order_id,
      decision: 'accepted', idempotent_replay: result.idempotent_replay }, status: 200 }
  } catch { return denied('RECOVERY_OUTCOME_UNKNOWN', 202) }
}
