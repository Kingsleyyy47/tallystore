import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { sha256Hex, signCustomerCapability } from '../_shared/customer-api-delegation.ts'
import { customerApiRoute } from '../_shared/customer-api-route.mjs'

type Section = 'products' | 'sms' | 'social_boost'
const sections = new Set<Section>(['products', 'sms', 'social_boost'])
const defaultSections: Section[] = ['products', 'sms', 'social_boost']
const smmQuantityTypes = new Set([
  'Default','Mentions','Mentions with Hashtags','Mentions Hashtag',
  'Mentions User Followers','Mentions Media Likers','Comment Likes',
  'Invites from Groups','Subscriptions','Web Traffic',
])
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
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > 16_384) throw new Error('Request too large')
  const parsed = JSON.parse(raw)
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
  const { data, error } = await admin.rpc('tally_circle_qualified_count', { p_user_id: userId })
  if (error || !Number.isInteger(data) || data < 0) throw new Error('Circle status unavailable')
  return data >= 5 ? 3 : 0
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
  const rawKey = /^Bearer\s+(tlyc_(?:products|sms|social_boost)_[a-f0-9]{64})$/i.exec(req.headers.get('authorization') || '')?.[1]
  if (!rawKey) return { error: fail('invalid_key', 401) }
  const { data, error } = await admin.rpc('customer_api_authorize', {
    p_hash: await sha256Hex(rawKey), p_section: requested, p_limit: 60,
  })
  if (error || !data) return { error: fail('unavailable', 503) }
  if (!data.ok) return { error: fail(data.code, data.code === 'rate_limited' ? 429 : 401) }
  return { identity: data as { key_id: string; user_id: string; section: Section } }
}
async function purchase(req: Request, admin: any) {
  const input = await body(req)
  const requested = section(input.section)
  if (!requested) return fail('invalid_section')
  const authorization = await authorize(req, admin, requested)
  if (authorization.error) return authorization.error
  const target = requested === 'products' ? 'process-purchase' :
    requested === 'sms' ? 'smsbus' : 'smm-create-order'
  const payload = { ...input }
  delete payload.section
  if (requested === 'sms') payload.action = 'create_otp'
  // The target route owns pricing, verified-wallet checks, idempotency,
  // supplier dispatch, and its current pause flag.
  const rawBody = JSON.stringify(payload)
  const capability = await signCustomerCapability(authorization.identity!, target, rawBody)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/${target}`
  const response = await fetch(url, {
    method: 'POST', headers: {
      Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
      'Content-Type': 'application/json', 'x-tally-api-capability': capability,
    }, body: rawBody, signal: AbortSignal.timeout(45_000),
  })
  const result = await response.json().catch(() => null)
  if (!result) return fail('purchase_outcome_unknown', 503)
  return json(result, response.status)
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
        .select('id, name, category, platform, service_type, price_ngn, min_quantity, max_quantity')
        .eq('is_active', true).order('platform').limit(500)
      if (error) return fail('unavailable', 503)
      return json({ success: true, data: (data || []).map((item: any) => ({
        ...item,
        price_basis: item.service_type === 'Package' || !smmQuantityTypes.has(item.service_type)
          ? 'fixed' : 'per_1000',
      })) })
    }
    // SMS pricing depends on a live Daisy quote; use its existing catalogue.
    const rawBody = JSON.stringify({ action: 'services' })
    const capability = await signCustomerCapability(authorization.identity!, 'smsbus', rawBody)
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const response = await fetch(`${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/smsbus`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
        'Content-Type': 'application/json', 'x-tally-api-capability': capability }, body: rawBody,
      signal: AbortSignal.timeout(20_000),
    })
    const data = await response.json().catch(() => null)
    return data ? json(data, response.status) : fail('unavailable', 503)
  }
  if (path === '/v1/quote') {
    if (requested !== 'products') return fail('invalid_section')
    return await productQuote(admin, userId, url)
  }
  if (path === '/v1/orders') {
    const table = requested === 'products' ? 'orders' : requested === 'sms' ? 'sms_orders' : 'smm_orders'
    const fields = requested === 'products' ? 'id, status, amount, created_at, product_group_id' :
      requested === 'sms' ? 'id, status, price_ngn, created_at, service_id' :
      'id, status, amount_ngn, created_at, service_id'
    const { data, error } = await admin.from(table).select(fields).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(100)
    if (error) return fail('unavailable', 503)
    return json({ success: true, data: data || [] })
  }
  const orderMatch = /^\/v1\/orders\/([a-f0-9-]{36})$/.exec(path)
  if (orderMatch) {
    if (!uuid.test(orderMatch[1])) return fail('invalid_request')
    const table = requested === 'products' ? 'orders' : requested === 'sms' ? 'sms_orders' : 'smm_orders'
    const fields = requested === 'products'
      ? 'id, status, amount, created_at, product_group_id, account_details, financial_authorization_status'
      : requested === 'sms'
      ? 'id, status, price_ngn, created_at, service_id, phone_number, messages'
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
    if (route.kind === 'read') return await read(req, route.path, admin)
    return fail('not_found', 404)
  } catch (error) {
    console.error('Customer API request failed', error instanceof Error ? error.name : 'unknown')
    if (error instanceof Error && error.message === 'Unauthorized') return fail('unauthorized', 401)
    return fail('unavailable', 503)
  }
})
