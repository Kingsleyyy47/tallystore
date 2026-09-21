function authorizePurchase({ walletState, orderAmount, availableFunds }) {
  if (walletState !== 'active') return { ok: false, code: 'WALLET_NOT_ACTIVE' }
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return { ok: false, code: 'INVALID_ORDER_AMOUNT' }
  if (!Number.isFinite(availableFunds)) return { ok: false, code: 'FINANCIAL_STATE_UNAVAILABLE' }
  if (availableFunds < orderAmount) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
  return {
    ok: true,
    code: 'AUTHORIZED',
    authorization: {
      amount: orderAmount,
      financialSecurityVersion: 1,
      consumed: false,
    },
  }
}

function dispatchDecision({ walletState, order, globalFulfillmentPaused = false, currentFinancialSecurityVersion = 1 }) {
  if (globalFulfillmentPaused) return { sendSupplier: false, revealSecret: false, code: 'FULFILLMENT_PAUSED' }
  if (walletState !== 'active') return { sendSupplier: false, revealSecret: false, code: 'WALLET_NOT_ACTIVE' }
  if (!order.authorization || order.authorization.consumed) {
    return { sendSupplier: false, revealSecret: false, code: 'ORDER_AUTHORIZATION_INVALID' }
  }
  if (order.authorization.financialSecurityVersion !== currentFinancialSecurityVersion) {
    return { sendSupplier: false, revealSecret: false, code: 'ORDER_AUTHORIZATION_STALE' }
  }
  if (order.authorization.amount !== order.amount) {
    return { sendSupplier: false, revealSecret: false, code: 'ORDER_AUTHORIZATION_AMOUNT_MISMATCH' }
  }
  if (!['funds_held', 'authorized'].includes(order.status)) {
    return { sendSupplier: false, revealSecret: false, code: 'ORDER_STATE_NOT_DISPATCHABLE' }
  }
  return { sendSupplier: true, revealSecret: false, code: 'DISPATCH_ALLOWED' }
}

function supplierOutcomeDecision({ order, supplierOutcome }) {
  if (supplierOutcome === 'success') {
    return { captureFunds: true, releaseHold: false, refundWallet: false, status: 'fulfilled' }
  }
  if (supplierOutcome === 'definitive_failure_before_capture') {
    return { captureFunds: false, releaseHold: true, refundWallet: false, status: 'failed_released' }
  }
  if (supplierOutcome === 'unknown_timeout') {
    return { captureFunds: false, releaseHold: false, refundWallet: false, retrySupplier: false, status: 'outcome_unknown' }
  }
  if (supplierOutcome === 'failure_after_capture') {
    return { captureFunds: false, releaseHold: false, refundWallet: true, status: 'refund_pending' }
  }
  throw new Error(`Unexpected supplier outcome ${supplierOutcome} for ${order.id}`)
}

function credentialRevealDecision(order) {
  const completed = order.status === 'completed'
  const hasCredentials = Array.isArray(order.credentials) && order.credentials.length > 0
  return {
    reveal: completed && hasCredentials,
    code: completed && hasCredentials ? 'CREDENTIALS_VISIBLE' : 'CREDENTIALS_HIDDEN_UNTIL_COMPLETED',
  }
}

function deniedDispatchWithNotification({ dispatch, notificationAvailable }) {
  if (dispatch.sendSupplier || dispatch.revealSecret) {
    return { ...dispatch, notificationStatus: 'not_applicable' }
  }
  return {
    ...dispatch,
    notificationStatus: notificationAvailable ? 'notification_recorded' : 'notification_failed',
    code: notificationAvailable ? dispatch.code : `${dispatch.code}_NOTIFICATION_FAILED_NO_DELIVERY`,
  }
}

function localStockCredentialFlow({ authorized, reservationAvailable, orderInsertSucceeds }) {
  const state = {
    walletDebited: false,
    refundPosted: false,
    reserveAttempted: false,
    credentialsCreated: false,
    soldMarked: false,
  }

  if (!authorized?.ok) return { ...state, code: 'AUTHORIZATION_DENIED' }
  state.walletDebited = true
  state.reserveAttempted = true

  if (!reservationAvailable) {
    state.refundPosted = true
    return { ...state, code: 'RESERVATION_FAILED_REFUNDED' }
  }

  if (!orderInsertSucceeds) {
    state.refundPosted = true
    return { ...state, code: 'ORDER_INSERT_FAILED_REFUNDED' }
  }

  state.credentialsCreated = true
  state.soldMarked = true
  return { ...state, code: 'COMPLETED' }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const noFunds = authorizePurchase({ walletState: 'active', orderAmount: 5000, availableFunds: 2000 })
assert(!noFunds.ok && noFunds.code === 'INSUFFICIENT_FUNDS', 'insufficient funds should decline before authorization')

const unavailableFunds = authorizePurchase({ walletState: 'active', orderAmount: 5000, availableFunds: Number.NaN })
assert(!unavailableFunds.ok && unavailableFunds.code === 'FINANCIAL_STATE_UNAVAILABLE', 'unavailable financial state should decline before authorization')

const frozenAuth = authorizePurchase({ walletState: 'frozen', orderAmount: 1000, availableFunds: 10000 })
assert(!frozenAuth.ok && frozenAuth.code === 'WALLET_NOT_ACTIVE', 'frozen wallet should not authorize purchase')

const authorized = authorizePurchase({ walletState: 'active', orderAmount: 4000, availableFunds: 10000 })
assert(authorized.ok, 'valid purchase did not authorize')

const order = {
  id: 'order-1',
  status: 'funds_held',
  amount: 4000,
  authorization: authorized.authorization,
}

assert(dispatchDecision({ walletState: 'active', order }).code === 'DISPATCH_ALLOWED', 'authorized order did not dispatch')
assert(dispatchDecision({ walletState: 'frozen', order }).code === 'WALLET_NOT_ACTIVE', 'frozen wallet dispatched unused authorization')
assert(dispatchDecision({ walletState: 'active', order, globalFulfillmentPaused: true }).code === 'FULFILLMENT_PAUSED', 'global pause did not block dispatch')
assert(dispatchDecision({ walletState: 'active', order: { ...order, authorization: null } }).code === 'ORDER_AUTHORIZATION_INVALID', 'missing authorization dispatched')
assert(dispatchDecision({ walletState: 'active', order: { ...order, authorization: { ...authorized.authorization, amount: 3999 } } }).code === 'ORDER_AUTHORIZATION_AMOUNT_MISMATCH', 'wrong authorization amount dispatched')
assert(dispatchDecision({ walletState: 'active', order, currentFinancialSecurityVersion: 2 }).code === 'ORDER_AUTHORIZATION_STALE', 'stale pre-review authorization dispatched after security version changed')
assert(dispatchDecision({ walletState: 'active', order: { ...order, status: 'outcome_unknown' } }).code === 'ORDER_STATE_NOT_DISPATCHABLE', 'unknown-outcome order redispatched')

const deniedWithNotificationFailure = deniedDispatchWithNotification({
  dispatch: dispatchDecision({ walletState: 'active', order: { ...order, authorization: null } }),
  notificationAvailable: false,
})
assert(
  !deniedWithNotificationFailure.sendSupplier &&
    !deniedWithNotificationFailure.revealSecret &&
    deniedWithNotificationFailure.code === 'ORDER_AUTHORIZATION_INVALID_NOTIFICATION_FAILED_NO_DELIVERY',
  'notification/logging failure converted denied dispatch into value release',
)

const unknown = supplierOutcomeDecision({ order, supplierOutcome: 'unknown_timeout' })
assert(!unknown.releaseHold && !unknown.refundWallet && !unknown.retrySupplier && unknown.status === 'outcome_unknown', 'unknown supplier outcome should not retry/refund/release blindly')

const preCaptureFailure = supplierOutcomeDecision({ order, supplierOutcome: 'definitive_failure_before_capture' })
assert(preCaptureFailure.releaseHold && !preCaptureFailure.refundWallet, 'pre-capture failure should release hold without refund credit')

const postCaptureFailure = supplierOutcomeDecision({ order, supplierOutcome: 'failure_after_capture' })
assert(postCaptureFailure.refundWallet && !postCaptureFailure.releaseHold, 'post-capture failure should refund without also releasing hold')

const stockRace = localStockCredentialFlow({
  authorized,
  reservationAvailable: false,
  orderInsertSucceeds: true,
})
assert(stockRace.walletDebited && stockRace.reserveAttempted, 'stock-race model did not debit before reservation attempt')
assert(stockRace.refundPosted && stockRace.code === 'RESERVATION_FAILED_REFUNDED', 'stock-race model did not refund after reservation failure')
assert(!stockRace.credentialsCreated && !stockRace.soldMarked, 'stock-race model released value after reservation failure')

assert(!credentialRevealDecision({ status: 'processing', credentials: [{ username: 'u', password: 'p' }] }).reveal, 'processing order revealed credentials')
assert(!credentialRevealDecision({ status: 'completed', credentials: [] }).reveal, 'empty credentials were visible')
assert(credentialRevealDecision({ status: 'completed', credentials: [{ username: 'u', password: 'p' }] }).reveal, 'completed credential order did not reveal')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'insufficient funds decline before authorization',
    'unavailable financial state declines before authorization',
    'frozen wallet cannot authorize or dispatch unused authorization',
    'global fulfillment pause blocks dispatch',
    'missing, consumed, wrong-amount, or wrong-state authorization blocks dispatch',
    'stale authorization cannot dispatch after security version changes',
    'unknown supplier outcome does not retry, refund, or release blindly',
    'pre-capture failure releases hold without refund credit',
    'post-capture failure refunds without double release',
    'local stock reservation failure after debit refunds without credential reveal or sold marking',
    'notification failure cannot convert denial into delivery',
    'credentials reveal only for completed orders with credentials',
  ],
}, null, 2))
