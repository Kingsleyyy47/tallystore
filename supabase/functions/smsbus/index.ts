import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// ── Inlined: forex-rates ──────────────────────────────────────────────────────
async function getUsdToNgnRate(): Promise<number> {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
    if (!res.ok) throw new Error(`Exchange rate API failed: ${res.status}`)
    const data = await res.json()
    const rate = data.rates?.NGN
    if (!rate || rate <= 0) throw new Error('Invalid NGN rate')
    return rate
  } catch {
    return 1650 // fallback
  }
}

// ── Inlined: daisysms-client ──────────────────────────────────────────────────
const DEFAULT_DAISY_BASE = 'https://daisysms.io/stubs/handler_api.php'
const DAISY_COUNTRY = 187

const SERVICE_NAMES: Record<string, string> = {
  wa: 'WhatsApp', go: 'Google', tg: 'Telegram', ig: 'Instagram',
  fb: 'Facebook', tw: 'Twitter / X', am: 'Amazon', ap: 'Apple ID',
  ms: 'Microsoft', ds: 'Discord', ub: 'Uber', ln: 'LinkedIn',
  yt: 'YouTube', nf: 'Netflix', sn: 'Snapchat', ti: 'TikTok',
  pm: 'PayPal', sh: 'Shopify', eb: 'eBay', cl: 'Craigslist',
  mm: 'Mail.ru', ok: 'Odnoklassniki', vk: 'VKontakte',
  yi: 'Yahoo', wb: 'WeChat', li: 'Line', vi: 'Viber',
  wm: 'Walmart', gg: 'Grab', lf: 'Lyft', hz: 'Hinge',
  bu: 'Bumble', kk: 'KakaoTalk', sk: 'Skype', zo: 'Zoom',
  sp: 'Spotify', rx: 'Robinhood', cb: 'Coinbase', bn: 'Binance',
  kc: 'KuCoin', ic: 'ICQ', tt: 'TextNow', of: 'OnlyFans',
  bd: 'Badoo', gr: 'Grindr', pt: 'Poshmark', zl: 'Zalo',
}

class DaisySmsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DaisySmsError'
  }
}

async function daisyGet(apiKey: string, params: Record<string, string>): Promise<string> {
  const url = new URL(Deno.env.get('DAISYSMS_BASE_URL') || DEFAULT_DAISY_BASE)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  return (await res.text()).trim()
}

async function daisyGetBalance(apiKey: string): Promise<number> {
  const text = await daisyGet(apiKey, { action: 'getBalance' })
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'Invalid API key')
  const match = text.match(/^ACCESS_BALANCE:([\d.]+)$/)
  if (!match) throw new DaisySmsError('PARSE_ERROR', `Unexpected balance response: ${text}`)
  return parseFloat(match[1])
}

type DaisyService = { code: string; name: string; count: number; priceUsd: number }
type DaisyPriceEntry = {
  count?: number | string
  price?: number | string
  cost?: number | string
  rate?: number | string
}

function normalizeDaisyService(code: string, entry: DaisyPriceEntry | undefined): DaisyService | null {
  if (!entry || typeof entry !== 'object') return null
  const count = Number(entry.count || 0)
  const priceUsd = Number(entry.price ?? entry.cost ?? entry.rate ?? 0)
  if (!Number.isFinite(count) || count < 1) return null
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return null
  return {
    code,
    name: SERVICE_NAMES[code] || code.toUpperCase(),
    count,
    priceUsd,
  }
}

function collectDaisyService(services: Map<string, DaisyService>, service: DaisyService | null) {
  if (!service) return
  const existing = services.get(service.code)
  if (!existing || service.count > existing.count) services.set(service.code, service)
}

function parseServiceCountryPrices(raw: unknown): DaisyService[] {
  const services = new Map<string, DaisyService>()
  if (!raw || typeof raw !== 'object') return []

  for (const [code, countries] of Object.entries(raw as Record<string, unknown>)) {
    if (!countries || typeof countries !== 'object') continue
    const usa = (countries as Record<string, DaisyPriceEntry>)[String(DAISY_COUNTRY)]
    collectDaisyService(services, normalizeDaisyService(code, usa))
  }

  return [...services.values()]
}

function parseCountryServicePrices(raw: unknown): DaisyService[] {
  const services = new Map<string, DaisyService>()
  if (!raw || typeof raw !== 'object') return []

  const usa = (raw as Record<string, unknown>)[String(DAISY_COUNTRY)]
  if (!usa || typeof usa !== 'object') return []

  for (const [code, entry] of Object.entries(usa as Record<string, DaisyPriceEntry>)) {
    collectDaisyService(services, normalizeDaisyService(code, entry))
  }

  return [...services.values()]
}

async function daisyGetPriceObject(apiKey: string, action: 'getPricesVerification' | 'getPrices'): Promise<unknown> {
  const text = await daisyGet(apiKey, { action })
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'Invalid API key')
  try {
    return JSON.parse(text)
  } catch {
    throw new DaisySmsError('PARSE_ERROR', `Unexpected ${action} response`)
  }
}

function uniqueSortedServices(candidates: DaisyService[]): DaisyService[] {
  const services = new Map<string, DaisyService>()
  for (const service of candidates) collectDaisyService(services, service)
  return [...services.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function daisyGetServices(apiKey: string): Promise<DaisyService[]> {
  const rawVerification = await daisyGetPriceObject(apiKey, 'getPricesVerification')
  const verificationServices = uniqueSortedServices([
    ...parseServiceCountryPrices(rawVerification),
    ...parseCountryServicePrices(rawVerification),
  ])

  if (verificationServices.length > 0) {
    return verificationServices
  }

  const rawPrices = await daisyGetPriceObject(apiKey, 'getPrices')
  return uniqueSortedServices([
    ...parseCountryServicePrices(rawPrices),
    ...parseServiceCountryPrices(rawPrices),
  ])
}

async function daisyGetNumber(apiKey: string, serviceCode: string, maxPriceUsd?: number): Promise<{ activationId: string; phoneNumber: string }> {
  const params: Record<string, string> = { action: 'getNumber', service: serviceCode }
  if (maxPriceUsd !== undefined) params.max_price = maxPriceUsd.toFixed(4)
  const text = await daisyGet(apiKey, params)
  if (text === 'NO_NUMBERS') throw new DaisySmsError('NO_NUMBERS', 'No numbers available for this service right now.')
  if (text === 'MAX_PRICE_EXCEEDED') throw new DaisySmsError('MAX_PRICE_EXCEEDED', 'Service price has changed. Please try again.')
  if (text === 'NO_MONEY') throw new DaisySmsError('NO_MONEY', 'SMS purchases are temporarily unavailable.')
  if (text === 'TOO_MANY_ACTIVE_RENTALS') throw new DaisySmsError('TOO_MANY_ACTIVE_RENTALS', 'Too many active SMS orders. Cancel one first.')
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'SMS service is temporarily unavailable.')
  const match = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/)
  if (!match) throw new DaisySmsError('PARSE_ERROR', `Unexpected rent response: ${text}`)
  return { activationId: match[1], phoneNumber: match[2] }
}

type DaisyStatus = { status: 'ok'; code: string } | { status: 'waiting' } | { status: 'cancelled' }

async function daisyGetStatus(apiKey: string, activationId: string): Promise<DaisyStatus> {
  const text = await daisyGet(apiKey, { action: 'getStatus', id: activationId })
  if (text === 'STATUS_WAIT_CODE') return { status: 'waiting' }
  if (text === 'STATUS_CANCEL') return { status: 'cancelled' }
  if (text === 'NO_ACTIVATION') throw new DaisySmsError('NO_ACTIVATION', 'Activation not found.')
  const match = text.match(/^STATUS_OK:(.+)$/)
  if (match) return { status: 'ok', code: match[1] }
  throw new DaisySmsError('PARSE_ERROR', `Unexpected status response: ${text}`)
}

async function daisyMarkDone(apiKey: string, activationId: string) {
  await daisyGet(apiKey, { action: 'setStatus', id: activationId, status: '6' })
}

async function daisyCancelNumber(apiKey: string, activationId: string) {
  const text = await daisyGet(apiKey, { action: 'setStatus', id: activationId, status: '8' })
  return text === 'ACCESS_CANCEL'
}

function extractCode(text: string): string | null {
  const patterns = [/\b(\d{4,8})\b/, /code[:\s]+(\d{4,8})/i, /OTP[:\s]+(\d{4,8})/i]
  for (const p of patterns) { const m = text.match(p); if (m) return m[1] }
  return null
}

// ── Main function ─────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired', 'failed']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function generateReference(prefix = 'SMS') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function getDaisyKey() { return Deno.env.get('DAISYSMS_API_KEY') || '' }

function envNumber(name: string, fallback: number) {
  const v = Number(Deno.env.get(name) ?? fallback)
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

function friendlyError(error: unknown): string {
  if (error instanceof DaisySmsError) {
    const map: Record<string, string> = {
      NO_NUMBERS: 'No numbers available for this service right now.',
      MAX_PRICE_EXCEEDED: 'Service price has changed. Please try again.',
      NO_MONEY: 'SMS purchases are temporarily unavailable.',
      TOO_MANY_ACTIVE_RENTALS: 'Too many active SMS orders. Cancel one first.',
      BAD_KEY: 'SMS service is temporarily unavailable.',
      NO_ACTIVATION: 'This SMS order was not found.',
    }
    return map[error.code] || error.message
  }
  return error instanceof Error ? error.message : 'Unexpected SMS error'
}

type SupabaseAdmin = ReturnType<typeof createClient>

async function requireAuth(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Missing authorization header')
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) throw new Error('Unauthorized')
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
  return { user, admin }
}

async function debitWallet(admin: SupabaseAdmin, userId: string, amount: number) {
  for (let i = 0; i < 3; i++) {
    const { data: p } = await admin.from('profiles').select('wallet_balance').eq('id', userId).single()
    if (!p) throw new Error('Failed to fetch wallet balance')
    const prev = Number(p.wallet_balance || 0)
    if (prev < amount) throw new Error(`Insufficient wallet balance. Required: ₦${amount.toLocaleString()}, Available: ₦${prev.toLocaleString()}`)
    const next = prev - amount
    const { data: updated } = await admin.from('profiles')
      .update({ wallet_balance: next, updated_at: new Date().toISOString() })
      .eq('id', userId).eq('wallet_balance', prev).select('wallet_balance').single()
    if (updated) return { prev, next }
  }
  throw new Error('Wallet balance changed during purchase. Please try again.')
}

async function refundWallet(admin: SupabaseAdmin, order: { id: string; user_id: string; reference: string; price_ngn: number }, reason: string) {
  const amount = Number(order.price_ngn || 0)
  if (amount <= 0) return
  const refundRef = `REFUND-${order.reference}`
  const { data: existing } = await admin.from('transactions').select('id').eq('reference', refundRef).maybeSingle()
  if (existing) return
  const { data: tx } = await admin.from('transactions').insert({
    user_id: order.user_id, type: 'refund', amount, balance_after: 0,
    description: reason, reference: refundRef, status: 'pending',
  }).select('id').single()
  if (!tx) return
  for (let i = 0; i < 3; i++) {
    const { data: p } = await admin.from('profiles').select('wallet_balance').eq('id', order.user_id).single()
    if (!p) break
    const next = Number(p.wallet_balance || 0) + amount
    const { data: updated } = await admin.from('profiles')
      .update({ wallet_balance: next, updated_at: new Date().toISOString() })
      .eq('id', order.user_id).eq('wallet_balance', p.wallet_balance).select('wallet_balance').single()
    if (updated) {
      await admin.from('transactions').update({ status: 'completed', balance_after: next }).eq('id', tx.id)
      await admin.from('sms_orders').update({ refunded_at: new Date().toISOString(), refund_amount_ngn: amount, refund_reference: refundRef }).eq('id', order.id).is('refunded_at', null)
      return
    }
  }
}

async function recordPurchase(admin: SupabaseAdmin, userId: string, reference: string, amount: number, balanceAfter: number, description: string) {
  await admin.from('transactions').insert({
    user_id: userId, type: 'purchase', amount: -amount,
    balance_after: balanceAfter, description, reference, status: 'completed',
  })
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleHealth() {
  const key = getDaisyKey()
  if (!key) return json({ success: true, configured: false, valid: false, balance: null })
  try {
    const bal = await daisyGetBalance(key)
    return json({ success: true, configured: true, valid: true, balance: { balance: bal, frozen: 0 } })
  } catch {
    return json({ success: true, configured: true, valid: false, balance: null })
  }
}

async function handleServices() {
  const key = getDaisyKey()
  if (!key) return json({ success: true, data: [] })
  const otpMarginUsd = envNumber('DAISYSMS_OTP_MARGIN_USD', 0.35)
  const exchangeRate = await getUsdToNgnRate()
  const services = await daisyGetServices(key)
  const enriched = services.map((svc, i) => {
    const totalUsd = svc.priceUsd + otpMarginUsd
    return {
      service_id: svc.code, service_code: svc.code, service_name: svc.name,
      project_id: i + 1, country_id: DAISY_COUNTRY, country_code: 'us',
      provider_cost_usd: Number(svc.priceUsd.toFixed(4)),
      margin_usd: Number(otpMarginUsd.toFixed(4)),
      total_cost_usd: Number(totalUsd.toFixed(4)),
      exchange_rate: Number(exchangeRate.toFixed(4)),
      price_ngn: Math.ceil(totalUsd * exchangeRate),
      available_count: svc.count,
    }
  })
  return json({ success: true, data: enriched.filter(s => s.available_count > 0) })
}

async function handleOrders(admin: SupabaseAdmin, userId: string) {
  const { data, error } = await admin.from('sms_orders').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error(`Failed to load orders: ${error.message}`)
  return json({ success: true, data: data || [] })
}

async function handleCreateOtp(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const key = getDaisyKey()
  if (!key) throw new Error('SMS service is not configured')
  const serviceCode = String(body.service_id || body.project_id || '')
  if (!serviceCode) throw new Error('service_id is required')
  const idempotencyKey = String(body.idempotency_key || '')
  if (!idempotencyKey || idempotencyKey.length < 10) throw new Error('Valid idempotency_key is required')

  const { data: existing } = await admin.from('sms_orders').select('*').eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing) return json({ success: true, data: existing, idempotency_hit: true })

  const otpMarginUsd = envNumber('DAISYSMS_OTP_MARGIN_USD', 0.35)
  const exchangeRate = await getUsdToNgnRate()
  const services = await daisyGetServices(key)
  const svc = services.find(s => s.code === serviceCode)
  if (!svc) throw new Error('Service not available')

  const totalUsd = svc.priceUsd + otpMarginUsd
  const priceNgn = Math.ceil(totalUsd * exchangeRate)

  const { data: profile } = await admin.from('profiles').select('wallet_balance').eq('id', userId).single()
  if (!profile || Number(profile.wallet_balance || 0) < priceNgn) {
    throw new Error(`Insufficient wallet balance. Required: ₦${priceNgn.toLocaleString()}`)
  }

  const number = await daisyGetNumber(key, serviceCode, svc.priceUsd * 1.25)
  const reference = generateReference('SMS')
  let debit: { prev: number; next: number } | null = null

  try {
    debit = await debitWallet(admin, userId, priceNgn)
    const { data: order, error: orderErr } = await admin.from('sms_orders').insert({
      user_id: userId, reference, idempotency_key: idempotencyKey, order_type: 'otp',
      provider_request_id: number.activationId,
      service_id: serviceCode, service_name: svc.name,
      country_id: DAISY_COUNTRY, country_code: 'us',
      phone_number: `+${number.phoneNumber}`, raw_phone_number: number.phoneNumber,
      provider_cost_usd: svc.priceUsd, margin_usd: otpMarginUsd,
      total_cost_usd: totalUsd, exchange_rate: exchangeRate, price_ngn: priceNgn,
      status: 'active',
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      provider_payload: { activation_id: number.activationId, service: svc },
    }).select().single()
    if (orderErr || !order) throw new Error(`Failed to create order: ${orderErr?.message}`)
    await recordPurchase(admin, userId, reference, priceNgn, debit.next, `SMS OTP: ${svc.name}`)
    return json({ success: true, data: order, new_balance: debit.next })
  } catch (err) {
    try { await daisyCancelNumber(key, number.activationId) } catch { /* ignore */ }
    if (debit) await refundWallet(admin, { id: '00000000-0000-0000-0000-000000000000', user_id: userId, reference, price_ngn: priceNgn }, `Auto-refund for failed SMS order: ${svc.name}`)
    throw err
  }
}

async function handleCheckOtp(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const key = getDaisyKey()
  const { data: order, error } = await admin.from('sms_orders').select('*').eq('id', String(body.order_id || '')).eq('user_id', userId).single()
  if (error || !order) throw new Error('SMS order not found')
  if (TERMINAL_STATUSES.includes(order.status)) return json({ success: true, data: order })

  const activationId = order.provider_request_id
  if (!activationId) throw new Error('Order is missing activation ID')

  const result = await daisyGetStatus(key, activationId)

  if (result.status === 'waiting') {
    await admin.from('sms_orders').update({ status: 'waiting' }).eq('id', order.id)
    return json({ success: true, data: { ...order, status: 'waiting' }, waiting: true })
  }
  if (result.status === 'cancelled') {
    await admin.from('sms_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', order.id)
    await refundWallet(admin, order, `Auto-refund for cancelled SMS order: ${order.reference}`)
    return json({ success: true, data: { ...order, status: 'cancelled' } })
  }
  if (result.status === 'ok') {
    const messages = Array.isArray(order.messages) ? order.messages : []
    const newMsg = { content: result.code, code: result.code, received_at: new Date().toISOString() }
    const nextMessages = messages.some((m: any) => m.code === result.code) ? messages : [...messages, newMsg]
    const { data: updated } = await admin.from('sms_orders').update({
      status: 'completed', messages: nextMessages, completed_at: new Date().toISOString(),
    }).eq('id', order.id).select().single()
    try { await daisyMarkDone(key, activationId) } catch { /* ignore */ }
    return json({ success: true, data: updated })
  }
  return json({ success: true, data: order, waiting: true })
}

async function handleCancelOtp(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const key = getDaisyKey()
  const { data: order, error } = await admin.from('sms_orders').select('*').eq('id', String(body.order_id || '')).eq('user_id', userId).single()
  if (error || !order) throw new Error('SMS order not found')
  if (TERMINAL_STATUSES.includes(order.status)) return json({ success: true, data: order, already_final: true })
  if (order.provider_request_id) {
    try { await daisyCancelNumber(key, order.provider_request_id) } catch { /* ignore */ }
  }
  const { data: updated } = await admin.from('sms_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', order.id).select().single()
  await refundWallet(admin, order, `Refund for cancelled SMS order: ${order.reference}`)
  return json({ success: true, data: updated })
}

// ── DaisySMS webhook (no auth — called by DaisySMS server) ───────────────────
async function handleDaisyWebhook(req: Request) {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
  const payload = await req.json().catch(() => null) as any
  if (!payload?.activationId) return new Response('ok', { status: 200 })

  const activationId = String(payload.activationId)
  const { data: order } = await admin.from('sms_orders').select('*').eq('provider_request_id', activationId).maybeSingle()
  if (!order || TERMINAL_STATUSES.includes(order.status)) return new Response('ok', { status: 200 })

  const code = payload.code || extractCode(payload.text) || payload.text
  const messages = Array.isArray(order.messages) ? order.messages : []
  const newMsg = { content: payload.text, code, received_at: payload.receivedAt || new Date().toISOString() }
  const nextMessages = messages.some((m: any) => m.code === code) ? messages : [...messages, newMsg]

  await admin.from('sms_orders').update({
    status: 'completed', messages: nextMessages, completed_at: new Date().toISOString(),
  }).eq('id', order.id)

  return new Response('ok', { status: 200 })
}

// ── Entry point ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // DaisySMS webhook — no auth header, identified by ?webhook=1
  const url = new URL(req.url)
  if (req.method === 'POST' && url.searchParams.get('webhook') === '1') {
    return await handleDaisyWebhook(req)
  }

  try {
    const { user, admin } = await requireAuth(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action || '')

    switch (action) {
      case 'health':       return await handleHealth()
      case 'services':     return await handleServices()
      case 'countries':    return json({ success: true, data: [{ id: DAISY_COUNTRY, name: 'United States', code: 'us' }] })
      case 'rental_areas': return json({ success: true, data: [] })
      case 'orders':       return await handleOrders(admin, user.id)
      case 'create_otp':   return await handleCreateOtp(admin, user.id, body)
      case 'check_otp':    return await handleCheckOtp(admin, user.id, body)
      case 'cancel_otp':   return await handleCancelOtp(admin, user.id, body)
      case 'rent_number':
      case 'rental_sms':
      case 'renew_rental':
      case 'cancel_rental':
        return json({ success: false, error: 'Long-term rentals are not available with the current SMS provider.' }, 400)
      default:
        throw new Error('Unknown SMS action')
    }
  } catch (err) {
    const message = friendlyError(err)
    const isAuth = err instanceof Error && (err.message === 'Unauthorized' || err.message === 'Missing authorization header')
    console.error('SMS function error:', message)
    return json({ success: false, error: message }, isAuth ? 401 : 400)
  }
})
