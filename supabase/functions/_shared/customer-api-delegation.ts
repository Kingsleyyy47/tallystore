import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

type Capability = {
  key_id: string
  user_id: string
  section: 'products' | 'sms' | 'social_boost' | 'airtime' | 'giftcards' | 'telegram'
  target: 'process-purchase' | 'smsbus' | 'smm-create-order' | 'customer-airtime' | 'customer-giftcards' | 'telegram-stars'
  body_hash: string
  nonce: string
  expires_at: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hex = /^[a-f0-9]{64}$/
const encoder = new TextEncoder()

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signature(value: string) {
  const secret = Deno.env.get('CUSTOMER_API_DELEGATION_SECRET') || ''
  if (secret.length < 32) throw new Error('Customer API delegation is unavailable')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function base64url(text: string) {
  return btoa(String.fromCharCode(...encoder.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new Error('Invalid customer API capability')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))
}

export async function signCustomerCapability(
  identity: { key_id: string; user_id: string; section: Capability['section'] },
  target: Capability['target'], body: string,
) {
  const payload: Capability = {
    ...identity, target, body_hash: await sha256Hex(body),
    nonce: crypto.randomUUID(), expires_at: Date.now() + 30_000,
  }
  const encoded = base64url(JSON.stringify(payload))
  return `${encoded}.${bytesToHex(await signature(encoded))}`
}

export async function authenticateCustomerRequest(
  req: Request, admin: any, section: Capability['section'], target: Capability['target'],
): Promise<{ id: string }> {
  const raw = req.headers.get('x-tally-api-capability')
  if (raw !== null) {
    const match = /^([A-Za-z0-9_-]{1,2048})\.([a-f0-9]{64})$/.exec(raw)
    if (!match) throw new Error('Unauthorized')
    const actual = Uint8Array.from(match[2].match(/../g) || [], (part) => parseInt(part, 16))
    const expected = await signature(match[1])
    if (actual.length !== expected.length) throw new Error('Unauthorized')
    let mismatch = 0
    for (let i = 0; i < expected.length; i += 1) mismatch |= actual[i] ^ expected[i]
    if (mismatch !== 0) throw new Error('Unauthorized')
    let payload: Capability
    try { payload = JSON.parse(fromBase64url(match[1])) as Capability } catch { throw new Error('Unauthorized') }
    if (!uuid.test(payload.key_id) || !uuid.test(payload.user_id) || !uuid.test(payload.nonce) ||
        payload.section !== section || payload.target !== target || !hex.test(payload.body_hash) ||
        !Number.isInteger(payload.expires_at) || payload.expires_at < Date.now() ||
        payload.expires_at > Date.now() + 60_000) throw new Error('Unauthorized')
    const body = await req.clone().text()
    if (await sha256Hex(body) !== payload.body_hash) throw new Error('Unauthorized')
    const { data, error } = await admin.rpc('customer_api_consume_capability', {
      p_key_id: payload.key_id, p_user_id: payload.user_id,
      p_section: section, p_nonce: payload.nonce,
    })
    if (error || data !== true) throw new Error('Unauthorized')
    return { id: payload.user_id }
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) throw new Error('Missing authorization header')
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const { data: { user }, error } = await anon.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (error || !user) throw new Error('Unauthorized')
  return { id: user.id }
}
