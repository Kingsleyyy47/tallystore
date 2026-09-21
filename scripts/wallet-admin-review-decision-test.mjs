function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const adminActors = new Set(['owner-admin'])

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isBalanceNeutralAdminRepair(entry) {
  const metadata = entry.metadata || {}
  return (
    metadata.source === 'admin-ledger-repair' ||
    String(metadata.balance_unchanged || '').toLowerCase() === 'true' ||
    String(metadata.requires_owner_evidence || '').toLowerCase() === 'true' ||
    Number(entry.balanceAfter || 0) <= Number(entry.balanceBefore || 0)
  )
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100)
}

function hasVerifiedGatewayEvidence(entry) {
  const metadata = entry.metadata || {}
  const externalPaymentId = String(entry.externalPaymentId || '').trim()
  const amount = Number(entry.amount || 0)
  if (!externalPaymentId || amount <= 0 || toCents(metadata.verified_amount_ngn) !== toCents(amount)) {
    return false
  }

  if (metadata.provider === 'ercas' || metadata.provider === 'ercaspay') {
    return entry.providerEvidence?.provider === 'ercas'
      && entry.providerEvidence.userId === entry.userId
      && toCents(entry.providerEvidence.amount) === toCents(amount)
      && [entry.providerEvidence.reference, entry.providerEvidence.transactionReference, entry.providerEvidence.ercasReference].includes(externalPaymentId)
      && normalize(entry.providerEvidence.status) === 'credited'
  }

  if (metadata.provider === 'pocketfi') {
    return entry.providerEvidence?.provider === 'pocketfi'
      && entry.providerEvidence.id === metadata.webhook_log_id
      && entry.providerEvidence.matchedUserId === entry.userId
      && entry.providerEvidence.processed === true
      && toCents(entry.providerEvidence.amount) === toCents(amount)
      && [entry.reference, externalPaymentId].filter(Boolean).includes(entry.providerEvidence.reference)
  }

  return false
}

function isTrustedPrincipalCredit(entry) {
  const type = normalize(entry.type)
  const amount = Number(entry.amount || 0)
  if (amount <= 0 || normalize(entry.status || 'completed') !== 'completed') return false

  if (['topup', 'top_up', 'wallet_topup', 'wallet_deposit', 'deposit'].includes(type)) {
    return hasVerifiedGatewayEvidence(entry)
  }

  if (type === 'admin_credit') {
    return adminActors.has(String(entry.createdBy || ''))
      && String(entry.metadata?.approved_by || '').trim() === String(entry.createdBy || '').trim()
      && String(entry.metadata?.approval_reference || '').trim().length >= 8
      && String(entry.metadata?.reason || '').trim().length >= 3
      && !isBalanceNeutralAdminRepair(entry)
  }

  return false
}

function isWalletDebit(entry) {
  return ['purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal', 'chargeback', 'correction_debit'].includes(normalize(entry.type))
}

function isRefund(entry) {
  return ['refund', 'purchase_refund', 'auto_refund'].includes(normalize(entry.type))
}

function linkedOriginalTrustedDebit(refund, trustedDebits) {
  const metadata = refund.metadata || {}
  const directId = String(metadata.source_debit_transaction_id || '').trim()
  if (directId && trustedDebits.has(directId)) return trustedDebits.get(directId)

  const sourceKey = String(metadata.source_debit_idempotency_key || metadata.original_purchase_idempotency_key || '').trim()
  if (sourceKey) {
    return [...trustedDebits.values()].find((debit) => debit.idempotencyKey && debit.idempotencyKey === sourceKey) || null
  }

  const sourceOrderId = String(metadata.source_order_id || metadata.order_id || metadata.transaction_id || '').trim()
  const sourceOrderTable = String(metadata.source_order_table || '').trim()
  if (sourceOrderId) {
    return [...trustedDebits.values()].find((debit) => {
      if (sourceOrderTable && debit.sourceOrderTable && debit.sourceOrderTable !== sourceOrderTable) return false
      return debit.sourceOrderIds.includes(sourceOrderId)
    }) || null
  }

  const originalReference = String(metadata.original_reference || '').trim()
  if (originalReference) {
    return [...trustedDebits.values()].find((debit) => debit.reference && debit.reference === originalReference) || null
  }

  return null
}

function isDepositHistoryEntry(entry) {
  const type = normalize(entry.type)
  const amount = Number(entry.amount || 0)
  if (amount <= 0) return false
  return ['topup', 'top_up', 'wallet_topup', 'deposit', 'wallet_deposit', 'admin_credit'].includes(type)
}

function displayTransactionAmount(entry) {
  const amount = Number(entry.amount || 0)
  const absoluteAmount = Math.abs(amount)
  const type = normalize(entry.type)

  if (isWalletDebit(entry)) return -absoluteAmount
  if (isRefund(entry)) return absoluteAmount
  if ([
    'topup',
    'top_up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
    'credit',
    'admin_credit',
    'staff_credit',
    'promotion_credit',
    'correction_credit',
    'referral_withdrawal',
  ].includes(type)) {
    return absoluteAmount
  }

  return amount
}

function calculateBacking(entries) {
  const completed = entries.filter((entry) => normalize(entry.status || 'completed') === 'completed')
  const trustedPrincipal = completed
    .filter(isTrustedPrincipalCredit)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const completedDebits = completed
    .filter(isWalletDebit)
    .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0)
  const trustedDebits = new Map()
  for (const entry of completed.filter(isWalletDebit)) {
    const metadata = entry.metadata || {}
    const debitId = String(entry.id || entry.transactionId || entry.idempotencyKey || '').trim()
    const trustedDebitAmount = Number(metadata.trusted_principal_debit_amount || 0)
    if (
      !debitId ||
      String(metadata.trusted_principal_authorized || '').toLowerCase() !== 'true' ||
      !Number.isFinite(trustedDebitAmount) ||
      trustedDebitAmount <= 0
    ) continue
    trustedDebits.set(debitId, {
      id: debitId,
      amount: Math.min(Math.abs(Number(entry.amount || 0)), trustedDebitAmount),
      idempotencyKey: String(entry.idempotencyKey || '').trim(),
      reference: String(entry.reference || '').trim(),
      sourceOrderTable: String(metadata.source_order_table || '').trim(),
      sourceOrderIds: [metadata.source_order_id, metadata.order_id, metadata.transaction_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    })
  }
  const completedRefunds = completed
    .filter((entry) => isRefund(entry) && Number(entry.amount || 0) > 0)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const refundedByOriginal = new Map()
  for (const refund of completed.filter((entry) => isRefund(entry) && Number(entry.amount || 0) > 0)) {
    const original = linkedOriginalTrustedDebit(refund, trustedDebits)
    if (!original) continue
    const alreadyRefunded = refundedByOriginal.get(original.id) || 0
    const eligible = Math.min(Number(refund.amount || 0), Math.max(original.amount - alreadyRefunded, 0))
    refundedByOriginal.set(original.id, alreadyRefunded + eligible)
  }
  const linkedEligibleRefunds = [...refundedByOriginal.values()].reduce((sum, amount) => sum + amount, 0)
  const trustedDebitCapacity = Math.min(completedDebits, trustedPrincipal)
  const eligibleRefunds = Math.min(linkedEligibleRefunds, trustedDebitCapacity)
  const trustedConsumedSpend = Math.max(trustedDebitCapacity - eligibleRefunds, 0)
  const backedAvailable = Math.max(trustedPrincipal - trustedConsumedSpend, 0)

  return {
    trustedPrincipal,
    completedDebits,
    completedRefunds,
    linkedEligibleRefunds,
    trustedDebitCapacity,
    eligibleRefunds,
    trustedConsumedSpend,
    backedAvailable,
  }
}

function unsuspendDecision({ reviewerIsAdmin, storedWalletBalance, entries, unresolvedSupplierOutcomes = 0 }) {
  if (!reviewerIsAdmin) return { ok: false, code: 'ADMIN_REVIEW_REQUIRED' }
  if (unresolvedSupplierOutcomes > 0) return { ok: false, code: 'SUPPLIER_OUTCOME_UNKNOWN' }

  const backing = calculateBacking(entries)
  if (Number(storedWalletBalance || 0) > backing.backedAvailable + 1) {
    return { ok: false, code: 'WALLET_REVIEW_REQUIRED', backing }
  }

  return { ok: true, code: 'UNSUSPEND_ALLOWED', backing }
}

function staffAdjustmentDecision({ requesterIsAdmin, amount }) {
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, code: 'INVALID_ADJUSTMENT_AMOUNT' }
  if (amount > 0 && !requesterIsAdmin) return { ok: true, code: 'PENDING_ADMIN_REVIEW', trustedPrincipalCreated: false }
  return {
    ok: true,
    code: amount > 0 ? 'POST_ADMIN_CREDIT' : 'POST_ADMIN_DEBIT',
    transactionType: amount > 0 ? 'admin_credit' : 'admin_debit',
    trustedPrincipalCreated: amount > 0 && requesterIsAdmin,
  }
}

function adminChargebackDecision({ requesterIsAdmin, amount, reference, existingReferences = new Set(), walletFrozen = false }) {
  const cleanReference = String(reference || '').trim()
  if (!requesterIsAdmin) return { ok: false, code: 'ADMIN_REVIEW_REQUIRED' }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'INVALID_CHARGEBACK_AMOUNT' }
  if (cleanReference.length < 3) return { ok: false, code: 'CHARGEBACK_REFERENCE_REQUIRED' }
  if (existingReferences.has(cleanReference)) return { ok: false, code: 'CHARGEBACK_ALREADY_RECORDED' }

  return {
    ok: true,
    code: 'POST_CHARGEBACK',
    transactionType: 'chargeback',
    trustedPrincipalCreated: false,
    idempotencyKey: `chargeback:customer-1:${cleanReference}`,
    walletFrozenAfter: true,
    walletFrozenBefore: walletFrozen,
  }
}

const entries = [
  {
    type: 'deposit',
    userId: 'customer-1',
    amount: 100_000,
    status: 'completed',
    externalPaymentId: 'ercas-pay-1',
    metadata: { provider: 'ercas', verified_amount_ngn: 100_000 },
    providerEvidence: {
      provider: 'ercas',
      userId: 'customer-1',
      amount: 100_000,
      status: 'credited',
      reference: 'ercas-pay-1',
    },
  },
  {
    type: 'deposit',
    userId: 'customer-1',
    amount: 500_000,
    status: 'completed',
    externalPaymentId: 'fake-pay-1',
    metadata: { provider: 'ercas', verified_amount_ngn: 500_000 },
  },
  {
    type: 'deposit',
    userId: 'customer-1',
    amount: 25_000,
    status: 'completed',
    externalPaymentId: 'pocketfi-pay-1',
    metadata: { provider: 'pocketfi', verified_amount_ngn: 25_000, webhook_log_id: 'pocketfi-log-1' },
    providerEvidence: {
      provider: 'pocketfi',
      id: 'pocketfi-log-1',
      matchedUserId: 'customer-1',
      processed: true,
      amount: 25_000,
      reference: 'pocketfi-pay-1',
    },
  },
  { type: 'deposit', amount: 500_000, status: 'completed' },
  { type: 'credit', amount: 500_000, status: 'completed' },
  { type: 'staff_credit', amount: 500_000, status: 'completed', createdBy: 'staff-user' },
  { type: 'promotion_credit', amount: 500_000, status: 'completed' },
  { type: 'admin_credit', amount: 50_000, status: 'completed', createdBy: 'staff-user', balanceBefore: 0, balanceAfter: 50_000 },
  { type: 'admin_credit', amount: 30_000, status: 'completed', createdBy: 'owner-admin', balanceBefore: 100_000, balanceAfter: 100_000, metadata: { source: 'admin-ledger-repair', balance_unchanged: 'true' } },
  { type: 'admin_credit', amount: 15_000, status: 'completed', createdBy: 'owner-admin', balanceBefore: 100_000, balanceAfter: 115_000 },
  {
    type: 'admin_credit',
    amount: 20_000,
    status: 'completed',
    createdBy: 'owner-admin',
    balanceBefore: 100_000,
    balanceAfter: 120_000,
    metadata: {
      approved_by: 'owner-admin',
      approval_reference: 'approval-admin-credit-1',
      reason: 'manual verified business credit',
    },
  },
  {
    id: 'purchase-trusted-1',
    type: 'purchase',
    amount: -40_000,
    status: 'completed',
    metadata: {
      trusted_principal_authorized: 'true',
      trusted_principal_debit_amount: 40_000,
      source_order_id: 'order-1',
      source_order_table: 'orders',
    },
  },
  {
    type: 'refund',
    amount: 15_000,
    status: 'completed',
    metadata: {
      source_debit_transaction_id: 'purchase-trusted-1',
      source_order_id: 'order-1',
      source_order_table: 'orders',
    },
  },
  { type: 'refund', amount: 999_999, status: 'completed', metadata: { note: 'loose refund must not restore trusted balance' } },
]

const backing = calculateBacking(entries)
assert(backing.trustedPrincipal === 145_000, `trusted principal was ${backing.trustedPrincipal}, expected 145000`)
assert(backing.completedDebits === 40_000, 'completed debit total was wrong')
assert(backing.completedRefunds === 1_014_999, 'completed raw refund total was wrong')
assert(backing.linkedEligibleRefunds === 15_000, 'loose refund was incorrectly treated as eligible trusted restoration')
assert(backing.backedAvailable === 120_000, `backed available was ${backing.backedAvailable}, expected 120000`)

const forgedMarkerBacking = calculateBacking([
  ...entries,
  {
    id: 'purchase-forged-marker',
    type: 'purchase',
    amount: -10_000,
    status: 'completed',
    metadata: {
      trusted_principal_authorized: 'true',
    },
  },
  {
    type: 'refund',
    amount: 10_000,
    status: 'completed',
    metadata: {
      source_debit_transaction_id: 'purchase-forged-marker',
    },
  },
])
assert(forgedMarkerBacking.completedRefunds === 1_024_999, 'forged-marker raw refund must remain visible')
assert(forgedMarkerBacking.linkedEligibleRefunds === 15_000, 'forged-marker refund was incorrectly treated as eligible trusted restoration')
assert(forgedMarkerBacking.backedAvailable === 110_000, 'forged-marker refund incorrectly restored trusted backing')

const unbackedUnsuspend = unsuspendDecision({
  reviewerIsAdmin: true,
  storedWalletBalance: 500_000,
  entries,
})
assert(!unbackedUnsuspend.ok && unbackedUnsuspend.code === 'WALLET_REVIEW_REQUIRED', 'unbacked wallet was unsuspended')

const backedUnsuspend = unsuspendDecision({
  reviewerIsAdmin: true,
  storedWalletBalance: 120_000,
  entries,
})
assert(backedUnsuspend.ok && backedUnsuspend.code === 'UNSUSPEND_ALLOWED', 'backed wallet review did not allow unsuspend')

const nonAdminUnsuspend = unsuspendDecision({
  reviewerIsAdmin: false,
  storedWalletBalance: 0,
  entries: [],
})
assert(!nonAdminUnsuspend.ok && nonAdminUnsuspend.code === 'ADMIN_REVIEW_REQUIRED', 'non-admin reviewer could unsuspend')

const unknownOutcomeUnsuspend = unsuspendDecision({
  reviewerIsAdmin: true,
  storedWalletBalance: 0,
  entries: [],
  unresolvedSupplierOutcomes: 1,
})
assert(!unknownOutcomeUnsuspend.ok && unknownOutcomeUnsuspend.code === 'SUPPLIER_OUTCOME_UNKNOWN', 'unknown supplier exposure did not block unsuspend')

const staffCreditRequest = staffAdjustmentDecision({ requesterIsAdmin: false, amount: 50_000 })
assert(staffCreditRequest.code === 'PENDING_ADMIN_REVIEW', 'staff credit request did not require admin review')
assert(staffCreditRequest.trustedPrincipalCreated === false, 'staff credit request created trusted principal before approval')

const adminCredit = staffAdjustmentDecision({ requesterIsAdmin: true, amount: 50_000 })
assert(adminCredit.code === 'POST_ADMIN_CREDIT' && adminCredit.transactionType === 'admin_credit', 'admin approved credit did not post as admin_credit')
assert(adminCredit.trustedPrincipalCreated === true, 'admin approved credit did not create trusted principal')

const adminDebit = staffAdjustmentDecision({ requesterIsAdmin: true, amount: -10_000 })
assert(adminDebit.code === 'POST_ADMIN_DEBIT' && adminDebit.transactionType === 'admin_debit', 'admin debit did not post as admin_debit')

const missingChargebackReference = adminChargebackDecision({ requesterIsAdmin: true, amount: 25_000, reference: '' })
assert(!missingChargebackReference.ok && missingChargebackReference.code === 'CHARGEBACK_REFERENCE_REQUIRED', 'chargeback without stable reference was allowed')

const invalidChargebackAmount = adminChargebackDecision({ requesterIsAdmin: true, amount: 0, reference: 'provider-reversal-1' })
assert(!invalidChargebackAmount.ok && invalidChargebackAmount.code === 'INVALID_CHARGEBACK_AMOUNT', 'zero chargeback amount was allowed')

const nonAdminChargeback = adminChargebackDecision({ requesterIsAdmin: false, amount: 25_000, reference: 'provider-reversal-1' })
assert(!nonAdminChargeback.ok && nonAdminChargeback.code === 'ADMIN_REVIEW_REQUIRED', 'non-admin chargeback was allowed')

const duplicateChargeback = adminChargebackDecision({
  requesterIsAdmin: true,
  amount: 25_000,
  reference: 'provider-reversal-1',
  existingReferences: new Set(['provider-reversal-1']),
})
assert(!duplicateChargeback.ok && duplicateChargeback.code === 'CHARGEBACK_ALREADY_RECORDED', 'duplicate chargeback reference was allowed')

const validChargeback = adminChargebackDecision({ requesterIsAdmin: true, amount: 25_000, reference: 'provider-reversal-1' })
assert(validChargeback.ok && validChargeback.transactionType === 'chargeback', 'valid chargeback did not post as chargeback')
assert(validChargeback.trustedPrincipalCreated === false, 'chargeback created trusted principal')
assert(validChargeback.walletFrozenAfter === true, 'chargeback did not freeze wallet for review')
assert(validChargeback.idempotencyKey === 'chargeback:customer-1:provider-reversal-1', 'chargeback idempotency key was not reference-bound')

assert(displayTransactionAmount({ type: 'admin_debit', amount: 789_292 }) === -789_292, 'positive stored admin_debit rendered as credit')
assert(displayTransactionAmount({ type: 'staff_debit', amount: 10_000 }) === -10_000, 'positive stored staff_debit rendered as credit')
assert(displayTransactionAmount({ type: 'purchase', amount: -5_000 }) === -5_000, 'negative purchase did not render as debit')
assert(displayTransactionAmount({ type: 'chargeback', amount: 25_000 }) === -25_000, 'chargeback did not render as a debit')
assert(displayTransactionAmount({ type: 'admin_credit', amount: 20_000 }) === 20_000, 'admin_credit did not render as credit')
assert(isDepositHistoryEntry({ type: 'admin_credit', amount: 20_000 }) === true, 'approved admin_credit should stay visible in funding history')
assert(isDepositHistoryEntry({ type: 'credit', amount: 500_000 }) === false, 'generic credit should not be labelled as a deposit')
assert(isDepositHistoryEntry({ type: 'staff_credit', amount: 500_000 }) === false, 'staff_credit should not be labelled as a deposit')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'verified gateway deposits and approved admin credits create trusted principal',
    'generic, staff, promotion, unapproved admin, and balance-neutral repair credits are excluded',
    'refunds restore previous trusted debit capacity without becoming principal',
    'unbacked wallets cannot be unsuspended by balance editing',
    'non-admin reviewers cannot unsuspend financial holds',
    'unknown supplier outcomes block reinstatement',
    'staff credit requests queue for admin review and do not create trusted principal',
    'admin approved credits post as admin_credit and admin debits post as admin_debit',
    'manual admin chargebacks require admin, positive amount, stable reference, and duplicate-reference rejection',
    'manual admin chargebacks post as chargeback, do not create trusted principal, and freeze wallet review',
    'admin and staff debits render negative even when stored with positive amounts',
    'chargebacks render negative even when stored with positive amounts',
    'generic and staff credits are not labelled as deposit history',
  ],
  backing,
}, null, 2))
