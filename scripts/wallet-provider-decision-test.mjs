import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'
import {
  matchesNowPaymentsIdentity, shouldIgnoreStaleNowPaymentsStatus, validateTerminalNowPaymentsStatus,
} from '../supabase/functions/_shared/nowpayments-identity.mjs'

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
  if (providerResult.requestSuccessful !== true) {
    return { credit: false, code: 'PROVIDER_FAILED', closesPendingPayment: true }
  }
  if (body.status !== 'SUCCESSFUL') return { credit: false, code: 'PROVIDER_NOT_SUCCESSFUL', closesPendingPayment: true }

  if ((body.transactionReference && body.transactionReference !== pendingPayment.transaction_reference) ||
      (body.paymentReference && body.paymentReference !== pendingPayment.ercas_reference)) {
    return { credit: false, code: 'PAYMENT_IDENTITY_MISMATCH', closesPendingPayment: true }
  }

  const expectedMinor = ngnMinorUnits(pendingPayment.amount)
  const verifiedMinor = ngnMinorUnits(body.amount)
  if (expectedMinor === null || verifiedMinor === null || expectedMinor !== verifiedMinor) {
    return { credit: false, code: 'AMOUNT_MISMATCH', closesPendingPayment: true }
  }
  const verifiedAmount = verifiedMinor / 100
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
  const rawAmount = payload.order?.amount ?? payload.order?.settlement_amount ?? payload.amount ?? payload.data?.amount
  const amountMinor = ngnMinorUnits(rawAmount)
  const amount = amountMinor === null ? Number.NaN : amountMinor / 100
  const reference = payload.transaction?.reference || payload.reference || payload.transaction_reference
  if (!accountNumber || amountMinor === null || !reference) {
    return { credit: false, code: 'MANUAL_REVIEW_REQUIRED' }
  }

  if (partnerCustomer) {
    return partnerApiPaused
      ? { credit: false, code: 'PARTNER_API_PAUSED_MANUAL_REVIEW' }
      : { credit: false, code: 'PARTNER_CHECKOUT_HANDOFF' }
  }

  if (!accountOwner) return { credit: false, code: 'UNKNOWN_ACCOUNT_MANUAL_REVIEW' }
  if (existingCredit) {
    if (existingCredit.userId !== accountOwner.userId || ngnMinorUnits(existingCredit.amount) !== amountMinor) {
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
  const expectedPayAmount = Number(existingTransaction.outcome_amount || 0)
  const providerPaidAmount = Number(providerPayment.actually_paid || providerPayment.pay_amount || 0)
  const amountTolerance = Math.max(expectedPayAmount * 0.005, 0.00000001)

  if (!payloadPaymentId || !savedPaymentId || payloadPaymentId !== savedPaymentId) return { ok: false, reason: 'payment_id_mismatch' }
  if (providerPaymentId && providerPaymentId !== savedPaymentId) return { ok: false, reason: 'provider_payment_id_mismatch' }
  if (!savedReference || providerOrderId !== savedReference) return { ok: false, reason: 'provider_order_reference_mismatch' }
  if (providerStatus !== 'finished') return { ok: false, reason: `provider_status_${providerStatus || 'missing'}` }
  if (!(expectedPayAmount > 0)) return { ok: false, reason: 'saved_payment_amount_missing' }
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
    return { credit: false, code: 'SIGNED_UNMATCHED_REVIEW', punishNamedCustomer: false }
  }
  if (!matchesNowPaymentsIdentity(existingTransaction, payload.payment_id, payload.order_id)) {
    return { credit: false, code: 'PAYMENT_IDENTITY_REVIEW', punishNamedCustomer: false }
  }
  if (shouldIgnoreStaleNowPaymentsStatus(existingTransaction.status, payload.payment_status)) {
    return { credit: false, code: 'STALE_STATUS_IGNORED', punishNamedCustomer: false }
  }

  const status = String(payload.payment_status || '').trim().toLowerCase()
  if (status === 'partially_paid') return { credit: false, code: 'PARTIAL_PAYMENT_HELD' }
  if (['waiting', 'confirming', 'confirmed', 'sending'].includes(status)) return { credit: false, code: 'PROVIDER_PAYMENT_PENDING' }
  if (['failed', 'refunded', 'expired'].includes(status)) {
    if (!providerPayment) return { credit: false, code: 'PROVIDER_STATUS_VERIFICATION_FAILED' }
    const terminalValidation = validateTerminalNowPaymentsStatus(existingTransaction, payload, providerPayment)
    if (!terminalValidation.ok) return { credit: false, code: 'TERMINAL_REVIEW', reason: terminalValidation.reason }
    return { credit: false, code: `PROVIDER_${status.toUpperCase()}` }
  }
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
  ercas_reference: 'PAYMENT-REF-1',
}

for (const value of ['9999.99', '10000.01', '10000.001', '-10000', 'not-a-number']) {
  assert(ercasDecision({
    pendingPayment: pending,
    providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: value } },
    requesterUserId: 'user-a',
    ledger: ercasLedger,
  }).code === 'AMOUNT_MISMATCH', `Ercas must reject amount ${value}`)
}
assert(ngnMinorUnits('10000.00') === 1000000, 'exact NGN minor-unit parser changed')
assert(ngnMinorUnits(10000.01) === 1000001, 'numeric NGN minor units changed')
assert(ngnMinorUnits(0) === null, 'zero NGN amount was accepted')
assert(ngnMinorUnits('9'.repeat(200)) === null, 'oversized NGN amount was accepted')

assert(ercasDecision({ pendingPayment: null, providerResult: null, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PENDING_PAYMENT_NOT_FOUND', 'missing pending payment was not blocked')
assert(ercasDecision({ pendingPayment: pending, providerResult: null, requesterUserId: 'user-b', ledger: ercasLedger }).code === 'PENDING_PAYMENT_USER_MISMATCH', 'wrong local user was not blocked')
assert(ercasDecision({ pendingPayment: pending, providerResult: null, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_UNAVAILABLE_RETRY', 'provider timeout should not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: { responseBody: { status: 'PENDING' } }, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_PENDING', 'pending provider status should not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: false, responseBody: { status: 'FAILED' } }, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_FAILED', 'failed provider status should not credit')
assert(ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: false, responseBody: { status: 'SUCCESSFUL', amount: 10000 } }, requesterUserId: 'user-a', ledger: ercasLedger }).code === 'PROVIDER_FAILED', 'failed provider envelope with a successful body must not credit')
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
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, transactionReference: 'OTHER-TRANSACTION' } }, requesterUserId: 'user-a', ledger: ercasLedger }),
    message: 'provider transaction reference mismatch should close pending payment evidence',
  },
  {
    actual: ercasDecision({ pendingPayment: pending, providerResult: { requestSuccessful: true, responseBody: { status: 'SUCCESSFUL', amount: 10000, paymentReference: 'OTHER-PAYMENT' } }, requesterUserId: 'user-a', ledger: ercasLedger }),
    message: 'provider payment reference mismatch should close pending payment evidence',
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
const overPrecisePocketFiBody = JSON.stringify({
  account_number: '1234567890', order: { amount: '15000.004' }, transaction: { reference: 'PF-REF-1' },
})
assert(pocketFiDecision({ secret, body: overPrecisePocketFiBody, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, existingCredit: { userId: 'user-a', amount: 15000 }, ledger: pocketFiLedger }).code === 'MANUAL_REVIEW_REQUIRED', 'over-precise PocketFi replay was accepted after rounding')
const mismatchedPocketFiBody = JSON.stringify({
  account_number: '1234567890', order: { amount: '15000.01' }, transaction: { reference: 'PF-REF-1' },
})
assert(pocketFiDecision({ secret, body: mismatchedPocketFiBody, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, existingCredit: { userId: 'user-a', amount: 15000 }, ledger: pocketFiLedger }).code === 'POCKETFI_REFERENCE_CONFLICT', 'PocketFi replay with a different exact amount was accepted')
const eventOnlyPocketFiBody = JSON.stringify({
  id: 'event-1', sessionId: 'session-1', account_number: '1234567890',
  order: { amount: '15000' }, transaction: { id: 'event-transaction-1' }, status: 'success',
})
assert(pocketFiDecision({ secret, body: eventOnlyPocketFiBody, headers: { authorization: `Bearer ${secret}` }, accountOwner: { userId: 'user-a' }, ledger: pocketFiLedger }).code === 'MANUAL_REVIEW_REQUIRED', 'event/session ID without a transfer reference was credited')
const pocketFiSource = readFileSync(new URL('../supabase/functions/webhook-pocketfi/index.ts', import.meta.url), 'utf8')
const pocketFiReferenceExtractor = pocketFiSource.match(/function extractReference\(payload: any\): string \| undefined \{([\s\S]*?)\n\}/)?.[1] || ''
assert(pocketFiReferenceExtractor.includes('payload.transaction?.reference'), 'PocketFi must use an explicit transaction reference')
assert(!/payload\.(?:sessionId|id)\b|payload\.(?:data\?\.)?transaction\?\.id\b/.test(pocketFiReferenceExtractor), 'PocketFi event/session IDs must not become a payment idempotency key')

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
for (const terminalStatus of ['failed', 'refunded', 'expired']) {
  const terminalPayload = { ...nowPayload, payment_status: terminalStatus }
  const terminalInput = { secret: nowPaymentsSecret, payload: terminalPayload, signature: signNowPayments(nowPaymentsSecret, terminalPayload), existingTransaction: cryptoTransaction }
  assert(nowPaymentsDecision({ ...terminalInput, providerPayment: null }).code === 'PROVIDER_STATUS_VERIFICATION_FAILED', `${terminalStatus} notification skipped provider lookup`)
  assert(nowPaymentsDecision({ ...terminalInput, providerPayment: providerFinished }).reason === 'provider_terminal_status_conflict', `${terminalStatus} notification overwrote a different current provider state`)
  assert(nowPaymentsDecision({ ...terminalInput, providerPayment: { ...providerFinished, payment_status: terminalStatus } }).code === `PROVIDER_${terminalStatus.toUpperCase()}`, `verified ${terminalStatus} status was not accepted`)
  assert(nowPaymentsDecision({ ...terminalInput, providerPayment: { ...providerFinished, payment_status: terminalStatus, payment_id: 'other-payment' } }).reason === 'provider_payment_identity_mismatch', `${terminalStatus} provider identity mismatch was accepted`)
  assert(nowPaymentsDecision({ ...terminalInput, providerPayment: { ...providerFinished, payment_status: terminalStatus, pay_currency: 'btc' } }).reason === 'provider_currency_mismatch', `${terminalStatus} provider currency mismatch was accepted`)
}
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: null, providerPayment: providerFinished }).code === 'SIGNED_UNMATCHED_REVIEW', 'unknown signed NOWPayments transaction was not held for review')
const wrongPaymentId = { ...nowPayload, payment_id: 'np-pay-other', payment_status: 'waiting' }
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: wrongPaymentId, signature: signNowPayments(nowPaymentsSecret, wrongPaymentId), existingTransaction: cryptoTransaction, providerPayment: null }).code === 'PAYMENT_IDENTITY_REVIEW', 'signed non-finished event with wrong payment ID could update another transaction')
const wrongSignedOrder = { ...nowPayload, order_id: 'other-order', payment_status: 'waiting' }
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: wrongSignedOrder, signature: signNowPayments(nowPaymentsSecret, wrongSignedOrder), existingTransaction: cryptoTransaction, providerPayment: null }).code === 'PAYMENT_IDENTITY_REVIEW', 'signed non-finished event with wrong order ID could update another transaction')
for (const storedStatus of ['completed_pending_review', 'completed_pending_release', 'completed', 'blocked_review', 'verification_failed', 'failed', 'refunded', 'expired']) {
  const stalePayload = { ...nowPayload, payment_status: 'waiting' }
  assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: stalePayload, signature: signNowPayments(nowPaymentsSecret, stalePayload), existingTransaction: { ...cryptoTransaction, status: storedStatus }, providerPayment: null }).code === 'STALE_STATUS_IGNORED', `${storedStatus} was downgraded by an older pending event`)
}
assert(!shouldIgnoreStaleNowPaymentsStatus('processing', 'finished'), 'verified finished state was incorrectly ignored')
const nowWebhookSource = readFileSync(new URL('../supabase/functions/nowpayments-webhook/index.ts', import.meta.url), 'utf8')
assert(nowWebhookSource.includes(".eq('nowpayments_payment_id', providerPaymentId).limit(2)"), 'webhook must resolve by provider payment ID only')
assert(!nowWebhookSource.includes('.or(`nowpayments_payment_id.eq.'), 'webhook must not resolve by either provider ID or caller order ID')
assert(nowWebhookSource.indexOf('matchesNowPaymentsIdentity(existingTransaction, payment_id, order_id)') < nowWebhookSource.indexOf('switch (reportedStatus)'), 'identity check must precede all status writes')
assert(nowWebhookSource.includes("event_type: 'CRYPTO_IPN_IDENTITY_REVIEW'"), 'unmatched signed webhook must be retained for review')
assert(nowWebhookSource.indexOf('shouldIgnoreStaleNowPaymentsStatus(existingTransaction.status, payment_status)') < nowWebhookSource.indexOf('switch (reportedStatus)'), 'stale events must be ignored before status mapping or writes')
assert(nowWebhookSource.includes("validateTerminalNowPaymentsStatus(existingTransaction, payload, verifiedProviderPayment)"), 'terminal webhook must compare current provider status before changing the transaction')
assert(nowWebhookSource.includes("event_type: 'CRYPTO_IPN_TERMINAL_REVIEW'"), 'terminal provider conflicts must be retained for review')
assert(nowWebhookSource.includes("event_type: 'CRYPTO_IPN_FINISHED_REVIEW'"), 'finished provider conflicts must be retained for review')
assert(nowWebhookSource.includes("event_type: 'CRYPTO_IPN_UNSUPPORTED_STATUS_REVIEW'"), 'unknown signed provider statuses must be retained for review')
assert(!nowWebhookSource.includes('transactionStatus = payment_status'), 'unknown signed provider statuses must not become local transaction states')
assert(!/\.update\(\{[\s\S]*?outcome_amount: verifiedPayAmount/.test(nowWebhookSource), 'webhook must not rewrite the server-created expected payment amount')
assert(!nowWebhookSource.includes("status: 'verification_failed'"), 'a conflicting finished notification must not overwrite a newer local transaction state')
assert((nowWebhookSource.match(/\.eq\('status', existingTransaction\.status\)/g) || []).length >= 2, 'held and terminal webhook updates must have optimistic status predicates')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: null }).code === 'PROVIDER_STATUS_VERIFICATION_FAILED', 'NOWPayments finished IPN skipped server-side status verification')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, actually_paid: 0.1 } }).reason === 'provider_paid_amount_too_low', 'underpaid NOWPayments status was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, order_id: 'other-order' } }).reason === 'provider_order_reference_mismatch', 'wrong NOWPayments order reference was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: { ...providerFinished, pay_currency: 'btc' } }).reason === 'provider_currency_mismatch', 'wrong NOWPayments currency was not rejected')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: { ...cryptoTransaction, outcome_amount: null }, providerPayment: providerFinished }).reason === 'saved_payment_amount_missing', 'provider payment amount replaced a missing server-created quote')
assert(nowPaymentsDecision({ secret: nowPaymentsSecret, payload: nowPayload, signature: nowSignature, existingTransaction: cryptoTransaction, providerPayment: providerFinished }).code === 'COMPLETED_PENDING_REVIEW', 'verified NOWPayments finished payment auto-credited instead of manual review')

const statusDb = new PGlite()
try {
  await statusDb.exec("CREATE TABLE crypto_payment (id text PRIMARY KEY, status text NOT NULL); INSERT INTO crypto_payment VALUES ('payment-1', 'pending');")
  const readStatus = (await statusDb.query("SELECT status FROM crypto_payment WHERE id = 'payment-1'")).rows[0].status
  await statusDb.exec("UPDATE crypto_payment SET status = 'completed_pending_review' WHERE id = 'payment-1'")
  const staleUpdate = await statusDb.query("UPDATE crypto_payment SET status = 'processing' WHERE id = 'payment-1' AND status = $1 RETURNING id", [readStatus])
  assert(staleUpdate.rows.length === 0, 'stale pending update succeeded after the finished review hold committed')
  assert((await statusDb.query("SELECT status FROM crypto_payment WHERE id = 'payment-1'")).rows[0].status === 'completed_pending_review', 'stale webhook changed a verified review hold')
  const heldReadStatus = (await statusDb.query("SELECT status FROM crypto_payment WHERE id = 'payment-1'")).rows[0].status
  await statusDb.exec("UPDATE crypto_payment SET status = 'refunded' WHERE id = 'payment-1'")
  const staleHeldUpdate = await statusDb.query("UPDATE crypto_payment SET status = 'completed_pending_review' WHERE id = 'payment-1' AND status = $1 RETURNING id", [heldReadStatus])
  assert(staleHeldUpdate.rows.length === 0, 'verified finished hold overwrote a newer refunded state')
  await statusDb.exec("UPDATE crypto_payment SET status = 'pending' WHERE id = 'payment-1'")
  const terminalReadStatus = (await statusDb.query("SELECT status FROM crypto_payment WHERE id = 'payment-1'")).rows[0].status
  await statusDb.exec("UPDATE crypto_payment SET status = 'completed_pending_review' WHERE id = 'payment-1'")
  const staleTerminalUpdate = await statusDb.query("UPDATE crypto_payment SET status = 'failed' WHERE id = 'payment-1' AND status = $1 RETURNING id", [terminalReadStatus])
  assert(staleTerminalUpdate.rows.length === 0, 'verified terminal event overwrote a newer finished review hold')
} finally {
  await statusDb.close()
}

console.log(JSON.stringify({
  ok: true,
  providers: ['ercas', 'pocketfi', 'nowpayments'],
  scenarios: [
    'browser/provider-unverified Ercas success cannot credit',
    'wrong user/payment binding cannot credit',
    'provider pending/failed/timeout states cannot credit',
    'provider success body inside a failed verification envelope cannot credit',
    'definitive provider failures and mismatches close pending payment evidence',
    'amount mismatch cannot credit',
    'provider transaction and payment references must match the server-created checkout when returned',
    'currency, merchant, and environment mismatches cannot credit when provider returns those fields',
    'same provider payment cannot fund two wallets',
    'overlapping pending-payment recovery workers produce one claim and one skip',
    'PocketFi unsigned or invalid signatures cannot credit or punish named users',
    'PocketFi partner payments are manual review while partner API is paused',
    'PocketFi duplicate references require exact raw amounts or are held/conflict-blocked',
    'PocketFi event/session IDs without a transfer reference cannot create wallet credit',
    'NOWPayments missing or invalid IPN signatures cannot credit or punish named users',
    'NOWPayments partial, expired, unknown, or unverified payments cannot credit',
    'NOWPayments wrong amount, currency, or order identity cannot credit',
    'NOWPayments non-finished status cannot change a row with mismatched provider or order identity',
    'unmatched signed NOWPayments events are held as operator evidence before acknowledgement',
    'NOWPayments terminal statuses require current matching provider status and preserve conflicts for review',
    'NOWPayments finished verification conflicts preserve the transaction and leave review evidence',
    'unknown signed NOWPayments statuses cannot become local transaction states or alter quoted payment terms',
    'conditional status writes prevent terminal and finished-review notifications from overwriting newer states',
    'older pending/partial NOWPayments events cannot downgrade a committed review hold',
    'NOWPayments finished payments are held for manual review and do not auto-credit',
  ],
}, null, 2))
