export function matchesNowPaymentsIdentity(transaction, paymentId, orderId) {
  const savedPaymentId = String(transaction?.nowpayments_payment_id ?? '').trim()
  const savedOrderId = String(transaction?.payment_reference ?? '').trim()
  return savedPaymentId !== '' && savedOrderId !== ''
    && savedPaymentId === String(paymentId ?? '').trim()
    && savedOrderId === String(orderId ?? '').trim()
}

const NON_FINAL_STATUSES = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid'])
const REVIEW_OR_TERMINAL_STATUSES = new Set([
  'completed_pending_review', 'completed_pending_release', 'completed',
  'blocked_review', 'verification_failed', 'failed', 'refunded', 'expired',
])

export function isNonFinalNowPaymentsStatus(status) {
  return NON_FINAL_STATUSES.has(String(status ?? '').trim().toLowerCase())
}

export function shouldIgnoreStaleNowPaymentsStatus(storedStatus, reportedStatus) {
  return REVIEW_OR_TERMINAL_STATUSES.has(String(storedStatus ?? '').trim().toLowerCase())
    && isNonFinalNowPaymentsStatus(reportedStatus)
}

export function validateTerminalNowPaymentsStatus(transaction, notification, providerPayment) {
  if (!matchesNowPaymentsIdentity(transaction, notification?.payment_id, notification?.order_id)) {
    return { ok: false, reason: 'saved_payment_identity_mismatch' }
  }
  if (String(providerPayment?.payment_id ?? '').trim() !== String(notification.payment_id).trim()
      || String(providerPayment?.order_id ?? '').trim() !== String(notification.order_id).trim()) {
    return { ok: false, reason: 'provider_payment_identity_mismatch' }
  }
  const reportedStatus = String(notification.payment_status ?? '').trim().toLowerCase()
  const providerStatus = String(providerPayment?.payment_status ?? '').trim().toLowerCase()
  if (!new Set(['failed', 'refunded', 'expired']).has(reportedStatus)
      || providerStatus !== reportedStatus) {
    return { ok: false, reason: 'provider_terminal_status_conflict' }
  }
  const expectedCurrency = String(transaction.outcome_currency || transaction.crypto_type || '').trim().toLowerCase()
  const providerCurrency = String(providerPayment?.pay_currency ?? '').trim().toLowerCase()
  if (expectedCurrency && providerCurrency && expectedCurrency !== providerCurrency) {
    return { ok: false, reason: 'provider_currency_mismatch' }
  }
  return { ok: true, reason: 'verified' }
}
