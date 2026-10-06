import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { sha256Hex, signCustomerCapability } from '../_shared/customer-api-delegation.ts'
import { customerApiRoute } from '../_shared/customer-api-route.mjs'
import { getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields } from '../_shared/smm-order-contract.ts'
import { validTelegramApiInput, type TelegramApiAction } from '../_shared/telegram-api-contract.ts'

type Section = 'products' | 'sms' | 'social_boost' | 'airtime' | 'giftcards' | 'telegram'
const sections = new Set<Section>(['products', 'sms', 'social_boost', 'airtime', 'giftcards', 'telegram'])
const defaultSections: Section[] = ['products', 'sms', 'social_boost', 'airtime', 'giftcards', 'telegram']
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status,
    headers: { ...cors, 'Content-Type': 'application/json', ...headers } })
}
function fail(code: string, status = 400) { return json({ success: false, code }, status) }
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } })
}
async function sessionUser(req: Request, admin: any) {
  const header = req.headers.get('authorization') || ''
  if (!/^Bearer\s+[^\s]+$/i.test(header) || header.includes('tlyc_')) throw new Error('Unauthorized')
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: header } }, auth: { persistSession: false } })
  const { data: { user }, error } = await client.auth.getUser(header.replace(/^Bearer\s+/i, ''))
  if (error || !user) throw new Error('Unauthorized')
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('is_admin, is_staff, account_suspended').eq('id', user.id).single()
  if (profileError || !profile || profile.account_suspended) throw new Error('Unauthorized')
  return { id: user.id, isAdmin: profile.is_admin === true, isStaff: profile.is_staff === true }
}
async function body(req: Request) {
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('Invalid JSON request')
  const size = Number(req.headers.get('content-length'))
  if (Number.isFinite(size) && size > 16_384) throw new Error('Request too large')
  if (!req.body) throw new Error('Invalid JSON request')
  const reader = req.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let raw: string
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Request timed out')), 5_000)
    })
    while (true) {
      const next = await Promise.race([reader.read(), timeout])
      if (next.done) break
      if (next.value.byteLength === 0) throw new Error('Invalid JSON request')
      length += next.value.byteLength
      if (length > 16_384) throw new Error('Request too large')
      parts.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof Error && (error.message === 'Request too large' || error.message === 'Request timed out')) throw error
    throw new Error('Invalid JSON request')
  } finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined) }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Invalid JSON request') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON request')
  return parsed as Record<string, unknown>
}
function section(value: unknown): Section | null {
  return typeof value === 'string' && sections.has(value as Section) ? value as Section : null
}
function publicKey(row: any) {
  return { id: row.id, section: row.section, label: row.label, prefix: row.key_prefix,
    created_at: row.created_at, last_used_at: row.last_used_at, revoked_at: row.revoked_at }
}
function ngnMinorUnits(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const normalizedWhole = whole.replace(/^0+/, '') || '0'
  if (normalizedWhole.length > 14) return null
  const minor = BigInt(normalizedWhole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null
}
async function circlePercent(admin: any, userId: string) {
  const { data, error } = await admin.rpc('get_tally_circle_purchase_status', { p_user_id: userId })
  if (error || !data || typeof data.enabled !== 'boolean'
    || typeof data.is_member !== 'boolean' || ![0, 3].includes(data.discount_percent)
    || (!data.enabled && data.is_member)) {
    const { data: circleLaunched, error: launchError } = await admin.rpc('tally_circle_launch_enabled')
    if (!launchError && circleLaunched === false) return 0
    throw new Error('Circle status unavailable')
  }
  if (!data.enabled || !data.is_member) {
    if (data.discount_percent !== 0) throw new Error('Circle status unavailable')
    return 0
  }
  if (data.discount_percent !== 3) throw new Error('Circle status unavailable')
  return 3
}
async function productQuote(admin: any, userId: string, url: URL) {
  const productId = url.searchParams.get('product_group_id') || ''
  const quantity = Number(url.searchParams.get('quantity'))
  const discountCode = (url.searchParams.get('discount_code') || '').trim().toUpperCase()
  if (!uuid.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    return fail('invalid_request')
  }
  const { data: product, error } = await admin.from('product_groups')
    .select('id, category_id, name, price, stock_count, availability_status, is_sellable, is_active, quantity_discount_tiers')
    .eq('id', productId).maybeSingle()
  if (error || !product) return fail('product_not_found', 404)
  const availability = String(product.availability_status || '').toUpperCase()
  if (product.is_active !== true || product.is_sellable === false ||
      ['UNAVAILABLE','PAUSED'].includes(availability) ||
      (Number(product.stock_count) < quantity && availability !== 'UNLIMITED')) {
    return fail('product_unavailable', 409)
  }
  const unitMinor = ngnMinorUnits(product.price)
  if (unitMinor === null || !Number.isSafeInteger(unitMinor * quantity)) return fail('price_unavailable', 503)
  const tiers = Array.isArray(product.quantity_discount_tiers) ? product.quantity_discount_tiers : []
  const tier = tiers.filter((item: any) => Number(item.min_qty) >= 2 && quantity >= Number(item.min_qty))
    .sort((a: any, b: any) => Number(b.discount_pct) - Number(a.discount_pct))[0]
  const tierPct = tier ? Math.min(Math.max(Number(tier.discount_pct), 0), 100) : 0
  const originalMinor = unitMinor * quantity
  let totalMinor = tierPct > 0 ? Math.round((originalMinor / 100) * (1 - tierPct / 100)) * 100 : originalMinor
  let codePct = 0
  if (discountCode) {
    const { data: capacity, error: capacityError } = await admin.rpc('discount_code_capacity_version')
    if (capacityError || capacity !== 1) return fail('discount_unavailable', 503)
    if (tierPct > 0) return fail('discount_conflict', 409)
    const { data: code, error: codeError } = await admin.from('discount_codes').select('*')
      .eq('code', discountCode).eq('is_active', true).maybeSingle()
    if (codeError) return fail('discount_unavailable', 503)
    if (!code || (code.expires_at && new Date(code.expires_at) < new Date()) ||
        (code.max_uses && code.used_count >= code.max_uses) ||
        (code.product_group_id && code.product_group_id !== productId) ||
        (code.category_id && !code.product_group_id && code.category_id !== product.category_id) ||
        (code.user_id && code.user_id !== userId) ||
        (code.max_order_amount && totalMinor / 100 > Number(code.max_order_amount))) {
      return fail('invalid_discount_code', 409)
    }
    codePct = Math.min(Math.max(Number(code.percent_off), 0), 100)
    totalMinor = Math.round((totalMinor / 100) * (1 - codePct / 100)) * 100
  }
  const circlePct = await circlePercent(admin, userId)
  if (circlePct) totalMinor = Math.round(totalMinor * 97 / 100)
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) return fail('price_unavailable', 503)
  return json({ success: true, data: {
    product_group_id: productId, name: product.name, quantity,
    unit_price_ngn: unitMinor / 100, original_amount_ngn: originalMinor / 100,
    quantity_discount_percent: tierPct, code_discount_percent: codePct,
    tally_circle_discount_percent: circlePct, expected_amount_ngn: totalMinor / 100,
    currency: 'NGN',
  } })
}
async function socialQuote(admin: any, url: URL) {
  const allowed = new Set(['section', 'service_id', 'quantity', 'link', 'comments', 'usernames',
    'username', 'hashtags', 'hashtag', 'keywords', 'answer_number', 'groups'])
  if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) {
    return fail('invalid_request')
  }
  const serviceId = Number(url.searchParams.get('service_id'))
  if (!Number.isSafeInteger(serviceId) || serviceId < 1) return fail('invalid_request')
  const { data: service, error } = await admin.from('smm_services')
    .select('id, service_type, price_ngn, rate_usd, min_quantity, max_quantity')
    .eq('id', serviceId).eq('is_active', true).maybeSingle()
  if (error) return fail('unavailable', 503)
  if (!service || !getSmmOrderContract(service.service_type)) return fail('service_unavailable', 409)
  if (service.rate_usd === null || service.rate_usd === undefined ||
    !Number.isFinite(Number(service.rate_usd)) || Number(service.rate_usd) < 0) {
    return fail('price_unavailable', 503)
  }
  const fields = Object.fromEntries([...url.searchParams.entries()].filter(([key]) =>
    key !== 'section' && key !== 'service_id'))
  try {
    const normalized = validateSmmOrderFields(service.service_type, fields)
    const quote = quoteSmmOrder(service, { ...normalized, quantity: fields.quantity })
    return json({ success: true, data: { service_id: service.id, quantity: quote.quantity,
      expected_price_ngn: quote.amountNgn, currency: 'NGN' } })
  } catch {
    return fail('invalid_request')
  }
}
async function manage(req: Request, path: string, admin: any) {
  const user = await sessionUser(req, admin)
  if (path === '/v1/keys' && req.method === 'GET') {
    const [{ data: access, error: accessError }, { data: keys, error: keysError }] = await Promise.all([
      admin.from('customer_api_access').select('allowed_sections, is_active').eq('user_id', user.id).maybeSingle(),
      admin.from('customer_api_keys').select('id, section, label, key_prefix, created_at, last_used_at, revoked_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }),
    ])
    if (accessError || keysError) return fail('unavailable', 503)
    return json({ success: true, data: { access: access || {
      allowed_sections: user.isAdmin || user.isStaff ? [] : defaultSections,
      is_active: !user.isAdmin && !user.isStaff,
    },
      keys: (keys || []).map(publicKey) } })
  }
  if (path === '/v1/keys' && req.method === 'POST') {
    if (user.isAdmin || user.isStaff) return fail('customer_only', 403)
    const input = await body(req)
    const requested = section(input.section)
    const label = typeof input.label === 'string' ? input.label.trim() : ''
    if (!requested || label.length < 1 || label.length > 60) return fail('invalid_request')
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const rawKey = `tlyc_${requested}_${secret}`
    const { data: key, error } = await admin.rpc('customer_api_create_key', {
      p_user_id: user.id, p_section: requested, p_label: label,
      p_hash: await sha256Hex(rawKey), p_prefix: `tlyc_${requested}_${secret.slice(0, 8)}`,
    })
    if (error || !key) return fail('unavailable', 503)
    if (!key.success) return fail(String(key.code || 'unavailable').toLowerCase(),
      key.code === 'KEY_LIMIT' ? 409 : 403)
    return json({ success: true, data: {
      id: key.id, section: key.section, label: key.label, prefix: key.prefix,
      created_at: key.created_at, last_used_at: null, revoked_at: null, api_key: rawKey,
    } }, 201)
  }
  const deleteMatch = /^\/v1\/keys\/([a-f0-9-]{36})$/.exec(path)
  if (deleteMatch && req.method === 'DELETE') {
    const { data, error } = await admin.from('customer_api_keys').update({ revoked_at: new Date().toISOString() })
      .eq('id', deleteMatch[1]).eq('user_id', user.id).is('revoked_at', null).select('id').maybeSingle()
    if (error) return fail('unavailable', 503)
    return data ? json({ success: true }) : fail('not_found', 404)
  }
  if (path === '/v1/admin/access' && req.method === 'POST') {
    const ownerId = Deno.env.get('TALLYSTORE_OWNER_USER_ID') || ''
    if (!ownerId || !user.isAdmin || user.id !== ownerId) return fail('owner_required', 403)
    const input = await body(req)
    if (typeof input.user_id !== 'string' || !uuid.test(input.user_id) ||
        !Array.isArray(input.allowed_sections) ||
        input.allowed_sections.some((item) => !section(item)) ||
        typeof input.is_active !== 'boolean') return fail('invalid_request')
    const { data: target, error: targetError } = await admin.from('profiles')
      .select('is_admin, is_staff, account_suspended').eq('id', input.user_id).maybeSingle()
    if (targetError || !target || target.is_admin || target.is_staff || target.account_suspended) return fail('customer_required', 403)
    const { data, error } = await admin.from('customer_api_access').upsert({
      user_id: input.user_id, allowed_sections: [...new Set(input.allowed_sections)],
      is_active: input.is_active, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('user_id, allowed_sections, is_active').single()
    if (error || !data) return fail('unavailable', 503)
    return json({ success: true, data })
  }
  return fail('not_found', 404)
}

async function authorize(req: Request, admin: any, requested: Section) {
  const rawKey = /^Bearer\s+(tlyc_(?:products|sms|social_boost|airtime|giftcards|telegram)_[a-f0-9]{64})$/i.exec(req.headers.get('authorization') || '')?.[1]
  if (!rawKey) return { error: fail('invalid_key', 401) }
  const { data, error } = await admin.rpc('customer_api_authorize', {
    p_hash: await sha256Hex(rawKey), p_section: requested, p_limit: 60,
  })
  if (error || !data) return { error: fail('unavailable', 503) }
  if (!data.ok) return { error: fail(data.code, data.code === 'rate_limited' ? 429 : 401) }
  return { identity: data as { key_id: string; user_id: string; section: Section } }
}
type AirtimeAction = 'check_phone' | 'quote' | 'purchase' | 'status'
const airtimeId = (value: unknown) => typeof value === 'string' && value.length <= 180 &&
  /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/.test(value)
function validAirtimeInput(input: Record<string, unknown>, action: AirtimeAction) {
  const fields = action === 'check_phone' ? ['section', 'phone_number'] :
    action === 'status' ? ['section', 'order_id'] :
    ['section', 'phone_number', 'operator_id', 'product_id', 'package_id', 'unit_value',
      ...(action === 'purchase' ? ['expected_amount_ngn', 'idempotency_key'] : [])]
  if (input.section !== 'airtime' || Object.keys(input).some(key => !fields.includes(key))) return false
  if (action === 'status') return typeof input.order_id === 'string' && uuid.test(input.order_id)
  if (typeof input.phone_number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(input.phone_number)) return false
  if (action === 'check_phone') return true
  if (!airtimeId(input.product_id) || input.operator_id !== input.product_id) return false
  if (input.package_id !== undefined && (typeof input.package_id !== 'string' ||
      input.package_id.length > 180 || !/^[\x20-\x7e]+$/.test(input.package_id) || /["'\\]/.test(input.package_id))) return false
  if (input.unit_value !== undefined && (typeof input.unit_value !== 'number' || !Number.isFinite(input.unit_value)
      || input.unit_value <= 0 || Math.abs(input.unit_value * 100 - Math.round(input.unit_value * 100)) > 1e-7)) return false
  if (input.package_id === undefined && input.unit_value === undefined) return false
  if (action === 'purchase' && (typeof input.expected_amount_ngn !== 'number' ||
      !Number.isSafeInteger(input.expected_amount_ngn) || input.expected_amount_ngn <= 0 || input.expected_amount_ngn > 1_000_000_000 ||
      typeof input.idempotency_key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$/.test(input.idempotency_key))) return false
  return true
}
// Product checkout can deliver up to 500 local accounts. Bound the response
// independently of Content-Length while allowing their full credentials.
async function targetJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const maximum = 32 * 1024 * 1024
  const declared = response.headers.get('content-length')
  if (signal.aborted || response.redirected || !response.body ||
    (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))) throw new Error('Target unavailable')
  const reader = response.body.getReader()
  let rejectAbort: (reason: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => { void reader.cancel().catch(() => {}); rejectAbort(new Error('Target deadline')) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximum) throw new Error('Target response too large')
      chunks.push(chunk.value)
    }
    if (signal.aborted) throw new Error('Target deadline')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Target invalid response')
    return value as Record<string, unknown>
  } finally {
    signal.removeEventListener('abort', abort)
    void reader.cancel().catch(() => {})
  }
}
async function callTarget(identity: { key_id: string; user_id: string; section: Section },
  target: 'process-purchase' | 'smsbus' | 'smm-create-order' | 'customer-airtime' | 'customer-giftcards' | 'telegram-stars',
  payload: Record<string, unknown>, timeoutMs: number, failureCode: 'purchase_outcome_unknown' | 'unavailable' = 'purchase_outcome_unknown') {
  const rawBody = JSON.stringify(payload)
  const capability = await signCustomerCapability(identity, target, rawBody)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/${target}`
  const controller = new AbortController()
  const signal = controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Target deadline')) }, timeoutMs)
  })
  try {
    const request = (async () => {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', headers: {
          Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
          'Content-Type': 'application/json', 'x-tally-api-capability': capability,
        }, body: rawBody, signal,
      })
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('Target deadline') }
      return json(await targetJson(response, signal), response.status)
    })()
    return await Promise.race([request, deadline])
  } catch { return fail(failureCode, 503) }
  finally { controller.abort(); clearTimeout(timer) }
}
async function airtimeAction(req: Request, path: string, admin: any) {
  const action: AirtimeAction = path === '/v1/airtime/check-phone' ? 'check_phone' :
    path === '/v1/airtime/quote' ? 'quote' : 'status'
  const input = await body(req)
  if (!validAirtimeInput(input, action)) return fail('invalid_request')
  const authorization = await authorize(req, admin, 'airtime')
  if (authorization.error) return authorization.error
  const payload = { ...input }
  delete payload.section
  return callTarget(authorization.identity!, 'customer-airtime', { ...payload, action }, action === 'quote' ? 30_000 : 20_000)
}
async function giftcardAction(req: Request, path: string, admin: any) {
  const action = path === '/v1/giftcards/details' ? 'details' :
    path === '/v1/giftcards/quote' ? 'quote' : 'status'
  const input = await body(req)
  const permitted = action === 'status' ? ['section', 'order_id'] : action === 'details'
    ? ['section', 'product_id'] : ['section', 'product_id', 'package_id', 'unit_value', 'quantity', 'quote_request_id']
  if (input.section !== 'giftcards' || Object.keys(input).some(key => !permitted.includes(key))) return fail('invalid_request')
  if (action === 'status' ? typeof input.order_id !== 'string' || !uuid.test(input.order_id)
    : typeof input.product_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(input.product_id)) {
    return fail('invalid_request')
  }
  if (action === 'quote' && (!Number.isSafeInteger(input.quantity) || (input.quantity as number) < 1 ||
    (input.quantity as number) > 20 || typeof input.unit_value !== 'number' || !Number.isFinite(input.unit_value)
    || input.unit_value <= 0
    || typeof input.quote_request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$/.test(input.quote_request_id))) {
    return fail('invalid_request')
  }
  const authorization = await authorize(req, admin, 'giftcards')
  if (authorization.error) return authorization.error
  const payload: Record<string, unknown> = { ...input, action }
  delete payload.section
  return callTarget(authorization.identity!, 'customer-giftcards', payload, action === 'quote' ? 120_000 : action === 'status' ? 30_000 : 20_000)
}
async function telegramAction(req: Request, path: string, admin: any) {
  const action: TelegramApiAction = path === '/v1/telegram/recipient' ? 'recipient' :
    path === '/v1/telegram/quote' ? 'quote' : 'status'
  const input = await body(req)
  if (!validTelegramApiInput(input, action)) return fail('invalid_request')
  const authorization = await authorize(req, admin, 'telegram')
  if (authorization.error) return authorization.error
  const payload: Record<string, unknown> = { ...input, action: `api_${action}` }
  delete payload.section
  return callTarget(authorization.identity!, 'telegram-stars', payload, 25_000)
}
async function purchase(req: Request, admin: any) {
  const input = await body(req)
  const requested = section(input.section)
  if (!requested) return fail('invalid_section')
  if (requested === 'airtime' && !validAirtimeInput(input, 'purchase')) return fail('invalid_request')
  if (requested === 'telegram' && !validTelegramApiInput(input, 'purchase')) return fail('invalid_request')
  if (requested === 'giftcards' && (typeof input.quote_id !== 'string' || !uuid.test(input.quote_id))) return fail('invalid_request')
  const authorization = await authorize(req, admin, requested)
  if (authorization.error) return authorization.error
  const target = requested === 'products' ? 'process-purchase' :
    requested === 'sms' ? 'smsbus' : requested === 'airtime' ? 'customer-airtime' :
    requested === 'giftcards' ? 'customer-giftcards' : requested === 'telegram' ? 'telegram-stars' : 'smm-create-order'
  const payload = { ...input }
  delete payload.section
  if (requested === 'sms') payload.action = 'create_otp'
  if (requested === 'airtime') payload.action = 'purchase'
  if (requested === 'giftcards') payload.action = 'purchase'
  if (requested === 'telegram') payload.action = 'api_purchase'
  // The target route owns pricing, verified-wallet checks, idempotency,
  // supplier dispatch, and its current pause flag.
  return callTarget(authorization.identity!, target, payload, 45_000)
}
async function read(req: Request, path: string, admin: any) {
  const url = new URL(req.url)
  const requested = section(url.searchParams.get('section'))
  if (!requested) return fail('invalid_section')
  const authorization = await authorize(req, admin, requested)
  if (authorization.error) return authorization.error
  const userId = authorization.identity!.user_id
  if (path === '/v1/wallet') {
    const { data, error } = await admin.rpc('wallet_financial_truth_internal', { p_user_id: userId })
    if (error || !data || data.spending_blocked !== false ||
        !Number.isFinite(Number(data.confirmed_spendable))) return fail('wallet_unavailable', 503)
    return json({ success: true, data: { currency: 'NGN', spendable_ngn: Number(data.confirmed_spendable) } })
  }
  if (path === '/v1/catalogue') {
    if (requested === 'airtime') return fail('use_airtime_check_phone', 400)
    if (requested === 'telegram') return callTarget(authorization.identity!, 'telegram-stars', { action: 'api_catalogue' }, 25_000)
    if (requested === 'giftcards') {
      const allowed = new Set(['section','start','limit','q','country'])
      for (const name of new Set(url.searchParams.keys())) {
        if (!allowed.has(name) || url.searchParams.getAll(name).length !== 1) return fail('invalid_request')
      }
      const startRaw = url.searchParams.get('start') ?? '0'
      const limitRaw = url.searchParams.get('limit') ?? '20'
      const country = url.searchParams.get('country')
      const query = url.searchParams.get('q')
      if (!/^\d{1,7}$/.test(startRaw) || Number(startRaw) > 1_000_000 ||
        !/^\d{1,2}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 50 ||
        (country !== null && !/^[A-Z]{2}$/.test(country)) ||
        (query !== null && (!query.trim() || query.length > 100 ||
          [...query].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)))) return fail('invalid_request')
      const response = await callTarget(authorization.identity!, 'customer-giftcards', {
        action:'catalogue',start:Number(startRaw),limit:Number(limitRaw),
        ...(country === null ? {} : { country }),...(query === null ? {} : { query }),
      }, 20_000)
      const result = await response.clone().json().catch(() => null)
      if (!response.ok || result?.success !== true) return response
      return Array.isArray(result.products) && result.products.length <= Number(limitRaw) &&
        result.pagination?.start === Number(startRaw) && result.pagination?.limit === Number(limitRaw)
        ? json({ success:true,data:result.products,pagination:result.pagination }) : fail('unavailable',503)
    }
    if (requested === 'products') {
      const circlePct = await circlePercent(admin, userId)
      const { data, error } = await admin.from('product_groups')
        .select('id, name, description, price, stock_count, availability_status, is_sellable, quantity_discount_tiers, categories(name)')
        .eq('is_active', true).order('name').limit(500)
      if (error) return fail('unavailable', 503)
      return json({ success: true, data: (data || []).map((item: any) => ({
        id: item.id, name: item.name, description: item.description,
        category: item.categories?.name || null, price_ngn: Number(item.price),
        unit_price_ngn: Number(item.price), tally_circle_discount_percent: circlePct,
        quantity_discount_tiers: item.quantity_discount_tiers || [],
        available: item.is_sellable !== false && (Number(item.stock_count) > 0 ||
          String(item.availability_status).toUpperCase() === 'UNLIMITED') &&
          !['UNAVAILABLE', 'PAUSED'].includes(String(item.availability_status).toUpperCase()),
        stock_count: Number(item.stock_count), availability_status: item.availability_status,
      })) })
    }
    if (requested === 'social_boost') {
      const { data, error } = await admin.from('smm_services')
        .select('id, name, category, platform, service_type, price_ngn, rate_usd, min_quantity, max_quantity')
        .eq('is_active', true).order('platform').limit(500)
      if (error) return fail('unavailable', 503)
      return json({ success: true, data: (data || []).filter((item: any) =>
        getSmmOrderContract(item.service_type) && Number(item.price_ngn) > 0 &&
        item.rate_usd !== null && item.rate_usd !== undefined &&
        Number.isFinite(Number(item.rate_usd)) && Number(item.rate_usd) >= 0
      ).map((item: any) => {
        const { rate_usd: _providerCost, ...publicItem } = item
        const contract = getSmmOrderContract(item.service_type)!
        return { ...publicItem, price_basis: contract.mode === 'package' ? 'fixed' : 'per_1000',
          required_fields: contract.fields }
      }) })
    }
    // SMS pricing depends on its live catalogue. Apply the same bounded,
    // redirect-refusing transport used for every other delegated target.
    return callTarget(authorization.identity!, 'smsbus', { action: 'services' }, 20_000, 'unavailable')
  }
  if (path === '/v1/quote') {
    if (requested === 'telegram') {
      const allowed = ['section', 'product_type', 'quantity', 'product_id']
      for (const name of url.searchParams.keys()) if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1) return fail('invalid_request')
      const input: Record<string, unknown> = Object.fromEntries(url.searchParams)
      if (input.quantity !== undefined) input.quantity = typeof input.quantity === 'string' && /^\d+$/.test(input.quantity) ? Number(input.quantity) : NaN
      if (!validTelegramApiInput(input, 'quote')) return fail('invalid_request')
      delete input.section
      return callTarget(authorization.identity!, 'telegram-stars', { ...input, action: 'api_quote' }, 25_000)
    }
    if (requested === 'products') return await productQuote(admin, userId, url)
    if (requested === 'social_boost') return await socialQuote(admin, url)
    return fail('invalid_section')
  }
  if (path === '/v1/orders') {
    if (requested === 'telegram') return callTarget(authorization.identity!, 'telegram-stars', { action: 'api_orders' }, 20_000)
    if (requested === 'giftcards') {
      const response = await callTarget(authorization.identity!, 'customer-giftcards', { action: 'orders' }, 20_000)
      const result = await response.clone().json().catch(() => null)
      if (!response.ok || result?.success !== true) return response
      return Array.isArray(result.orders) ? json({ success: true, data: result.orders }) : fail('unavailable', 503)
    }
    const table = requested === 'products' ? 'orders' : requested === 'sms' ? 'sms_orders' :
      requested === 'airtime' ? 'customer_airtime_orders' : 'smm_orders'
    const fields = requested === 'products' ? 'id, status, amount, created_at, product_group_id' :
      requested === 'sms' ? 'id, status, price_ngn, created_at, service_id' :
      requested === 'airtime' ? 'id, status, recipient_phone, product_name, amount_ngn, currency, created_at' :
      'id, status, amount_ngn, created_at, service_id'
    const { data, error } = await admin.from(table).select(fields).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(100)
    if (error) return fail('unavailable', 503)
    return json({ success: true, data: data || [] })
  }
  const orderMatch = /^\/v1\/orders\/([a-f0-9-]{36})$/.exec(path)
  if (orderMatch) {
    if (!uuid.test(orderMatch[1])) return fail('invalid_request')
    if (requested === 'telegram') return callTarget(authorization.identity!, 'telegram-stars',
      { action: 'api_status', order_id: orderMatch[1] }, 25_000)
    if (requested === 'giftcards') {
      const response = await callTarget(authorization.identity!, 'customer-giftcards',
        { action: 'order', order_id: orderMatch[1] }, 20_000)
      const result = await response.clone().json().catch(() => null)
      if (!response.ok || result?.success !== true) return response
      return result.order?.id === orderMatch[1]
        ? json({ success: true, data: { ...result.order,
          ...('redemptions' in result ? { redemptions: result.redemptions } : {}) } })
        : fail('unavailable', 503)
    }
    const table = requested === 'products' ? 'orders' : requested === 'sms' ? 'sms_orders' :
      requested === 'airtime' ? 'customer_airtime_orders' : 'smm_orders'
    const fields = requested === 'products'
      ? 'id, status, amount, created_at, product_group_id, account_details, financial_authorization_status'
      : requested === 'sms'
      ? 'id, status, price_ngn, created_at, service_id, phone_number, messages'
      : requested === 'airtime'
      ? 'id, status, recipient_phone, product_name, amount_ngn, currency, created_at'
      : 'id, status, amount_ngn, created_at, service_id, quantity, link'
    const { data, error } = await admin.from(table).select(fields)
      .eq('user_id', userId).eq('id', orderMatch[1]).maybeSingle()
    if (error) return fail('unavailable', 503)
    if (!data) return fail('not_found', 404)
    if (requested === 'products') {
      const { account_details, financial_authorization_status, ...summary } = data
      return json({ success: true, data: {
        ...summary,
        ...(data.status === 'completed' && financial_authorization_status === 'captured'
          ? { account_details } : {}),
      } })
    }
    return json({ success: true, data })
  }
  return fail('not_found', 404)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ success: true })
  const route = customerApiRoute(new URL(req.url).pathname, req.method)
  // The customer feature is advertised as Coming soon. Hiding its page is not
  // authorization: key issuance, delegated purchases and API reads must all
  // remain unavailable until the server-side launch gate is explicitly enabled.
  // Existing owners may still revoke keys, and the owner may prepare access.
  const pausedControl = route.kind === 'manage' && (
    (req.method === 'DELETE' && /^\/v1\/keys\/[a-f0-9-]{36}$/.test(route.path)) ||
    (req.method === 'POST' && route.path === '/v1/admin/access')
  )
  if (route.kind !== 'not_found' && Deno.env.get('CUSTOMER_API_ENABLED') !== 'true' && !pausedControl) {
    return fail('coming_soon', 503)
  }
  try {
    const admin = adminClient()
    if (route.kind === 'manage') return await manage(req, route.path, admin)
    if (route.kind === 'purchase') return await purchase(req, admin)
    if (route.kind === 'airtime') return await airtimeAction(req, route.path, admin)
    if (route.kind === 'giftcards') return await giftcardAction(req, route.path, admin)
    if (route.kind === 'telegram') return await telegramAction(req, route.path, admin)
    if (route.kind === 'read') return await read(req, route.path, admin)
    return fail('not_found', 404)
  } catch (error) {
    console.error('Customer API request failed', error instanceof Error ? error.name : 'unknown')
    if (error instanceof Error && error.message === 'Unauthorized') return fail('unauthorized', 401)
    if (error instanceof Error && error.message === 'Request too large') return fail('request_too_large', 413)
    if (error instanceof Error && error.message === 'Request timed out') return fail('request_timeout', 408)
    if (error instanceof Error && error.message === 'Invalid JSON request') return fail('invalid_request', 400)
    return fail('unavailable', 503)
  }
})
