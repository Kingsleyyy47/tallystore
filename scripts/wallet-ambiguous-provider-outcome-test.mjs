import { readFileSync } from 'node:fs'

for (const route of ['purchase-bills', 'create-withdrawal-request']) {
  const source = readFileSync(`supabase/functions/${route}/index.ts`, 'utf8')
  if (/type:\s*['"]refund['"]/.test(source)) {
    throw new Error(`${route} must not auto-refund an ambiguous provider outcome`)
  }
  if (!source.includes("status: 'pending'") ||
      !source.includes("status: 'outcome_unknown'") ||
      !source.includes("outcome: 'outcome_unknown'") ||
      !source.includes("The wallet debit remains posted pending review.")) {
    throw new Error(`${route} must retain funds and expose an unknown-outcome state`)
  }
  if (/sagecloud_response:\s*JSON\.stringify\((?:purchaseResponse|transferResponse)\)|(?:purchase|transfer)_response:\s*(?:purchaseResponse|transferResponse)/.test(source)) {
    throw new Error(`${route} exposes a raw provider response`)
  }
  if (/const errorText = await response\.text\(\)|console\.error\(['"]Database error:/.test(source)) {
    throw new Error(`${route} may log or return a raw provider/database error`)
  }
}

const bills = readFileSync('supabase/functions/purchase-bills/index.ts', 'utf8')
if (!bills.includes("const unresolved = existingTransaction.status === 'pending'")) {
  throw new Error('A bills idempotency replay must not call a pending order successful')
}
for (const marker of [
  'const { data: existingTransaction, error: existingTransactionError } = await supabaseAdmin',
  "throw new Error('Could not verify existing bills transaction')",
  'const { data: billRecord, error: dbError } = await supabaseAdmin',
]) {
  if (!bills.includes(marker)) throw new Error(`Bills server-owned order path missing: ${marker}`)
}

const withdrawal = readFileSync('supabase/functions/create-withdrawal-request/index.ts', 'utf8')
if (!withdrawal.includes("throw new Error('Bank account could not be verified')") ||
    withdrawal.includes('proceeding with provided name')) {
  throw new Error('Withdrawal must stop before debit when bank verification fails')
}

const bitrefill = readFileSync('supabase/functions/purchase-bitrefill/index.ts', 'utf8')
if (/type:\s*['"]refund['"]|order:\s*existingOrder|bitrefill_response:\s*invoice|const errorText = await response\.text\(\)/.test(bitrefill)) {
  throw new Error('Bitrefill must not auto-refund or disclose raw pending/provider data')
}
for (const marker of [
  "const completed = existingOrder.status === 'successful'",
  'redemption: completed ?',
  'bitrefill_invoice_id: invoiceId',
  "outcome: 'outcome_unknown'",
  "if (blockSettingError) throw new Error('Could not verify product availability')",
  "if (markupSettingError) throw new Error('Could not verify product price')",
]) {
  if (!bitrefill.includes(marker)) throw new Error(`Bitrefill missing safety marker: ${marker}`)
}

const telegram = readFileSync('supabase/functions/telegram-stars/index.ts', 'utf8')
const supplierCatches = telegram.match(/catch \(_err\) \{[\s\S]*?SUPPLIER_OUTCOME_UNKNOWN[\s\S]*?\}, 202\)/g) || []
if (supplierCatches.length !== 2 || supplierCatches.some((block) => block.includes('refundWallet(')) ||
    !telegram.includes('Supplier outcome unknown; manual review required') ||
    (telegram.match(/if \(!istarOrder\?\.order_id\) throw new Error\('Supplier order confirmation missing'\)/g) || []).length !== 2 ||
    (telegram.match(/code: 'ORDER_OUTCOME_UNRESOLVED'/g) || []).length !== 2 ||
    (telegram.match(/if \(orderTrackingError \|\| !trackedOrder\) throw new Error\('Supplier order tracking unavailable'\)/g) || []).length !== 2 ||
    telegram.includes('You have been refunded.') ||
    telegram.includes('error_message: err.message') ||
    telegram.includes('error: err.message')) {
  throw new Error('Telegram supplier ambiguity must retain the debit and hide provider errors')
}
const confirmedFailure = telegram.indexOf("if (istarOrder.status === 'failed'")
const reviewResponse = telegram.indexOf("code: 'SUPPLIER_OUTCOME_REVIEW_REQUIRED'", confirmedFailure)
const adminCancel = telegram.slice(telegram.indexOf('async function handleAdminCancelOrder'))
if (confirmedFailure < 0 || reviewResponse < confirmedFailure ||
    telegram.includes('await refundWallet(') ||
    !adminCancel.includes("code: 'TELEGRAM_CANCELLATION_REVIEW_REQUIRED'")) {
  throw new Error('Telegram polling and admin cancellation must hold ambiguous refunds for review')
}

console.log('Ambiguous provider outcomes retain funds and require reconciliation.')
