import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf("        const role = profile.is_admin ? 'admin' : profile.is_staff ? 'staff' : 'customer'")
const end = source.indexOf('        if (!reviewType) continue', start)
assert(start >= 0 && end > start, 'canonical Fraud Review classification must be present')

const code = ts.transpileModule(`
function classify(profile) {
  const truth = profile.truth;
  const duplicateTopupReferences = profile.duplicateTopupReferences || [];
  ${source.slice(start, end)}
  return { reviewType, reason, role, netSpend, exposure, trustedAvailable: truth.confirmed_spendable };
}
globalThis.classify = classify;
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const context = { formatAdminNaira: (amount) => `₦${amount}` }
runInNewContext(code, context)

const baseTruth = {
  trusted_principal: 0, completed_debits: 0, eligible_refunds: 0,
  net_consumed_spend: 0, spend_exposure: 0, quarantined_excess: 0,
  trusted_book_balance: 0, stored_wallet_balance: 0,
  unexplained_difference: 0, confirmed_spendable: 0,
  evidence_complete: true, integrity_status: 'consistent',
  spending_blocked: false,
}
const profile = (truth, overrides = {}) => ({
  account_suspended: false, wallet_review_required: false,
  is_staff: false, is_admin: false,
  duplicateTopupReferences: [],
  truth: { ...baseTruth, ...truth }, ...overrides,
})

const excess = context.classify(profile({
  trusted_principal: 70000, stored_wallet_balance: 100000,
  trusted_book_balance: 70000, confirmed_spendable: 70000,
  quarantined_excess: 30000, integrity_status: 'quarantined_excess',
}))
assert.equal(excess.reviewType, 'quarantined_excess')
assert.equal(excess.trustedAvailable, 70000, 'positive excess must not erase backed spendable funds')
assert.equal(excess.exposure, 30000)
assert.equal(excess.reason.includes('quarantined'), true)

const zero = context.classify(profile({
  stored_wallet_balance: 500000, quarantined_excess: 500000,
  integrity_status: 'quarantined_excess',
}))
assert.equal(zero.reviewType, 'quarantined_excess')
assert.equal(zero.trustedAvailable, 0)

assert.equal(context.classify(profile({ integrity_status: 'payment_identity_conflict' })).reviewType, 'duplicate_deposit')
assert.match(source, /fraudReviewFilter === 'excess' && row\.reviewType === 'quarantined_excess'/)
assert.match(source, /row\.truth\.spending_blocked \? 'blocked' : 'permitted up to confirmed spendable'/)
assert.match(source, /fraudFilterCounts\.duplicate}<\/p>\s*<p className="text-xs text-muted-foreground">Payment conflicts/)
assert.match(source, /fraudReviewFilter === 'unblock' && row\.truth\.spending_blocked/)
assert.match(source, /fraudReviewFilter === 'review' && row\.walletReviewRequired/)
assert.match(source, /unblock: fraudRows\.filter\(row => row\.truth\.spending_blocked\)\.length/)
assert.match(source, /review: fraudRows\.filter\(row => row\.walletReviewRequired\)\.length/)
assert.match(source, /Spending blocked/)
assert.match(source, /\['unblock', 'Holds'\]/)
assert.match(source, /\['review', 'Review flags'\]/)
const reviewOnly = context.classify(profile(baseTruth, { wallet_review_required: true }))
assert.equal(reviewOnly.reviewType, 'review_unblock')
assert.match(reviewOnly.reason, /backed funds are spendable/)
const blockedReview = context.classify(profile({ spending_blocked: true }, { wallet_review_required: true }))
assert.match(blockedReview.reason, /spending hold remains/)
assert.equal(context.classify(profile(baseTruth)).reviewType, null)
const sharedIdentity = context.classify(profile(baseTruth, {
  duplicateTopupReferences: ['same-payment-on-two-wallets'],
}))
assert.equal(sharedIdentity.reviewType, 'duplicate_deposit')
assert.match(sharedIdentity.reason, /does not block spending/)
assert.match(source, /fraudReviewFilter === 'duplicate' && \(row\.reviewType === 'duplicate_deposit' \|\| row\.duplicateTopupReferences\.length > 0\)/)
assert.equal(context.classify(profile({
  trusted_principal: 300000, completed_debits: 299000,
  net_consumed_spend: 299000, stored_wallet_balance: 1000,
})).reviewType, 'watchlist')
assert.equal(context.classify(profile({
  trusted_principal: 300000, completed_debits: 299000,
  net_consumed_spend: 299000, stored_wallet_balance: 1000,
}, { is_staff: true })).reviewType, null, 'staff accounts must not receive a customer watchlist classification')
assert.equal(context.classify(profile({ integrity_status: 'quarantined_excess' }, { is_admin: true })).role, 'admin')

assert.match(source, /getAdminWalletFinancialTruthPage\(afterUserId\)/)
const loaderStart = source.indexOf('  const loadFraudReview = useCallback')
const loaderEnd = source.indexOf('  useEffect(() => {', loaderStart)
assert.doesNotMatch(source.slice(loaderStart, loaderEnd),
  /\.from\(['"](?:pending_payments|pocketfi_webhook_logs|transactions)['"]\)/)
assert.match(source, /setFraudRows\(\[\]\)\s+setFraudLastLoadedAt\(null\)/)
assert.match(source, /fraudError \? null : fraudLoading \|\| !fraudLastLoadedAt/)
assert.doesNotMatch(source, /can purchase again\./, 'clearing an account suspension does not guarantee wallet authorization')
assert.equal((source.match(/Wallet review and confirmed funds still govern purchases\./g) || []).length, 2)

console.log('Fraud Review canonical classification checks passed (no database execution).')
