// Read-only recovery for a lost process-purchase response. The caller supplies
// an authenticated customer ID and a service-role client; this helper never
// creates, resumes, captures, releases, or dispatches a purchase.
export type CustomerPurchaseState = 'unknown' | 'pending' | 'completed' | 'released' | 'review_required'
export type CustomerPurchaseStatus = {
  state: CustomerPurchaseState
  order_id?: string
  quantity?: number
  amount_ngn?: number
}

type Admin = { from: (table: string) => any }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const terminalOrder = new Set(['cancelled', 'canceled', 'failed'])
const unresolvedAttempt = new Set(['prepared', 'sending', 'succeeded', 'unknown'])

function moneyMinor(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null
  const negative = text.startsWith('-')
  const [whole, fractional = ''] = (negative ? text.slice(1) : text).split('.')
  if (whole.length > 10) return null
  const minor = Number(BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0')))
  return Number.isSafeInteger(minor) ? minor * (negative ? -1 : 1) : null
}

function base(order: any): CustomerPurchaseStatus {
  const result: CustomerPurchaseStatus = { state: 'review_required' }
  if (typeof order?.id === 'string' && UUID.test(order.id)) result.order_id = order.id
  const quantity = Number(order?.account_details?.quantity)
  if (Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 500) result.quantity = quantity
  const amount = moneyMinor(order?.amount)
  if (amount !== null && amount > 0) result.amount_ngn = amount / 100
  return result
}

export async function getCustomerPurchaseStatus(
  admin: Admin, userId: string, idempotencyKey: unknown, productId: unknown, orderId?: unknown,
): Promise<CustomerPurchaseStatus> {
  if (!UUID.test(userId) || typeof idempotencyKey !== 'string'
    || idempotencyKey.length < 10 || idempotencyKey.length > 200
    || /[\u0000-\u001f\u007f]/.test(idempotencyKey)
    || typeof productId !== 'string' || !UUID.test(productId)
    || (orderId != null && (typeof orderId !== 'string' || !UUID.test(orderId)))) return { state: 'unknown' }

  try {
    // Query by the original request identity. An order_id from browser storage
    // is only a consistency hint, never an authorization key.
    const { data: order, error: orderError } = await admin.from('orders')
      .select('id,user_id,product_group_id,idempotency_key,amount,status,account_details,wallet_reservation_id,financial_authorization_status')
      .eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle()
    if (orderError) return { state: 'review_required' }
    if (!order) {
      // Absence is never proof of a failed purchase: an in-flight RPC may
      // commit after this read. Orphaned ledger/reservation evidence elevates
      // the case to review, but even a clean read remains unknown.
      const [transaction, reservation] = await Promise.all([
        admin.from('transactions').select('id').eq('user_id', userId)
          .eq('idempotency_key', `purchase:${idempotencyKey}`).maybeSingle(),
        admin.from('wallet_reservations').select('id').eq('user_id', userId)
          .eq('idempotency_key', `product:reservation:${idempotencyKey}`).maybeSingle(),
      ])
      if (transaction.error || reservation.error || transaction.data || reservation.data) return { state: 'review_required' }
      return { state: 'unknown' }
    }
    const result = base(order)
    if (order.user_id !== userId || order.idempotency_key !== idempotencyKey
      || order.product_group_id !== productId || (orderId && order.id !== orderId)) return { state: 'review_required' }
    if (!result.order_id || !result.quantity || result.amount_ngn === undefined
      || typeof order.wallet_reservation_id !== 'string' || !UUID.test(order.wallet_reservation_id)) return result

    const [reservationResult, ledgerResult, attemptsResult] = await Promise.all([
      admin.from('wallet_reservations')
        .select('id,user_id,order_table,order_id,idempotency_key,amount,currency,status,metadata,captured_at,released_at')
        .eq('id', order.wallet_reservation_id).eq('user_id', userId).maybeSingle(),
      admin.from('transactions')
        .select('id,user_id,type,amount,status,balance_type,idempotency_key,metadata')
        .eq('user_id', userId).eq('idempotency_key', `purchase:${idempotencyKey}`).maybeSingle(),
      admin.from('supplier_purchase_attempts').select('status,order_id,reservation_id')
        .eq('order_id', order.id),
    ])
    if (reservationResult.error || ledgerResult.error || attemptsResult.error) return result
    const reservation = reservationResult.data
    const ledger = ledgerResult.data
    const attempts = attemptsResult.data
    if (!reservation || !Array.isArray(attempts)
      || reservation.id !== order.wallet_reservation_id
      || reservation.user_id !== userId || reservation.order_table !== 'orders'
      || reservation.order_id !== order.id
      || reservation.idempotency_key !== `product:reservation:${idempotencyKey}`
      || reservation.currency !== 'NGN'
      || moneyMinor(reservation.amount) !== moneyMinor(order.amount)
      || attempts.some((attempt: any) => attempt.order_id !== order.id
        || attempt.reservation_id !== reservation.id)) return result

    const hasCapturedLedger = ledger !== null && ledger !== undefined
    const exactLedger = hasCapturedLedger
      && ledger.id && UUID.test(ledger.id)
      && ledger.user_id === userId && ledger.type === 'purchase'
      && ledger.status === 'completed' && (ledger.balance_type ?? 'wallet') === 'wallet'
      && ledger.idempotency_key === `purchase:${idempotencyKey}`
      && moneyMinor(ledger.amount) === -moneyMinor(order.amount)!
      && ledger.metadata?.source_order_table === 'orders'
      && ledger.metadata?.source_order_id === order.id
      && ledger.metadata?.source_order_idempotency_key === idempotencyKey
      && ledger.metadata?.wallet_reservation_id === reservation.id
      && ledger.metadata?.reservation_idempotency_key === reservation.idempotency_key
    const orderStatus = String(order.status || '').toLowerCase()
    const authorization = String(order.financial_authorization_status || '').toLowerCase()
    if (orderStatus === 'completed' && authorization === 'captured'
      && reservation.status === 'captured' && reservation.captured_at
      && reservation.metadata?.capture_idempotency_key === `purchase:${idempotencyKey}`
      && reservation.metadata?.capture_transaction_id === ledger?.id
      && exactLedger
      && !attempts.some((attempt: any) => ['prepared', 'sending', 'unknown'].includes(attempt.status))) {
      return { ...result, state: 'completed' }
    }
    if (terminalOrder.has(orderStatus) && authorization === 'released'
      && reservation.status === 'released' && reservation.released_at
      && !hasCapturedLedger
      && !attempts.some((attempt: any) => unresolvedAttempt.has(attempt.status))
      && attempts.every((attempt: any) => attempt.status === 'rejected')) {
      return { ...result, state: 'released' }
    }
    if (orderStatus === 'processing' && ['funds_held', 'outcome_unknown'].includes(authorization)
      && ['active', 'review_required'].includes(reservation.status) && !hasCapturedLedger) {
      return { ...result, state: 'pending' }
    }
    return result
  } catch {
    return { state: 'review_required' }
  }
}
