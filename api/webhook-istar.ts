// Public raw-byte bridge. Verification and all credentials live in Supabase.
function istarEdgeUrl(): string | null {
  const origin = process.env.VITE_SUPABASE_URL
  if (!['https://dssvvswvqnxanyzfhixf.supabase.co',
    'https://ktmlojvchkmzcdbjdyjx.supabase.co'].includes(origin || '')) return null
  return `${origin}/functions/v1/istar-webhook`
}
const MAX_BODY_BYTES = 65536
const MAX_RESPONSE_BYTES = 32768
const BODY_TIMEOUT_MS = 5000
// Combined with the five-second request-body limit, leave a response margin
// under the supplier's ten-second delivery deadline. Edge persists before ACK.
const UPSTREAM_TIMEOUT_MS = 4000

export const config = { api: { bodyParser: false } }

async function readRawBody(req: any): Promise<Buffer> {
  const declaredLength = req.headers?.['content-length']
  if (declaredLength && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new Error('BODY_TOO_LARGE')
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body, 'utf8')
    if (body.length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
    return body
  }
  if (req.body !== undefined && req.body !== null) throw new Error('INVALID_BODY')
  const chunks: Buffer[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('BODY_TIMEOUT')), BODY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([(async () => {
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        length += bytes.length
        if (length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
        chunks.push(bytes)
      }
      return Buffer.concat(chunks)
    })(), timeout])
  } catch (error) {
    req.pause?.()
    throw error
  } finally { clearTimeout(timer) }
}

async function readResponse(upstream: Response,
  trackReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void): Promise<string> {
  const declared = upstream.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    void upstream.body?.cancel().catch(() => {})
    throw new Error('RESPONSE_TOO_LARGE')
  }
  const reader = upstream.body?.getReader()
  if (!reader) throw new Error('INVALID_RESPONSE')
  trackReader(reader)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {})
        throw new Error('RESPONSE_TOO_LARGE')
      }
      chunks.push(chunk.value)
    }
  } finally {
    trackReader(null)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let requestUrl: URL
  try { requestUrl = new URL(req.url || '/api/webhook-istar', 'https://tallystore.org') }
  catch { return res.status(400).json({ error: 'Invalid webhook request' }) }
  if (requestUrl.search) {
    return res.status(400).json({ error: 'Webhook verification must use headers' })
  }
  const edgeUrl = istarEdgeUrl()
  if (!edgeUrl) return res.status(503).json({ error: 'Webhook project is not configured' })
  const signature = req.headers?.['x-istar-signature']
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }
  let body: Buffer
  try { body = await readRawBody(req) } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    return res.status(reason === 'BODY_TOO_LARGE' ? 413 : reason === 'BODY_TIMEOUT' ? 408 : 400)
      .json({ error: 'Invalid webhook body' })
  }
  const controller = new AbortController()
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      if (activeReader) void activeReader.cancel().catch(() => {})
      reject(new Error('UPSTREAM_TIMEOUT'))
    }, UPSTREAM_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([(async () => {
      const upstream = await fetch(edgeUrl, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-istar-signature': signature },
        body,
      })
      if (controller.signal.aborted || upstream.redirected) {
        void upstream.body?.cancel().catch(() => {})
        throw new Error('INVALID_RESPONSE')
      }
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {})
        const status = [400, 401, 405, 408, 413, 500, 503].includes(upstream.status) ? upstream.status : 502
        return { status, payload: { error: 'Webhook verification or processing failed' } }
      }
      const parsed = JSON.parse(await readResponse(upstream, reader => { activeReader = reader }))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_RESPONSE')
      if (parsed.received === true) return { status: 200, payload: { received: true } }
      if (parsed.success === true) return { status: 200, payload: { success: true } }
      const allowed = ['No order id — ignored', 'Order reference not matched', 'Already processed',
        'Terminal order needs manual review', 'Order changed; manual review required',
        'Already in terminal state', 'Failed order needs manual review', 'Refund held for review',
        'Supplier order needs manual review']
      if (typeof parsed.message !== 'string' || !allowed.includes(parsed.message)) throw new Error('INVALID_RESPONSE')
      return { status: 200, payload: { message: parsed.message } }
    })(), timeout])
    return res.status(result.status).json(result.payload)
  } catch {
    controller.abort()
    return res.status(502).json({ error: 'Webhook bridge unavailable' })
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (activeReader) void activeReader.cancel().catch(() => {})
  }
}
