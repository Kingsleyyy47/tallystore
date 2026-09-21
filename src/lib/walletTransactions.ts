export type WalletTransactionKind = 'funding' | 'purchase' | 'withdrawal' | 'restoration'

export type WalletTransactionLike = {
  type?: unknown
  amount?: unknown
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

export const getTransactionSignedAmount = (transaction: WalletTransactionLike) => {
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
