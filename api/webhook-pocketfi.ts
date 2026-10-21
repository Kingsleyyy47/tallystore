// Preserve provider-signed bytes. Provider keys and wallet settlement stay in Supabase.
const TARGET = 'https://ktmlojvchkmzcdbjdyjx.supabase.co/functions/v1/webhook-pocketfi'
const VERIFICATION_HEADERS = ['authorization', 'pocketfi-signature', 'http_pocketfi_signature',
  'x-pocketfi-signature', 'x-webhook-signature', 'x-pocketfi-webhook-secret', 'x-webhook-secret']
class BodyLimit extends Error {}
async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!body || signal.aborted) throw new Error('BODY_UNAVAILABLE')
  const reader = body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  const abort = () => {void reader.cancel().catch(() => {})}
  signal.addEventListener('abort', abort, {once: true})
  try {
    for (;;) {const part = await reader.read(); if (part.done) break; size += part.value.byteLength
      if (size > limit) throw new BodyLimit(); chunks.push(part.value)}
    if (signal.aborted) throw new Error('BODY_TIMEOUT')
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
    return bytes
  } finally {signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); try {reader.releaseLock()} catch {}}
}
export function createPocketfiProxy(transport: typeof fetch = fetch, timeoutMs = 20000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 20000) throw new Error('INVALID_TIMEOUT')
  return async function proxy(request: Request): Promise<Response> {
    const json = (value: unknown, status: number) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}})
    if (request.method !== 'POST') return json({error: 'Method not allowed'}, 405)
    if (new URL(request.url).searchParams.has('token')) return json({error: 'Webhook secrets must be sent in headers'}, 400)
    const headers = new Headers({'Accept': 'application/json', 'Content-Type': request.headers.get('content-type') || 'application/json'})
    for (const name of VERIFICATION_HEADERS) {const value = request.headers.get(name); if (value) headers.set(name, value)}
    if (!VERIFICATION_HEADERS.some(name => headers.has(name))) return json({error: 'Missing PocketFi verification header'}, 401)
    const length = request.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) return json({error: 'Webhook body is too large'}, 413)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
    let raw: Uint8Array | undefined
    try {
      raw = await boundedBytes(request.body, 65536, controller.signal)
      if (!raw.byteLength) return json({error: 'Webhook body is required'}, 400)
      const upstream = await transport(TARGET, {method: 'POST', headers, body: raw, redirect: 'error', signal: controller.signal})
      if (!upstream.ok) {void upstream.body?.cancel().catch(() => {}); return json({error: 'PocketFi webhook verification or processing failed'}, upstream.status)}
      const response = await boundedBytes(upstream.body, 32768, controller.signal)
      return new Response(response, {status: upstream.status, headers: {'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store'}})
    } catch (error) {return json({error: 'PocketFi webhook bridge unavailable'}, error instanceof BodyLimit && !raw ? 413 : 502)}
    finally {clearTimeout(timer); controller.abort(); raw?.fill(0)}
  }
}
// Web Standard entry keeps the original stream even for application/json.
export default {fetch: createPocketfiProxy()}
