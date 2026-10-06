// Read-only display normalization for historical order snapshots. The original
// account_details JSON is retained unchanged in the order record.
type Account = Record<string, unknown>

const RAW_LINE_KEYS = ['raw_line', 'account_line', 'credential_line', 'credentials', 'original_line'] as const

function rawCredentialLine(account: Account): string | null {
  for (const key of RAW_LINE_KEYS) {
    if (typeof account[key] === 'string') return account[key] as string
  }
  const info = account.additional_info
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    for (const key of RAW_LINE_KEYS) {
      if (typeof (info as Account)[key] === 'string') return (info as Account)[key] as string
    }
  }
  // Some old imports placed a whole stock line in the username column.
  if (typeof account.username === 'string' && account.username.split('|').length >= 5) return account.username
  return null
}

export function normalizeOrderCredential(account: unknown): Account {
  if (!account || typeof account !== 'object' || Array.isArray(account)) return {}
  const source = account as Account
  const line = rawCredentialLine(source)
  if (!line) return { ...source }

  // The separator-adjacent spaces in an old stock line may be formatting or
  // part of a credential. Keep the exact original for copying and download;
  // the trimmed columns below are only a convenient parsed view.
  const withOriginalLine = { ...source, original_line: line }

  // Supplier deliveries already have explicit fields. Their spaces can be
  // part of a password or another opaque secret, so never reparse the raw line
  // over those stored values. Historical rows with only a stock line still use
  // the legacy parser below.
  if (typeof source.username === 'string' && source.username !== line &&
      typeof source.password === 'string') return withOriginalLine

  const parts = line.split('|').map((part) => part.trim())
  if (parts.length === 6 && parts[5] === '') parts.pop()
  // Only the documented five-column legacy format is positional. An
  // unrecognized line stays visible as originally stored; no fields are guessed.
  if (parts.length !== 5 || !parts[0] || !parts[1] ||
      (/^username\s*$/i.test(parts[0]) && /^password\s*$/i.test(parts[1]))) return withOriginalLine

  return {
    ...withOriginalLine,
    username: parts[0],
    password: parts[1],
    email: parts[2],
    email_password: parts[3],
    two_fa_code: parts[4],
  }
}

export function normalizeOrderCredentials(accounts: unknown): Account[] {
  return Array.isArray(accounts) ? accounts.map(normalizeOrderCredential) : []
}
