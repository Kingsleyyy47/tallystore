import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// This route is deliberately inert until the separate inbox migration, worker
// credentials, and worker schedule have been reviewed and activated.
const DATABASE_URLS = new Set([
  'https://dssvvswvqnxanyzfhixf.supabase.co',
  'https://ktmlojvchkmzcdbjdyjx.supabase.co',
])
const MAX_BODY_BYTES = 65536
const BODY_TIMEOUT_MS = 1500
const ENQUEUE_TIMEOUT_MS = 2000
const MAX_DATABASE_RESPONSE_BYTES = 32768

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

async function readRawBody(req: Request): Promise<Uint8Array> {
  const declared = req.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error('BODY_TOO_LARGE')
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(new Error('BODY_TIMEOUT'))
    }, BODY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([(async () => {
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
        chunks.push(chunk.value)
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return bytes
    })(), deadline])
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}

async function verifySignature(bytes: Uint8Array, signature: string, secret: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false
  const exactBytes = new Uint8Array(bytes.byteLength)
  exactBytes.set(bytes)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16))
  return crypto.subtle.verify('HMAC', key, signatureBytes, exactBytes)
}

async function eventHash(bytes: Uint8Array): Promise<string> {
  const exactBytes = new Uint8Array(bytes.byteLength)
  exactBytes.set(bytes)
  const hash = await crypto.subtle.digest('SHA-256', exactBytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function boundedEnqueueFetch(input: RequestInfo | URL, init: RequestInit | undefined,
  signal: AbortSignal, databaseUrl: string): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin !== databaseUrl || url.pathname !== '/rest/v1/rpc/enqueue_istar_webhook_event'
    || signal.aborted) throw new Error('DATABASE_TARGET_REJECTED')
  const response = await fetch(input, { ...init, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' })
  if (signal.aborted || response.redirected || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new Error('DATABASE_RESPONSE_REJECTED')
  }
  const reader = response.body.getReader()
  const cancelReader = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancelReader, { once: true })
  if (signal.aborted) cancelReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_DATABASE_RESPONSE_BYTES) throw new Error('DATABASE_RESPONSE_TOO_LARGE')
      chunks.push(chunk.value)
    }
  } finally {
    signal.removeEventListener('abort', cancelReader)
    cancelReader()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new Response(bytes, { status: response.status, headers: response.headers })
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (new URL(req.url).search) return json({ error: 'Webhook verification must use headers' }, 400)
  const secret = Deno.env.get('ISTAR_WEBHOOK_SECRET') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const databaseUrl = Deno.env.get('SUPABASE_URL') || ''
  if (Deno.env.get('ISTAR_WEBHOOK_QUEUE_ENABLED') !== 'true' || secret.length < 8 || secret.length > 64
    || !serviceRoleKey
    || !DATABASE_URLS.has(databaseUrl)) return json({ error: 'Webhook unavailable' }, 503)
  let bytes: Uint8Array
  try { bytes = await readRawBody(req) } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    return json({ error: 'Invalid webhook body' }, reason === 'BODY_TOO_LARGE' ? 413 : reason === 'BODY_TIMEOUT' ? 408 : 400)
  }
  const signature = req.headers.get('x-istar-signature') || ''
  try {
    if (!await verifySignature(bytes, signature, secret)) return json({ error: 'Invalid webhook signature' }, 401)
  } catch { return json({ error: 'Invalid webhook signature' }, 401) }
  let payload: Record<string, any>
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    payload = JSON.parse(raw)
  } catch { return json({ error: 'Invalid signed webhook event' }, 400) }
  const providerOrderId = payload?.order?.id
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !['order.completed','order.failed'].includes(payload.event_type)
    || !['string','number'].includes(typeof providerOrderId)
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(String(providerOrderId))) {
    return json({ error: 'Invalid signed webhook event' }, 400)
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('ENQUEUE_TIMEOUT')) }, ENQUEUE_TIMEOUT_MS)
  })
  try {
    const admin = createClient(databaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => boundedEnqueueFetch(input, init, controller.signal, databaseUrl) },
    })
    const { data, error } = await Promise.race([admin.rpc('enqueue_istar_webhook_event', {
      p_event_hash: await eventHash(bytes), p_event_type: payload.event_type,
      p_provider_order_id: String(providerOrderId), p_raw_body: raw, p_signature: signature,
    }), deadline])
    if (error || !data?.success || !data?.event_id) throw new Error('ENQUEUE_FAILED')
    return json({ received: true })
  } catch {
    // The insert may have committed before the response was lost. Provider
    // retries are safe because the exact signed body hash is unique.
    return json({ error: 'Webhook persistence unavailable' }, 503)
  } finally { controller.abort(); clearTimeout(timer) }
})
