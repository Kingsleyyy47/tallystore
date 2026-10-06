// The provider's public Order schema is flat. Some older integrations wrap the
// same Order in `data` or `order`, with request claims in `payload`. All
// identity/value claims in these known wrappers must agree.
export type IstarOrderKind = 'stars' | 'premium'
export type IstarWalletType = 'USDT' | 'TON'
export type IstarOrderStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type IstarExpectedOrder = {
  kind: IstarOrderKind
  username: string
  walletType: IstarWalletType
  quantity?: number
  months?: number
  providerOrderId?: string
  recipientHash?: string
  amount?: string | number
}

export type VerifiedIstarOrder = {
  orderId: string
  status: IstarOrderStatus
  username: string
  walletType: IstarWalletType
  amount: string
  quantity?: number
  months?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECIMAL = /^\d{1,32}(?:\.\d{1,18})?$/

export function canonicalIstarOrderId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== 'string') return null
  if (UUID.test(value)) return value.toLowerCase()
  if (!/^\d{1,20}$/.test(value)) return null
  const integer = BigInt(value)
  return integer > 0n ? integer.toString() : null
}

export function canonicalIstarAmount(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return null
  const raw = String(value)
  if (!DECIMAL.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  const normalizedWhole = BigInt(whole).toString()
  const normalizedFraction = fraction.replace(/0+$/, '')
  if (normalizedWhole === '0' && !normalizedFraction) return null
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function present(rows: Record<string, unknown>[], key: string): unknown[] {
  return rows.filter(row => Object.hasOwn(row, key) && row[key] !== null && row[key] !== undefined)
    .map(row => row[key])
}

function exactAliases(rows: Record<string, unknown>[], keys: string[],
  expected: unknown, normalize: (value: unknown) => unknown): boolean {
  return keys.every(key => present(rows, key).every(value => normalize(value) === expected))
}

// A null result means "outcome unknown/review". It must never authorize a
// second supplier send, a customer refund, or a completed order.
export function validateIstarOrderReceipt(value: unknown,
  expected: IstarExpectedOrder): VerifiedIstarOrder | null {
  const outer = record(value)
  if (!outer || !['stars', 'premium'].includes(expected.kind)
    || typeof expected.username !== 'string' || expected.username.length === 0
    || !['USDT', 'TON'].includes(expected.walletType)) return null
  const nestedData = record(outer.data)
  const nestedOrder = record(outer.order)
  if ((outer.data != null && !nestedData) || (outer.order != null && !nestedOrder)) return null
  const wrappers = [outer, ...(nestedData ? [nestedData] : []), ...(nestedOrder ? [nestedOrder] : [])]
  const payloads: Record<string, unknown>[] = []
  for (const wrapper of wrappers) {
    if (wrapper.payload == null) continue
    const payload = record(wrapper.payload)
    if (!payload) return null
    payloads.push(payload)
  }
  const rows = [...wrappers, ...payloads]
  const source = nestedOrder || nestedData || outer
  const orderId = canonicalIstarOrderId(source.order_id ?? source.id)
  const status = source.status
  const amount = canonicalIstarAmount(source.amount)
  if (!orderId || !['pending', 'processing', 'completed', 'failed'].includes(status as string)
    || typeof source.username !== 'string' || source.username !== expected.username
    || source.wallet_type !== expected.walletType || !amount) return null
  if (!exactAliases(rows, ['order_id', 'id'], orderId, canonicalIstarOrderId)
    || !exactAliases(rows, ['status'], status, value => value)
    || !exactAliases(rows, ['username'], expected.username, value => value)
    || !exactAliases(rows, ['wallet_type'], expected.walletType, value => value)
    || !exactAliases(rows, ['amount'], amount, canonicalIstarAmount)) return null
  if (expected.providerOrderId !== undefined
    && canonicalIstarOrderId(expected.providerOrderId) !== orderId) return null
  if (expected.amount !== undefined
    && canonicalIstarAmount(expected.amount) !== amount) return null
  const providerKind = expected.kind === 'stars' ? 'star' : 'premium'
  if (!exactAliases(rows, ['order_type'], providerKind, value => value)) return null
  const recipientClaims = rows.flatMap(row => [
    ...present([row], 'recipient_hash'), ...present([row], 'recipient'),
  ])
  if (recipientClaims.some(value => typeof value !== 'string' || value.length === 0
    || value !== recipientClaims[0])) return null
  if (expected.recipientHash !== undefined) {
    if (recipientClaims.some(value => value !== expected.recipientHash)) return null
  }
  if (expected.kind === 'stars') {
    if (!Number.isSafeInteger(expected.quantity) || (expected.quantity ?? 0) < 50
      || (expected.quantity ?? 0) > 1_000_000
      || !exactAliases(rows, ['quantity'], expected.quantity, value => value)
      || present(rows, 'months').length) return null
    if (source.quantity !== expected.quantity) return null
  } else {
    if (![3, 6, 12].includes(expected.months ?? 0)
      || !exactAliases(rows, ['months'], expected.months, value => value)
      || present(rows, 'quantity').length) return null
    if (source.months !== expected.months) return null
  }
  return {
    orderId, status: status as IstarOrderStatus, username: expected.username,
    walletType: expected.walletType, amount,
    ...(expected.kind === 'stars' ? { quantity: expected.quantity } : { months: expected.months }),
  }
}
