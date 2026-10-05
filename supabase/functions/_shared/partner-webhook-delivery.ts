// This module deliberately has no default HTTP implementation. A normal fetch
// after a DNS lookup is vulnerable to rebinding. Production callers must pass
// an egress transport that connects only to one of the checked IPv4 addresses,
// preserves the original hostname for TLS/SNI verification, and never follows
// redirects. Without that transport, delivery fails closed.
export type PinnedWebhookTransport = {
  resolveAll: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>
  postPinned: (request: {
    url: string
    hostname: string
    verifiedIpv4: readonly string[]
    method: 'POST'
    headers: Record<string, string>
    body: string
    redirect: 'error'
    signal: AbortSignal
  }) => Promise<Response>
}
type Partner = { id: unknown; is_active?: unknown; owner_reviewed_at?: unknown;
  webhook_url?: unknown; webhook_secret?: unknown }
type Order = { id: unknown; partner_id?: unknown; partner_reference?: unknown;
  status?: unknown; item_type?: unknown; amount_ngn?: unknown; currency?: unknown }
export type WebhookDeliveryResult = {
  state: 'delivered' | 'rejected' | 'outcome_unknown'
  code: string
  http_status?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_STATUS: Record<string, readonly string[]> = {
  'partner.order.completed': ['completed'],
  'partner.order.active': ['active'],
  'partner.order.processing': ['processing'],
  'partner.order.failed': ['failed', 'cancelled', 'canceled'],
  'partner.order.refunded': ['failed', 'cancelled', 'canceled'],
}
const ITEM_TYPES = new Set(['product', 'sms', 'social_boost', 'bills_airtime', 'giftcards', 'telegram_stars'])
const TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 4_096

export function isPublicIpv4(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return false
  const parts = value.split('.').map(Number)
  if (parts.some((part, index) => part > 255 || (String(part) !== value.split('.')[index]))) return false
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
    || (a === 203 && b === 0 && c === 113)) return false
  return true
}

export function validatePartnerWebhookUrl(value: unknown): { url: string; hostname: string } | null {
  if (typeof value !== 'string' || value.length < 12 || value.length > 500
    || /[\u0000-\u0020\u007f]/.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || url.hash || !url.hostname || url.hostname.length > 253) return null
  const hostname = url.hostname.toLowerCase()
  // All IP literals, including IPv4 numeric encodings and IPv4-mapped IPv6,
  // are refused. DNS answers must also be public IPv4 only.
  if (hostname.includes(':') || /^(?:\d+\.){3}\d+$/.test(hostname)
    || !/^[a-z0-9.-]+$/.test(hostname)
    || !hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')
    || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /\.(?:localhost|local|internal|lan|home|corp|invalid|test)$/i.test(hostname)) return null
  return { url: url.toString(), hostname }
}

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)))
  return `sha256=${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function boundedResponse(response: Response): Promise<boolean> {
  if (!response.body) return true
  const reader = response.body.getReader()
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return true
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); return false }
    }
  } finally { reader.releaseLock() }
}

export async function deliverPartnerWebhookSafely(input: {
  partner: Partner
  order: Order
  eventType: string
  keyScopes: readonly string[]
  transport?: PinnedWebhookTransport
  nowMs?: number
  timeoutMs?: number
}): Promise<WebhookDeliveryResult> {
  const { partner, order, eventType, keyScopes, transport } = input
  const target = validatePartnerWebhookUrl(partner?.webhook_url)
  const status = String(order?.status || '').toLowerCase()
  const itemType = String(order?.item_type || '')
  const amount = Number(order?.amount_ngn)
  if (!target || !UUID.test(String(partner?.id || '')) || partner.is_active !== true
    || !partner.owner_reviewed_at || !UUID.test(String(order?.id || ''))
    || order.partner_id !== partner.id || !Array.isArray(keyScopes)
    || !keyScopes.includes('orders:read') || !EVENT_STATUS[eventType]?.includes(status)
    || !ITEM_TYPES.has(itemType) || !Number.isFinite(amount) || amount <= 0
    || order.currency && order.currency !== 'NGN') return { state: 'rejected', code: 'WEBHOOK_NOT_AUTHORIZED' }
  const secret = partner.webhook_secret
  if (typeof secret !== 'string' || !/^tly_whsec_[0-9a-f]{64}$/.test(secret)) {
    return { state: 'rejected', code: 'WEBHOOK_SECRET_MISSING' }
  }
  if (!transport || typeof transport.resolveAll !== 'function' || typeof transport.postPinned !== 'function') {
    return { state: 'rejected', code: 'PINNED_EGRESS_REQUIRED' }
  }
  const reference = typeof order.partner_reference === 'string' && order.partner_reference.length <= 180
    ? order.partner_reference : null
  const nowMs = Number.isSafeInteger(input.nowMs) ? input.nowMs! : Date.now()
  const timestamp = String(Math.floor(nowMs / 1000))
  const body = JSON.stringify({ event: eventType, created_at: new Date(nowMs).toISOString(),
    partner_id: partner.id, data: { order: { id: order.id, partner_reference: reference,
      item_type: itemType, amount_ngn: amount, currency: 'NGN', status } } })
  const controller = new AbortController()
  const timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs! >= 1
    && input.timeoutMs! <= TIMEOUT_MS ? input.timeoutMs! : TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('webhook deadline')), { once: true })
  })
  try {
    const addresses = await Promise.race([transport.resolveAll(target.hostname, controller.signal), deadline])
    if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 16
      || !addresses.every(isPublicIpv4)) return { state: 'rejected', code: 'WEBHOOK_DNS_UNSAFE' }
    const verifiedIpv4 = Object.freeze([...new Set(addresses)])
    const response = await Promise.race([transport.postPinned({ url: target.url, hostname: target.hostname,
      verifiedIpv4, method: 'POST', body, redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'TallyStore-Partner-API/2.0',
        'X-Tally-Event': eventType, 'X-Tally-Partner-Id': String(partner.id),
        'X-Tally-Timestamp': timestamp,
        'X-Tally-Signature': await sign(secret, timestamp, body) } }), deadline])
    if (response.status >= 300 && response.status < 400) return { state: 'outcome_unknown', code: 'WEBHOOK_REDIRECT_REFUSED', http_status: response.status }
    const withinLimit = await Promise.race([boundedResponse(response), deadline])
    if (!withinLimit) return { state: 'outcome_unknown', code: 'WEBHOOK_RESPONSE_TOO_LARGE', http_status: response.status }
    return response.ok
      ? { state: 'delivered', code: 'WEBHOOK_DELIVERED', http_status: response.status }
      : { state: 'outcome_unknown', code: 'WEBHOOK_HTTP_FAILURE', http_status: response.status }
  } catch {
    return { state: 'outcome_unknown', code: 'WEBHOOK_TRANSPORT_UNAVAILABLE' }
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}
