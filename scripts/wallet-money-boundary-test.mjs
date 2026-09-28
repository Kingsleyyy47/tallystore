import { readFileSync } from 'node:fs'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'
import { sameBillsRequest } from '../supabase/functions/_shared/bills-idempotency.mjs'
import { sameBitrefillRequest } from '../supabase/functions/_shared/bitrefill-idempotency.mjs'
import { canonicalCryptoAmount, sameCryptoTopupRequest } from '../supabase/functions/_shared/crypto-topup-request.mjs'

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

const billsSource = readFileSync(new URL('../supabase/functions/purchase-bills/index.ts', import.meta.url), 'utf8')
const existingBill = {
  transaction_type: 'data', amount: '1000.00', service_provider: 'MTN',
  service_code: 'PLAN-1', beneficiary_phone: '08012345678', payment_source: 'wallet',
}
assert(sameBillsRequest(existingBill, { ...existingBill, amount: 1000 }),
  'same bills request should be a safe idempotent retry')
for (const changed of [
  { amount: 999.5 }, { transaction_type: 'airtime' }, { service_provider: 'GLO' },
  { service_code: 'PLAN-2' }, { beneficiary_phone: '08012345679' },
  { payment_source: 'crypto' },
]) {
  assert(!sameBillsRequest(existingBill, { ...existingBill, ...changed }),
    `changed bills request was accepted as a retry: ${JSON.stringify(changed)}`)
}
assert(billsSource.includes('const clientAmountMinor = ngnMinorUnits(amount);'), 'bills route must parse client amount exactly')
assert(billsSource.includes('if (!sameBillsRequest(existingTransaction, {'),
  'bills route must compare retries with the stored purchase terms')
assert(billsSource.includes('status: 409'), 'bills route must conflict on mismatched idempotency reuse')
assert(billsSource.includes('const liveAmountMinor = ngnMinorUnits(livePlan?.price);'), 'bills route must parse provider plan price exactly')
assert(billsSource.includes('if (clientAmountMinor !== liveAmountMinor)'), 'bills route must require exact provider-price match')
assert(billsSource.includes('purchaseAmount = liveAmountMinor / 100;'), 'bills debit must derive from matched provider price')
assert(!billsSource.includes('Math.round(purchaseAmount)') && !billsSource.includes('parseFloat(amount)'),
  'bills route must not round or loosely parse a browser amount')
assert(ngnMinorUnits('1000.00') === ngnMinorUnits(1000), 'equivalent NGN values should match in minor units')
for (const value of [999.5, 1000.5, '1000garbage', '1000.000', '1e3']) {
  assert(ngnMinorUnits(value) !== ngnMinorUnits(1000), `bills price mismatch ${String(value)} was accepted`)
}

const bitrefillSource = readFileSync(new URL('../supabase/functions/purchase-bitrefill/index.ts', import.meta.url), 'utf8')
const existingGiftOrder = {
  product_id: 'GIFT-1', product_name: 'Gift Card', package_id: null,
  quantity: 2, recipient_phone: null, amount_ngn: 4500, amount_original: 20,
  payment_source: 'wallet',
}
const giftRequest = {
  product_id: 'GIFT-1', product_name: 'Gift Card', package_id: null,
  quantity: 2, recipient_phone: null, expected_amount_ngn: '4500.00',
  value: '10.00', payment_source: 'wallet',
}
assert(sameBitrefillRequest(existingGiftOrder, giftRequest), 'same gift-card request should be a safe retry')
for (const changed of [
  { product_id: 'GIFT-2' }, { product_name: 'Other' }, { package_id: 'PKG-2' },
  { quantity: 3 }, { recipient_phone: '08012345678' }, { expected_amount_ngn: 4501 },
  { value: '11.00' }, { value: '10garbage' }, { payment_source: 'crypto' },
]) {
  assert(!sameBitrefillRequest(existingGiftOrder, { ...giftRequest, ...changed }),
    `changed gift-card request was accepted as a retry: ${JSON.stringify(changed)}`)
}
assert(bitrefillSource.includes('if (!sameBitrefillRequest(existingOrder, {'),
  'gift-card route must compare retries with stored order terms')
assert(bitrefillSource.includes('const denominationMinor = ngnMinorUnits(value);'),
  'gift-card flexible denominations must be parsed exactly')
assert(!bitrefillSource.includes('parseFloat(value)'), 'gift-card route must not loosely parse denominations')

const cryptoSource = readFileSync(new URL('../supabase/functions/create-crypto-sell-order/index.ts', import.meta.url), 'utf8')
assert(canonicalCryptoAmount('0.02500') === '0.025', 'crypto decimal canonicalization changed the amount')
for (const value of ['0', '-1', '1garbage', '1e3', '0.0000000000000000001']) {
  assert(canonicalCryptoAmount(value) === null, `invalid crypto amount ${value} was accepted`)
}
const existingCrypto = {
  crypto_type: 'BTC', crypto_amount: '0.02500000', nowpayments_network: 'bitcoin',
  transaction_type: 'sell', payment_provider: 'nowpayments',
}
assert(sameCryptoTopupRequest(existingCrypto, { crypto_type: 'btc', crypto_amount: 0.025 }),
  'same crypto top-up must be a safe retry even when the provider supplied a network')
for (const changed of [
  { crypto_type: 'ETH' }, { crypto_amount: '0.026' }, { network: 'other-network' },
  { crypto_amount: '0.025junk' },
]) {
  assert(!sameCryptoTopupRequest(existingCrypto, { crypto_type: 'BTC', crypto_amount: 0.025, ...changed }),
    `changed crypto top-up was accepted as a retry: ${JSON.stringify(changed)}`)
}
assert(!sameCryptoTopupRequest({ ...existingCrypto, transaction_type: 'buy' },
  { crypto_type: 'BTC', crypto_amount: 0.025 }), 'other crypto transaction type was accepted')
assert(cryptoSource.includes('crypto-topup:${supabaseUrl}:${user.id}:${safeIdempotencyKey}'),
  'new crypto references must bind project and authenticated user')
assert(cryptoSource.includes(".in('payment_reference', [orderReference, legacyReference])"),
  'crypto retries must recognize legacy references without creating another provider order')
assert(cryptoSource.includes('if (!sameCryptoTopupRequest(existingPayment, {'),
  'crypto retries must bind the requested payment terms')
assert(!cryptoSource.includes('parseFloat(crypto_amount)'), 'crypto amount must not be loosely parsed')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'zero, negative, NaN, and infinite amounts are rejected before posting',
    'over-precise and oversized amounts are rejected',
    'ambiguous string and exponent-style amounts are rejected at JSON boundaries',
    'currency codes must be uppercase alphabetic 3 to 8 characters',
    'debit rows are signed internally from positive input',
    'database-style constraints allow debt balances but reject invalid money precision and currency',
    'data-plan purchases compare exact provider and client minor units before charging the server price',
    'bills idempotency keys reject changes to price, product, recipient, provider, or payment source',
    'gift-card idempotency keys reject changed order terms and malformed flexible denominations',
    'crypto top-up retries bind project, user, currency, amount, and requested network while recognizing legacy references',
  ],
}, null, 2))
