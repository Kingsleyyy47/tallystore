import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg === '--help' || arg === '-h') {
    printHelp()
    process.exit(0)
  }
  if (arg.startsWith('--')) {
    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? process.argv[i + 1]
    if (inlineValue == null && value && !value.startsWith('--')) i += 1
    args.set(key, value === undefined || value.startsWith('--') ? 'true' : value)
  }
}

const WALLET_DEBIT_TYPES = [
  'purchase',
  'admin_debit',
  'staff_debit',
  'debit',
  'withdrawal',
  'chargeback',
  'correction_debit',
]

const WALLET_REFUND_TYPES = ['refund', 'purchase_refund', 'auto_refund']

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

function printHelp() {
  console.log(`Read-only wallet reconciliation.

Usage:
  TALLYSTORE_RECONCILE_ENV=staging TALLYSTORE_RECONCILE_READONLY=I_UNDERSTAND_READ_ONLY \\
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
  npm run security:wallet:reconcile -- --user-id <uuid>

Options:
  --user-id <uuid>        Reconcile one profile by id.
  --email <email>         Reconcile one profile by email.
  --since <iso-date>      Limit supporting event scans to a lower bound.
  --history-csv <paths>   Offline CSV export reconciliation. Use comma-separated local file paths.
  --allow-production      Required when TALLYSTORE_RECONCILE_ENV=production.
  --json                 Output compact JSON only.
  --self-test            Validate parser/backing helpers without Supabase.
`)
}

const historyCsvPaths = splitInputPaths(args.get('history-csv'))
const envName = String(process.env.TALLYSTORE_RECONCILE_ENV || '').trim().toLowerCase()
const readonlyAck = String(process.env.TALLYSTORE_RECONCILE_READONLY || '').trim()
const allowProduction = args.get('allow-production') === 'true'
const jsonOnly = args.get('json') === 'true'
const userIdArg = cleanText(args.get('user-id'))
const emailArg = cleanText(args.get('email'))?.toLowerCase()
const sinceArg = cleanText(args.get('since'))
const sinceDate = sinceArg ? new Date(sinceArg) : null
const offlineCsvMode = historyCsvPaths.length > 0

if (!offlineCsvMode && !['staging', 'production'].includes(envName)) {
  fail('Set TALLYSTORE_RECONCILE_ENV to staging or production. Refusing unknown environment.')
}
if (!offlineCsvMode && envName === 'production' && !allowProduction) {
  fail('Production reconciliation requires --allow-production. This command is read-only but still touches production evidence.')
}
if (!offlineCsvMode && readonlyAck !== 'I_UNDERSTAND_READ_ONLY') {
  fail('Set TALLYSTORE_RECONCILE_READONLY=I_UNDERSTAND_READ_ONLY to confirm no corrective writes should be attempted.')
}
if (!offlineCsvMode && !userIdArg && !emailArg) {
  fail('Provide --user-id or --email.')
}
if (sinceDate && Number.isNaN(sinceDate.getTime())) {
  fail('--since must be an ISO-compatible date.')
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!offlineCsvMode && (!supabaseUrl || !serviceRoleKey)) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for owner-controlled read-only evidence collection.')
}

const supabase = offlineCsvMode ? null : createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const run = async () => {
  if (offlineCsvMode) {
    const report = reconcileHistoryCsvFiles(historyCsvPaths)
    if (jsonOnly) console.log(JSON.stringify(report, null, 2))
    else printCsvReport(report)
    return
  }

  const profile = await findProfile()
  const userId = profile.id
  const [
    transactions,
    orders,
    smmOrders,
    smsOrders,
    billsTransactions,
    bitrefillOrders,
    cryptoWithdrawals,
    pendingPayments,
    pocketfiWebhookLogs,
    cryptoTransactions,
  ] = await Promise.all([
    selectRows('transactions', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('orders', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('smm_orders', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('sms_orders', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('bills_transactions', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('bitrefill_orders', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('crypto_withdrawals', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('pending_payments', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
    selectRows('pocketfi_webhook_logs', 'id,matched_user_id,matched_account_number,processed,verified_amount_ngn,verified_reference,verified_status,error_message,created_at', (q) => q.eq('matched_user_id', userId).order('created_at', { ascending: true })),
    selectRows('crypto_transactions', '*', (q) => q.eq('user_id', userId).order('created_at', { ascending: true })),
  ])

  const adminActorIds = await loadAdminActorIds(transactions)

  const filteredTransactions = filterSince(transactions)
  const walletTransactions = filteredTransactions.filter((row) =>
    String(row.balance_type || 'wallet').toLowerCase() === 'wallet' &&
    String(row.status || 'completed').toLowerCase() === 'completed'
  )
  const backing = calculateWalletBacking(walletTransactions, adminActorIds, { pendingPayments, pocketfiWebhookLogs })
  const duplicateReferences = duplicatesBy(transactions.filter((row) => row.reference), (row) => `${row.type || ''}:${row.reference}`)
  const duplicateIdempotencyKeys = duplicatesBy(transactions.filter((row) => row.idempotency_key), (row) => row.idempotency_key)
  const orphaned = {
    productPurchases: orphanedByIdempotency(transactions, orders, 'purchase:', 'purchase'),
    smmPurchases: orphanedByIdempotency(transactions, smmOrders, 'smm:purchase:', 'purchase'),
    smsPurchases: orphanedByIdempotency(transactions, smsOrders, 'sms:purchase:', 'purchase'),
    billsPurchases: orphanedByMetadataId(transactions, billsTransactions, 'purchase-bills', 'transaction_id'),
    bitrefillPurchases: orphanedByMetadataId(transactions, bitrefillOrders, 'purchase-bitrefill', 'order_id'),
    withdrawals: orphanedByMetadataId(transactions, cryptoWithdrawals, 'create-withdrawal-request', 'withdrawal_id'),
  }
  const failedOrRefundedRowsWithDebits = {
    productOrders: terminalRowsWithPostedDebits(transactions, orders, {
      label: 'orders',
      debitPrefix: 'purchase:',
      refundOrderTable: 'orders',
    }),
    smmOrders: terminalRowsWithPostedDebits(transactions, smmOrders, {
      label: 'smm_orders',
      debitPrefix: 'smm:purchase:',
      refundOrderTable: 'smm_orders',
    }),
    smsOrders: terminalRowsWithPostedDebits(transactions, smsOrders, {
      label: 'sms_orders',
      debitPrefix: 'sms:purchase:',
      refundOrderTable: 'sms_orders',
    }),
    billsTransactions: terminalRowsWithPostedDebits(transactions, billsTransactions, {
      label: 'bills_transactions',
      metadataSource: 'purchase-bills',
      metadataIdField: 'transaction_id',
      refundOrderTable: 'bills_transactions',
    }),
    bitrefillOrders: terminalRowsWithPostedDebits(transactions, bitrefillOrders, {
      label: 'bitrefill_orders',
      metadataSource: 'purchase-bitrefill',
      metadataIdField: 'order_id',
      refundOrderTable: 'bitrefill_orders',
    }),
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: envName,
    target: { userId, email: profile.email || null },
    coverage: {
      since: sinceDate ? sinceDate.toISOString() : null,
      transactions: transactions.length,
      filteredTransactions: filteredTransactions.length,
      orders: orders.length,
      smmOrders: smmOrders.length,
      smsOrders: smsOrders.length,
      billsTransactions: billsTransactions.length,
      bitrefillOrders: bitrefillOrders.length,
      cryptoWithdrawals: cryptoWithdrawals.length,
      pendingPayments: pendingPayments.length,
      cryptoTransactions: cryptoTransactions.length,
    },
    profile: {
      id: profile.id,
      email: profile.email || null,
      walletBalance: number(profile.wallet_balance),
      cryptoBalance: number(profile.crypto_balance),
      referralBalance: number(profile.referral_balance),
      isAdmin: profile.is_admin === true,
      isStaff: profile.is_staff === true,
      accountSuspended: profile.account_suspended === true,
      suspensionReason: profile.suspension_reason || null,
      createdAt: profile.created_at || null,
      updatedAt: profile.updated_at || null,
    },
    walletBacking: {
      storedWalletBalance: number(profile.wallet_balance),
      trustedCredits: backing.trustedCredits,
      grossDebits: backing.grossDebits,
      completedRefunds: backing.completedRefunds,
      eligibleRefunds: backing.eligibleRefunds,
      trustedConsumedSpend: backing.trustedConsumedSpend,
      backedAvailable: backing.backedAvailable,
      unexplainedDifference: number(profile.wallet_balance) - backing.backedAvailable,
    },
    evidenceFlags: {
      duplicateReferences,
      duplicateIdempotencyKeys,
      orphaned,
      failedOrRefundedRowsWithDebits,
      pendingPaymentsWithoutCompletedTopup: pendingPayments.filter((payment) => {
        const ref = String(payment.transaction_reference || payment.reference || '')
        return ref && !transactions.some((tx) => tx.reference === ref && ['topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'].includes(String(tx.type || '').toLowerCase()))
      }),
      cryptoReviewItems: cryptoTransactions.filter((row) =>
        ['completed_pending_review', 'completed_pending_release', 'blocked_review', 'verification_failed'].includes(String(row.status || '').toLowerCase())
      ),
    },
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
  }
}

function cleanText(value) {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

function splitInputPaths(value) {
  const text = cleanText(value)
  if (!text) return []
  return text.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function number(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function absMoneyFromRow(row) {
  for (const field of [
    'amount',
    'amount_ngn',
    'total_amount',
    'total_ngn',
    'price_ngn',
    'price',
    'cost',
    'value',
    'wallet_balance',
    'balance',
  ]) {
    if (row[field] == null || row[field] === '') continue
    const parsed = parseMoney(row[field])
    if (parsed != null) return Math.abs(parsed)
  }
  return 0
}

function parseMoney(value) {
  const text = String(value ?? '').replace(/[₦,\s]/g, '').trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function fail(message) {
  console.error(`wallet-reconcile-readonly refused: ${message}`)
  process.exit(1)
}

function runSelfTest() {
  const splitPaths = splitInputPaths(' C:\\tmp\\raw.csv, C:\\tmp\\derived.csv ')
  assertSelf(splitPaths.length === 2, 'history CSV path splitting must handle comma-separated paths')
  assertSelf(splitPaths[0] === 'C:\\tmp\\raw.csv', 'history CSV path splitting must trim entries')

  const parsedRows = parseCsvText('id,description,amount\n1,"hello, there",-100\n')
  assertSelf(parsedRows.length === 1, 'CSV parser must parse one data row')
  assertSelf(parsedRows[0].description === 'hello, there', 'CSV parser must preserve quoted commas')

  const rawClass = classifyHistoryCsvFile('raw-ledger.csv', [{ type: 'purchase', amount: '-100', status: 'completed' }])
  const derivedClass = classifyHistoryCsvFile('rileygreen-unexplained-wallet-changes.csv', [{ previous_recorded_balance: '0', unexplained_difference: '100' }])
  assertSelf(rawClass.countedInTotals === true, 'raw ledger-shaped CSV must count in totals')
  assertSelf(derivedClass.countedInTotals === false && derivedClass.kind === 'supporting_derived_analysis', 'derived analysis CSV must be support-only')

  const backingRows = [
    {
      id: 'deposit-1',
      user_id: 'user-1',
      type: 'topup',
      amount: 100,
      reference: 'ref-1',
      external_payment_id: 'ercas-1',
      metadata: { provider: 'ercaspay', verified_amount_ngn: 100 },
      status: 'completed',
    },
    {
      id: 'admin-credit-1',
      type: 'admin_credit',
      amount: 50,
      created_by: 'admin-1',
      balance_before: 100,
      balance_after: 150,
      metadata: {
        approved_by: 'admin-1',
        approval_reference: 'approval-admin-credit-1',
        reason: 'verified business credit',
      },
      status: 'completed',
    },
    {
      id: 'admin-credit-without-approval-metadata',
      type: 'admin_credit',
      amount: 999,
      created_by: 'admin-1',
      balance_before: 150,
      balance_after: 1149,
      status: 'completed',
    },
    {
      id: 'debit-1',
      type: 'purchase',
      amount: -80,
      metadata: {
        trusted_principal_authorized: true,
        trusted_principal_debit_amount: 80,
        source_order_id: 'order-1',
        source_order_table: 'orders',
      },
      status: 'completed',
    },
    {
      id: 'loose-refund',
      type: 'refund',
      amount: 80,
      metadata: {},
      status: 'completed',
    },
    {
      id: 'linked-refund',
      type: 'refund',
      amount: 30,
      metadata: { source_debit_transaction_id: 'debit-1' },
      status: 'completed',
    },
  ]
  const backingAdminActors = new Set(['admin-1'])
  const backingEvidence = {
    pendingPayments: [{
      user_id: 'user-1',
      status: 'credited',
      amount: 100,
      transaction_reference: 'ref-1',
      ercas_reference: 'ercas-1',
    }],
  }
  const backing = calculateWalletBacking(backingRows, backingAdminActors, backingEvidence)

  assertSelf(backing.trustedCredits === 150, 'verified deposit plus approved admin credit must create trusted principal')
  assertSelf(backing.grossDebits === 80, 'purchase debit must consume principal capacity')
  assertSelf(backing.completedRefunds === 110, 'raw refund total must remain visible for review')
  assertSelf(backing.linkedEligibleRefunds === 30, 'only linked refund should restore trusted debit capacity')
  assertSelf(backing.eligibleRefunds === 30, 'loose refund must not become eligible trusted backing')
  assertSelf(backing.backedAvailable === 100, 'backed available must ignore loose refund money')

  const forgedMarkerBacking = calculateWalletBacking([
    ...backingRows,
    {
      id: 'fake-marked-debit',
      type: 'purchase',
      amount: -40,
      metadata: {
        trusted_principal_authorized: true,
      },
      status: 'completed',
    },
    {
      id: 'fake-marked-refund',
      type: 'refund',
      amount: 40,
      metadata: { source_debit_transaction_id: 'fake-marked-debit' },
      status: 'completed',
    },
  ], backingAdminActors, backingEvidence)
  assertSelf(forgedMarkerBacking.completedRefunds === 150, 'forged-marker raw refund must remain visible for review')
  assertSelf(forgedMarkerBacking.linkedEligibleRefunds === 30, 'forged trusted marker without trusted amount must not restore refund capacity')
  assertSelf(forgedMarkerBacking.eligibleRefunds === 30, 'forged trusted marker refund must not become eligible trusted backing')
  assertSelf(forgedMarkerBacking.backedAvailable === 60, 'forged trusted marker refund must not increase backed availability')

  console.log(JSON.stringify({
    ok: true,
    checks: 17,
    noSupabaseConnection: true,
    looseRefundsDoNotCreateTrustedFunds: true,
    forgedTrustedMarkersDoNotCreateTrustedFunds: true,
  }, null, 2))
}

function assertSelf(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function reconcileHistoryCsvFiles(paths) {
  const fileReports = []
  const rows = []

  for (const filePath of paths) {
    const csvText = readFileSync(filePath, 'utf8')
    const parsedRows = parseCsvText(csvText)
    const classification = classifyHistoryCsvFile(filePath, parsedRows)
    fileReports.push({
      path: filePath,
      rows: parsedRows.length,
      classification: classification.kind,
      countedInTotals: classification.countedInTotals,
      reason: classification.reason,
    })
    if (!classification.countedInTotals) continue
    parsedRows.forEach((row, index) => {
      rows.push({
        filePath,
        line: index + 2,
        source: String(row.source || row.table || row.section || '').toLowerCase(),
        row,
      })
    })
  }

  const duplicateRows = duplicateExportRows(rows)
  const uniqueRows = []
  const seen = new Set()
  for (const wrapped of rows) {
    const key = exportRowKey(wrapped)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueRows.push(wrapped)
  }

  const transactionPurchases = uniqueRows.filter((wrapped) => isCompletedPurchaseTransaction(wrapped.row, wrapped.source))
  const refundTransactions = uniqueRows.filter((wrapped) => isCompletedRefundTransaction(wrapped.row, wrapped.source))
  const completedOrderRows = uniqueRows.filter((wrapped) => isCompletedOrderRow(wrapped.row, wrapped.source))
  const terminalOrderRows = uniqueRows.filter((wrapped) => isTerminalOrderRow(wrapped.row, wrapped.source))
  const matchedOrderRows = completedOrderRows.filter((order) => transactionPurchases.some((tx) => rowsProbablyMatch(tx.row, order.row)))
  const unmatchedOrderRows = completedOrderRows.filter((order) => !matchedOrderRows.includes(order))
  const failedOrRefundedRowsWithPostedDebits = terminalOrderRowsWithPostedDebits(
    terminalOrderRows,
    transactionPurchases,
    refundTransactions,
  )
  const walletSnapshots = uniqueRows
    .map((wrapped) => {
      const balance = parseMoney(wrapped.row.wallet_balance ?? wrapped.row.displayed_wallet_balance ?? wrapped.row.balance)
      return balance == null ? null : {
        filePath: wrapped.filePath,
        line: wrapped.line,
        source: wrapped.source || null,
        walletBalance: balance,
      }
    })
    .filter(Boolean)

  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'offline-csv',
    files: fileReports,
    coverage: {
      rawRows: rows.length,
      uniqueRows: uniqueRows.length,
      duplicateRows: duplicateRows.reduce((sum, entry) => sum + entry.duplicateCount, 0),
      completedPurchaseTransactions: transactionPurchases.length,
      completedOrderRows: completedOrderRows.length,
      matchedOrderRows: matchedOrderRows.length,
      unmatchedOrderRows: unmatchedOrderRows.length,
      walletSnapshots: walletSnapshots.length,
    },
    retailValue: {
      completedPurchaseTransactions: sumRows(transactionPurchases),
      completedOrderRows: sumRows(completedOrderRows),
      matchedOrderRowsExcludedFromLossTotal: sumRows(matchedOrderRows),
      unmatchedOrderRowsAdditionalReviewValue: sumRows(unmatchedOrderRows),
      dedupedRecordedPurchaseValue: sumRows(transactionPurchases) + sumRows(unmatchedOrderRows),
    },
    duplicateRows,
    evidenceFlags: {
      failedOrRefundedRowsWithPostedDebits,
    },
    walletSnapshots,
    limitations: [
      'Offline CSV mode does not prove payment-provider funding, supplier delivery, or production database permissions.',
      'Derived analysis, mismatch, unexplained-change, and other non-raw files are listed as supporting evidence but excluded from transaction/order totals.',
      'Matching order rows are excluded from the deduped loss total when they appear to describe the same purchase already counted in transactions.',
      'Unmatched completed order rows are review evidence, not confirmed supplier cost.',
    ],
  }

  return report
}

function classifyHistoryCsvFile(filePath, rows) {
  const name = String(filePath || '').toLowerCase()
  const headers = new Set(Object.keys(rows[0] || {}))
  const hasRawLedgerShape = headers.has('type') && headers.has('amount') && headers.has('status')
  const hasRawOrderShape = (
    headers.has('order_id') ||
    headers.has('product_name') ||
    headers.has('item_name') ||
    headers.has('order_status')
  ) && (headers.has('status') || headers.has('order_status'))
  const looksDerivedByName = /analysis|mismatch|unexplained|reconciliation|derived/.test(name)
  const looksDerivedByHeaders = (
    headers.has('previous_recorded_balance') ||
    headers.has('implied_balance') ||
    headers.has('unexplained_difference') ||
    headers.has('mismatch') ||
    headers.has('expected_balance') ||
    headers.has('calculated_balance')
  )

  if (looksDerivedByName || looksDerivedByHeaders) {
    return {
      kind: 'supporting_derived_analysis',
      countedInTotals: false,
      reason: 'Derived analysis rows are not independent transaction/order evidence.',
    }
  }

  if (hasRawLedgerShape || hasRawOrderShape) {
    return {
      kind: hasRawLedgerShape ? 'raw_ledger_or_transaction_export' : 'raw_order_export',
      countedInTotals: true,
      reason: 'Raw transaction/order-shaped export.',
    }
  }

  return {
    kind: 'supporting_unknown_schema',
    countedInTotals: false,
    reason: 'Schema is not recognized as a raw transaction or order export.',
  }
}

function parseCsvText(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const headers = (rows.shift() || []).map(normalizeHeader)
  return rows
    .filter((cells) => cells.some((value) => String(value || '').trim()))
    .map((cells) => {
      const output = {}
      headers.forEach((header, index) => {
        if (!header) return
        output[header] = String(cells[index] ?? '').trim()
      })
      return output
    })
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function duplicateExportRows(rows) {
  const buckets = new Map()
  for (const wrapped of rows) {
    const key = exportRowKey(wrapped)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(wrapped)
  }

  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => ({
      key,
      occurrences: bucket.length,
      duplicateCount: bucket.length - 1,
      locations: bucket.map((wrapped) => `${wrapped.filePath}:${wrapped.line}`),
    }))
}

function exportRowKey(wrapped) {
  const row = wrapped.row
  const source = wrapped.source || 'unknown'
  const id = cleanText(row.id || row.transaction_id || row.order_id)
  if (id) return `${source}:${id}`
  return `${source}:${stableObjectKey(row)}`
}

function stableObjectKey(row) {
  return Object.keys(row)
    .sort()
    .map((key) => `${key}=${row[key]}`)
    .join('|')
}

function isCompletedPurchaseTransaction(row, source) {
  const type = String(row.type || row.transaction_type || row.kind || '').toLowerCase()
  const status = String(row.status || row.transaction_status || 'completed').toLowerCase()
  const amount = parseMoney(row.amount)
  const looksLikeTransaction = source.includes('transaction') || source === 'wallet' || type === 'purchase'
  const isPurchase = type.includes('purchase') || String(row.description || row.message || '').toLowerCase().startsWith('purchase:')
  const isCompleted = ['completed', 'success', 'successful', 'paid', 'settled'].includes(status)
  return looksLikeTransaction && isPurchase && isCompleted && (amount == null || amount < 0)
}

function isCompletedRefundTransaction(row, source) {
  const type = String(row.type || row.transaction_type || row.kind || '').toLowerCase()
  const status = String(row.status || row.transaction_status || 'completed').toLowerCase()
  const amount = parseMoney(row.amount)
  const looksLikeTransaction = source.includes('transaction') || source === 'wallet' || type.includes('refund')
  const isRefund = type.includes('refund') || String(row.description || row.message || '').toLowerCase().includes('refund')
  const isCompleted = ['completed', 'success', 'successful', 'paid', 'settled'].includes(status)
  return looksLikeTransaction && isRefund && isCompleted && (amount == null || amount > 0)
}

function isCompletedOrderRow(row, source) {
  const status = String(row.status || row.order_status || '').toLowerCase()
  const type = String(row.type || row.item_type || row.product_type || '').toLowerCase()
  const isOrderSource = source.includes('order') || row.order_id || row.product_name || row.item_name
  const isCompleted = ['completed', 'fulfilled', 'success', 'successful', 'delivered'].includes(status)
  return isOrderSource && isCompleted && !type.includes('refund')
}

function isTerminalOrderRow(row, source) {
  const status = String(row.status || row.order_status || '').toLowerCase()
  const type = String(row.type || row.item_type || row.product_type || '').toLowerCase()
  const isOrderSource = source.includes('order') || row.order_id || row.product_name || row.item_name
  const isTerminal = ['failed', 'cancelled', 'canceled', 'refunded', 'refund_posted', 'refund_pending'].includes(status)
  return isOrderSource && isTerminal && !type.includes('refund')
}

function terminalOrderRowsWithPostedDebits(terminalOrderRows, purchaseTransactions, refundTransactions) {
  return terminalOrderRows
    .map((order) => {
      const debits = purchaseTransactions.filter((tx) => rowsProbablyMatch(tx.row, order.row))
      const refunds = refundTransactions.filter((tx) => rowsProbablyMatch(tx.row, order.row))
      const debitAmount = sumRows(debits)
      const refundAmount = sumRows(refunds)
      return {
        filePath: order.filePath,
        line: order.line,
        source: order.source || null,
        id: order.row.id || order.row.order_id || null,
        status: order.row.status || order.row.order_status || null,
        debitAmount,
        refundAmount,
        unresolvedDebitAmount: Math.max(debitAmount - refundAmount, 0),
        debitRows: debits.map((wrapped) => ({
          filePath: wrapped.filePath,
          line: wrapped.line,
          id: wrapped.row.id || wrapped.row.transaction_id || null,
          amount: absMoneyFromRow(wrapped.row),
        })),
        refundRows: refunds.map((wrapped) => ({
          filePath: wrapped.filePath,
          line: wrapped.line,
          id: wrapped.row.id || wrapped.row.transaction_id || null,
          amount: absMoneyFromRow(wrapped.row),
        })),
      }
    })
    .filter((item) => item.debitRows.length > 0)
}

function rowsProbablyMatch(transactionRow, orderRow) {
  const txKeys = rowMatchKeys(transactionRow)
  const orderKeys = rowMatchKeys(orderRow)
  if (txKeys.some((key) => orderKeys.includes(key))) return true

  const txAmount = absMoneyFromRow(transactionRow)
  const orderAmount = absMoneyFromRow(orderRow)
  if (!txAmount || !orderAmount || txAmount !== orderAmount) return false

  const txName = cleanText(transactionRow.description || transactionRow.product_name || transactionRow.item_name)
  const orderName = cleanText(orderRow.description || orderRow.product_name || orderRow.item_name)
  if (!txName || !orderName) return false
  return normalizeComparable(txName).includes(normalizeComparable(orderName)) ||
    normalizeComparable(orderName).includes(normalizeComparable(txName))
}

function rowMatchKeys(row) {
  const keys = []
  for (const field of ['id', 'order_id', 'transaction_id', 'reference', 'external_reference', 'idempotency_key']) {
    const value = cleanText(row[field])
    if (value) keys.push(value)
  }
  return keys
}

function normalizeComparable(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function sumRows(rows) {
  return rows.reduce((sum, wrapped) => sum + absMoneyFromRow(wrapped.row), 0)
}

async function findProfile() {
  let query = supabase.from('profiles').select('*').limit(1)
  query = userIdArg ? query.eq('id', userIdArg) : query.ilike('email', emailArg)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Could not load profile: ${error.message}`)
  if (!data) throw new Error('Profile not found.')
  return data
}

async function selectRows(table, columns, apply) {
  let query = supabase.from(table).select(columns)
  if (sinceDate && table !== 'profiles') query = query.gte('created_at', sinceDate.toISOString())
  const { data, error } = await apply(query)
  if (error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST200'].includes(error.code)) return []
    throw new Error(`Could not read ${table}: ${error.message}`)
  }
  return Array.isArray(data) ? data : []
}

function filterSince(rows) {
  if (!sinceDate) return rows
  return rows.filter((row) => {
    const created = row.created_at ? new Date(row.created_at).getTime() : 0
    return created >= sinceDate.getTime()
  })
}

async function loadAdminActorIds(transactions) {
  const ids = Array.from(new Set(
    transactions
      .filter((row) => String(row.type || '').toLowerCase() === 'admin_credit' && row.created_by)
      .map((row) => String(row.created_by))
      .filter(Boolean)
  ))
  if (!ids.length) return new Set()
  const adminRows = await selectRows('profiles', 'id,is_admin', (q) => q.in('id', ids).eq('is_admin', true))
  return new Set(adminRows.map((row) => String(row.id)))
}

function calculateWalletBacking(rows, adminActorIds = new Set(), evidence = {}) {
  let trustedCredits = 0
  let grossDebits = 0
  let completedRefunds = 0
  const trustedDebitById = new Map()
  const refundRows = []
  for (const row of rows) {
    const type = String(row.type || '').toLowerCase()
    const amount = number(row.amount)
    const metadata = parseMetadata(row.metadata)
    const balanceBefore = number(row.balance_before)
    const balanceAfter = number(row.balance_after)
    const isBalanceNeutralAdminRepair = (
      String(metadata.source || '') === 'admin-ledger-repair' ||
      String(metadata.balance_unchanged || '').toLowerCase() === 'true' ||
      String(metadata.requires_owner_evidence || '').toLowerCase() === 'true' ||
      balanceAfter <= balanceBefore
    )
    if (amount > 0 && isVerifiedGatewayCredit(row, evidence) && ['topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'].includes(type)) {
      trustedCredits += amount
    } else if (
      amount > 0
      && type === 'admin_credit'
      && adminActorIds.has(String(row.created_by || ''))
      && hasApprovedAdminCreditEvidence(row, metadata)
      && !isBalanceNeutralAdminRepair
    ) {
      trustedCredits += amount
    }
    if (WALLET_DEBIT_TYPES.includes(type)) {
      grossDebits += Math.abs(amount)
      const trustedDebitAmount = trustedPrincipalDebitAmount(row, metadata, amount)
      if (trustedDebitAmount > 0) {
        const debitId = String(row.id || row.transaction_id || row.idempotency_key || '').trim()
        if (debitId) {
          trustedDebitById.set(debitId, {
            id: debitId,
            amount: trustedDebitAmount,
            idempotencyKey: String(row.idempotency_key || '').trim(),
            reference: String(row.reference || '').trim(),
            sourceOrderTable: String(metadata.source_order_table || '').trim(),
            sourceOrderIds: [
              metadata.source_order_id,
              metadata.order_id,
              metadata.transaction_id,
            ].map((value) => String(value || '').trim()).filter(Boolean),
          })
        }
      }
    }
    if (amount > 0 && WALLET_REFUND_TYPES.includes(type)) {
      completedRefunds += amount
      refundRows.push({ row, amount, metadata })
    }
  }
  const refundedByOriginal = new Map()
  for (const refund of refundRows) {
    const original = findTrustedOriginalDebit(refund.metadata, trustedDebitById)
    if (!original) continue
    const alreadyRefunded = refundedByOriginal.get(original.id) || 0
    const refundableRemaining = Math.max(original.amount - alreadyRefunded, 0)
    const eligibleAmount = Math.min(refund.amount, refundableRemaining)
    refundedByOriginal.set(original.id, alreadyRefunded + eligibleAmount)
  }
  const linkedEligibleRefunds = [...refundedByOriginal.values()].reduce((sum, amount) => sum + amount, 0)
  const trustedDebitCapacity = Math.min(grossDebits, trustedCredits)
  const eligibleRefunds = Math.min(linkedEligibleRefunds, trustedDebitCapacity)
  const trustedConsumedSpend = Math.max(trustedDebitCapacity - eligibleRefunds, 0)
  return {
    trustedCredits,
    grossDebits,
    completedRefunds,
    linkedEligibleRefunds,
    eligibleRefunds,
    trustedConsumedSpend,
    backedAvailable: Math.max(trustedCredits - trustedConsumedSpend, 0),
  }
}

function hasApprovedAdminCreditEvidence(row, metadata) {
  const createdBy = String(row.created_by || '').trim()
  return Boolean(createdBy)
    && String(metadata.approved_by || '').trim() === createdBy
    && String(metadata.approval_reference || '').trim().length >= 8
    && String(metadata.reason || '').trim().length >= 3
}

function trustedPrincipalDebitAmount(row, metadata, amount) {
  if (String(metadata.trusted_principal_authorized || '').toLowerCase() !== 'true') return 0
  const trustedAmount = number(metadata.trusted_principal_debit_amount)
  if (trustedAmount <= 0) return 0
  return Math.min(Math.abs(number(amount || row.amount)), trustedAmount)
}

function findTrustedOriginalDebit(refundMetadata, trustedDebitById) {
  const directId = String(refundMetadata.source_debit_transaction_id || '').trim()
  if (directId && trustedDebitById.has(directId)) return trustedDebitById.get(directId)

  const debitKey = String(
    refundMetadata.source_debit_idempotency_key ||
    refundMetadata.original_purchase_idempotency_key ||
    ''
  ).trim()
  if (debitKey) {
    const byKey = [...trustedDebitById.values()].find((debit) => debit.idempotencyKey && debit.idempotencyKey === debitKey)
    if (byKey) return byKey
  }

  const sourceOrderId = String(
    refundMetadata.source_order_id ||
    refundMetadata.order_id ||
    refundMetadata.transaction_id ||
    ''
  ).trim()
  const sourceOrderTable = String(refundMetadata.source_order_table || '').trim()
  if (sourceOrderId) {
    const byOrder = [...trustedDebitById.values()].find((debit) => {
      if (sourceOrderTable && debit.sourceOrderTable && debit.sourceOrderTable !== sourceOrderTable) return false
      return debit.sourceOrderIds.includes(sourceOrderId)
    })
    if (byOrder) return byOrder
  }

  const originalReference = String(refundMetadata.original_reference || '').trim()
  if (originalReference) {
    return [...trustedDebitById.values()].find((debit) => debit.reference && debit.reference === originalReference) || null
  }

  return null
}

function parseMetadata(metadata) {
  if (metadata && typeof metadata === 'object') return metadata
  if (typeof metadata === 'string' && metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function isVerifiedGatewayCredit(row, evidence = {}) {
  const amount = number(row.amount)
  const externalPaymentId = String(row.external_payment_id || '').trim()
  const reference = String(row.reference || '').trim()
  const metadata = parseMetadata(row.metadata)
  const provider = String(metadata.provider || '').toLowerCase()
  const verifiedAmount = number(metadata.verified_amount_ngn)

  if (!externalPaymentId || amount <= 0 || toCents(verifiedAmount) !== toCents(amount)) return false

  if (['ercaspay', 'ercas'].includes(provider)) {
    return Array.isArray(evidence.pendingPayments) && evidence.pendingPayments.some((payment) => {
      const paymentStatus = String(payment.status || 'pending').toLowerCase()
      const localRefs = [reference, externalPaymentId].filter(Boolean)
      const paymentRefs = [
        String(payment.transaction_reference || '').trim(),
        String(payment.ercas_reference || '').trim(),
      ].filter(Boolean)
      return String(payment.user_id || '') === String(row.user_id || '') &&
        paymentStatus === 'credited' &&
        toCents(number(payment.amount)) === toCents(amount) &&
        localRefs.some((localRef) => paymentRefs.includes(localRef))
    })
  }

  if (provider === 'pocketfi') {
    const webhookLogId = String(metadata.webhook_log_id || '').trim()
    return Boolean(webhookLogId) &&
      Array.isArray(evidence.pocketfiWebhookLogs) &&
      evidence.pocketfiWebhookLogs.some((log) =>
        String(log.id || '') === webhookLogId &&
        String(log.matched_user_id || '') === String(row.user_id || '') &&
        Boolean(log.processed) === true &&
        toCents(number(log.verified_amount_ngn)) === toCents(amount) &&
        [reference, externalPaymentId].filter(Boolean).includes(String(log.verified_reference || '').trim())
      )
  }

  return false
}

function toCents(value) {
  return Math.round(number(value) * 100)
}

function duplicatesBy(rows, keyFn) {
  const buckets = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (!key) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => ({
      key,
      rows: bucket.length,
      ids: bucket.map((row) => row.id),
      firstSeen: bucket[0]?.created_at || null,
      lastSeen: bucket[bucket.length - 1]?.created_at || null,
    }))
}

function orphanedByIdempotency(transactions, rows, prefix, type) {
  const existingKeys = new Set(rows.map((row) => row.idempotency_key).filter(Boolean))
  return transactions.filter((tx) =>
    String(tx.type || '').toLowerCase() === type &&
    String(tx.status || 'completed').toLowerCase() === 'completed' &&
    String(tx.idempotency_key || '').startsWith(prefix) &&
    !existingKeys.has(String(tx.idempotency_key).slice(prefix.length))
  ).map(minimalTx)
}

function orphanedByMetadataId(transactions, rows, source, idField) {
  const existingIds = new Set(rows.map((row) => String(row.id)))
  return transactions.filter((tx) => {
    const metadata = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {}
    return metadata.source === source && metadata[idField] && !existingIds.has(String(metadata[idField]))
  })
}

function terminalRowsWithPostedDebits(transactions, rows, options) {
  return rows
    .filter((row) => {
      const status = String(row.status || row.order_status || '').toLowerCase()
      return ['failed', 'cancelled', 'canceled', 'refunded', 'refund_posted', 'refund_pending'].includes(status)
    })
    .map((row) => {
      const debits = matchingLedgerRows(transactions, row, options, 'debit')
      const refunds = matchingLedgerRows(transactions, row, options, 'refund')
      const debitAmount = debits.reduce((sum, tx) => sum + Math.abs(number(tx.amount)), 0)
      const refundAmount = refunds.reduce((sum, tx) => sum + Math.abs(number(tx.amount)), 0)
      return {
        source: options.label,
        id: row.id || null,
        status: row.status || row.order_status || null,
        createdAt: row.created_at || null,
        idempotencyKey: row.idempotency_key || null,
        debitAmount,
        refundAmount,
        unresolvedDebitAmount: Math.max(debitAmount - refundAmount, 0),
        debitTransactions: debits.map(minimalTx),
        refundTransactions: refunds.map(minimalTx),
      }
    })
    .filter((item) => item.debitTransactions.length > 0)
}

function matchingLedgerRows(transactions, row, options, direction) {
  const wantedRefund = direction === 'refund'
  return transactions.filter((tx) => {
    const type = String(tx.type || '').toLowerCase()
    const isRefund = WALLET_REFUND_TYPES.includes(type)
    const isDebit = WALLET_DEBIT_TYPES.includes(type)
    if (wantedRefund ? !isRefund : !isDebit) return false

    const txMetadata = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {}
    if (options.refundOrderTable && wantedRefund) {
      if (
        String(txMetadata.source_order_table || '') === options.refundOrderTable &&
        String(txMetadata.source_order_id || '') === String(row.id || '')
      ) return true
    }
    if (options.debitPrefix && row.idempotency_key) {
      const expected = `${wantedRefund ? options.debitPrefix.replace(':purchase:', ':refund:') : options.debitPrefix}${row.idempotency_key}`
      if (String(tx.idempotency_key || '') === expected) return true
    }
    if (options.metadataSource && options.metadataIdField) {
      return txMetadata.source === options.metadataSource &&
        String(txMetadata[options.metadataIdField] || '') === String(row.id || '')
    }
    return false
  })
}

function minimalTx(tx) {
  return {
    id: tx.id,
    createdAt: tx.created_at || null,
    type: tx.type || null,
    amount: number(tx.amount),
    reference: tx.reference || null,
    idempotencyKey: tx.idempotency_key || null,
  }
}

function printReport(report) {
  console.log('Wallet Reconciliation Read-Only Report')
  console.log(`Environment: ${report.environment}`)
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Target: ${report.target.email || 'no email'} (${report.target.userId})`)
  console.log('')
  console.log('Wallet backing:')
  for (const [key, value] of Object.entries(report.walletBacking)) {
    console.log(`  ${key}: ${value}`)
  }
  console.log('')
  console.log('Evidence counts:')
  console.log(`  duplicateReferences: ${report.evidenceFlags.duplicateReferences.length}`)
  console.log(`  duplicateIdempotencyKeys: ${report.evidenceFlags.duplicateIdempotencyKeys.length}`)
  for (const [key, value] of Object.entries(report.evidenceFlags.orphaned)) {
    console.log(`  orphaned.${key}: ${value.length}`)
  }
  for (const [key, value] of Object.entries(report.evidenceFlags.failedOrRefundedRowsWithDebits)) {
    console.log(`  failedOrRefundedRowsWithDebits.${key}: ${value.length}`)
  }
  console.log(`  pendingPaymentsWithoutCompletedTopup: ${report.evidenceFlags.pendingPaymentsWithoutCompletedTopup.length}`)
  console.log(`  cryptoReviewItems: ${report.evidenceFlags.cryptoReviewItems.length}`)
  console.log('')
  console.log('Full JSON:')
  console.log(JSON.stringify(report, null, 2))
}

function printCsvReport(report) {
  console.log('Wallet Reconciliation Offline CSV Report')
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Files: ${report.files.map((file) => `${file.path} (${file.rows} rows)`).join(', ')}`)
  console.log('')
  console.log('Coverage:')
  for (const [key, value] of Object.entries(report.coverage)) {
    console.log(`  ${key}: ${value}`)
  }
  console.log('')
  console.log('Retail value:')
  for (const [key, value] of Object.entries(report.retailValue)) {
    console.log(`  ${key}: ${value}`)
  }
  console.log('')
  console.log('Limitations:')
  report.limitations.forEach((item) => console.log(`  - ${item}`))
  console.log('')
  console.log('Full JSON:')
  console.log(JSON.stringify(report, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
