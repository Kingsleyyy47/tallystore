export type WalletTransactionKind = 'funding' | 'purchase' | 'withdrawal' | 'restoration'

export type WalletTransactionLike = {
  type?: unknown
  amount?: unknown
  balance_before?: unknown
  balance_after?: unknown
  metadata?: unknown
}

export const normalizeTransactionType = (value?: unknown) =>
  String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')

export const debitTransactionTypes = new Set([
  'purchase',
  'admin_debit',
  'staff_debit',
  'debit',
  'withdrawal',
  'chargeback',
  'correction_debit',
])

export const depositTransactionTypes = new Set([
  'topup',
  'top_up',
  'wallet_topup',
  'wallet_deposit',
  'deposit',
])

export const creditTransactionTypes = new Set([
  ...depositTransactionTypes,
  'refund',
  'purchase_refund',
  'auto_refund',
  'admin_credit',
  'staff_credit',
  'promotion_credit',
  'correction_credit',
  'referral_withdrawal',
])

export const refundTransactionTypes = new Set([
  'refund',
  'purchase_refund',
  'auto_refund',
])

export const isDebitTransactionType = (value?: unknown) =>
  debitTransactionTypes.has(normalizeTransactionType(value))

export const isDepositTransactionType = (value?: unknown) =>
  depositTransactionTypes.has(normalizeTransactionType(value))

export const isRefundTransactionType = (value?: unknown) =>
  refundTransactionTypes.has(normalizeTransactionType(value))

export const isBalanceNeutralLedgerEvidence = (transaction: WalletTransactionLike) => {
  const type = String(transaction.type || '').toLowerCase()
  const metadata = transaction.metadata
  if ((type !== 'admin_credit' && type !== 'correction_credit') ||
      !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      transaction.balance_before == null || transaction.balance_after == null ||
      !Number.isFinite(Number(transaction.balance_before)) ||
      !Number.isFinite(Number(transaction.balance_after))) return false
  const markers = metadata as Record<string, unknown>
  return Number(transaction.amount) > 0 &&
    Number(transaction.balance_before) === Number(transaction.balance_after) &&
    markers.source === 'admin-ledger-repair' &&
    String(markers.balance_unchanged) === 'true' &&
    String(markers.requires_owner_evidence) === 'true'
}

export const getTransactionSignedAmount = (transaction: WalletTransactionLike) => {
  if (isBalanceNeutralLedgerEvidence(transaction)) return 0
  const amount = Number(transaction.amount || 0)
  const absoluteAmount = Math.abs(amount)
  const type = normalizeTransactionType(transaction.type)

  if (debitTransactionTypes.has(type)) return -absoluteAmount
  if (creditTransactionTypes.has(type)) return absoluteAmount
  return amount
}

export const classifyWalletTransaction = (transaction: WalletTransactionLike): WalletTransactionKind => {
  const type = normalizeTransactionType(transaction.type)
  if (type.includes('withdraw')) return 'withdrawal'
  if (refundTransactionTypes.has(type)) return 'restoration'
  if (
    debitTransactionTypes.has(type) ||
    type.includes('purchase') ||
    type.includes('order') ||
    getTransactionSignedAmount(transaction) < 0
  ) {
    return 'purchase'
  }
  return 'funding'
}

export const getWalletTransactionTitle = (transaction: WalletTransactionLike) => {
  if (isBalanceNeutralLedgerEvidence(transaction)) return 'Ledger repair (no balance change)'
  const kind = classifyWalletTransaction(transaction)
  const type = normalizeTransactionType(transaction.type)
  if (isDepositTransactionType(type)) return 'Wallet top-up'
  if (type === 'admin_credit') return 'Admin credit'
  if (type === 'staff_credit') return 'Staff credit'
  if (type === 'promotion_credit') return 'Promotion credit'
  if (type === 'correction_credit') return 'Correction credit'
  if (type === 'referral_withdrawal') return 'Referral transfer'
  if (kind === 'funding') return 'Wallet credit'
  if (kind === 'restoration') return 'Refund restoration'
  if (kind === 'withdrawal') return 'Withdrawal'
  return 'Purchase'
}
