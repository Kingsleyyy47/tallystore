// Migration ingress only. Signed raw receipts commit in the Source inbox.
// No orders, wallet, refunds, provider requests, or Target credentials.
import crypto from 'crypto'
const SOURCE_ORIGIN = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const MAX_BODY_BYTES = 65536
// Web Standard fetch entry bypasses the legacy parsed req.body helper.

export function canonical(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('INVALID_PAYLOAD')
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    if (entries.some(([key]) => ['__proto__','constructor','prototype'].includes(key))) throw new Error('INVALID_PAYLOAD')
    return Object.fromEntries(entries.map(([key,item]) => [key,canonical(item,depth + 1)]))
  }
  return value
}

async function readRawBody(req: any): Promise<Buffer> {
  const declared = req.headers?.['content-length']
  if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error('TOO_LARGE')
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.from(req.body, 'utf8')
    if (raw.length > MAX_BODY_BYTES) {raw.fill(0); throw new Error('TOO_LARGE')}
    return raw
  }
  if (req.body !== undefined && req.body !== null) throw new Error('INVALID_BODY')
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  const chunks: Buffer[] = []
  let bytes = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {cancelled = true; req.pause?.(); reject(new Error('BODY_TIMEOUT'))}, 5000)
  })
  try {
    return await Promise.race([(async () => {
      for await (const chunk of req) {
        if (cancelled) throw new Error('BODY_TIMEOUT')
        const raw = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk)
        bytes += raw.length
        if (bytes > MAX_BODY_BYTES) {raw.fill(0); req.pause?.(); throw new Error('TOO_LARGE')}
        chunks.push(raw)
      }
      if (cancelled) throw new Error('BODY_TIMEOUT')
      return Buffer.concat(chunks, bytes)
    })(), timeout])
  } finally {cancelled = true; clearTimeout(timer); for (const b of chunks) b.fill(0)}
}

async function boundedReceipt(upstream: Response): Promise<boolean> {
  if (upstream.status !== 200 || !upstream.body) {await upstream.body?.cancel(); return false}
  const chunks: Uint8Array[] = []
  let n = 0
  for await (const b of upstream.body as any) {
    n += b.length
    if (n > 4096) throw new Error('INVALID_RECEIPT')
    chunks.push(b)
  }
  const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)))
  return !!payload && !Array.isArray(payload) && payload.durable === true && typeof payload.conflict === 'boolean'
}

// Parsed JSON cannot prove preservation of a rounded numeric token. Compare
// each original numeric token to its exact safe integer value; any decimal
// value outside that narrow contract is retained for review using raw hashes.
export function hasUnsafeNumericToken(text: string): boolean {
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g
  for (const match of text.matchAll(tokens)) {
    const token = match[0]
    if (token[0] === '"') continue
    const numeric = Number(token)
    if (!Number.isSafeInteger(numeric) || token.length > 128) return true
    const parts = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token)!
    const fraction = parts[3] || '', exponent = Number(parts[4] || 0) - fraction.length
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return true
    let coefficient = BigInt(parts[2] + fraction)
    if (parts[1]) coefficient = -coefficient
    if (exponent >= 0) coefficient *= 10n ** BigInt(exponent)
    else {const divisor = 10n ** BigInt(-exponent); if (coefficient % divisor !== 0n) return true; coefficient /= divisor}
    if (coefficient !== BigInt(numeric)) return true
  }
  return false
}

export async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'})
  try {if (new URL(req.url || '/api/webhook-istar', 'https://tallystore.org').search) return res.status(400).json({error: 'Invalid webhook request'})}
  catch {return res.status(400).json({error: 'Invalid webhook request'})}
  const secret = process.env.ISTAR_WEBHOOK_SECRET || ''
  if (!secret) return res.status(503).json({error: 'Webhook is not configured'})
  const signature = req.headers?.['x-istar-signature']
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return res.status(401).json({error: 'Invalid webhook signature'})
  let raw: Buffer
  try {raw = await readRawBody(req)} catch (e) {
    const reason = e instanceof Error ? e.message : ''
    return res.status(reason === 'TOO_LARGE' ? 413 : reason === 'BODY_TIMEOUT' ? 408 : 400).json({error: 'Invalid webhook body'})
  }
  try {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest()
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return res.status(401).json({error: 'Invalid webhook signature'})
    let payload: Record<string, any>, text: string, identity: string, canonicalHash: string
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(raw)
      payload = JSON.parse(text)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['order.completed','order.failed'].includes(payload.event_type)) throw new Error('INVALID_EVENT')
      const rawHash = crypto.createHash('sha256').update(raw).digest('hex')
      const rawId = payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order) ? payload.order.id : null
      const orderId = typeof rawId === 'string' ? rawId.trim() : typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : ''
      let review = !orderId || orderId.length > 160 || /[\u0000-\u001f\u007f]/.test(orderId) || hasUnsafeNumericToken(text)
      if (!review) {
        try {canonicalHash = crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')}
        catch {review = true}
      }
      // The inbox's existing review: contract prevents normal settlement claims.
      // Different unsafe numeric/identity bodies cannot collapse through JS rounding.
      if (review) {identity = 'review:istar:' + rawHash; canonicalHash = rawHash}
      else identity = orderId + ':' + payload.event_type
    } catch {return res.status(400).json({error: 'Invalid signed webhook event'})}
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (process.env.SUPABASE_URL !== SOURCE_ORIGIN || key.length < 30) return res.status(503).json({error: 'Webhook capture is not configured'})
    // Embed the already-validated original JSON object text. JSON numbers retain
    // their exact raw value for the database raw-body/payload binding check.
    const rpcBody = '{"p_provider":"istar","p_identity":' + JSON.stringify(identity) + ',"p_raw":' + JSON.stringify('\\x' + raw.toString('hex')) + ',"p_payload":' + text + ',"p_canonical_hash":' + JSON.stringify(canonicalHash) + ',"p_proof":' + JSON.stringify({contract: 'hmac-sha256-raw', signature}) + ',"p_ingress_project":"dssvvswvqnxanyzfhixf"}'
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const accepted = await Promise.race([(async () => {
        const response = await fetch(SOURCE_ORIGIN + '/rest/v1/rpc/migration_enqueue_verified', {
          method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + key, apikey: key}, body: rpcBody,
        })
        return await boundedReceipt(response)
      })(), new Promise<never>((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new Error('CAPTURE_TIMEOUT'))}, 4000)})])
      return accepted ? res.status(202).json({accepted: true}) : res.status(503).json({error: 'Webhook capture unavailable'})
    } catch {return res.status(502).json({error: 'Webhook capture unavailable'})}
    finally {clearTimeout(timer); controller.abort()}
  } finally {raw.fill(0)}
}

// Vercel's Web Standard entry receives the original byte stream for JSON as
// well as text bodies. Never reconstruct signed bytes from a parsed object.
export default {
  async fetch(request: Request): Promise<Response> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const req = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      pause() {if (reader) void reader.cancel().catch(() => {})},
      async *[Symbol.asyncIterator]() {
        if (!request.body) return
        reader = request.body.getReader()
        try {
          for (;;) {const part = await reader.read(); if (part.done) break; yield part.value}
        } finally {
          void reader.cancel().catch(() => {})
          try {reader.releaseLock()} catch { /* cancellation settles pending reads */ }
        }
      },
    }
    let status = 200
    const headers = new Headers()
    const res = {
      setHeader(name: string, value: string) {headers.set(name, value)},
      status(code: number) {status = code; return this},
      json(body: unknown) {return Response.json(body, {status, headers})},
    }
    return await handler(req, res)
  },
}
