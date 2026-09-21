class SupplierOrder {
  constructor({ id, kind, amount, quantity = 1 }) {
    this.id = id
    this.kind = kind
    this.amount = amount
    this.quantity = quantity
    this.status = 'submitted'
    this.refunded = 0
    this.refundKeys = new Set()
    this.dispatchAttempts = 1
    this.outcomeUnknown = false
    this.delivered = false
  }

  refund(key, amount) {
    if (this.refundKeys.has(key)) return { ok: true, code: 'REFUND_IDEMPOTENT_REPLAY', amount: 0 }
    const remaining = this.amount - this.refunded
    if (amount > remaining) return { ok: false, code: 'REFUND_EXCEEDS_ORDER_AMOUNT', amount: 0 }
    this.refundKeys.add(key)
    this.refunded += amount
    return { ok: true, code: 'REFUND_POSTED', amount }
  }
}

function providerSubmissionDecision(order, outcome) {
  if (outcome === 'response_lost') {
    order.status = 'outcome_unknown'
    order.outcomeUnknown = true
    return {
      status: order.status,
      retrySupplier: false,
      refundWallet: false,
      releaseValue: false,
      dispatchAttempts: order.dispatchAttempts,
    }
  }

  if (outcome === 'provider_declined') {
    const refund = order.refund(`${order.kind}:refund:${order.id}:provider_declined`, order.amount)
    order.status = refund.ok ? 'failed_refunded' : 'refund_review'
    return { status: order.status, refund }
  }

  throw new Error(`Unhandled provider submission outcome ${outcome}`)
}

function lateProviderStatus(order, status) {
  if (status === 'success') {
    order.status = 'fulfilled'
    order.outcomeUnknown = false
    order.delivered = true
    return { status: order.status, refundWallet: false, retrySupplier: false, releaseValue: true }
  }

  if (status === 'failed') {
    const refund = order.refund(`${order.kind}:refund:${order.id}:late_failed`, order.amount)
    order.status = refund.ok ? 'failed_refunded' : 'refund_review'
    order.outcomeUnknown = false
    return { status: order.status, refund, retrySupplier: false, releaseValue: false }
  }

  throw new Error(`Unhandled late provider status ${status}`)
}

function smmStatusDecision(order, { status, remains = 0, panelCharge = 0 }) {
  if (status === 'completed') {
    order.status = 'fulfilled'
    order.delivered = true
    return { status: order.status, refund: null }
  }

  if (status === 'cancelled' && panelCharge === 0) {
    const refund = order.refund(`smm:refund:${order.id}:cancelled`, order.amount)
    order.status = 'failed_refunded'
    return { status: order.status, refund }
  }

  if (status === 'partial') {
    const ratio = order.quantity > 0 ? remains / order.quantity : 0
    const refundAmount = Math.floor(order.amount * Math.max(0, Math.min(1, ratio)))
    const refund = order.refund(`smm:refund:${order.id}:partial`, refundAmount)
    order.status = 'partial_refunded'
    return { status: order.status, refund }
  }

  return { status: 'unchanged', refund: null }
}

function daisyStatusDecision(order, status) {
  if (status === 'STATUS_OK') {
    order.status = 'fulfilled'
    order.delivered = true
    return { status: order.status, refund: null, revealCode: true }
  }

  if (status === 'NO_ACTIVATION' || status === 'STATUS_CANCEL') {
    const refund = order.refund(`sms:refund:${order.id}:${status}`, order.amount)
    order.status = 'failed_refunded'
    return { status: order.status, refund, revealCode: false }
  }

  return { status: 'waiting', refund: null, revealCode: false }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function lostResponseDoesNotRetryOrRefund() {
  const order = new SupplierOrder({ id: 'bitrefill-1', kind: 'bitrefill', amount: 5000 })
  const decision = providerSubmissionDecision(order, 'response_lost')
  assert(decision.status === 'outcome_unknown', 'lost response did not enter outcome_unknown')
  assert(decision.retrySupplier === false, 'lost response retried supplier blindly')
  assert(decision.refundWallet === false, 'lost response refunded blindly')
  assert(decision.dispatchAttempts === 1, 'lost response created another dispatch attempt')
}

function lateSuccessAfterUnknownDoesNotDuplicateDispatch() {
  const order = new SupplierOrder({ id: 'istar-1', kind: 'istar', amount: 1500 })
  providerSubmissionDecision(order, 'response_lost')
  const decision = lateProviderStatus(order, 'success')
  assert(decision.status === 'fulfilled', 'late success did not fulfill unknown order')
  assert(decision.refundWallet === false, 'late success refunded wallet')
  assert(order.dispatchAttempts === 1, 'late success caused duplicate supplier dispatch')
  assert(order.delivered, 'late success did not release delivered value')
}

function definitiveFailureRefundsOnce() {
  const order = new SupplierOrder({ id: 'bitrefill-2', kind: 'bitrefill', amount: 7500 })
  const first = providerSubmissionDecision(order, 'provider_declined')
  const duplicate = providerSubmissionDecision(order, 'provider_declined')
  assert(first.refund.code === 'REFUND_POSTED', 'definitive failure did not refund')
  assert(duplicate.refund.code === 'REFUND_IDEMPOTENT_REPLAY', 'duplicate definitive failure double-refunded')
  assert(order.refunded === 7500, 'definitive failure refunded wrong amount')
}

function smmPartialRefundIsCappedAndIdempotent() {
  const order = new SupplierOrder({ id: 'smm-1', kind: 'smm', amount: 10_000, quantity: 1000 })
  const partial = smmStatusDecision(order, { status: 'partial', remains: 250 })
  const duplicate = smmStatusDecision(order, { status: 'partial', remains: 250 })
  const excessive = order.refund('smm:refund:smm-1:manual-excess', 10_000)
  assert(partial.refund.code === 'REFUND_POSTED', 'SMM partial status did not post refund')
  assert(partial.refund.amount === 2500, 'SMM partial refund amount was not based on undelivered ratio')
  assert(duplicate.refund.code === 'REFUND_IDEMPOTENT_REPLAY', 'SMM duplicate partial status double-refunded')
  assert(!excessive.ok && excessive.code === 'REFUND_EXCEEDS_ORDER_AMOUNT', 'SMM over-refund was not capped')
}

function daisyTerminalCallbacksRefundOnceAndHideCode() {
  const order = new SupplierOrder({ id: 'sms-1', kind: 'sms', amount: 1200 })
  const first = daisyStatusDecision(order, 'NO_ACTIVATION')
  const duplicate = daisyStatusDecision(order, 'NO_ACTIVATION')
  assert(first.refund.code === 'REFUND_POSTED', 'Daisy terminal failure did not refund')
  assert(duplicate.refund.code === 'REFUND_IDEMPOTENT_REPLAY', 'Daisy duplicate terminal callback double-refunded')
  assert(first.revealCode === false, 'Daisy failure revealed an OTP code')
  assert(order.refunded === 1200, 'Daisy terminal failure refunded wrong amount')
}

function daisyLateCodeAfterFailureDoesNotRefundAgain() {
  const order = new SupplierOrder({ id: 'sms-2', kind: 'sms', amount: 1200 })
  daisyStatusDecision(order, 'STATUS_CANCEL')
  const lateCode = daisyStatusDecision(order, 'STATUS_OK')
  assert(lateCode.revealCode === true, 'Daisy late success did not reveal code')
  assert(order.refunded === 1200, 'Daisy late success changed refund total')
  assert(order.delivered, 'Daisy late success was not recorded as delivered')
}

lostResponseDoesNotRetryOrRefund()
lateSuccessAfterUnknownDoesNotDuplicateDispatch()
definitiveFailureRefundsOnce()
smmPartialRefundIsCappedAndIdempotent()
daisyTerminalCallbacksRefundOnceAndHideCode()
daisyLateCodeAfterFailureDoesNotRefundAgain()

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'lost supplier response becomes outcome_unknown without blind retry/refund/release',
    'late success after unknown outcome fulfills without duplicate dispatch',
    'definitive provider failure refunds once with idempotent duplicate handling',
    'SMM partial refund is ratio-based, capped, and idempotent',
    'Daisy terminal failure callbacks refund once and do not reveal code',
    'late Daisy success after terminal failure does not create a second refund',
  ],
}, null, 2))
