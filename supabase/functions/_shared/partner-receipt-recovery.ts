// Financial recovery uses only an immutable service receipt and the original
// reservation. No provider operation or caller-supplied outcome/amount is used.
const OWNER = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const ALLOWED = new Set(['action', 'order_id', 'receipt_proof_hash'])
const DENIALS = new Set(['OWNER_DENIED', 'ORDER_NOT_FOUND', 'BINDING_MISMATCH',
  'UNKNOWN_REQUIRES_REVIEW', 'DECISION_CONFLICT', 'NOT_RECOVERABLE'])
type Result = { body: Record<string, unknown>; status: number }
const failed = (code: string, status: number): Result => ({ body: { success: false, code }, status })

export async function reconcilePartnerDispatchReceipt(admin: any, ownerId: string,
  body: Record<string, unknown>): Promise<Result> {
  if (ownerId !== OWNER) return failed('PARTNER_OWNER_REQUIRED', 403)
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'admin_reconcile_dispatch_receipt'
    || Object.keys(body).some(key => !ALLOWED.has(key))
    || typeof body.order_id !== 'string' || !UUID.test(body.order_id)
    || typeof body.receipt_proof_hash !== 'string' || !HASH.test(body.receipt_proof_hash)) return failed('INVALID_REQUEST', 400)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result: any = await Promise.race([
      Promise.resolve().then(() => admin.rpc('reconcile_api_partner_dispatch_receipt', {
        p_order_id: body.order_id, p_owner_user_id: ownerId, p_receipt_proof_hash: body.receipt_proof_hash,
      })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('recovery timeout')), 20_000) }),
    ])
    // A database transport failure may occur after commit. Do not claim that
    // nothing changed, release a hold, or automatically attempt the action again.
    if (result.error || !result.data) return failed('RECOVERY_OUTCOME_UNKNOWN', 202)
    const data = result.data
    if (data.success !== true) return DENIALS.has(data.code)
      ? failed(data.code, data.code === 'OWNER_DENIED' ? 403 : 409)
      : failed('RECOVERY_OUTCOME_UNKNOWN', 202)
    if (data.order_id !== body.order_id || !['accepted', 'rejected'].includes(data.decision)
      || typeof data.idempotent_replay !== 'boolean') return failed('RECOVERY_OUTCOME_UNKNOWN', 202)
    return { body: { success: true, order_id: data.order_id,
      decision: data.decision, idempotent_replay: data.idempotent_replay }, status: 200 }
  } catch { return failed('RECOVERY_OUTCOME_UNKNOWN', 202) }
  finally { if (timer) clearTimeout(timer) }
}
