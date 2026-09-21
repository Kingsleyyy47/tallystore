import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const tempDir = mkdtempSync(join(tmpdir(), 'tally-wallet-reconcile-'))

try {
  const ledgerA = join(tempDir, 'tallystore-user-history-osas-a.csv')
  const ledgerB = join(tempDir, 'tallystore-user-history-osas-b.csv')
  const orders = join(tempDir, 'tallystore-user-orders-osas.csv')
  const derived = join(tempDir, 'rileygreen-unexplained-wallet-changes.csv')

  const ledgerCsv = [
    'source,id,type,status,amount,description,reference,wallet_balance',
    'transactions,tx-1,purchase,completed,-1820,Purchase: sample one,ref-1,443680',
    'transactions,tx-2,purchase,completed,-4500,Purchase: FRANCE FB,ref-2,443680',
    'transactions,tx-3,purchase,completed,-10000,Purchase: failed order,failed-order-1,433680',
    'transactions,tx-4,refund,completed,4000,Partial refund for failed order,failed-order-1,437680',
  ].join('\n')

  writeFileSync(ledgerA, ledgerCsv)
  writeFileSync(ledgerB, ledgerCsv)
  writeFileSync(orders, [
    'source,order_id,status,product_name,total_amount',
    'orders,tx-2,completed,FRANCE FB,4500',
    'orders,failed-order-1,failed,FAILED TEST PRODUCT,10000',
  ].join('\n'))
  writeFileSync(derived, [
    'next_recorded_transaction_time_utc,previous_recorded_balance,implied_balance,unexplained_difference',
    '2026-09-10T01:40:57Z,95500,559999,464499',
  ].join('\n'))

  const result = spawnSync(process.execPath, [
    'scripts/wallet-reconcile-readonly.mjs',
    '--json',
    '--history-csv',
    [ledgerA, ledgerB, orders, derived].join(','),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })

  assert(result.status === 0, `offline reconcile command failed:\n${result.stderr || result.stdout}`)

  const report = JSON.parse(result.stdout)
  assert(report.environment === 'offline-csv', 'offline report must use offline-csv environment')
  assert(report.files.length === 4, 'offline report must include every supplied file')
  assert(report.files.some((file) => file.classification === 'supporting_derived_analysis' && file.countedInTotals === false), 'derived analysis CSV must be excluded from totals')
  assert(report.coverage.rawRows === 10, `expected 10 counted raw rows before dedupe, got ${report.coverage.rawRows}`)
  assert(report.coverage.uniqueRows === 6, `expected 6 unique rows after dedupe, got ${report.coverage.uniqueRows}`)
  assert(report.coverage.duplicateRows === 4, `expected 4 duplicate rows, got ${report.coverage.duplicateRows}`)
  assert(report.coverage.completedPurchaseTransactions === 3, 'expected three completed purchase transaction rows')
  assert(report.coverage.completedOrderRows === 1, 'expected one completed order row')
  assert(report.coverage.matchedOrderRows === 1, 'matching order row must be detected')
  assert(report.coverage.unmatchedOrderRows === 0, 'matching order row must not become additional loss')
  assert(report.retailValue.completedPurchaseTransactions === 16320, 'purchase transaction retail total should be NGN 16,320')
  assert(report.retailValue.completedOrderRows === 4500, 'order retail total should be NGN 4,500')
  assert(report.retailValue.matchedOrderRowsExcludedFromLossTotal === 4500, 'matched order value must be excluded from loss total')
  assert(report.retailValue.dedupedRecordedPurchaseValue === 16320, 'deduped recorded purchase value should not double-count duplicate exports or matching orders')
  assert(report.evidenceFlags.failedOrRefundedRowsWithPostedDebits.length === 1, 'failed order with posted debit must be reported for review')
  const failedOrder = report.evidenceFlags.failedOrRefundedRowsWithPostedDebits[0]
  assert(failedOrder.debitAmount === 10000, `failed order debit should be NGN 10,000, got ${failedOrder.debitAmount}`)
  assert(failedOrder.refundAmount === 4000, `failed order refund should be NGN 4,000, got ${failedOrder.refundAmount}`)
  assert(failedOrder.unresolvedDebitAmount === 6000, `failed order unresolved exposure should be NGN 6,000, got ${failedOrder.unresolvedDebitAmount}`)

  console.log(JSON.stringify({
    ok: true,
    scenarios: [
      'duplicate raw exports are deduped before totals',
      'matching order rows are excluded from recorded purchase loss totals',
      'derived analysis files are supporting evidence and not independent spend',
      'failed/refunded order rows with posted debits are reported with unresolved exposure',
      'offline CSV mode requires no production credentials',
    ],
    coverage: report.coverage,
    retailValue: report.retailValue,
  }, null, 2))
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
