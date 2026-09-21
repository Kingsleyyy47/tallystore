function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isCompleted(entry) {
  return normalize(entry.status || 'completed') === 'completed'
}

function isVerifiedGatewayDeposit(entry) {
  if (!isCompleted(entry)) return false
  if (!['deposit', 'topup', 'top_up', 'wallet_topup', 'wallet_deposit'].includes(normalize(entry.type))) return false
  if (Number(entry.amount || 0) <= 0) return false
  return entry.providerEvidence?.verified === true
    && entry.providerEvidence.walletId === entry.walletId
    && Math.round(Number(entry.providerEvidence.amount || 0) * 100) === Math.round(Number(entry.amount || 0) * 100)
    && String(entry.providerEvidence.paymentId || '') === String(entry.externalPaymentId || '')
}

function isApprovedAdminCredit(entry) {
  if (!isCompleted(entry)) return false
  if (normalize(entry.type) !== 'admin_credit') return false
  if (Number(entry.amount || 0) <= 0) return false
  return entry.approval?.reviewerRole === 'admin'
    && String(entry.approval?.approvalId || '').length > 0
    && Number(entry.balanceAfter || 0) > Number(entry.balanceBefore || 0)
}

function isTrustedPrincipalCredit(entry) {
  return isVerifiedGatewayDeposit(entry) || isApprovedAdminCredit(entry)
}

function isDebit(entry) {
  return ['purchase', 'admin_debit', 'staff_debit', 'chargeback', 'correction_debit'].includes(normalize(entry.type))
}

function isTrustedPrincipalAuthorizedDebit(entry) {
  const trustedAmount = Number(entry.metadata?.trusted_principal_debit_amount || 0)
  return isDebit(entry)
    && String(entry.metadata?.trusted_principal_authorized || '').toLowerCase() === 'true'
    && Number.isFinite(trustedAmount)
    && trustedAmount > 0
}

function isRefund(entry) {
  return ['refund', 'purchase_refund', 'auto_refund'].includes(normalize(entry.type))
}

function calculateTrustedState(entries, reservations = []) {
  const completed = entries.filter(isCompleted)
  const trustedPrincipal = completed
    .filter(isTrustedPrincipalCredit)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)

  let remainingPrincipalForDebits = trustedPrincipal
  let trustedDebitCapacity = 0
  const trustedDebitById = new Map()
  for (const entry of completed) {
    if (!isDebit(entry)) continue
    const debit = Math.abs(Number(entry.amount || 0))
    const consumedPrincipal = Math.min(debit, remainingPrincipalForDebits)
    remainingPrincipalForDebits -= consumedPrincipal
    trustedDebitCapacity += consumedPrincipal
    if (isTrustedPrincipalAuthorizedDebit(entry)) {
      const trustedDebitAmount = Math.min(debit, Number(entry.metadata?.trusted_principal_debit_amount || 0), consumedPrincipal)
      trustedDebitById.set(String(entry.id || ''), trustedDebitAmount)
    }
  }

  const refundedByOriginal = new Map()
  let eligibleRefunds = 0
  for (const entry of completed) {
    if (!isRefund(entry)) continue
    const originalId = String(entry.originalTransactionId || '')
    const trustedDebit = trustedDebitById.get(originalId) || 0
    const alreadyRefunded = refundedByOriginal.get(originalId) || 0
    const refundableRemaining = Math.max(trustedDebit - alreadyRefunded, 0)
    const eligible = Math.min(Number(entry.amount || 0), refundableRemaining)
    refundedByOriginal.set(originalId, alreadyRefunded + eligible)
    eligibleRefunds += eligible
  }

  const trustedConsumedSpend = Math.max(trustedDebitCapacity - eligibleRefunds, 0)
  const trustedBookBalance = Math.max(trustedPrincipal - trustedConsumedSpend, 0)
  const reservedSpend = reservations
    .filter((reservation) => normalize(reservation.status || 'active') === 'active')
    .reduce((sum, reservation) => sum + Number(reservation.amount || 0), 0)
  const trustedAvailable = Math.max(trustedPrincipal - trustedConsumedSpend - reservedSpend, 0)

  return {
    trustedPrincipal,
    trustedDebitById,
    trustedDebitCapacity,
    eligibleRefunds,
    trustedConsumedSpend,
    trustedBookBalance,
    reservedSpend,
    trustedAvailable,
  }
}

function refundDecision(entries, refund) {
  const stateBefore = calculateTrustedState(entries)
  if (!String(refund.originalTransactionId || '')) {
    return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_REQUIRED', stateBefore }
  }

  const original = entries.find((entry) => String(entry.id || '') === String(refund.originalTransactionId))
  if (!original || !isDebit(original) || !isCompleted(original)) {
    return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_REQUIRED', stateBefore }
  }

  if (!isTrustedPrincipalAuthorizedDebit(original)) {
    return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', stateBefore }
  }

  const trustedOriginalDebit = stateBefore.trustedDebitById.get(String(original.id || '')) || 0
  if (trustedOriginalDebit <= 0) {
    return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', stateBefore }
  }

  const alreadyRefunded = entries
    .filter((entry) => isCompleted(entry) && isRefund(entry) && String(entry.originalTransactionId || '') === String(refund.originalTransactionId))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  if (alreadyRefunded + Number(refund.amount || 0) > trustedOriginalDebit) {
    return { ok: false, code: 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT', stateBefore }
  }

  return { ok: true, code: 'REFUND_RESTORES_TRUSTED_DEBIT', stateBefore }
}

function purchaseAuthorization({ storedWalletBalance, entries, reservations = [], orderAmount }) {
  const trusted = calculateTrustedState(entries, reservations)
  if (Number(storedWalletBalance || 0) > trusted.trustedBookBalance + 1) {
    return { ok: false, code: 'WALLET_UNBACKED_FUNDS', freeze: true, trusted }
  }
  if (Number(orderAmount || 0) > trusted.trustedAvailable) {
    return { ok: false, code: 'INSUFFICIENT_FUNDS', freeze: false, trusted }
  }
  return { ok: true, code: 'AUTHORIZED', freeze: false, trusted }
}

const verifiedDeposit = {
  id: 'deposit-1',
  walletId: 'wallet-1',
  type: 'deposit',
  amount: 100_000,
  status: 'completed',
  externalPaymentId: 'pay-1',
  providerEvidence: {
    verified: true,
    walletId: 'wallet-1',
    amount: 100_000,
    paymentId: 'pay-1',
  },
}

const approvedAdminCredit = {
  id: 'admin-credit-1',
  walletId: 'wallet-1',
  type: 'admin_credit',
  amount: 20_000,
  status: 'completed',
  balanceBefore: 100_000,
  balanceAfter: 120_000,
  approval: {
    reviewerRole: 'admin',
    approvalId: 'approval-1',
  },
}

const excludedCredits = [
  { id: 'generic-credit', walletId: 'wallet-1', type: 'credit', amount: 500_000, status: 'completed' },
  { id: 'staff-credit', walletId: 'wallet-1', type: 'staff_credit', amount: 500_000, status: 'completed' },
  { id: 'promo-credit', walletId: 'wallet-1', type: 'promotion_credit', amount: 500_000, status: 'completed' },
  { id: 'fake-deposit', walletId: 'wallet-1', type: 'deposit', amount: 500_000, status: 'completed', externalPaymentId: 'fake' },
  {
    id: 'unapproved-admin-credit',
    walletId: 'wallet-1',
    type: 'admin_credit',
    amount: 500_000,
    status: 'completed',
    balanceBefore: 0,
    balanceAfter: 500_000,
    approval: { reviewerRole: 'staff', approvalId: 'not-admin' },
  },
]

const fundedPurchase = {
  id: 'purchase-1',
  walletId: 'wallet-1',
  type: 'purchase',
  amount: -30_000,
  status: 'completed',
  metadata: {
    trusted_principal_authorized: true,
    trusted_principal_debit_amount: 30_000,
  },
}

const validRefund = {
  id: 'refund-1',
  walletId: 'wallet-1',
  type: 'refund',
  amount: 30_000,
  status: 'completed',
  originalTransactionId: 'purchase-1',
}

const nakedRefundDecision = refundDecision([verifiedDeposit, approvedAdminCredit, fundedPurchase], {
  id: 'refund-naked',
  walletId: 'wallet-1',
  type: 'refund',
  amount: 30_000,
  status: 'completed',
})
assert(nakedRefundDecision.code === 'REFUND_ORIGINAL_DEBIT_REQUIRED', 'refund without original debit link was allowed')

const linkedRefundDecision = refundDecision([verifiedDeposit, approvedAdminCredit, fundedPurchase], validRefund)
assert(linkedRefundDecision.ok && linkedRefundDecision.code === 'REFUND_RESTORES_TRUSTED_DEBIT', 'linked trusted refund was not allowed')

const mixedCaseStatusState = calculateTrustedState([
  { ...verifiedDeposit, id: 'mixed-case-deposit', status: 'Completed' },
  { ...fundedPurchase, id: 'mixed-case-purchase', status: 'Completed' },
  { ...validRefund, id: 'mixed-case-refund', status: 'Completed', originalTransactionId: 'mixed-case-purchase' },
])
assert(mixedCaseStatusState.trustedAvailable === 100_000, 'mixed-case completed status was not treated as completed')

const afterRefund = calculateTrustedState([
  verifiedDeposit,
  approvedAdminCredit,
  ...excludedCredits,
  fundedPurchase,
  validRefund,
])
assert(afterRefund.trustedPrincipal === 120_000, `refund changed trusted principal to ${afterRefund.trustedPrincipal}`)
assert(afterRefund.eligibleRefunds === 30_000, 'valid refund did not restore trusted debit capacity')
assert(afterRefund.trustedAvailable === 120_000, `available after valid refund was ${afterRefund.trustedAvailable}`)

const userExampleBeforeRefund = calculateTrustedState([
  {
    ...verifiedDeposit,
    id: 'example-deposit-100k',
    amount: 100_000,
    externalPaymentId: 'example-pay-100k',
    providerEvidence: {
      verified: true,
      walletId: 'wallet-1',
      amount: 100_000,
      paymentId: 'example-pay-100k',
    },
  },
  { ...fundedPurchase, id: 'example-purchase-30k', amount: -30_000 },
])
assert(userExampleBeforeRefund.trustedPrincipal === 100_000, 'example deposit did not create 100k trusted principal')
assert(userExampleBeforeRefund.trustedAvailable === 70_000, 'example 30k purchase did not consume trusted availability')

const userExampleAfterRefund = calculateTrustedState([
  {
    ...verifiedDeposit,
    id: 'example-deposit-100k',
    amount: 100_000,
    externalPaymentId: 'example-pay-100k',
    providerEvidence: {
      verified: true,
      walletId: 'wallet-1',
      amount: 100_000,
      paymentId: 'example-pay-100k',
    },
  },
  { ...fundedPurchase, id: 'example-purchase-30k', amount: -30_000 },
  { ...validRefund, id: 'example-refund-30k', amount: 30_000, originalTransactionId: 'example-purchase-30k' },
])
assert(userExampleAfterRefund.trustedPrincipal === 100_000, 'example refund incorrectly created new trusted principal')
assert(userExampleAfterRefund.trustedAvailable === 100_000, 'example refund did not restore the prior trusted debit')

const unbackedPurchase = {
  id: 'legacy-unbacked-purchase',
  walletId: 'wallet-2',
  type: 'purchase',
  amount: -50_000,
  status: 'completed',
}
const unbackedRefund = {
  id: 'legacy-refund',
  walletId: 'wallet-2',
  type: 'refund',
  amount: 50_000,
  status: 'completed',
  originalTransactionId: 'legacy-unbacked-purchase',
}
const unbacked = calculateTrustedState([unbackedPurchase, unbackedRefund])
assert(unbacked.trustedPrincipal === 0, 'unbacked legacy purchase/refund created trusted principal')
assert(unbacked.eligibleRefunds === 0, 'unbacked legacy refund became eligible trusted funds')
assert(unbacked.trustedAvailable === 0, 'unbacked legacy refund became spendable')
const unbackedRefundDecision = refundDecision([unbackedPurchase], unbackedRefund)
assert(unbackedRefundDecision.code === 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', 'refund of untrusted original debit was allowed')

const fakeMarkedUnbackedPurchase = {
  id: 'fake-marked-unbacked-purchase',
  walletId: 'wallet-2',
  type: 'purchase',
  amount: -50_000,
  status: 'completed',
  metadata: {
    trusted_principal_authorized: true,
  },
}
const fakeMarkedUnbackedRefund = {
  id: 'fake-marked-unbacked-refund',
  walletId: 'wallet-2',
  type: 'refund',
  amount: 50_000,
  status: 'completed',
  originalTransactionId: 'fake-marked-unbacked-purchase',
}
const fakeMarkedUnbacked = calculateTrustedState([fakeMarkedUnbackedPurchase, fakeMarkedUnbackedRefund])
assert(fakeMarkedUnbacked.trustedPrincipal === 0, 'fake marked unbacked debit created trusted principal')
assert(fakeMarkedUnbacked.eligibleRefunds === 0, 'fake marked unbacked debit refund became eligible trusted funds')
assert(fakeMarkedUnbacked.trustedAvailable === 0, 'fake marked unbacked debit refund became spendable')
const fakeMarkedRefundDecision = refundDecision([fakeMarkedUnbackedPurchase], fakeMarkedUnbackedRefund)
assert(fakeMarkedRefundDecision.code === 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', 'refund of fake marked unbacked debit was allowed')

const depositBackedFakeMarkedPurchase = {
  id: 'deposit-backed-fake-marked-purchase',
  walletId: 'wallet-1',
  type: 'purchase',
  amount: -50_000,
  status: 'completed',
  metadata: {
    trusted_principal_authorized: true,
  },
}
const depositBackedFakeMarkedRefund = {
  id: 'deposit-backed-fake-marked-refund',
  walletId: 'wallet-1',
  type: 'refund',
  amount: 50_000,
  status: 'completed',
  originalTransactionId: 'deposit-backed-fake-marked-purchase',
}
const depositBackedFakeMarked = calculateTrustedState([verifiedDeposit, depositBackedFakeMarkedPurchase, depositBackedFakeMarkedRefund])
assert(depositBackedFakeMarked.trustedPrincipal === 100_000, 'deposit-backed fake marked debit changed trusted principal')
assert(depositBackedFakeMarked.trustedConsumedSpend === 50_000, 'deposit-backed fake marked debit did not consume trusted spend capacity')
assert(depositBackedFakeMarked.eligibleRefunds === 0, 'deposit-backed fake marked debit refund became eligible trusted funds')
assert(depositBackedFakeMarked.trustedAvailable === 50_000, 'deposit-backed fake marked debit refund increased trusted availability')
const depositBackedFakeMarkedRefundDecision = refundDecision([verifiedDeposit, depositBackedFakeMarkedPurchase], depositBackedFakeMarkedRefund)
assert(depositBackedFakeMarkedRefundDecision.code === 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', 'refund of deposit-backed fake marked debit was allowed')

const unmarkedLegacyDebit = {
  id: 'legacy-unmarked-purchase',
  walletId: 'wallet-1',
  type: 'purchase',
  amount: -50_000,
  status: 'completed',
}
const unmarkedLegacyRefund = {
  id: 'legacy-unmarked-refund',
  walletId: 'wallet-1',
  type: 'refund',
  amount: 50_000,
  status: 'completed',
  originalTransactionId: 'legacy-unmarked-purchase',
}
const unmarkedLegacyState = calculateTrustedState([verifiedDeposit, unmarkedLegacyDebit, unmarkedLegacyRefund])
assert(unmarkedLegacyState.trustedPrincipal === 100_000, 'unmarked legacy debit changed trusted principal')
assert(unmarkedLegacyState.trustedConsumedSpend === 50_000, 'unmarked legacy debit did not consume trusted spend capacity')
assert(unmarkedLegacyState.eligibleRefunds === 0, 'refund of unmarked legacy debit restored spendable funds')
assert(unmarkedLegacyState.trustedAvailable === 50_000, 'refund of unmarked legacy debit increased trusted availability')
const unmarkedLegacyRefundDecision = refundDecision([verifiedDeposit, unmarkedLegacyDebit], unmarkedLegacyRefund)
assert(unmarkedLegacyRefundDecision.code === 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', 'refund of deposit-backed but unmarked legacy debit was allowed')

const pendingInvalidRefund = calculateTrustedState([
  verifiedDeposit,
  fundedPurchase,
  {
    id: 'pending-refund-zero-snapshot',
    walletId: 'wallet-1',
    type: 'refund',
    amount: 56_620,
    status: 'pending',
    balanceAfter: 0,
    originalTransactionId: 'purchase-1',
  },
])
assert(pendingInvalidRefund.eligibleRefunds === 0, 'pending invalid refund was treated as trusted restoration')
assert(pendingInvalidRefund.trustedAvailable === 70_000, 'pending invalid refund changed trusted availability')
const pendingThenValidRefundDecision = refundDecision([
  verifiedDeposit,
  fundedPurchase,
  {
    id: 'pending-refund-same-original',
    walletId: 'wallet-1',
    type: 'refund',
    amount: 30_000,
    status: 'pending',
    originalTransactionId: 'purchase-1',
  },
], validRefund)
assert(
  pendingThenValidRefundDecision.ok && pendingThenValidRefundDecision.code === 'REFUND_RESTORES_TRUSTED_DEBIT',
  'pending refund incorrectly consumed the trusted refund cap before completion',
)

const fabricatedWallet = purchaseAuthorization({
  storedWalletBalance: 500_000,
  entries: [],
  orderAmount: 1,
})
assert(fabricatedWallet.code === 'WALLET_UNBACKED_FUNDS' && fabricatedWallet.freeze, 'fabricated wallet balance did not freeze before purchase')

const fabricatedRileyLikeWallet = purchaseAuthorization({
  storedWalletBalance: 789_292,
  entries: [unbackedPurchase, unbackedRefund],
  orderAmount: 1,
})
assert(
  fabricatedRileyLikeWallet.code === 'WALLET_UNBACKED_FUNDS'
    && fabricatedRileyLikeWallet.freeze
    && fabricatedRileyLikeWallet.trusted.trustedAvailable === 0,
  'unbacked displayed wallet plus refund history became spendable',
)

const honestInsufficient = purchaseAuthorization({
  storedWalletBalance: 0,
  entries: [],
  orderAmount: 1,
})
assert(honestInsufficient.code === 'INSUFFICIENT_FUNDS' && !honestInsufficient.freeze, 'honest zero-balance purchase was treated as fraud')

const activeReservation = purchaseAuthorization({
  storedWalletBalance: 120_000,
  entries: [verifiedDeposit, approvedAdminCredit],
  reservations: [{ id: 'hold-1', amount: 90_000, status: 'active' }],
  orderAmount: 40_000,
})
assert(activeReservation.code === 'INSUFFICIENT_FUNDS' && !activeReservation.freeze, 'valid reservation caused fraud freeze or overspend')
assert(activeReservation.trusted.trustedAvailable === 30_000, 'reservation was not subtracted from trusted available funds')

const afterChargebackDebt = calculateTrustedState([
  verifiedDeposit,
  {
    id: 'chargeback-1',
    walletId: 'wallet-1',
    type: 'chargeback',
    amount: -150_000,
    status: 'completed',
  },
])
assert(afterChargebackDebt.trustedPrincipal === 100_000, 'chargeback changed trusted principal')
assert(afterChargebackDebt.trustedDebitCapacity === 100_000, 'chargeback did not consume trusted debit capacity up to principal')
assert(afterChargebackDebt.trustedAvailable === 0, 'chargeback debt left spendable trusted funds')
const chargebackPurchase = purchaseAuthorization({
  storedWalletBalance: -50_000,
  entries: [
    verifiedDeposit,
    {
      id: 'chargeback-1',
      walletId: 'wallet-1',
      type: 'chargeback',
      amount: -150_000,
      status: 'completed',
    },
  ],
  orderAmount: 1,
})
assert(chargebackPurchase.code === 'INSUFFICIENT_FUNDS' && !chargebackPurchase.ok, 'chargeback debt authorized new spend')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'only verified payment-gateway deposits and approved admin credits create trusted principal',
    'refunds must reference an original trusted debit before they can restore spendable value',
    'refunds restore prior trusted debit capacity without increasing trusted principal',
    'completed status checks are case-normalized for imported or legacy rows',
    'a 100k verified deposit, 30k purchase, and 30k linked refund restores availability back to 100k without increasing principal',
    'unbacked legacy purchases and their refunds cannot create spendable funds',
    'fake trusted-principal metadata on an unbacked debit still cannot create refundable trusted capacity',
    'fake trusted-principal metadata without trusted debit amount cannot create refundable capacity even when deposits exist',
    'deposit-backed legacy debits still need trusted-principal authorization before refunds can restore funds',
    'pending or invalid refund snapshots do not become trusted restorations',
    'pending refunds do not consume the original debit refund cap before completion',
    'fabricated displayed balances freeze before purchase authorization',
    'a large displayed wallet with no deposit or admin credit keeps trusted available at zero and blocks even a 1 NGN purchase',
    'honest insufficient funds decline without fraud suspension',
    'active reservations reduce trusted available funds without creating a fraud mismatch',
    'chargebacks preserve trusted principal but consume backing and leave no spendable funds',
  ],
}, null, 2))
