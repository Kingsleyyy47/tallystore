import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { dispatchPartnerWebhookEvent } from '../_shared/partner-webhook-dispatch.ts'
import { createRuntimePinnedWebhookTransport } from '../_shared/partner-webhook-transport.ts'

const MAX_BODY_BYTES = 512
const RUN_BUDGET_MS = 45_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (code: string, status: number, extra: Record<string, number> = {}) =>
  new Response(JSON.stringify({ code, ...extra }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

// Compare fixed-length digests so neither a prefix nor token length is a
// shortcut to authorization. Do not include either secret in logs or output.
async function sameSecret(presented: string, expected: string): Promise<boolean> {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [left, right] = await Promise.all([hash(presented), hash(expected)])
  let different = presented.length === expected.length ? 0 : 1
  for (let index = 0; index < left.length; index++) different |= left[index] ^ right[index]
  return different === 0
}
async function deadline<T>(call: () => PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(call), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('worker deadline')), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
async function boundedBody(req: Request): Promise<string | null> {
  const length = Number(req.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('body deadline')), 5_000)
    })
    while (true) {
      const part = await Promise.race([reader.read(), timedOut])
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY_BYTES) return null
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let position = 0
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
  finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined) }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply('METHOD_NOT_ALLOWED', 405)
  if (Deno.env.get('PARTNER_WEBHOOK_WORKER_ENABLED') !== 'true') return reply('UNAVAILABLE', 503)
  const expected = Deno.env.get('PARTNER_WEBHOOK_WORKER_SECRET') || ''
  const authorization = req.headers.get('authorization') || ''
  if (authorization.length > 2000) return reply('UNAUTHORIZED', 401)
  const presented = /^Bearer\s+([^\s]+)$/.exec(authorization)?.[1] || ''
  if (expected.length < 32 || !presented || !(await sameSecret(presented, expected))) return reply('UNAUTHORIZED', 401)
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply('INVALID_REQUEST', 400)
  let body: Record<string, unknown>
  try {
    const raw = await boundedBody(req)
    if (raw === null) return reply('INVALID_REQUEST', 400)
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply('INVALID_REQUEST', 400)
    body = parsed
  } catch { return reply('INVALID_REQUEST', 400) }
  if (Object.keys(body).some(key => key !== 'limit') || !Number.isInteger(body.limit)
    || Number(body.limit) < 1 || Number(body.limit) > 20) return reply('INVALID_REQUEST', 400)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const serviceUrl = Deno.env.get('SUPABASE_URL') || ''
  if (!serviceKey || !serviceUrl) return reply('UNAVAILABLE', 503)
  const transport = createRuntimePinnedWebhookTransport()
  if (!transport) return reply('UNAVAILABLE', 503)
  const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
  const started = Date.now()
  try {
    const listed = await deadline(() => admin.rpc('list_queued_api_partner_webhook_events', { p_limit: body.limit }), 5_000)
    if (listed.error || listed.data?.success !== true || !Array.isArray(listed.data.events)) return reply('UNAVAILABLE', 503)
    const totals = { delivered: 0, rejected: 0, outcome_unknown: 0, skipped: 0 }
    for (const event of listed.data.events.slice(0, Number(body.limit))) {
      // Leave unclaimed work for the next run if there is insufficient time
      // for a complete bounded transport and finalization round trip.
      if (Date.now() - started >= RUN_BUDGET_MS - 20_000) break
      const result = typeof event?.event_id === 'string' && UUID.test(event.event_id)
        ? await dispatchPartnerWebhookEvent(admin, event.event_id, transport)
        : 'skipped'
      totals[result]++
    }
    return reply('OK', 200, totals)
  } catch { return reply('UNAVAILABLE', 503) }
})
