import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { IStarProvider } from '../_shared/istar-provider.ts'

// Manual/scheduled worker for the private inbox. No schedule is installed by
// this function or its migration.
const DATABASE_URLS = new Set([
  'https://dssvvswvqnxanyzfhixf.supabase.co',
  'https://ktmlojvchkmzcdbjdyjx.supabase.co',
])
const RPCS = new Set(['claim_istar_webhook_events','defer_istar_webhook_event','settle_istar_webhook_event'])
const RPC_TIMEOUT_MS = 8000
const MAX_RPC_RESPONSE_BYTES = 262144

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  if (provided.length < 32 || expected.length < 32 || provided.length > 256 || expected.length > 256) return false
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [actual, required] = await Promise.all([digest(provided), digest(expected)])
  let different = 0
  for (let i = 0; i < required.length; i++) different |= actual[i] ^ required[i]
  return different === 0
}

async function rpc(name: string, args: Record<string, unknown>, key: string, databaseUrl: string) {
  if (!RPCS.has(name)) throw new Error('WORKER_RPC_REJECTED')
  if (!DATABASE_URLS.has(databaseUrl)) throw new Error('WORKER_DATABASE_TARGET_REJECTED')
  const controller = new AbortController()
  const activeReader: { current: ReadableStreamDefaultReader<Uint8Array> | null } = { current: null }
  const cancelActiveReader = () => {
    const reader = activeReader.current
    if (reader) void reader.cancel().catch(() => {})
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      cancelActiveReader()
      reject(new Error('WORKER_RPC_TIMEOUT'))
    }, RPC_TIMEOUT_MS)
  })
  try {
    const admin = createClient(databaseUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.origin !== databaseUrl || url.pathname !== `/rest/v1/rpc/${name}` || controller.signal.aborted) {
          throw new Error('WORKER_DATABASE_TARGET_REJECTED')
        }
        const response = await fetch(input, {
          ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        })
        if (controller.signal.aborted || response.redirected || !response.body) {
          void response.body?.cancel().catch(() => {})
          throw new Error('WORKER_DATABASE_RESPONSE_REJECTED')
        }
        const reader = response.body.getReader()
        activeReader.current = reader
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            length += chunk.value.byteLength
            if (length > MAX_RPC_RESPONSE_BYTES) throw new Error('WORKER_DATABASE_RESPONSE_TOO_LARGE')
            chunks.push(chunk.value)
          }
        } finally {
          if (activeReader.current === reader) activeReader.current = null
          void reader.cancel().catch(() => {})
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        return new Response(bytes, { status: response.status, headers: response.headers })
      } },
    })
    const result = await Promise.race([admin.rpc(name, args), deadline])
    if (result.error) throw new Error('WORKER_RPC_FAILED')
    return result.data
  } finally {
    controller.abort()
    cancelActiveReader()
    clearTimeout(timer)
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (new URL(req.url).search) return json({ error: 'Invalid worker request' }, 400)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const providerKey = Deno.env.get('ISTAR_API_KEY') || ''
  const workerToken = Deno.env.get('ISTAR_WEBHOOK_WORKER_TOKEN') || ''
  const databaseUrl = Deno.env.get('SUPABASE_URL') || ''
  if (Deno.env.get('ISTAR_WEBHOOK_QUEUE_ENABLED') !== 'true' || !serviceKey || !providerKey
    || workerToken.length < 32 || workerToken.length > 256
    || !DATABASE_URLS.has(databaseUrl)) return json({ error: 'Worker unavailable' }, 503)
  const authorization = req.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ') || !await tokenMatches(authorization.slice(7), workerToken)) {
    return json({ error: 'Unauthorized' }, 401)
  }
  let claimed: any[]
  try {
    const data = await rpc('claim_istar_webhook_events', { p_limit: 1 }, serviceKey, databaseUrl)
    if (!Array.isArray(data)) throw new Error('WORKER_CLAIM_INVALID')
    claimed = data
  } catch { return json({ error: 'Worker queue unavailable' }, 503) }

  let processed = 0
  let deferred = 0
  let review = 0
  for (const event of claimed) {
    if (!event?.id || !event?.lease_token || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(String(event.provider_order_id))) {
      continue
    }
    try {
      const provider = new IStarProvider({
        apiKey: providerKey,
        baseURL: Deno.env.get('ISTAR_BASE_URL') || 'https://v1.fragmentapi.com/api/v1/partner',
      })
      const receipt = await provider.get(`/orders/${event.provider_order_id}`)
      const result = await rpc('settle_istar_webhook_event', {
        p_event_id: event.id, p_lease_token: event.lease_token, p_receipt: receipt,
      }, serviceKey, databaseUrl)
      if (result?.success) { processed++; continue }
      if (result?.code === 'ISTAR_LEASE_STALE') continue
      const manual = ['ISTAR_RECEIPT_MISMATCH','ISTAR_TERMINAL_CONFLICT',
        'ISTAR_RECEIPT_INVALID'].includes(result?.code)
      await rpc('defer_istar_webhook_event', {
        p_event_id: event.id, p_lease_token: event.lease_token,
        p_error: String(result?.code || 'SETTLEMENT_UNAVAILABLE'), p_manual_review: manual,
      }, serviceKey, databaseUrl)
      if (manual) review++; else deferred++
    } catch {
      try {
        await rpc('defer_istar_webhook_event', {
          p_event_id: event.id, p_lease_token: event.lease_token,
          p_error: 'PROVIDER_OR_SETTLEMENT_UNAVAILABLE', p_manual_review: false,
        }, serviceKey, databaseUrl)
        deferred++
      } catch { /* Expired leases become claimable again. */ }
    }
  }
  return json({ processed, deferred, review })
})
