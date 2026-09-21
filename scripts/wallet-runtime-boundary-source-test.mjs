import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

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
  'function hasApprovedAdminCreditEvidence',
  'async function calculateWalletBacking',
  'admin backing calculator must define approval-evidence check before calculating trusted credits',
)
assertOrder(
  adminAdjust,
  'unsuspendReview = await calculateWalletBacking(supabaseAdmin, targetUserId)',
  "supabaseAdmin.rpc('set_customer_suspension_state'",
  'admin unsuspend must calculate wallet backing before changing suspension state',
)
assertOrder(
  adminAdjust,
  'if (unsuspendReview.backedAvailable < -tolerance || storedWalletBalance > unsuspendReview.backedAvailable + tolerance)',
  'set_customer_suspension_state',
  'admin unsuspend must reject unbacked balances before suspension RPC',
)
assertContains(adminAdjust, [
  "type === 'admin_credit'",
  'adminActorIds.has(String(row.created_by || \'\'))',
  'hasApprovedAdminCreditEvidence(row, metadata)',
  'metadata.approved_by',
  'metadata.approval_reference',
  'isBalanceNeutralAdminRepair',
  'trustedCredits += amount',
  'completedRefunds += amount',
  'const original = findLinkedTrustedDebit(refund, trustedDebits)',
  'const eligibleRefunds = Math.min(linkedEligibleRefunds, trustedDebitCapacity)',
], 'admin wallet backing must trust only approved admin credits and verified deposits, with linked refunds as restoration only')

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
  'debitResult = await applyWalletTransaction',
  'sageCloudClient.purchaseAirtime',
  'bills route must debit wallet before airtime provider dispatch',
)
assertOrder(
  bills,
  'debitResult = await applyWalletTransaction',
  'sageCloudClient.purchaseData',
  'bills route must debit wallet before data provider dispatch',
)
assertContains(bills, [
  'async function getWalletRequestForensics',
  "const walletRequestForensics = await getWalletRequestForensics(req, 'purchase-bills')",
  'source_order_id: billRecord.id',
  "source_order_table: 'bills_transactions'",
  'source_debit_transaction_id: debitResult?.transaction?.id || null',
  'source_debit_idempotency_key: `bills:purchase:${idempotency_key}`',
  'request_forensics: walletRequestForensics',
], 'bills refunds must keep original debit provenance')
assertNonThrowingLogOnlyHelper(bills, 'async function logAdminAlert', 'bills admin-alert logging must not convert notification failure into delivery')
assertNonThrowingLogOnlyHelper(bills, 'async function recordRevenueEvent', 'bills revenue logging must not convert notification failure into delivery')

const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
assertOrder(
  bitrefill,
  'debitResult = await applyWalletTransaction',
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
  'source_debit_transaction_id: debitResult?.transaction?.id || null',
  'source_debit_idempotency_key: `bitrefill:purchase:${idempotency_key}`',
  'request_forensics: walletRequestForensics',
], 'Bitrefill refunds must keep original debit provenance')
assertNonThrowingLogOnlyHelper(bitrefill, 'async function recordRevenueEvent', 'Bitrefill revenue logging must not convert notification failure into delivery')

const withdrawal = read('supabase/functions/create-withdrawal-request/index.ts')
assertOrder(
  withdrawal,
  'debitResult = await applyWalletTransaction',
  'transferResponse = await sageCloudClient.transfer',
  'withdrawal route must debit wallet before provider dispatch',
)
assertContains(withdrawal, [
  'async function getWalletRequestForensics',
  "const walletRequestForensics = await getWalletRequestForensics(req, 'create-withdrawal-request')",
  'source_order_id: withdrawalRecord.id',
  "source_order_table: 'crypto_withdrawals'",
  'source_debit_transaction_id: debitResult?.transaction?.id || null',
  'source_debit_idempotency_key: debitIdempotencyKey',
  'request_forensics: walletRequestForensics',
], 'withdrawal debit/refund metadata must keep source provenance and request forensics')

const productPurchase = read('supabase/functions/process-purchase/index.ts')
assertNonThrowingLogOnlyHelper(productPurchase, 'async function recordRevenueEvent', 'product revenue logging must not convert notification failure into delivery')

const smmCreateOrder = read('supabase/functions/smm-create-order/index.ts')
assertNonThrowingLogOnlyHelper(smmCreateOrder, 'async function recordRevenueEvent', 'SMM revenue logging must not convert notification failure into delivery')

const smsbus = read('supabase/functions/smsbus/index.ts')
assertNonThrowingLogOnlyHelper(smsbus, 'async function recordRevenueEvent', 'SMS revenue logging must not convert notification failure into delivery')

const adminPage = read('src/pages/AdminPage.tsx')
assertContains(adminPage, [
  "if (type === 'admin_credit')",
  'function isWalletSpendTransaction',
  "'admin_debit'",
  "'staff_debit'",
  'return -absoluteAmount',
  'Trusted principal:',
  'Eligible refund restore:',
  'Trusted available:',
], 'admin UI must render admin debits as negative and expose trusted backing context')

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

console.log(JSON.stringify({
  ok: true,
  assertions: [
    'admin unsuspend recalculates wallet backing before status changes',
    'admin credits require admin actor plus approval metadata and refunds only restore linked trusted debit capacity',
    'NOWPayments verifies IPN signature before DB mutation',
    'NOWPayments auto-credit remains disabled and held for manual review',
    'NOWPayments provider lookup binds payment identity, reference, currency, and amount',
    'bills and Bitrefill debit before provider dispatch',
    'bills and Bitrefill refunds carry original debit provenance',
    'Bitrefill redemption value is looked up only after provider order creation',
    'admin debit/staff debit render negative in user history',
    'order-history credentials are completed-order only at the data boundary',
    'SMM status workers cannot dispatch new provider orders',
    'SMM status workers refund through wallet engine with source-order provenance',
    'pending-payment recovery is cron/service authorized and delegates to verification',
    'verify-and-credit-wallet validates pending payment/provider evidence before credit',
    'staff worker SMS refunds use wallet engine and approving-admin provenance',
    'revenue/admin-alert logging helpers cannot dispatch suppliers, reveal value, or throw delivery-changing errors',
    'current worker-like functions cannot dispatch suppliers from stale status/recovery/admin messages',
  ],
}, null, 2))
