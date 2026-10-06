import { validateGiftCardPurchaseSelection, type GiftCardPurchaseSelection } from './customer-giftcard-contract.ts'

// Bitrefill Personal API: Bearer token with the api.bitrefill.com host.
const ORIGIN = 'https://api.bitrefill.com/v2'
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/
const MAX_RESPONSE_BYTES = 1_000_000
const GET_DEADLINE_MS = 12_000
const POST_DEADLINE_MS = 20_000

async function limitedJson(response: Response,
  trackReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void): Promise<unknown> {
  const declared = Number(response.headers?.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('Provider response too large')
  if (!response.body) throw new Error('Provider invalid response')
  let raw = ''
  const reader = response.body.getReader()
  trackReader(reader)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Provider response too large')
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } finally {
    trackReader(null)
    void reader.cancel().catch(() => {})
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Provider invalid response') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider invalid response')
  return parsed
}

// Only the caller decides whether a financial POST is allowed. This client
// sends each call once, never retries, and never logs credentials or responses.
export class GiftCardProvider {
  private readonly token: string
  private readonly doFetch: typeof fetch
  constructor(token: string, doFetch: typeof fetch = fetch) {
    if (!token) throw new Error('Provider unavailable')
    this.token = token
    this.doFetch = doFetch
  }

  private async call(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const milliseconds = body === undefined ? GET_DEADLINE_MS : POST_DEADLINE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        if (activeReader) void activeReader.cancel().catch(() => {})
        reject(new Error('Provider deadline'))
      }, milliseconds)
    })
    try {
      const request = (async () => {
        const response = await this.doFetch(`${ORIGIN}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })
        if (!response.ok || response.redirected) throw new Error('Provider unavailable')
        return limitedJson(response, reader => { activeReader = reader })
      })()
      return await Promise.race([request, deadline])
    } finally {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }

  product(id: string) {
    if (!PRODUCT_ID.test(id)) throw new Error('Invalid product')
    return this.call(`/products/${encodeURIComponent(id)}`)
  }

  catalogue({ start = 0, limit = 20, query, country }: {
    start?: number; limit?: number; query?: string; country?: string
  } = {}) {
    if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      (query !== undefined && (!query.trim() || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query))) ||
      (country !== undefined && !/^[A-Z]{2}$/.test(country))) throw new Error('Invalid catalogue')
    const params = new URLSearchParams({ start: String(start), limit: String(limit), include_test_products: 'false' })
    if (query !== undefined) params.set('q', query)
    else params.set('type', 'gift_card')
    if (country !== undefined && query === undefined) params.set('country', country)
    return this.call(`${query === undefined ? '/products' : '/products/search'}?${params.toString()}`)
  }

  balance() { return this.call('/accounts/balance') }

  createUnpaidInvoice(rawRequest: GiftCardPurchaseSelection) {
    const request = validateGiftCardPurchaseSelection(rawRequest)
    if (!request) throw new Error('Invalid gift card request')
    const item: Record<string, unknown> = { product_id: request.product_id, quantity: request.quantity }
    if (request.package_id !== null) item.package_id = request.package_id
    else item.value = request.unit_value
    return this.call('/invoices', { products: [item], payment_method: 'balance', auto_pay: false })
  }

  pay(invoiceId: string) {
    if (!PROVIDER_ID.test(invoiceId)) throw new Error('Invalid invoice')
    // Irreversible. A database claim must fence this call before it is made.
    return this.call(`/invoices/${encodeURIComponent(invoiceId)}/pay`, {})
  }

  invoice(invoiceId: string) {
    if (!PROVIDER_ID.test(invoiceId)) throw new Error('Invalid invoice')
    return this.call(`/invoices/${encodeURIComponent(invoiceId)}`)
  }

  order(orderId: string) {
    if (!PROVIDER_ID.test(orderId)) throw new Error('Invalid order')
    return this.call(`/orders/${encodeURIComponent(orderId)}`)
  }
}
