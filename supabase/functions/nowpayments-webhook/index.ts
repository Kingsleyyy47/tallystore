import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers })
const paymentId = (value: unknown) => /^[0-9]{1,30}$/.test(String(value ?? '')) ? String(value) : null

function sortDeep(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('INVALID_NOTIFICATION')
  if (Array.isArray(value)) return value.map(item => sortDeep(item, depth + 1))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    if (entries.some(([key]) => ['__proto__','constructor','prototype'].includes(key))) throw new Error('INVALID_NOTIFICATION')
    return Object.fromEntries(entries.map(([key, item]) => [key, sortDeep(item, depth + 1)]))
  }
  return value
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function verifySignature(payload: Record<string, unknown>, signature: string, secret: string): Promise<boolean> {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16))
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(JSON.stringify(sortDeep(payload))))
}
async function readNotification(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader()
  if (!reader) throw new Error('INVALID_NOTIFICATION')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 32768) { await reader.cancel(); throw new Error('NOTIFICATION_TOO_LARGE') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const raw = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength }
  const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_NOTIFICATION')
  return payload as Record<string, unknown>
}

serve(async req => {
  if (req.method !== 'POST') return json({ success: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const ipnSecret = Deno.env.get('NOWPAYMENTS_IPN_SECRET')?.trim()
  const apiKey = Deno.env.get('NOWPAYMENTS_API_KEY')?.trim()
  if (!ipnSecret || !apiKey) return json({ success: false, code: 'PAYMENT_VERIFICATION_UNAVAILABLE' }, 503)
  let notification: Record<string, unknown>
  try { notification = await readNotification(req) } catch (error) {
    return json({ success: false, code: 'INVALID_NOTIFICATION' }, error instanceof Error && error.message === 'NOTIFICATION_TOO_LARGE' ? 413 : 400)
  }
  try {
    if (!await verifySignature(notification, req.headers.get('x-nowpayments-sig') || '', ipnSecret)) return json({ success: false, code: 'INVALID_SIGNATURE' }, 401)
    const id = paymentId(notification.payment_id)
    const reference = typeof notification.order_id === 'string' ? notification.order_id.trim() : ''
    if (!id || !reference || reference.length > 180) return json({ success: false, code: 'INVALID_PAYMENT_IDENTITY' }, 400)
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } })
    // Historical/browser-created receipt rows are not funding authority. Only
    // a server-registered immutable quote can enter this settlement path.
    const { data: receipt, error: receiptError } = await admin.from('crypto_transactions')
      .select('id').eq('nowpayments_payment_id', id).eq('payment_reference', reference).maybeSingle()
    if (receiptError) return json({ success: false, code: 'PAYMENT_VERIFICATION_UNAVAILABLE' }, 503)
    if (!receipt) return json({ success: true, credited: false, code: 'UNREGISTERED_PAYMENT_REQUIRES_REVIEW' })
    const { data: quoteResult, error: quoteError } = await admin.rpc('get_registered_nowpayments_wallet_quote', { p_crypto_transaction_id: receipt.id })
    if (quoteError) return json({ success: false, code: 'PAYMENT_VERIFICATION_UNAVAILABLE' }, 503)
    const quote = quoteResult
    if (quoteResult?.registered !== true || !quote || quote.payment_id !== id || quote.order_reference !== reference) return json({ success: true, credited: false, code: 'UNREGISTERED_PAYMENT_REQUIRES_REVIEW' })
    const response = await fetch(`https://api.nowpayments.io/v1/payment/${encodeURIComponent(id)}`, {
      method: 'GET', headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) return json({ success: false, code: 'PAYMENT_VERIFICATION_UNAVAILABLE' }, 503)
    const provider = await response.json()
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)
      || paymentId(provider.payment_id) !== id || String(provider.order_id || '') !== reference
      || String(provider.pay_currency || '').toLowerCase() !== String(quote.pay_currency).toLowerCase()
      || String(provider.pay_address || '') !== quote.pay_address
      || !Number.isFinite(Number(provider.pay_amount)) || Number(provider.pay_amount) !== Number(quote.pay_amount)) {
      return json({ success: false, code: 'PROVIDER_PAYMENT_MISMATCH' }, 409)
    }
    const status = String(provider.payment_status || '').toLowerCase()
    const signatureHash = await digest(req.headers.get('x-nowpayments-sig')!.toLowerCase())
    const verificationHash = await digest(JSON.stringify(sortDeep(provider)))
    if (status === 'finished' || status === 'refunded') {
      // Amounts are never read from the notification or the browser. SQL
      // validates provider evidence against the immutable original quote.
      const { data, error } = await admin.rpc(status === 'finished' ? 'settle_nowpayments_wallet_quote' : 'revoke_nowpayments_wallet_quote', {
        p_payment_id: id, p_order_reference: reference, p_pay_amount: Number(provider.pay_amount),
        p_pay_currency: String(provider.pay_currency).toLowerCase(), p_pay_address: String(provider.pay_address),
        p_actual_paid: provider.actually_paid == null ? null : Number(provider.actually_paid),
        p_provider_status: status, p_signature_hash: signatureHash, p_verification_hash: verificationHash,
      })
      if (error || !data) return json({ success: false, code: 'PAYMENT_SETTLEMENT_UNAVAILABLE' }, 503)
      if (data.success !== true) return json({ success: false, code: 'PAYMENT_EVIDENCE_REJECTED' }, 409)
      return json({ success: true, credited: data.credited === true, idempotency_hit: data.idempotency_hit === true,
        status: status === 'finished' ? 'completed' : 'refunded' })
    }
    const receiptStatus = ['waiting','confirming','confirmed','sending'].includes(status) ? 'processing'
      : ['partially_paid','failed','expired'].includes(status) ? status : null
    if (!receiptStatus) return json({ success: false, code: 'UNKNOWN_PROVIDER_STATUS' }, 409)
    // Non-final status never changes money or downgrades a settled receipt.
    const { data: recorded, error } = await admin.rpc('record_nowpayments_wallet_status', {
      p_payment_id: id, p_order_reference: reference, p_status: receiptStatus,
    })
    if (error || recorded?.success !== true) return json({ success: false, code: 'PAYMENT_STATUS_UNAVAILABLE' }, 503)
    return json({ success: true, credited: false, status: receiptStatus })
  } catch {
    // Provider responses, wallet addresses and keys must not reach public logs
    // or error bodies. A retry will use the same unique quote/ledger identity.
    return json({ success: false, code: 'PAYMENT_VERIFICATION_UNAVAILABLE' }, 503)
  }
})
