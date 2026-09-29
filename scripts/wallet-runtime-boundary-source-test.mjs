import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import nodeAssert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isBalanceNeutralLedgerEvidence } from '../src/lib/walletTransactions.ts'
import { projectRevenueOrder } from '../supabase/functions/revenue-os-maintenance/order-projection.mjs'

const root = process.cwd()

const revenueOrder = projectRevenueOrder({
  id: 'order-1', user_id: 'user-1', product_group_id: 'product-1', amount: 100,
  status: 'completed', created_at: '2026-09-25T00:00:00Z',
  account_details: {
    quantity: 2, expected_amount_ngn: '100', charged_amount_ngn: 100,
    original_total: 120, accounts: [{ password: 'private-password' }],
    email_password: 'private-email-password', supplier_response: { api_key: 'private-key' },
  },
})
assert(revenueOrder.account_details.quantity === 2 &&
  revenueOrder.account_details.original_total === 120,
  'maintenance analytics must retain the four required numeric order fields')
assert(!JSON.stringify(revenueOrder).includes('private-'),
  'maintenance analytics must not propagate delivered credentials or raw supplier data')
const maintenanceSource = readFileSync(join(root, 'supabase/functions/revenue-os-maintenance/index.ts'), 'utf8')
assert(maintenanceSource.includes('.map(projectRevenueOrder)'),
  'maintenance route must project order details before analytics')
assert(!maintenanceSource.includes("from('product_groups').select('*')"),
  'maintenance route must not read arbitrary product/supplier fields')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const ercasTopup = read('supabase/functions/create-wallet-topup/index.ts')
assert(
  ercasTopup.includes("if (ercasSettingError || ercasSetting?.value !== 'true')"),
  'Ercas top-up server must require an explicitly enabled setting and fail closed on settings read errors',
)
assertOrder(
  ercasTopup,
  "ercasSetting?.value !== 'true'",
  'const response = await fetch(`${ERCASPAY_BASE_URL}/payment/initiate`',
  'Ercas enablement must be checked before payment initiation',
)

const productPurchaseSource = read('supabase/functions/process-purchase/index.ts')
assertOrder(productPurchaseSource,
  "rpc('discount_code_capacity_version')",
  ".from('discount_codes')",
  'discounted checkout must require the database capacity guard before reading a code')
assert(!productPurchaseSource.includes('.update({ used_count:'),
  'checkout must not increment discount use after the order has delivered')
const publicErrorStart = productPurchaseSource.indexOf('const customerPurchaseErrors = new Set([')
const publicErrorEnd = productPurchaseSource.indexOf('\nserve(async (req) => {', publicErrorStart)
assert(publicErrorStart >= 0 && publicErrorEnd > publicErrorStart,
  'product purchase must define a customer-safe error boundary')
const publicErrorContext = {}
runInNewContext(ts.transpileModule(
  `${productPurchaseSource.slice(publicErrorStart, publicErrorEnd)}\nglobalThis.publicError = publicPurchaseError`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, publicErrorContext)
assert(publicErrorContext.publicError('permission denied for table wallets') ===
  'Purchase is temporarily unavailable. Please try again or contact support.',
  'database errors must not be returned to customers')
assert(publicErrorContext.publicError('INSUFFICIENT_STOCK: provider_secret_test_value') ===
  'INSUFFICIENT_STOCK: Not enough accounts are available. Please try a smaller quantity.',
  'dynamic stock errors must not echo arbitrary details')
assert(publicErrorContext.publicError('WALLET_UNBACKED_FUNDS: stored balance mismatch') ===
  'Purchasing is paused while this wallet is under security review. Please contact support.',
  'wallet integrity errors must retain a safe review explanation')
assert(publicErrorContext.publicError('Product is currently out of stock') ===
  'Product is currently out of stock', 'expected checkout errors must remain readable')
assert(productPurchaseSource.includes('const message = publicPurchaseError(internalMessage);'),
  'the customer purchase response must pass failures through the safe error boundary')

const smsSource = read('supabase/functions/smsbus/index.ts')
const smsErrorStart = smsSource.indexOf('function friendlyError(error: unknown): string {')
const smsErrorEnd = smsSource.indexOf('\ntype SupabaseAdmin =', smsErrorStart)
assert(smsErrorStart >= 0 && smsErrorEnd > smsErrorStart &&
  smsSource.includes('const message = friendlyError(err)'),
  'SMS request failures must pass through the public error mapper')
const smsErrorContext = {}
runInNewContext(ts.transpileModule(
  `class DaisySmsError extends Error { constructor(code, message) { super(message); this.code = code } }\n${smsSource.slice(smsErrorStart, smsErrorEnd)}\nglobalThis.mapError = friendlyError; globalThis.dbError = (message) => new Error(message); globalThis.providerError = (code, message) => new DaisySmsError(code, message)`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, smsErrorContext)
assert(smsErrorContext.mapError(smsErrorContext.dbError('permission denied for table wallet_secrets')) ===
  'SMS request is temporarily unavailable.', 'SMS database errors must not reach the browser')
assert(smsErrorContext.mapError(smsErrorContext.providerError('PARSE_ERROR', 'provider_secret_test_value')) ===
  'SMS service is temporarily unavailable.', 'unknown DaisySMS responses must not reach the browser')
assert(smsErrorContext.mapError(smsErrorContext.providerError('NO_NUMBERS', 'raw provider text')) ===
  'No numbers available for this service right now.', 'known SMS provider errors remain actionable')
assert(smsErrorContext.mapError(smsErrorContext.dbError('SMS order not found')) ===
  'SMS order not found', 'expected SMS customer errors remain readable')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertOrder(src, earlier, later, message) {
  const earlierIndex = src.indexOf(earlier)
  const laterIndex = src.indexOf(later)
  assert(earlierIndex !== -1, `${message}: missing earlier marker ${earlier}`)
  assert(laterIndex !== -1, `${message}: missing later marker ${later}`)
  assert(earlierIndex < laterIndex, message)
}

function assertContains(src, needles, message) {
  for (const needle of needles) {
    assert(src.includes(needle), `${message}: missing ${needle}`)
  }
}

function functionSlice(src, signature) {
  const start = src.indexOf(signature)
  assert(start !== -1, `missing function signature ${signature}`)
  const nextServe = src.indexOf('\nserve(', start)
  const nextFunction = src.indexOf('\nasync function ', start + signature.length)
  const nextPlainFunction = src.indexOf('\nfunction ', start + signature.length)
  const candidates = [nextServe, nextFunction, nextPlainFunction].filter((index) => index > start)
  const end = candidates.length > 0 ? Math.min(...candidates) : src.length
  return src.slice(start, end)
}

for (const [path, signature] of [
  ['supabase/functions/admin-adjust-balance/index.ts', 'serve(async (req) => {'],
  ['supabase/functions/partner-api/index.ts', 'async function requireAdmin('],
  ['supabase/functions/muabanvia-fulfill/index.ts', 'serve(async (req) => {'],
  ['supabase/functions/manual-restock/index.ts', 'serve(async (req) => {'],
  ['supabase/functions/smm-sync-services/index.ts', 'serve(async (req) => {'],
  ['supabase/functions/get-my-ip/index.ts', 'serve(async (req) => {'],
  ['supabase/functions/telegram-stars/index.ts', 'async function requireAdmin('],
  ['supabase/functions/smsbus/index.ts', 'async function requireAdminUser('],
  ['supabase/functions/smsbus/index.ts', 'async function requireSmsProductAccess('],
  ['supabase/functions/smsbus/index.ts', 'async function requireStaffPermission('],
  ['supabase/functions/email/index.ts', 'async function requireAdmin('],
  ['supabase/functions/email/index.ts', 'async function requireAdminOrStaffPermission('],
  ['supabase/functions/manage-staff/index.ts', 'async function assertQueuedStaffPermission('],
  ['supabase/functions/revenue-os-maintenance/index.ts', 'async function requireAuthorized('],
]) {
  const source = read(path)
  const guard = functionSlice(source, signature)
  assert(guard.includes('account_suspended'), `${path} ${signature} must read current account suspension state`)
  assert(guard.includes('profile.account_suspended') || guard.includes('profile?.account_suspended') || guard.includes('adminProfile.account_suspended') || guard.includes('adminProfile?.account_suspended') || guard.includes('data.account_suspended'),
    `${path} ${signature} must deny a suspended privileged actor`)
}

function assertNonThrowingLogOnlyHelper(src, signature, message) {
  const helper = functionSlice(src, signature)
  assert(!helper.includes('throw '), `${message}: helper must not throw`)
  for (const forbidden of [
    'applyWalletTransaction',
    'smmClient.createOrder',
    'daisyGetNumber',
    'istarPost',
    'sageCloudClient.purchaseAirtime',
    'sageCloudClient.purchaseData',
    'bitrefill.createInvoice',
    'account_details:',
  ]) {
    assert(!helper.includes(forbidden), `${message}: helper must not dispatch or release value via ${forbidden}`)
  }
  assert(helper.includes('console.error') || helper.includes('console.warn'), `${message}: helper must record/log failures`)
}

function assertNoSupplierDispatch(src, forbiddenCalls, message) {
  for (const forbidden of forbiddenCalls) {
    assert(!src.includes(forbidden), `${message}: must not dispatch supplier via ${forbidden}`)
  }
}

const adminAdjust = read('supabase/functions/admin-adjust-balance/index.ts')
assertOrder(
  adminAdjust,
  'unsuspendReview = await loadWalletFinancialTruth(supabaseAdmin, targetUserId)',
  "supabaseAdmin.rpc('set_customer_suspension_state'",
  'admin unsuspend must load canonical wallet truth before changing suspension state',
)
assertOrder(
  adminAdjust,
  'const blockReason = unsuspendBlockReason(unsuspendReview, targetProfile)',
  'set_customer_suspension_state',
  'admin unsuspend must review canonical financial state before suspension RPC',
)
assertContains(adminAdjust, [
  "supabaseAdmin.rpc('wallet_financial_truth_internal'",
  'if (!truth.evidence_complete)',
  "truth.integrity_status !== 'quarantined_excess'",
  'truth.wallet_review_required && !isAutomaticExcessReview(truth, profile)',
  'if (!truth.account_suspended && truth.spending_blocked)',
  "type: 'chargeback'",
  "const transactionType = adjustment_amount > 0 ? 'admin_credit' : 'admin_debit'",
  'approved_by: user.id',
], 'admin unsuspend must use canonical truth while preserving chargeback and approved-credit posting')
assert(!adminAdjust.includes('calculateWalletBacking'), 'admin unsuspend must not use a second wallet calculator')

const truthHelperStart = adminAdjust.indexOf('type WalletFinancialTruth = {')
const truthHelperEnd = adminAdjust.indexOf('serve(async (req) => {', truthHelperStart)
assert(truthHelperStart >= 0 && truthHelperEnd > truthHelperStart, 'canonical truth review helpers must exist')
const truthContext = {}
runInNewContext(ts.transpileModule(
  `${adminAdjust.slice(truthHelperStart, truthHelperEnd)}\nglobalThis.review = unsuspendBlockReason; globalThis.load = loadWalletFinancialTruth`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, truthContext)
const baseTruth = {
  user_id: 'fixture-user', account_suspended: true, wallet_review_required: false,
  wallet_review_reason: null, spending_blocked: true, evidence_complete: true,
  integrity_status: 'consistent', stored_wallet_balance: 100,
  trusted_book_balance: 100, confirmed_spendable: 100,
  quarantined_excess: 0, spend_exposure: 0,
}
const baseProfile = { wallet_reviewed_by: null }
assert(truthContext.review(baseTruth, baseProfile) === null, 'covered account may be reinstated')
const excessTruth = {
  ...baseTruth, wallet_review_required: true,
  wallet_review_reason: 'Wallet financial review: quarantined displayed excess 50',
  integrity_status: 'quarantined_excess', stored_wallet_balance: 150,
  quarantined_excess: 50, confirmed_spendable: 100,
}
assert(truthContext.review(excessTruth, baseProfile) === null, 'automatic excess-only hold must not block reinstatement')
assert(truthContext.review({ ...excessTruth, evidence_complete: false }, baseProfile) === 'EVIDENCE_INCOMPLETE')
assert(truthContext.review({ ...excessTruth, integrity_status: 'payment_identity_conflict' }, baseProfile) === 'SEVERE_INTEGRITY_REVIEW')
assert(truthContext.review({ ...excessTruth, spend_exposure: 1 }, baseProfile) === 'SEVERE_INTEGRITY_REVIEW')
assert(truthContext.review(excessTruth, { wallet_reviewed_by: 'admin-user' }) === 'WALLET_REVIEW_HOLD')
assert(truthContext.review({ ...excessTruth, wallet_review_reason: 'Manual investigation' }, baseProfile) === 'WALLET_REVIEW_HOLD')
assert(truthContext.review({ ...baseTruth, account_suspended: false, spending_blocked: true }, baseProfile) === 'SPENDING_BLOCKED')
const rpc = (data, error = null) => ({ rpc: async () => ({ data, error }) })
await nodeAssert.rejects(truthContext.load(rpc(null, { message: 'RPC failed' }), baseTruth.user_id), /Wallet financial truth unavailable/)
await nodeAssert.rejects(truthContext.load(rpc({ ...baseTruth, evidence_complete: null }), baseTruth.user_id), /incomplete/)
assert((await truthContext.load(rpc(baseTruth), baseTruth.user_id)).confirmed_spendable === 100)

const nowpayments = read('supabase/functions/nowpayments-webhook/index.ts')
assertContains(nowpayments, [
  'function cryptoAutoCreditEnabled()',
  'return false;',
  'crypto_auto_credit_disabled_manual_review_required',
  "credited: false",
], 'NOWPayments crypto credit must stay held for manual review')
assertOrder(
  nowpayments,
  'const isValid = await verifyIPNSignature(payload, signature, ipnSecret)',
  'const supabaseAdmin = createClient',
  'NOWPayments webhook must verify IPN signature before creating service-role client',
)
assertOrder(
  nowpayments,
  'verifiedProviderPayment = await fetchNowPaymentsStatus',
  'const autoCreditEnabled = cryptoAutoCreditEnabled()',
  'NOWPayments finished payments must be checked against provider status before credit decision',
)
assertOrder(
  nowpayments,
  'const autoCreditEnabled = cryptoAutoCreditEnabled()',
  '// Update transaction with webhook data',
  'NOWPayments manual-review hold must be evaluated before any credit path',
)
assertContains(nowpayments, [
  'provider_payment_id_mismatch',
  'provider_order_reference_mismatch',
  'provider_currency_mismatch',
  'provider_paid_amount_too_low',
], 'NOWPayments provider verification must bind identity, reference, currency, and amount')

const bills = read('supabase/functions/purchase-bills/index.ts')
assertOrder(
  bills,
  'await applyWalletTransaction(supabaseAdmin, {',
  'sageCloudClient.purchaseAirtime',
  'bills route must debit wallet before airtime provider dispatch',
)
assertOrder(
  bills,
  'await applyWalletTransaction(supabaseAdmin, {',
  'sageCloudClient.purchaseData',
  'bills route must debit wallet before data provider dispatch',
)
assertContains(bills, [
  'async function getWalletRequestForensics',
  "const walletRequestForensics = await getWalletRequestForensics(req, 'purchase-bills')",
  'source_order_id: billRecord.id',
  "source_order_table: 'bills_transactions'",
  'idempotencyKey: `bills:purchase:${idempotency_key}`',
  "outcome: 'outcome_unknown'",
  'request_forensics: walletRequestForensics',
], 'bills debit and unknown outcome must keep source provenance')
assertNonThrowingLogOnlyHelper(bills, 'async function logAdminAlert', 'bills admin-alert logging must not convert notification failure into delivery')
assertNonThrowingLogOnlyHelper(bills, 'async function recordRevenueEvent', 'bills revenue logging must not convert notification failure into delivery')

const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
assertOrder(
  bitrefill,
  'await applyWalletTransaction(supabaseAdmin, {',
  'const invoice = await bitrefill.createInvoice',
  'Bitrefill route must debit wallet before provider dispatch',
)
assertOrder(
  bitrefill,
  'const invoice = await bitrefill.createInvoice',
  'redemption = orderDetail.redemption_info || null',
  'Bitrefill redemption value must come only after provider invoice/order lookup',
)
assertContains(bitrefill, [
  'async function getWalletRequestForensics',
  "const walletRequestForensics = await getWalletRequestForensics(req, 'purchase-bitrefill')",
  'source_order_id: orderRecord.id',
  "source_order_table: 'bitrefill_orders'",
  'idempotencyKey: `bitrefill:purchase:${idempotency_key}`',
  "outcome: 'outcome_unknown'",
  'request_forensics: walletRequestForensics',
], 'Bitrefill debit and unknown outcome must keep source provenance')
assertNonThrowingLogOnlyHelper(bitrefill, 'async function recordRevenueEvent', 'Bitrefill revenue logging must not convert notification failure into delivery')

const withdrawal = read('supabase/functions/create-withdrawal-request/index.ts')
assertOrder(
  withdrawal,
  'await applyWalletTransaction(supabaseAdmin, {',
  'transferResponse = await sageCloudClient.transfer',
  'withdrawal route must debit wallet before provider dispatch',
)
assertContains(withdrawal, [
  'async function getWalletRequestForensics',
  "const walletRequestForensics = await getWalletRequestForensics(req, 'create-withdrawal-request')",
  'source_order_id: withdrawalRecord.id',
  "source_order_table: 'crypto_withdrawals'",
  'idempotencyKey: debitIdempotencyKey',
  "outcome: 'outcome_unknown'",
  'request_forensics: walletRequestForensics',
], 'withdrawal debit and unknown outcome must keep source provenance and request forensics')

const productPurchase = read('supabase/functions/process-purchase/index.ts')
assertNonThrowingLogOnlyHelper(productPurchase, 'async function recordRevenueEvent', 'product revenue logging must not convert notification failure into delivery')

const smmCreateOrder = read('supabase/functions/smm-create-order/index.ts')
assertNonThrowingLogOnlyHelper(smmCreateOrder, 'async function recordRevenueEvent', 'SMM revenue logging must not convert notification failure into delivery')

const smsbus = read('supabase/functions/smsbus/index.ts')
assertNonThrowingLogOnlyHelper(smsbus, 'async function recordRevenueEvent', 'SMS revenue logging must not convert notification failure into delivery')

const adminPage = read('src/pages/AdminPage.tsx')
assertContains(adminPage, [
  'function isWalletSpendTransaction',
  "'admin_debit'",
  "'staff_debit'",
  'return -absoluteAmount',
  'const signedAmount = getWalletTransactionDisplayAmount(tx)',
  'getAdminWalletFinancialTruthPage(afterUserId)',
  'getAdminWalletFinancialTruth(userId)',
  'Trusted principal:',
  'Eligible refund restore:',
  'Confirmed spendable:',
], 'admin UI must render admin debits as negative and expose trusted backing context')

const displayHelperStart = adminPage.indexOf('function normalizeLedgerText(')
const displayHelperEnd = adminPage.indexOf('function formatAdminNaira(', displayHelperStart)
assert(displayHelperStart >= 0 && displayHelperEnd > displayHelperStart, 'admin transaction display helpers must exist')
const displayContext = { isBalanceNeutralLedgerEvidence }
runInNewContext(ts.transpileModule(
  `${adminPage.slice(displayHelperStart, displayHelperEnd)}\nglobalThis.displayAmount = getWalletTransactionDisplayAmount`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, displayContext)
for (const type of ['admin_debit', 'staff_debit', 'chargeback']) {
  assert(displayContext.displayAmount({ type, amount: 125 }) === -125, `${type} positive stored amount must display as a debit`)
  assert(displayContext.displayAmount({ type, amount: -125 }) === -125, `${type} negative stored amount must display as a debit`)
}
assert(displayContext.displayAmount({ type: 'admin_credit', amount: 125 }) === 125, 'admin credit must display as a credit')
assert(displayContext.displayAmount({ type: 'refund', amount: 125 }) === 125, 'refund must display as a credit')
const neutralRepair = {
  type: 'admin_credit', amount: 125, balance_before: 1000, balance_after: 1000,
  metadata: { source: 'admin-ledger-repair', balance_unchanged: true, requires_owner_evidence: true },
}
assert(displayContext.displayAmount(neutralRepair) === 0, 'balance-neutral admin repair must not display as a credit')
assert(displayContext.displayAmount({ ...neutralRepair, balance_after: 1125 }) === 125,
  'changed-snapshot admin credit must not be hidden as neutral evidence')

const orderHistory = read('src/lib/supabase.ts')
assertContains(orderHistory, [
  'function sanitizeOrderHistoryCredentialVisibility',
  "String(order?.status || '').toLowerCase() === 'completed'",
  '(data || []).map(sanitizeOrderHistoryCredentialVisibility)',
], 'order history data layer must hide credentials unless orders are completed')

const smmCheckStatus = read('supabase/functions/smm-check-status/index.ts')
assert(!smmCheckStatus.includes('smmClient.createOrder'), 'SMM single-status worker must not dispatch new panel orders')
assertNoSupplierDispatch(smmCheckStatus, [
  'smmClient.createOrder',
  'daisyGetNumber',
  'istarPost',
  'sageCloudClient.purchaseAirtime',
  'sageCloudClient.purchaseData',
  'bitrefill.createInvoice',
], 'SMM single-status worker old messages')
assertContains(smmCheckStatus, [
  'const panelStatus = await smmClient.getOrderStatus(order.external_order_id)',
  'async function applyRefundTransaction',
  "supabaseAdmin.rpc('apply_wallet_transaction'",
  'await applyRefundTransaction(supabaseAdmin, {',
  "type: 'refund'",
  'idempotencyKey: `smm:refund:${order.id}:${newStatus}`',
  "source: 'smm-check-status'",
  "source_order_table: 'smm_orders'",
  'source_order_id: order.id',
], 'SMM single-status worker must only status-check and wallet-engine refund with order provenance')

const smmCheckAllOrders = read('supabase/functions/smm-check-all-orders/index.ts')
assert(!smmCheckAllOrders.includes('smmClient.createOrder'), 'SMM all-orders worker must not dispatch new panel orders')
assertNoSupplierDispatch(smmCheckAllOrders, [
  'smmClient.createOrder',
  'daisyGetNumber',
  'istarPost',
  'sageCloudClient.purchaseAirtime',
  'sageCloudClient.purchaseData',
  'bitrefill.createInvoice',
], 'SMM all-orders worker old messages')
assertContains(smmCheckAllOrders, [
  'isAuthorizedCron(req)',
  "Deno.env.get('SMM_CRON_SECRET')",
  'const singleResult = await smmClient.getOrderStatus(orderIds[0])',
  'statusResults = await smmClient.getMultipleOrderStatus(orderIds)',
  'async function applyRefundTransaction',
  "supabaseAdmin.rpc('apply_wallet_transaction'",
  'await applyRefundTransaction(supabaseAdmin, {',
  "type: 'refund'",
  'idempotencyKey: `smm:refund:${order.id}:${newStatus}`',
  "source: 'smm-check-all-orders'",
  "source_order_table: 'smm_orders'",
  'source_order_id: order.id',
], 'SMM all-orders worker must be cron/service authorized and only status-check/refund existing orders')

const pendingRecovery = read('supabase/functions/check-pending-payments/index.ts')
assertNoSupplierDispatch(pendingRecovery, [
  'smmClient.createOrder',
  'daisyGetNumber',
  'istarPost',
  'sageCloudClient.purchaseAirtime',
  'sageCloudClient.purchaseData',
  'bitrefill.createInvoice',
], 'pending-payment recovery old messages')
assertContains(pendingRecovery, [
  'isAuthorizedCron(req)',
  "Deno.env.get('PAYMENT_RECOVERY_CRON_SECRET')",
  'claimPendingPaymentForRecovery',
  ".eq('status', 'pending')",
  "supabase.functions.invoke('verify-and-credit-wallet'",
  "status: 'credited'",
], 'pending payment recovery worker must be cron/service authorized and delegate crediting to verification function')

const verifyCredit = read('supabase/functions/verify-and-credit-wallet/index.ts')
assertOrder(
  verifyCredit,
  "const { data: pendingPayment",
  'const creditResult = await applyWalletTransaction',
  'verify-and-credit-wallet must bind server-created pending payment before wallet credit',
)
assertContains(verifyCredit, [
  "pendingPayment.status && pendingPayment.status !== 'pending'",
  'markPendingPaymentVerificationRetry',
  'markPendingPaymentVerificationFailed',
  'Payment amount mismatch during wallet verification.',
  'Payment currency mismatch during wallet verification.',
  'Merchant identity mismatch during provider verification.',
  'Payment environment mismatch during provider verification.',
  'const creditResult = await applyWalletTransaction',
  "type: 'topup'",
  "source: 'verify-and-credit-wallet'",
], 'verify-and-credit-wallet must validate pending payment/provider evidence before wallet-engine credit')
assertOrder(
  verifyCredit,
  'Payment amount mismatch during wallet verification.',
  'const creditResult = await applyWalletTransaction',
  'verify-and-credit-wallet must validate provider amount before wallet credit',
)
assertOrder(
  verifyCredit,
  'Payment currency mismatch during wallet verification.',
  'const creditResult = await applyWalletTransaction',
  'verify-and-credit-wallet must validate provider currency before wallet credit',
)
assertOrder(
  verifyCredit,
  'Merchant identity mismatch during provider verification.',
  'const creditResult = await applyWalletTransaction',
  'verify-and-credit-wallet must validate provider merchant before wallet credit',
)
assertOrder(
  verifyCredit,
  'Payment environment mismatch during provider verification.',
  'const creditResult = await applyWalletTransaction',
  'verify-and-credit-wallet must validate provider environment before wallet credit',
)

const manageStaff = read('supabase/functions/manage-staff/index.ts')
const staffSearchStart = manageStaff.indexOf('async function handleStaffCustomerSearch(')
const staffSearchEnd = manageStaff.indexOf('\nasync function ', staffSearchStart + 1)
assert(staffSearchStart >= 0 && staffSearchEnd > staffSearchStart,
  'staff customer search handler must exist')
const staffSearch = manageStaff.slice(staffSearchStart, staffSearchEnd)
const staffReadStart = manageStaff.indexOf('async function requireStaffReadPermission(')
assert(staffReadStart >= 0 && staffReadStart < staffSearchStart,
  'staff read permission helper must precede customer search')
assertOrder(staffSearch, "await requireStaffReadPermission(admin, user, 'tab_users')",
  "admin.from('profiles')", 'staff customer search must check current permission before service-role profile reads')
assertContains(staffSearch, [
  ".eq('is_staff', false).eq('is_admin', false)",
  "const columns = 'id,email,full_name,wallet_balance,is_staff,is_admin,created_at'",
  'query.length < 3 || query.length > 120',
], 'staff customer search must exclude internal accounts and return limited fields')
assert(!staffSearch.includes(".select('*')"), 'staff customer search must not return whole profiles')
assertContains(manageStaff, [
  "if (profile.account_suspended === true) throw new HttpError('Account suspended', 403)",
  "if (profile.account_suspended === true) return json({ error: 'Account suspended' }, 403)",
  'ownerProfile?.account_suspended === true',
], 'staff read, staff action, and owner management must check current suspension state')
const staffPage = read('src/pages/StaffAdminPage.tsx')
assert(staffPage.includes('searchStaffCustomers(userQuery)') && !staffPage.includes('searchUsers(userQuery)'),
  'Staff Admin user search must use the permission-scoped server response')
const browserProfiles = read('src/lib/supabase.ts')
const managedDiscountStart = browserProfiles.indexOf('export async function getDiscountCodes(')
const managedDiscountEnd = browserProfiles.indexOf('export async function createDiscountCode(', managedDiscountStart)
const previewDiscountStart = browserProfiles.indexOf('export async function previewDiscountCode(')
const previewDiscountEnd = browserProfiles.indexOf('\nexport async function ', previewDiscountStart + 1)
assert(managedDiscountStart >= 0 && managedDiscountEnd > managedDiscountStart
  && previewDiscountStart >= 0,
  'browser discount readers must exist')
const managedDiscountReader = browserProfiles.slice(managedDiscountStart, managedDiscountEnd)
const previewDiscountReader = browserProfiles.slice(previewDiscountStart,
  previewDiscountEnd > previewDiscountStart ? previewDiscountEnd : browserProfiles.length)
assert(managedDiscountReader.includes("supabase.rpc('get_managed_discount_codes')")
  && !managedDiscountReader.includes(".from('discount_codes')"),
  'admin/staff discount listing must use the scoped RPC')
assert(previewDiscountReader.includes("supabase.rpc('preview_discount_code'")
  && !previewDiscountReader.includes(".from('discount_codes')"),
  'checkout preview must not read or enumerate discount rows')
for (const signature of ['export async function getAllUsers(', 'export async function searchUsers(']) {
  const start = browserProfiles.indexOf(signature)
  const end = browserProfiles.indexOf('\nexport async function ', start + signature.length)
  assert(start >= 0, `missing browser profile reader ${signature}`)
  const body = browserProfiles.slice(start, end > start ? end : browserProfiles.length)
  assert(!body.includes(".select('*')") && body.includes('.select(ADMIN_USER_SEARCH_COLUMNS)'),
    `${signature} must not fetch arbitrary profile columns into the browser`)
}
assertContains(browserProfiles, [
  "const ADMIN_USER_SEARCH_COLUMNS =",
  "'id,email,full_name,created_at,updated_at,wallet_balance,is_admin,is_staff,account_suspended,suspension_reason,suspended_at,wallet_review_required'",
], 'admin browser profile projection must stay explicit')
const staffSearchContext = {
  HttpError: class HttpError extends Error {
    constructor(message, status) { super(message); this.status = status }
  },
  json: (body) => body,
}
runInNewContext(ts.transpileModule(
  `${manageStaff.slice(staffReadStart, staffSearchEnd)}\nglobalThis.searchStaff = handleStaffCustomerSearch`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, staffSearchContext)

function mockStaffSearchAdmin(actor, permission) {
  const customerRows = [
    { id: 'customer-1', email: 'alice@example.test', full_name: 'Alice',
      wallet_balance: 200, is_staff: false, is_admin: false,
      created_at: '2026-09-25T00:00:00Z', private_token: 'must-not-leak' },
    { id: 'staff-1', email: 'alice-staff@example.test', full_name: 'Alice Staff',
      wallet_balance: 0, is_staff: true, is_admin: false,
      created_at: '2026-09-25T00:00:00Z', private_token: 'staff-secret' },
    { id: 'admin-1', email: 'alice-admin@example.test', full_name: 'Alice Admin',
      wallet_balance: 0, is_staff: false, is_admin: true,
      created_at: '2026-09-25T00:00:00Z', private_token: 'admin-secret' },
  ]
  const state = { searchReads: 0 }
  const admin = {
    from(table) {
      const filters = []
      return {
        select(columns) { this.columns = columns; return this },
        eq(column, value) { filters.push([column, value]); return this },
        ilike(column, value) { filters.push([column, value]); return this },
        async single() { return { data: actor, error: null } },
        async maybeSingle() { return { data: permission, error: null } },
        async limit() {
          nodeAssert.equal(table, 'profiles')
          state.searchReads += 1
          return { data: customerRows.filter((row) => filters.every(([key, value]) => {
            if (key === 'email' || key === 'full_name') {
              return String(row[key]).toLowerCase().includes(String(value).replace(/%/g, '').toLowerCase())
            }
            return row[key] === value
          })), error: null }
        },
      }
    },
  }
  return { admin, state }
}

const permittedStaff = mockStaffSearchAdmin(
  { id: 'staff-1', is_staff: true, is_admin: false, account_suspended: false },
  { is_enabled: true },
)
const staffCustomers = await staffSearchContext.searchStaff(permittedStaff.admin,
  { id: 'staff-1' }, { query: 'alice' })
nodeAssert.equal(staffCustomers.users.map((row) => row.id).join(','), 'customer-1')
nodeAssert.equal(permittedStaff.state.searchReads, 3)
nodeAssert(!JSON.stringify(staffCustomers).includes('must-not-leak'))
nodeAssert(!JSON.stringify(staffCustomers).includes('staff-secret'))

for (const [actor, permission] of [
  [{ id: 'staff-1', is_staff: true, is_admin: false, account_suspended: true }, { is_enabled: true }],
  [{ id: 'staff-1', is_staff: true, is_admin: false, account_suspended: false }, { is_enabled: false }],
  [{ id: 'customer-1', is_staff: false, is_admin: false, account_suspended: false }, null],
]) {
  const deniedStaff = mockStaffSearchAdmin(actor, permission)
  await nodeAssert.rejects(
    () => staffSearchContext.searchStaff(deniedStaff.admin, { id: actor.id }, { query: 'alice' }),
    (error) => error.status === 403,
  )
  nodeAssert.equal(deniedStaff.state.searchReads, 0)
}
assert(!manageStaff.includes('daisyGetNumber'), 'manage-staff must not allocate new SMS numbers directly')
assertNoSupplierDispatch(manageStaff, [
  'smmClient.createOrder',
  'daisyGetNumber',
  'istarPost',
  'sageCloudClient.purchaseAirtime',
  'sageCloudClient.purchaseData',
  'bitrefill.createInvoice',
], 'staff worker old messages')
assertContains(manageStaff, [
  'refundSmsOrderWallet(admin: any, order: any, reason: string, metadata: Record<string, unknown> = {})',
  'await applyWalletTransaction(admin, {',
  "type: 'refund'",
  'idempotencyKey: `staff:sms-refund:${order.id}`',
  '...metadata',
  "source_order_table: 'sms_orders'",
  'source_order_id: order.id',
  'const approvingAdminId = pendingAction.reviewed_by || pendingAction.admin_id || null',
  'approvalMetadata',
  'approved_by: approvingAdminId',
  "approval_type: 'staff_action_review'",
  'approval_reference: pendingAction.id || reference',
  'pending_action_id: pendingAction.id || null',
], 'staff worker paths must refund through wallet engine and keep approving-admin/order provenance')

const fraudBanGuardPaths = [
  'supabase/functions/process-purchase/index.ts',
  'supabase/functions/smm-create-order/index.ts',
  'supabase/functions/smsbus/index.ts',
  'supabase/functions/telegram-stars/index.ts',
  'supabase/functions/purchase-bills/index.ts',
  'supabase/functions/purchase-bitrefill/index.ts',
  'supabase/functions/create-crypto-sell-order/index.ts',
  'supabase/functions/_shared/staff-purchase-guard.ts',
]
for (const path of fraudBanGuardPaths) {
  const source = read(path)
  assert(!source.includes('await assertFraudDeviceNotBanned(admin, userId, req)'),
    `${path} must not use the retired fraud device ban as a purchase gate`)
}

const browserOrders = read('src/lib/supabase.ts')
const dashboardOrders = read('src/pages/Dashboard.tsx')
const adminOrders = read('src/pages/AdminPage.tsx')
assert((browserOrders.match(/\.from\('orders_safe_history' as any\)/g) || []).length >= 4,
  'customer/admin order-detail helpers must use the database-safe history view')
assert(dashboardOrders.includes(".from('orders_safe_history' as any)"),
  'dashboard activity must not select base-table account_details')
assert(adminOrders.includes("readRows('Product orders', 'orders_safe_history')"),
  'admin analytics must use non-secret order history')
assert(!/\.from\('orders'\)/.test(browserOrders + dashboardOrders + adminOrders),
  'browser source must not select the base orders table')

console.log(JSON.stringify({
  ok: true,
  assertions: [
    'Ercas top-up initiation requires an explicitly enabled server setting before provider dispatch',
    'product checkout hides unexpected database errors while retaining safe customer messages',
    'discounted checkout requires database capacity readiness and never post-increments use counts',
    'SMS actions hide unknown provider and database errors while preserving known declines',
    'privileged Edge routes and queued staff actions check current account suspension',
    'admin unsuspend reads canonical wallet truth before status changes',
    'quarantined excess is allowed while incomplete evidence and severe/manual holds remain blocked',
    'NOWPayments verifies IPN signature before DB mutation',
    'NOWPayments auto-credit remains disabled and held for manual review',
    'NOWPayments provider lookup binds payment identity, reference, currency, and amount',
    'bills and Bitrefill debit before provider dispatch',
    'bills and Bitrefill retain original debit identity for unresolved outcomes',
    'Bitrefill redemption value is looked up only after provider order creation',
    'admin debit/staff debit render negative in user history',
    'order-history credentials are completed-order only at the data boundary',
    'browser order-history callers use the database-safe credential projection',
    'SMM status workers cannot dispatch new provider orders',
    'SMM status workers refund through wallet engine with source-order provenance',
    'pending-payment recovery is cron/service authorized and delegates to verification',
    'verify-and-credit-wallet validates pending payment/provider evidence before credit',
    'staff worker SMS refunds use wallet engine and approving-admin provenance',
    'staff customer search checks current permission and suspension before returning a minimal customer-only result',
    'owner browser profile search requests only named operational columns',
    'browser discount preview and staff listing use role-scoped RPCs instead of direct table reads',
    'revenue/admin-alert logging helpers cannot dispatch suppliers, reveal value, or throw delivery-changing errors',
    'current worker-like functions cannot dispatch suppliers from stale status/recovery/admin messages',
    'retired fraud device bans no longer gate customer purchases',
  ],
}, null, 2))
