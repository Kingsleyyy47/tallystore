import { createHmac, timingSafeEqual } from 'node:crypto'

class CreditLedger {
  constructor() {
    this.byIdempotency = new Map()
    this.byExternalPayment = new Map()
  }

  credit({ userId, amount, idempotencyKey, externalPaymentId }) {
    const fingerprint = JSON.stringify({ userId, amount, externalPaymentId })
    const existing = this.byIdempotency.get(idempotencyKey)
    if (existing) {
      if (existing !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' }
      return { ok: true, code: 'IDEMPOTENT_REPLAY', credited: false }
    }

    const externalOwner = this.byExternalPayment.get(externalPaymentId)
    if (externalOwner && externalOwner !== userId) {
      return { ok: false, code: 'EXTERNAL_PAYMENT_ID_CONFLICT' }
    }

    this.byIdempotency.set(idempotencyKey, fingerprint)
    this.byExternalPayment.set(externalPaymentId, userId)
    return { ok: true, code: 'CREDITED', credited: true }
  }
}

function ercasDecision({ pendingPayment, providerResult, requesterUserId, ledger, expectedMerchant, expectedEnvironment }) {
  if (!pendingPayment) return { credit: false, code: 'PENDING_PAYMENT_NOT_FOUND', punishNamedCustomer: false }
  if (pendingPayment.user_id !== requesterUserId) return { credit: false, code: 'PENDING_PAYMENT_USER_MISMATCH', punishNamedCustomer: false }
  if (pendingPayment.status !== 'pending') return { credit: false, code: 'PENDING_PAYMENT_CLOSED', punishNamedCustomer: false }
  if (!providerResult) return { credit: false, code: 'PROVIDER_UNAVAILABLE_RETRY', pendingStaysPending: true }

  const body = providerResult.responseBody || {}
  if (body.status === 'PENDING' || providerResult.responseCode === 'pending') {
    return { credit: false, code: 'PROVIDER_PENDING', pendingStaysPending: true }
  }
  if (!providerResult.requestSuccessful && body.status !== 'SUCCESSFUL') {
    return { credit: false, code: 'PROVIDER_FAILED', closesPendingPayment: true }
  }
  if (body.status !== 'SUCCESSFUL') return { credit: false, code: 'PROVIDER_NOT_SUCCESSFUL', closesPendingPayment: true }

  const expectedAmount = Number(pendingPayment.amount)
  const verifiedAmount = Number(body.amount)
  if (!Number.isFinite(expectedAmount) || !Number.isFinite(verifiedAmount) || Math.abs(expectedAmount - verifiedAmount) > 0.01) {
    return { credit: false, code: 'AMOUNT_MISMATCH', closesPendingPayment: true }
  }
  if (body.currency && String(body.currency).trim().toUpperCase() !== 'NGN') {
    return { credit: false, code: 'CURRENCY_MISMATCH', closesPendingPayment: true }
  }
  if (expectedMerchant && body.merchant_id && String(body.merchant_id).trim().toLowerCase() !== String(expectedMerchant).trim().toLowerCase()) {
    return { credit: false, code: 'MERCHANT_MISMATCH', closesPendingPayment: true }
  }
  if (expectedEnvironment && body.environment && String(body.environment).trim().toLowerCase() !== String(expectedEnvironment).trim().toLowerCase()) {
    return { credit: false, code: 'ENVIRONMENT_MISMATCH', closesPendingPayment: true }
  }

  const externalPaymentId = body.ercs_reference || pendingPayment.transaction_reference
  const posted = ledger.credit({
    userId: pendingPayment.user_id,
    amount: verifiedAmount,
    idempotencyKey: `ercas:${pendingPayment.transaction_reference}`,
    externalPaymentId,
  })
  return { credit: posted.credited === true, code: posted.code }
}

class PendingRecoveryQueue {
  constructor(rows) {
    this.rows = new Map(rows.map((row) => [row.id, { ...row }]))
  }

  claim(rowSnapshot) {
    const row = this.rows.get(rowSnapshot.id)
    if (!row || row.status !== 'pending') return { claimed: false, code: 'RECOVERY_ROW_CLOSED' }
    if ((row.check_count ?? null) !== (rowSnapshot.check_count ?? null)) {
      return { claimed: false, code: 'RECOVERY_ALREADY_CLAIMED' }
    }

    row.check_count = Number(row.check_count || 0) + 1
    row.last_check_at = new Date('2026-09-19T00:00:00.000Z').toISOString()
    this.rows.set(row.id, row)
    return { claimed: true, code: 'RECOVERY_CLAIMED', row: { ...row } }
  }
}

function sign(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function signNowPayments(secret, payload) {
  const sortedPayload = {}
  for (const key of Object.keys(payload).sort()) {
    sortedPayload[key] = payload[key]
  }
  return createHmac('sha512', secret).update(JSON.stringify(sortedPayload)).digest('hex')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

function verifyPocketFiHeaders({ secret, body, headers }) {
  const directSecret = headers.authorization?.replace(/^Bearer\s+/i, '') ||
    headers['x-pocketfi-webhook-secret'] ||
    headers['x-webhook-secret']
  if (directSecret && safeEqual(directSecret, secret)) return true

  const signature = headers['pocketfi-signature'] ||
    headers['http_pocketfi_signature'] ||
    headers['x-pocketfi-signature'] ||
    headers['x-webhook-signature']
  if (!signature) return false
  return safeEqual(signature, sign(secret, body))
}

function pocketFiDecision({ secret, body, headers, accountOwner, partnerCustomer, partnerApiPaused, existingCredit, ledger }) {
  if (!verifyPocketFiHeaders({ secret, body, headers })) {
    return { credit: false, code: 'INVALID_WEBHOOK_VERIFICATION', punishNamedCustomer: false }
  }

  const payload = JSON.parse(body)
  const accountNumber = payload.account_number || payload.data?.account_number
  const amount = Number(payload.order?.amount ?? payload.order?.settlement_amount ?? payload.amount ?? payload.data?.amount)
  const reference = payload.transaction?.reference || payload.reference || payload.transaction_reference
  if (!accountNumber || !Number.isFinite(amount) || amount <= 0 || !reference) {
    return { credit: false, code: 'MANUAL_REVIEW_REQUIRED' }
  }

  if (partnerCustomer) {
    return partnerApiPaused
      ? { credit: false, code: 'PARTNER_API_PAUSED_MANUAL_REVIEW' }
      : { credit: false, code: 'PARTNER_CHECKOUT_HANDOFF' }
  }

  if (!accountOwner) return { credit: false, code: 'UNKNOWN_ACCOUNT_MANUAL_REVIEW' }
  if (existingCredit) {
    if (existingCredit.userId !== accountOwner.userId || Math.round(existingCredit.amount * 100) !== Math.round(amount * 100)) {
      return { credit: false, code: 'POCKETFI_REFERENCE_CONFLICT' }
    }
    return { credit: false, code: 'IDEMPOTENT_REPLAY' }
  }

  const posted = ledger.credit({
    userId: accountOwner.userId,
    amount,
    idempotencyKey: `pocketfi:${reference}`,
    externalPaymentId: reference,
  })
  return { credit: posted.credited === true, code: posted.code }
}

function verifyNowPaymentsSignature({ secret, payload, signature }) {
  if (!secret || !signature) return false
  return safeEqual(signature, signNowPayments(secret, payload))
}

function validateNowPaymentsFinishedPayment(existingTransaction, payload, providerPayment) {
  const payloadPaymentId = String(payload.payment_id || '')
  const savedPaymentId = String(existingTransaction.nowpayments_payment_id || '')
  const providerPaymentId = String(providerPayment.payment_id || '')
  const savedReference = String(existingTransaction.payment_reference || '')
  const providerOrderId = String(providerPayment.order_id || '')
  const providerStatus = String(providerPayment.payment_status || '').trim().toLowerCase()
  const expectedCurrency = String(existingTransaction.outcome_currency || existingTransaction.crypto_type || '').trim().toLowerCase()
  const providerCurrency = String(providerPayment.pay_currency || '').trim().toLowerCase()
  const expectedPayAmount = Number(existingTransaction.outcome_amount || providerPayment.pay_amount || payload.pay_amount || 0)
  const providerPaidAmount = Number(providerPayment.actually_paid || providerPayment.pay_amount || 0)
  const amountTolerance = Math.max(expectedPayAmount * 0.005, 0.00000001)

  if (!payloadPaymentId || !savedPaymentId || payloadPaymentId !== savedPaymentId) return { ok: false, reason: 'payment_id_mismatch' }
  if (providerPaymentId && providerPaymentId !== savedPaymentId) return { ok: false, reason: 'provider_payment_id_mismatch' }
  if (!savedReference || providerOrderId !== savedReference) return { ok: false, reason: 'provider_order_reference_mismatch' }
  if (providerStatus !== 'finished') return { ok: false, reason: `provider_status_${providerStatus || 'missing'}` }
  if (expectedCurrency && providerCurrency && expectedCurrency !== providerCurrency) return { ok: false, reason: 'provider_currency_mismatch' }
  if (expectedPayAmount > 0 && providerPaidAmount + amountTolerance < expectedPayAmount) return { ok: false, reason: 'provider_paid_amount_too_low' }

  return { ok: true, reason: 'verified' }
}

function nowPaymentsDecision({
  secret,
  payload,
  signature,
  existingTransaction,
  providerPayment,
  autoCreditEnabled = false,
}) {
  if (!verifyNowPaymentsSignature({ secret, payload, signature })) {
    return { credit: false, code: 'INVALID_IPN_SIGNATURE', punishNamedCustomer: false }
  }

  if (!existingTransaction) {
    return { credit: false, code: 'TRANSACTION_NOT_FOUND_ACK_ONLY', punishNamedCustomer: false }
  }

  const status = String(payload.payment_status || '').trim().toLowerCase()
  if (status === 'partially_paid') return { credit: false, code: 'PARTIAL_PAYMENT_HELD' }
  if (['waiting', 'confirming', 'confirmed', 'sending'].includes(status)) return { credit: false, code: 'PROVIDER_PAYMENT_PENDING' }
  if (['failed', 'refunded', 'expired'].includes(status)) return { credit: false, code: `PROVIDER_${status.toUpperCase()}` }
  if (status !== 'finished') return { credit: false, code: 'UNSUPPORTED_PROVIDER_STATUS' }

  if (!providerPayment) return { credit: false, code: 'PROVIDER_STATUS_VERIFICATION_FAILED' }

  const validation = validateNowPaymentsFinishedPayment(existingTransaction, payload, providerPayment)
  if (!validation.ok) {
    return { credit: false, code: 'PROVIDER_PAYMENT_VERIFICATION_FAILED', reason: validation.reason }
  }

  if (!autoCreditEnabled) {
    return { credit: false, code: 'COMPLETED_PENDING_REVIEW' }
  }

  return { credit: false, code: 'COMPLETED_PENDING_RELEASE' }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const ercasLedger = new CreditLedger()
const pending = {
  user_id: 'user-a',
  amount: 10000,
  status: 'pending',
  transaction_reference: 'TALLY-REF-1',
}

assert(ercasDecision({ pendingPayment: null, providerResult: null, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PENDING_PAYMENT_NOT_FOUND', 'missing pending payment was not blocked')
assert(ercasDecision({ pendingPayment: pending, providerResult: null, requesterUserId: 'user-b', ledger: ercasLedger }).code === 'PENDING_PAYMENT_USER_MISMATCH', 'wrong local user was not blocked')
assert(ercasDecision({ pendingPayment: pending, providerResult: null, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_UNAVAILABLE_RETRY', 'provider timeout should not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: { responseBody: { status: 'PENDING' } }, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_PENDING', 'pending provider status should not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: false, responseBody: { status: 'FAILED' } }, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_FAILED', 'failed provider status should not credit')
for (const scenario of [
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: false, responseBody: { status: 'FAILED' } }, requesterUserId: 'user-a', ledger: ercasLedger }),
    message: 'failed provider result should close pending payment evidence',
  },
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 5000, ercs_reference: 'ERCS-1' } }, requesterUserId: 'user-a', ledger: ercasLedger }),
    message: 'amount mismatch should close pending payment evidence',
  },
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, currency: 'USD', ercs_reference: 'ERCS-2' } }, requesterUserId: 'user-a', ledger: ercasLedger }),
    message: 'currency mismatch should close pending payment evidence',
  },
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, merchant_id: 'wrong-merchant', ercs_reference: 'ERCS-3' } }, requesterUserId: 'user-a', ledger: ercasLedger, expectedMerchant: 'tallystore-merchant' }),
    message: 'merchant mismatch should close pending payment evidence',
  },
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, environment: 'test', ercs_reference: 'ERCS-4' } }, requesterUserId: 'user-a', ledger: ercasLedger, expectedEnvironment: 'live' }),
    message: 'environment mismatch should close pending payment evidence',
  },
]) {
  assert(scenario.actual.closesPendingPayment === true, scenario.message)
}

const success = { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, ercs_reference: 'ERCS-1' } }
assert(ercasDecision({ pendingPayment: pending, providerResult: success, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'CREDITED', 'valid Ercas payment did not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: success, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'IDEMPOTENT_REPLAY', 'duplicate Ercas verification double credited')
assert(ercasDecision({ pendingPayment: { ...pending, user_id: 'user-b', transaction_reference: 'TALLY-REF-2' }, providerResult: success, requesterUserId: 'user-b', ledger: ercasLedger }).code === 'EXTERNAL_PAYMENT_ID_CONFLICT', 'same Ercas payment funded two wallets')

const recoveryQueue = new PendingRecoveryQueue([{ id: 'pending-1', status: 'pending', check_count: 0 }])
const recoverySnapshot = { id: 'pending-1', status: 'pending', check_count: 0 }
assert(recoveryQueue.claim(recoverySnapshot).code === 'RECOVERY_CLAIMED', 'first pending-payment recovery worker did not claim row')
assert(recoveryQueue.claim(recoverySnapshot).code === 'RECOVERY_ALREADY_CLAIMED', 'second pending-payment recovery worker was not skipped after stale claim')

const secret = 'pocketfi-test-secret'
const pocketFiLedger = new CreditLedger()
const body = JSON.stringify({
  account_number: '1234567890',
  order: { amount: 15000 },
  transaction: { reference: 'PF-REF-1' },
})
assert(pocketFiDecision({ secret, body, headers: {}, accountOwner: { userId: 'user-a' }, ledger: pocketFiLedger }).code === 'INVALID_WEBHOOK_VERIFICATION', 'unsigned PocketFi payload was not rejected')
assert(pocketFiDecision({ secret, body, headers: { 'x-pocketfi-signature': 'bad' }, accountOwner: { userId: 'user-a' }, ledger: pocketFiLedger }).code === 'INVALID_WEBHOOK_VERIFICATION', 'bad PocketFi signature was not rejected')
assert(pocketFiDecision({ secret, body, headers: { 'x-pocketfi-signature': sign(secret, body) }, partnerCustomer: { id: 'partner-customer' }, partnerApiPaused: true, ledger: pocketFiLedger }).code === 'PARTNER_API_PAUSED_MANUAL_REVIEW', 'partner payment during pause was not held for review')
assert(pocketFiDecision({ secret, body, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, ledger: pocketFiLedger }).code === 'CREDITED', 'valid PocketFi webhook did not credit')
assert(pocketFiDecision({ secret, body, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, existingCredit: { userId: 'user-a', amount: 15000 }, ledger: pocketFiLedger }).code === 'IDEMPOTENT_REPLAY', 'duplicate PocketFi reference was not idempotent')
assert(pocketFiDecision({ secret, body, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, existingCredit: { userId: 'user-b', amount: 15000 }, ledger: pocketFiLedger }).code === 'POCKETFI_REFERENCE_CONFLICT', 'conflicting PocketFi duplicate was not blocked')

const nowPaymentsSecret = 'nowpayments-ipn-secret'
const nowPayload = {
  payment_id: 'np-pay-1',
  payment_status: 'finished',
  pay_amount: 1.5,
  actually_paid: 1.5,
  pay_currency: 'ton',
  order_id: 'crypto-order-1',
}
const nowSignature = signNowPayments(nowPaymentsSecret, nowPayload)
const cryptoTransaction = {
  id: 'crypto-tx-1',
  user_id: 'user-a',
  nowpayments_payment_id: 'np-pay-1',
  payment_reference: 'crypto-order-1',
  outcome_amount: 1.5,
  outcome_currency: 'ton',
  status: 'waiting',
  credited_at: null,
}
const providerFinished = {
  payment_id: 'np-pay-1',
  payment_status: 'finished',
  pay_amount: 1.5,
  actually_paid: 1.5,
  pay_currency: 'ton',
  order_id: 'crypto-order-1',
}

assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: '', existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'INVALID_IPN_SIGNATURE', 'missing NOWPayments signature was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: 'bad', existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'INVALID_IPN_SIGNATURE', 'bad NOWPayments signature was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: { ...nowPayload, payment_status: 'partially_paid' }, signature: signNowPayments(nowPaymentsSecret, { ...nowPayload, payment_status: 'partially_paid' }), existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'PARTIAL_PAYMENT_HELD', 'partial NOWPayments payment became spendable')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: { ...nowPayload, payment_status: 'expired' }, signature: signNowPayments(nowPaymentsSecret, { ...nowPayload, payment_status: 'expired' }), existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'PROVIDER_EXPIRED', 'expired NOWPayments payment became spendable')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: null, providerPayment: providerFinished }).code === 'TRANSACTION_NOT_FOUND_ACK_ONLY', 'unknown NOWPayments transaction tried to credit')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: null }).code === 'PROVIDER_STATUS_VERIFICATION_FAILED', 'NOWPayments finished IPN skipped server-side status verification')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, actually_paid: 0.1 } }).reason === 'provider_paid_amount_too_low', 'underpaid NOWPayments status was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, order_id: 'other-order' } }).reason === 'provider_order_reference_mismatch', 'wrong NOWPayments order reference was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, pay_currency: 'btc' } }).reason === 'provider_currency_mismatch', 'wrong NOWPayments currency was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'COMPLETED_PENDING_REVIEW', 'verified NOWPayments finished payment auto-credited instead of manual review')

console.log(JSON.stringify({
  ok: true,
  providers: ['ercas', 'pocketfi', 'nowpayments'],
  scenarios: [
    'browser/provider-unverified Ercas success cannot credit',
    'wrong user/payment binding cannot credit',
    'provider pending/failed/timeout states cannot credit',
    'definitive provider failures and mismatches close pending payment evidence',
    'amount mismatch cannot credit',
    'currency, merchant, and environment mismatches cannot credit when provider returns those fields',
    'same provider payment cannot fund two wallets',
    'overlapping pending-payment recovery workers produce one claim and one skip',
    'PocketFi unsigned or invalid signatures cannot credit or punish named users',
    'PocketFi partner payments are manual review while partner API is paused',
    'PocketFi duplicate references are idempotent or conflict-blocked',
    'NOWPayments missing or invalid IPN signatures cannot credit or punish named users',
    'NOWPayments partial, expired, unknown, or unverified payments cannot credit',
    'NOWPayments wrong amount, currency, or order identity cannot credit',
    'NOWPayments finished payments are held for manual review and do not auto-credit',
  ],
}, null, 2))
