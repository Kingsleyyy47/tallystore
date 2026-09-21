const MAX_NAIRA = 1_000_000_000
const VALID_BALANCE_TYPES = new Set(['wallet', 'crypto', 'referral'])
const CREDIT_TYPES = new Set([
  'topup',
  'top_up',
  'top-up',
  'wallet_topup',
  'wallet_deposit',
  'deposit',
  'admin_credit',
  'staff_credit',
  'refund',
  'purchase_refund',
  'auto_refund',
  'referral_withdrawal',
  'referral_credit',
  'promotion_credit',
  'correction_credit',
])
const DEBIT_TYPES = new Set([
  'purchase',
  'admin_debit',
  'staff_debit',
  'debit',
  'chargeback',
  'withdrawal',
  'correction_debit',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeAmount(value) {
  if (typeof value === 'bigint') return { ok: false, code: 'UNSUPPORTED_AMOUNT_TYPE' }
  if (typeof value === 'string' && value.trim() !== String(Number(value))) {
    return { ok: false, code: 'MALFORMED_AMOUNT' }
  }
  const amount = Number(value)
  if (!Number.isFinite(amount)) return { ok: false, code: 'INVALID_AMOUNT' }
  if (amount <= 0) return { ok: false, code: 'AMOUNT_MUST_BE_POSITIVE' }
  if (Math.round(amount * 100) !== amount * 100) return { ok: false, code: 'AMOUNT_PRECISION_INVALID' }
  if (amount > MAX_NAIRA) return { ok: false, code: 'AMOUNT_TOO_LARGE' }
  return { ok: true, amount }
}

function validateCurrency(value = 'NGN') {
  const currency = String(value || 'NGN').trim().toUpperCase()
  if (!/^[A-Z]{3,8}$/.test(currency)) return { ok: false, code: 'INVALID_CURRENCY' }
  return { ok: true, currency }
}

function validateWalletTransaction({ type, amount, currency = 'NGN', balanceType = 'wallet' }) {
  const normalizedType = String(type || '').trim().toLowerCase()
  const amountResult = normalizeAmount(amount)
  if (!amountResult.ok) return amountResult

  const currencyResult = validateCurrency(currency)
  if (!currencyResult.ok) return currencyResult

  if (!VALID_BALANCE_TYPES.has(balanceType)) return { ok: false, code: 'INVALID_BALANCE_TYPE' }
  if (CREDIT_TYPES.has(normalizedType)) {
    return { ok: true, signedAmount: amountResult.amount, currency: currencyResult.currency }
  }
  if (DEBIT_TYPES.has(normalizedType)) {
    return { ok: true, signedAmount: -amountResult.amount, currency: currencyResult.currency }
  }
  return { ok: false, code: 'UNSUPPORTED_TRANSACTION_TYPE' }
}

function dbConstraintAllowsTransaction({ amount, currency }) {
  return (
    Number.isFinite(amount) &&
    amount !== 0 &&
    Math.round(amount * 100) === amount * 100 &&
    Math.abs(amount) <= MAX_NAIRA &&
    typeof currency === 'string' &&
    currency === currency.toUpperCase() &&
    /^[A-Z]{3,8}$/.test(currency)
  )
}

function dbConstraintAllowsBalance(value) {
  return (
    value == null ||
    (
      Number.isFinite(value) &&
      Math.round(value * 100) === value * 100 &&
      Math.abs(value) <= MAX_NAIRA
    )
  )
}

function expectCode(input, code, message) {
  const result = validateWalletTransaction(input)
  assert(!result.ok && result.code === code, `${message}: expected ${code}, got ${result.code}`)
}

for (const value of [0, -1, '-50', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  expectCode({ type: 'topup', amount: value }, value === 0 || value === -1 || value === '-50' ? 'AMOUNT_MUST_BE_POSITIVE' : 'INVALID_AMOUNT', `invalid amount ${String(value)} was accepted`)
}

for (const value of [1.001, '25.123', 0.009]) {
  expectCode({ type: 'topup', amount: value }, 'AMOUNT_PRECISION_INVALID', `over-precise amount ${String(value)} was accepted`)
}

for (const value of [1_000_000_000.01, '1000000001']) {
  expectCode({ type: 'topup', amount: value }, 'AMOUNT_TOO_LARGE', `oversized amount ${String(value)} was accepted`)
}

for (const value of ['1e6', '0x10', '001']) {
  expectCode({ type: 'topup', amount: value }, 'MALFORMED_AMOUNT', `ambiguous string amount ${String(value)} was accepted`)
}

for (const currency of ['ng', 'NGN1', 'NGN-TEST', 'TOO-LONG-CODE']) {
  expectCode({ type: 'topup', amount: 100, currency }, 'INVALID_CURRENCY', `bad currency ${String(currency)} was accepted`)
}

expectCode({ type: 'topup', amount: 100, balanceType: 'savings' }, 'INVALID_BALANCE_TYPE', 'bad balance type was accepted')
expectCode({ type: 'mint_money', amount: 100 }, 'UNSUPPORTED_TRANSACTION_TYPE', 'unsupported transaction type was accepted')

const credit = validateWalletTransaction({ type: 'admin_credit', amount: 10_000, currency: 'ngn' })
assert(credit.ok && credit.signedAmount === 10_000 && credit.currency === 'NGN', 'valid credit did not normalize as positive NGN')

const debit = validateWalletTransaction({ type: 'purchase', amount: 10_000, currency: 'NGN' })
assert(debit.ok && debit.signedAmount === -10_000, 'valid debit did not sign internally as negative')

assert(validateWalletTransaction({ type: 'purchase', amount: -10_000 }).code === 'AMOUNT_MUST_BE_POSITIVE', 'negative debit input was accepted instead of internally signing a positive amount')
assert(validateWalletTransaction({ type: 'purchase', amount: 10_000.01 }).ok, 'valid minor-unit purchase was rejected')
assert(dbConstraintAllowsTransaction({ amount: -10_000, currency: 'NGN' }), 'DB constraint should allow signed debit ledger amount')
assert(!dbConstraintAllowsTransaction({ amount: 0, currency: 'NGN' }), 'DB constraint allowed zero transaction amount')
assert(!dbConstraintAllowsTransaction({ amount: 10.001, currency: 'NGN' }), 'DB constraint allowed over-precise amount')
assert(!dbConstraintAllowsTransaction({ amount: 10, currency: 'ngn' }), 'DB constraint allowed lowercase currency')
assert(dbConstraintAllowsBalance(null), 'DB balance constraint should allow null legacy balance')
assert(dbConstraintAllowsBalance(-2500.25), 'DB balance constraint should allow negative debt/review balance')
assert(!dbConstraintAllowsBalance(10.001), 'DB balance constraint allowed over-precise balance')
assert(!dbConstraintAllowsBalance(1_000_000_000.01), 'DB balance constraint allowed oversized balance')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'zero, negative, NaN, and infinite amounts are rejected before posting',
    'over-precise and oversized amounts are rejected',
    'ambiguous string and exponent-style amounts are rejected at JSON boundaries',
    'currency codes must be uppercase alphabetic 3 to 8 characters',
    'debit rows are signed internally from positive input',
    'database-style constraints allow debt balances but reject invalid money precision and currency',
  ],
}, null, 2))
