function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseAdminDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatAdminAbsoluteDateTime(value, timeZone = 'UTC') {
  const parsed = parseAdminDate(value)
  if (!parsed) return 'Unknown'
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(parsed)
  return `${formatted} (${timeZone})`
}

function formatAdminDateWithRelative(value, now = new Date('2026-09-19T12:00:00Z'), timeZone = 'UTC') {
  const parsed = parseAdminDate(value)
  if (!parsed) return 'Unknown'
  const deltaSeconds = Math.round((now.getTime() - parsed.getTime()) / 1000)
  const suffix = deltaSeconds >= 0 ? 'ago' : 'from now'
  const absSeconds = Math.abs(deltaSeconds)
  const relative = absSeconds < 60
    ? `${absSeconds} seconds ${suffix}`
    : absSeconds < 3600
      ? `${Math.round(absSeconds / 60)} minutes ${suffix}`
      : absSeconds < 86400
        ? `${Math.round(absSeconds / 3600)} hours ${suffix}`
        : `${Math.round(absSeconds / 86400)} days ${suffix}`
  return `${formatAdminAbsoluteDateTime(value, timeZone)} · ${relative}`
}

function normalizeLedgerText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isWalletSpendTransaction(tx) {
  return [
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'withdrawal',
    'chargeback',
    'correction_debit',
  ].includes(normalizeLedgerText(tx.type))
}

function isWalletRefundTransaction(tx) {
  return ['refund', 'purchase_refund', 'auto_refund'].includes(normalizeLedgerText(tx.type))
}

function getWalletTransactionDisplayAmount(tx) {
  const amount = Number(tx.amount || 0)
  const absoluteAmount = Math.abs(amount)
  const type = normalizeLedgerText(tx.type)
  if (isWalletSpendTransaction(tx)) return -absoluteAmount
  if (isWalletRefundTransaction(tx)) return absoluteAmount
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
  ].includes(type)) return absoluteAmount
  return amount
}

const joined = formatAdminDateWithRelative('2026-09-18T12:00:00Z')
assert(joined.includes('Sep'), 'absolute date must include calendar date')
assert(joined.includes('(UTC)'), 'absolute date must include timezone')
assert(joined.includes('1 days ago'), 'date label must include relative age')
assert(joined.includes(' · '), 'date label must separate absolute and relative timestamp')

const future = formatAdminDateWithRelative('2026-09-20T12:00:00Z')
assert(future.includes('1 days from now'), 'future dates must not be mislabeled as past')
assert(formatAdminDateWithRelative('not-a-date') === 'Unknown', 'invalid dates must render Unknown')

assert(getWalletTransactionDisplayAmount({ type: 'admin_debit', amount: 789_292 }) === -789_292, 'admin_debit must display as a debit even when stored positive')
assert(getWalletTransactionDisplayAmount({ type: 'staff_debit', amount: -5_000 }) === -5_000, 'staff_debit must remain negative when stored negative')
assert(getWalletTransactionDisplayAmount({ type: 'refund', amount: -7_360 }) === 7_360, 'refund must display as restoration')
assert(getWalletTransactionDisplayAmount({ type: 'admin_credit', amount: -20_000 }) === 20_000, 'admin_credit must display as credit/restoration')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'admin user detail dates include absolute timestamp, timezone, and relative age',
    'future and invalid dates do not produce contradictory past labels',
    'admin_debit and staff_debit display as negative debits even when stored positive',
    'refund and approved credit rows display as positive restorations',
  ],
}, null, 2))
