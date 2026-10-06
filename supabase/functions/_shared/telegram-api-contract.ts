export type TelegramApiAction = 'catalogue' | 'quote' | 'recipient' | 'purchase' | 'status' | 'orders'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function validTelegramApiInput(input: Record<string, unknown>, action: TelegramApiAction,
  envelope: 'section' | 'action' = 'section'): boolean {
  if (!['catalogue', 'quote', 'recipient', 'purchase', 'status', 'orders'].includes(action)) return false
  const fields = action === 'catalogue' || action === 'orders' ? [envelope] :
    action === 'status' ? [envelope, 'order_id'] :
    [envelope, 'product_type', ...(input.product_type === 'stars' ? ['quantity'] : ['product_id']),
      ...(action === 'recipient' || action === 'purchase' ? ['username'] : []),
      ...(action === 'purchase' ? ['expected_amount_ngn', 'idempotency_key'] : [])]
  if (input[envelope] !== (envelope === 'section' ? 'telegram' : `api_${action}`) ||
    Object.keys(input).some(field => !fields.includes(field))) return false
  if (action === 'catalogue' || action === 'orders') return true
  if (action === 'status') return typeof input.order_id === 'string' && uuid.test(input.order_id)
  if (input.product_type === 'stars') {
    if (!Number.isSafeInteger(input.quantity) || (input.quantity as number) < 50 ||
      (input.quantity as number) > 1_000_000) return false
  } else if (input.product_type === 'premium') {
    if (typeof input.product_id !== 'string' || !uuid.test(input.product_id)) return false
  } else return false
  if ((action === 'recipient' || action === 'purchase') &&
    (typeof input.username !== 'string' || !/^@?[A-Za-z0-9_]{1,64}$/.test(input.username))) return false
  if (action === 'purchase' && (!Number.isSafeInteger(input.expected_amount_ngn) ||
    (input.expected_amount_ngn as number) <= 0 || typeof input.idempotency_key !== 'string' ||
    input.idempotency_key !== input.idempotency_key.trim() || input.idempotency_key.length < 10 ||
    input.idempotency_key.length > 160 || /[\x00-\x1f\x7f]/.test(input.idempotency_key))) return false
  return true
}

export async function readTelegramApiBody(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_REQUEST')
  const length = req.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16_384)) throw new Error('REQUEST_TOO_LARGE')
  const reader = req.body?.getReader()
  if (!reader) throw new Error('INVALID_REQUEST')
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 5000) })
  try {
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 16_384) throw new Error('REQUEST_TOO_LARGE')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('INVALID_REQUEST') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST')
    return value as Record<string, unknown>
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock() }
}
