const BASES = new Set(['https://v1.fragmentapi.com/api/v1/partner', 'https://sandbox.fragmentapi.com/api/v1/partner'])
const LIMIT = 512_000
const USERNAME = /^[A-Za-z0-9_]{5,32}$/
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/

function validGet(path: string): boolean {
  if (path === '/premium/packages') return true
  if (path.startsWith('/orders/')) return PROVIDER_ID.test(path.slice(8))
  const url = new URL(path, 'https://example.invalid')
  if (url.origin !== 'https://example.invalid' || url.hash) return false
  if (url.pathname === '/wallet/balance') return url.searchParams.size === 1
    && ['USDT', 'TON'].includes(url.searchParams.get('wallet_type') || '')
  if (!['/star/recipient/search', '/premium/recipient/search'].includes(url.pathname)) return false
  const key = url.pathname === '/star/recipient/search' ? 'quantity' : 'months'
  const raw = url.searchParams.get(key) || ''
  return url.searchParams.size === 2 && USERNAME.test(url.searchParams.get('username') || '')
    && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))
    && (key === 'quantity' ? Number(raw) >= 50 && Number(raw) <= 1_000_000 : [3, 6, 12].includes(Number(raw)))
}
function validPost(path: string, body: unknown): boolean {
  if (path !== '/orders/star' && path !== '/orders/premium') return false
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const row = body as Record<string, unknown>
  const key = path === '/orders/star' ? 'quantity' : 'months'
  return Object.keys(row).length === 4 && Object.keys(row).every(field => ['username','recipient_hash','wallet_type',key].includes(field))
    && typeof row.username === 'string' && USERNAME.test(row.username)
    && typeof row.recipient_hash === 'string' && /^[A-Za-z0-9_-]{6,500}$/.test(row.recipient_hash)
    && (row.wallet_type === 'USDT' || row.wallet_type === 'TON') && Number.isSafeInteger(row[key])
    && (key === 'quantity' ? Number(row[key]) >= 50 && Number(row[key]) <= 1_000_000 : [3,6,12].includes(Number(row[key])))
}

// Only server callers instantiate this client. Public requests cannot select
// a supplier host, path, credential, deadline or transport implementation.
export class IStarProvider {
  private readonly base: string
  private readonly key: string
  constructor({ apiKey, baseURL = 'https://v1.fragmentapi.com/api/v1/partner' }: { apiKey: string; baseURL?: string }) {
    if (!BASES.has(baseURL) || typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096
      || Array.from(apiKey).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Supplier configuration unavailable')
    this.base = baseURL
    this.key = apiKey
  }
  get(path: string): Promise<unknown> {
    if (!validGet(path)) return Promise.reject(new Error('Supplier request unavailable'))
    return this.request(path, 'GET')
  }
  post(path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
    if (!validPost(path, body) || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(idempotencyKey))
      return Promise.reject(new Error('Supplier request unavailable'))
    return this.request(path, 'POST', body, idempotencyKey)
  }
  private async request(path: string, method: 'GET'|'POST', body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Supplier request unavailable')) }, method === 'POST' ? 20_000 : 12_000)
    })
    const run = async () => {
      const response = await fetch(`${this.base}${path}`, {
        method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { 'API-Key': this.key, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      })
      const responseBody = response.body
      const rejectResponse = (): never => {
        void responseBody?.cancel().catch(() => {})
        throw new Error('Supplier request unavailable')
      }
      if (responseBody === null) throw new Error('Supplier request unavailable')
      if (controller.signal.aborted || !response.ok || response.redirected) rejectResponse()
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
      if (type !== 'application/json' && !type?.endsWith('+json')) rejectResponse()
      const declared = response.headers.get('Content-Length')
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) rejectResponse()
      reader = responseBody.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let size = 0
      let raw = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > LIMIT) throw new Error('Supplier request unavailable')
        raw += decoder.decode(chunk.value, { stream: true })
      }
      raw += decoder.decode()
      return JSON.parse(raw)
    }
    try { return await Promise.race([run(), deadline]) }
    catch { throw new Error('Supplier request unavailable') }
    finally {
      clearTimeout(timer)
      controller.abort()
      if (reader) void reader.cancel().catch(() => {})
    }
  }
}
