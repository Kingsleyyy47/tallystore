function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeTransactionType(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

const debitTransactionTypes = new Set([
  'purchase',
  'admin_debit',
  'staff_debit',
  'debit',
  'withdrawal',
  'chargeback',
  'correction_debit',
])

const depositTransactionTypes = new Set([
  'topup',
  'top_up',
  'wallet_topup',
  'wallet_deposit',
  'deposit',
])

const creditTransactionTypes = new Set([
  'topup',
  'top_up',
  'wallet_topup',
  'wallet_deposit',
  'deposit',
  'refund',
  'purchase_refund',
  'auto_refund',
  'admin_credit',
  'staff_credit',
  'promotion_credit',
  'correction_credit',
  'referral_withdrawal',
])

const refundTransactionTypes = new Set([
  'refund',
  'purchase_refund',
  'auto_refund',
])

function getTransactionSignedAmount(transaction) {
  const amount = Number(transaction.amount || 0)
  const absoluteAmount = Math.abs(amount)
  const type = normalizeTransactionType(transaction.type)

  if (debitTransactionTypes.has(type)) return -absoluteAmount
  if (creditTransactionTypes.has(type)) return absoluteAmount
  return amount
}

function classifyWalletTab(transaction) {
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

function getWalletTransactionTitle(transaction) {
  const kind = classifyWalletTab(transaction)
  const type = normalizeTransactionType(transaction.type)
  if (depositTransactionTypes.has(type)) return 'Wallet top-up'
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

function dashboardActivity(transaction) {
  const amount = getTransactionSignedAmount(transaction)
  const isCredit = amount > 0
  const isDebit = amount < 0
  return {
    amount,
    title: getWalletTransactionTitle(transaction),
    tone: isCredit ? 'credit' : isDebit || debitTransactionTypes.has(normalizeTransactionType(transaction.type)) ? 'debit' : 'neutral',
    sign: isCredit ? '+' : isDebit || debitTransactionTypes.has(normalizeTransactionType(transaction.type)) ? '-' : '',
  }
}

function calculateTotalDeposits(transactions) {
  return transactions
    .filter((transaction) => depositTransactionTypes.has(normalizeTransactionType(transaction.type)) && ['completed', 'success'].includes(String(transaction.status || '').toLowerCase()))
    .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0)
}

assert(getTransactionSignedAmount({ type: 'admin_debit', amount: 789_292 }) === -789_292, 'positive stored admin_debit displayed as credit')
assert(getTransactionSignedAmount({ type: 'staff_debit', amount: 10_000 }) === -10_000, 'positive stored staff_debit displayed as credit')
assert(getTransactionSignedAmount({ type: 'chargeback', amount: 25_000 }) === -25_000, 'positive stored chargeback displayed as credit')
assert(getTransactionSignedAmount({ type: 'refund', amount: -7_360 }) === 7_360, 'negative stored refund did not display as restoration')
assert(getTransactionSignedAmount({ type: 'admin_credit', amount: -20_000 }) === 20_000, 'negative stored admin_credit did not display as credit')
assert(getWalletTransactionTitle({ type: 'wallet_deposit', amount: 20_000 }) === 'Wallet top-up', 'deposit row was not labelled as top-up')
assert(getWalletTransactionTitle({ type: 'admin_credit', amount: 20_000 }) === 'Admin credit', 'admin_credit was not labelled separately from top-ups')
assert(getWalletTransactionTitle({ type: 'staff_credit', amount: 20_000 }) === 'Staff credit', 'staff_credit was not labelled separately from top-ups')
assert(getWalletTransactionTitle({ type: 'promotion_credit', amount: 20_000 }) === 'Promotion credit', 'promotion_credit was not labelled separately from top-ups')
assert(getWalletTransactionTitle({ type: 'correction_credit', amount: 20_000 }) === 'Correction credit', 'correction_credit was not labelled separately from top-ups')
assert(getWalletTransactionTitle({ type: 'referral_withdrawal', amount: 20_000 }) === 'Referral transfer', 'referral transfer was not labelled separately from top-ups')

assert(classifyWalletTab({ type: 'admin_debit', amount: 789_292 }) === 'purchase', 'wallet page did not classify admin_debit as spend')
assert(classifyWalletTab({ type: 'staff_debit', amount: 10_000 }) === 'purchase', 'wallet page did not classify staff_debit as spend')
assert(classifyWalletTab({ type: 'refund', amount: -7_360 }) === 'restoration', 'wallet page did not keep refund restoration separate from deposits and purchases')
assert(classifyWalletTab({ type: 'wallet_deposit', amount: 20_000 }) === 'funding', 'wallet page did not classify deposit as funding')
assert(
  calculateTotalDeposits([
    { type: 'wallet_deposit', amount: 20_000, status: 'completed' },
    { type: 'refund', amount: -7_360, status: 'completed' },
    { type: 'admin_credit', amount: 50_000, status: 'completed' },
    { type: 'staff_credit', amount: 10_000, status: 'completed' },
  ]) === 20_000,
  'wallet total deposits included refunds or non-deposit credits',
)

const dashboardDebit = dashboardActivity({ type: 'admin_debit', amount: 789_292, description: 'Admin adjustment' })
assert(dashboardDebit.amount === -789_292, 'dashboard admin_debit amount is not signed negative')
assert(dashboardDebit.tone === 'debit', 'dashboard admin_debit tone is not debit')
assert(dashboardDebit.sign === '-', 'dashboard admin_debit sign is not negative')

const dashboardRefund = dashboardActivity({ type: 'refund', amount: -7_360, description: 'Auto-refund' })
assert(dashboardRefund.amount === 7_360, 'dashboard refund amount is not signed positive')
assert(dashboardRefund.tone === 'credit', 'dashboard refund tone is not credit')
assert(dashboardRefund.sign === '+', 'dashboard refund sign is not positive')
assert(dashboardRefund.title === 'Refund restoration', 'dashboard refund title should not be labelled as wallet top-up')
const dashboardAdminCredit = dashboardActivity({ type: 'admin_credit', amount: 20_000, description: 'Admin credit' })
assert(dashboardAdminCredit.title === 'Admin credit', 'dashboard admin credit should not be labelled as wallet top-up')

const dashboardNeutral = dashboardActivity({ type: 'unknown', amount: 0, description: 'No-op' })
assert(dashboardNeutral.tone === 'neutral', 'dashboard zero unknown transaction should be neutral')
assert(dashboardNeutral.sign === '', 'dashboard neutral transaction should not show a plus or minus sign')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'customer wallet history renders typed admin/staff/chargeback debits as negative even when stored positive',
    'customer wallet history keeps refund restorations separate from deposits even when legacy rows are stored negative',
    'customer wallet total deposits excludes refund restorations and non-deposit credits',
    'customer wallet titles keep admin, staff, promotion, correction, and referral credits separate from top-ups',
    'dashboard recent activity labels refunds as restorations, not top-ups',
    'dashboard recent activity labels admin credits as admin credits, not top-ups',
    'dashboard recent activity derives tone and sign from typed signed amount instead of raw amount positivity',
    'neutral zero-value rows do not render fake debit signs',
  ],
}, null, 2))
