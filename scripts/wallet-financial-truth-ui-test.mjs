import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const page = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const customerWallet = readFileSync(new URL('../src/pages/WalletPage.tsx', import.meta.url), 'utf8')
const truthMigration = readFileSync(new URL('../supabase/migrations/20260924006000_wallet_financial_truth.sql', import.meta.url), 'utf8')
const fraudStart = page.indexOf('  const loadFraudReview = useCallback(async () => {')
const fraudEnd = page.indexOf('  useEffect(() => {', fraudStart)
assert(fraudStart >= 0 && fraudEnd > fraudStart, 'Fraud Review loader exists')
const fraud = page.slice(fraudStart, fraudEnd)

assert.match(fraud, /getAdminWalletFinancialTruthPage\(afterUserId\)/)
assert.match(fraud, /getAdminCrossWalletPaymentConflictsPage\(afterPaymentIdentity\)/)
assert.match(fraud, /duplicateRefsByUser\.get\(profile\.user_id\)/)
assert.match(fraud, /while \(true\)/)
assert.match(fraud, /afterUserId = page\[page\.length - 1\]\.user_id/)
assert.match(fraud, /if \(page\.length < 100\) break/)
assert.match(fraud, /setFraudError\(error\?\.message/)
assert.match(fraud, /setFraudRows\(\[\]\)/)
assert.match(fraud, /getAdminFraudLatestVisits\(/)
assert.match(fraud, /setFraudTelemetryError\(error instanceof Error/)
assert.doesNotMatch(fraud, /\.from\(['"](?:transactions|pending_payments|wallet_legacy_funding)['"]\)/)
assert.doesNotMatch(fraud, /isTrustedCreditTransaction|findLinkedTrustedDebit|FraudReviewHistoryLimitError/)

assert.match(client, /\.rpc\('get_admin_wallet_financial_truth_page'/)
assert.match(client, /\.rpc\('get_admin_cross_wallet_payment_conflicts_page'/)
assert.match(client, /p_limit: 100/)
assert.match(client, /\.rpc\('get_admin_wallet_financial_truth'/)
assert.match(client, /\.rpc\('get_admin_fraud_latest_visits'/)
assert.match(client, /if \(error\) throw new Error\(`Canonical wallet financial truth/)
assert.match(client, /Number\.isFinite\(Number\(amount\)\)/)
assert.match(client, /if \(truth\.user_id !== row\.user_id\)/)
assert.match(client, /typeof row\.is_staff !== 'boolean'/)
assert.match(client, /typeof row\.is_admin !== 'boolean'/)
assert.match(truthMigration, /is_staff boolean,\s+is_admin boolean/)
assert.doesNotMatch(truthMigration, /AND COALESCE\(p\.is_staff, false\) = false/)
assert.match(page, /fraudReviewFilter === 'internal' && row\.role !== 'customer'/)
assert.match(page, /row\.role === 'customer' && !row\.suspended/)

assert.match(page, /setUserFinancialTruthError\(error instanceof Error/)
assert.match(page, /userFinancialTruthLoading \? \(/)
assert.match(page, /Canonical financial truth unavailable\./)
assert.match(page, /userFinancialTruth\?\.completed_purchases|userFinancialTruth\.completed_purchases/)
assert.doesNotMatch(page, /calculateTotalSpent\(userOrders\)/)
assert.match(page, /getUserTransactions\(user\.id, true\)/)
assert.match(page, /Transaction history unavailable:/)
assert.match(page, /Crypto history could not be loaded; wallet transactions are still shown/)
assert.match(client, /if \(throwOnError\) throw error/)
assert.match(page, /isBalanceNeutralLedgerEvidence\(tx\)/)
assert.match(page, /'wallet_effect'/)
assert.match(page, /getWalletTransactionDisplayAmount\(tx\),/)
assert.match(page, /balance_type: 'crypto_activity'/)
assert.match(page, /tx\.balance_type && tx\.balance_type !== 'wallet' \? '' : getWalletTransactionDisplayAmount\(tx\)/)
assert.match(customerWallet, /isBalanceNeutralLedgerEvidence\(transaction\)/)
assert.match(customerWallet, /'Recorded amount', 'Wallet effect'/)

function makeTruthRow(index) {
  const userId = `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
  return {
    user_id: userId, email: `fixture-${index}@example.test`, full_name: null,
    is_staff: index === 1, is_admin: index === 2,
    account_suspended: false, wallet_review_required: true,
    suspension_reason: null, suspended_at: null,
    truth: {
      user_id: userId, trusted_principal: 0, completed_debits: 0,
      net_consumed_spend: 0, spend_exposure: 0,
      eligible_refunds: 0, quarantined_excess: 0, trusted_book_balance: 0,
      unexplained_difference: 0, evidence_complete: true, integrity_status: 'consistent',
      stored_wallet_balance: 0, completed_refunds: 0, confirmed_spendable: 0,
    },
  }
}

function createFraudLoader(failOnPage = 0, failTelemetry = false, failConflictsOnPage = 0) {
  const rows = Array.from({ length: 201 }, (_, index) => makeTruthRow(index + 1))
  rows[0].wallet_review_required = false
  rows[200].wallet_review_required = false
  rows[200].truth.legacy_spend_before_recorded_funding = true
  const conflicts = Array.from({ length: 201 }, (_, index) => ({
    payment_identity: `payment-${String(index + 1).padStart(3, '0')}`,
    wallet_ids: [rows[0].user_id, rows[1].user_id],
    funding_rows: 2,
  }))
  const state = { rows: [], error: null, telemetryError: null, loadedAt: null, loading: false, calls: 0, conflictCalls: 0, telemetryCalls: 0 }
  const context = {
    useCallback: (fn) => fn,
    setFraudRows: (value) => { state.rows = value },
    setFraudError: (value) => { state.error = value },
    setFraudTelemetryError: (value) => { state.telemetryError = value },
    setFraudLastLoadedAt: (value) => { state.loadedAt = value },
    setFraudLoading: (value) => { state.loading = value },
    toast: () => {},
    getAdminWalletFinancialTruthPage: async (afterUserId) => {
      state.calls += 1
      if (state.calls === failOnPage) throw new Error('page unavailable')
      const start = afterUserId ? rows.findIndex((row) => row.user_id === afterUserId) + 1 : 0
      return rows.slice(start, start + 100)
    },
    getAdminCrossWalletPaymentConflictsPage: async (afterPaymentIdentity) => {
      state.conflictCalls += 1
      if (state.conflictCalls === failConflictsOnPage) throw new Error('payment identities unavailable')
      const start = afterPaymentIdentity
        ? conflicts.findIndex((row) => row.payment_identity === afterPaymentIdentity) + 1
        : 0
      return conflicts.slice(start, start + 100)
    },
    getAdminFraudLatestVisits: async (userIds) => {
      state.telemetryCalls += 1
      if (failTelemetry) throw new Error('visit evidence unavailable')
      return userIds.map((user_id) => ({
        user_id, ip_address: '192.0.2.4', ip_source: 'unknown',
        observed_at: '2026-09-24T00:00:00Z', user_agent: null,
        ip_country: null, ip_region: null, ip_city: null, ip_isp: null,
        ip_addresses: ['192.0.2.4'],
      }))
    },
    parseAdminUserAgent: () => ({ deviceLabel: 'Unknown device', deviceType: null, os: null, browser: null }),
    formatAdminVisitLocation: () => null,
    formatAdminVisitIsp: () => null,
  }
  const compiled = ts.transpileModule(`${fraud}\nglobalThis.loadFraudReview = loadFraudReview`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  runInNewContext(compiled, context)
  return { state, load: context.loadFraudReview }
}

const complete = createFraudLoader()
await complete.load()
assert.equal(complete.state.calls, 3, 'all 201 customers require three RPC pages')
assert.equal(complete.state.conflictCalls, 3, 'all 201 shared payment identities require three RPC pages')
assert.equal(complete.state.rows.length, 199, 'accounts without an active hold are not shown as blocked')
assert.equal(complete.state.rows[0].duplicateTopupReferences.length, 201)
assert.equal(complete.state.rows[0].reviewType, 'review_unblock')
assert.equal(complete.state.rows[0].suspended, false)
assert.equal(complete.state.rows[1].duplicateTopupReferences.length, 0)
assert.equal(complete.state.rows.find((row) => row.userId === '00000000-0000-0000-0000-000000000201'), undefined)
assert.equal(complete.state.rows[0].role, 'admin')
assert.equal(complete.state.telemetryCalls, 2)
assert.equal(complete.state.rows[0].lastIpAddress, '192.0.2.4')
assert.equal(complete.state.error, null)
assert.equal(complete.state.loading, false)
assert(complete.state.loadedAt)

const failed = createFraudLoader(2)
await failed.load()
assert.equal(failed.state.rows.length, 0, 'a partial scan must not display partial totals')
assert.match(failed.state.error, /page unavailable/)
assert.equal(failed.state.loadedAt, null)

const failedPaymentEvidence = createFraudLoader(0, false, 2)
await failedPaymentEvidence.load()
assert.equal(failedPaymentEvidence.state.rows.length, 0)
assert.match(failedPaymentEvidence.state.error, /payment identities unavailable/)
assert.equal(failedPaymentEvidence.state.loadedAt, null)

const missingTelemetry = createFraudLoader(0, true)
await missingTelemetry.load()
assert.equal(missingTelemetry.state.rows.length, 199, 'telemetry errors cannot hide active holds')
assert.match(missingTelemetry.state.telemetryError, /IP telemetry unavailable/)
assert.equal(missingTelemetry.state.error, null)

console.log('Canonical wallet financial truth UI checks passed.')
