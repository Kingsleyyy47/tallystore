import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

const scannedRoots = [
  'api',
  'pages/api',
  'src',
  'supabase/functions',
]

const sourceFiles = scannedRoots
  .flatMap((dir) => walk(dir))
  .filter((path) => /\.(ts|tsx|js|mjs)$/.test(path))
  .sort()

const approvedDirectTransactionMutations = [
  {
    path: 'supabase/functions/admin-adjust-balance/index.ts',
    requiredFileMarkers: [
      "body?.action === 'record_ledger_credit'",
      "source: 'admin-ledger-repair'",
      'balance_unchanged: true',
      'requires_owner_evidence: true',
    ],
    requiredSegmentMarkers: [
      ".from('transactions')",
      '.insert(repairPayload)',
      ".select('*')",
    ],
  },
]

const directProfileBalanceWritePattern = /\.(insert|update|upsert)\s*\(\s*\{[^}]*\b(wallet_balance|crypto_balance|referral_balance)\b/s
const transactionTableReferencePattern = /\.from\(['"]transactions['"]\)/g
const transactionMutationInChainPattern = /\.(insert|update|delete|upsert)\s*\(/
const legacyWalletRpcPattern = /\.rpc\(['"](update_wallet_balance|credit_crypto_balance|deduct_crypto_balance|transfer_crypto_to_wallet|withdraw_referral_balance_to_wallet)['"]/g
const dangerousProfileSqlPattern = /\bupdate\s+(?:public\.)?profiles\s+set\s+[^;]*(wallet_balance|crypto_balance|referral_balance|account_suspended|is_admin|is_staff)\b/gi

const findings = []

for (const path of sourceFiles) {
  const src = read(path)

  if (directProfileBalanceWritePattern.test(src)) {
    findings.push({
      type: 'direct_profile_balance_write_literal',
      path,
      detail: 'Direct Supabase insert/update/upsert payload includes a protected balance column.',
    })
  }

  for (const match of src.matchAll(transactionTableReferencePattern)) {
    const segment = statementSegment(src, match.index ?? 0)
    if (transactionMutationInChainPattern.test(segment) && !isApprovedDirectTransactionMutation(path, src, segment)) {
      findings.push({
        type: 'direct_transactions_table_mutation',
        path,
        offset: match.index,
        detail: 'Direct mutation of transactions table found outside the audited balance-neutral admin repair path.',
      })
    }
  }

  for (const match of src.matchAll(legacyWalletRpcPattern)) {
    findings.push({
      type: 'legacy_wallet_rpc_call',
      path,
      offset: match.index,
      detail: `Legacy wallet RPC call found: ${match[1]}.`,
    })
  }

  const dangerousSql = src.match(dangerousProfileSqlPattern)
  if (dangerousSql) {
    findings.push({
      type: 'direct_profile_financial_sql',
      path,
      detail: 'Raw SQL updates protected profile financial/security columns.',
    })
  }
}

const summary = {
  ok: findings.length === 0,
  scannedFiles: sourceFiles.length,
  scannedRoots,
  approvedDirectTransactionMutations: approvedDirectTransactionMutations.map((item) => item.path),
  findings,
  acceptanceBoundary: [
    'This is a source-level pattern audit only.',
    'It complements, but does not replace, staging database grant/RLS/trigger tests.',
    'Approved direct transaction mutation is limited to balance-neutral admin ledger repair evidence.',
  ],
}

console.log(JSON.stringify(summary, null, 2))

if (findings.length > 0) process.exit(1)

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function walk(dir, files = []) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return files

  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    const rel = relative(root, full).replaceAll('\\', '/')

    if (statSync(full).isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry)) walk(rel, files)
    } else {
      files.push(rel)
    }
  }

  return files
}

function isApprovedDirectTransactionMutation(path, src, segment) {
  return approvedDirectTransactionMutations.some((approval) => (
    approval.path === path &&
    approval.requiredFileMarkers.every((marker) => src.includes(marker)) &&
    approval.requiredSegmentMarkers.every((marker) => segment.includes(marker))
  ))
}

function statementSegment(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1
  const lineEnd = src.indexOf('\n', index)
  const lines = [src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)]
  let cursor = lineEnd === -1 ? src.length : lineEnd + 1

  while (cursor < src.length) {
    const nextLineEnd = src.indexOf('\n', cursor)
    const line = src.slice(cursor, nextLineEnd === -1 ? src.length : nextLineEnd)
    const trimmed = line.trim()
    if (!trimmed.startsWith('.')) break
    lines.push(line)
    cursor = nextLineEnd === -1 ? src.length : nextLineEnd + 1
  }

  return lines.join('\n')
}
