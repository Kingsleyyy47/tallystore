import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tally-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const ALL_SECTIONS = ['products', 'sms', 'social_boost', 'bills_airtime', 'giftcards', 'crypto', 'telegram_stars']
const DEFAULT_SCOPES = ['catalogue:read', 'orders:create', 'orders:read', 'wallet:read']
const API_PARTNER_ADMIN_SELECT = 'id, name, contact_email, is_active, allowed_sections, markup_percent, balance_ngn, webhook_url, notes, created_at, updated_at'
const DEFAULT_DAISY_BASE = 'https://daisysms.io/stubs/handler_api.php'
const DAISY_COUNTRY = 187
const DEFAULT_SMS_MARGIN_NGN = 700
const SMM_API_URL = 'https://thelordofthepanels.com/api/v2'
const BITREFILL_API_URL = 'https://api.bitrefill.com/v2'
const SAGECLOUD_API_URL = 'https://api.sagecloud.ng/api'
const ISTAR_BASE = Deno.env.get('ISTAR_BASE_URL') || 'https://v1.fragmentapi.com/api/v1/partner'
const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1'
const NIGERIAN_NETWORKS = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'] as const

type SupabaseAdmin = ReturnType<typeof createClient>

type PartnerAuth = {
  partner: any
  key: any
}

type ApiResult = {
  body: Record<string, unknown>
  status?: number
}

type BitrefillProductPackage = { package_id: string; value: number }
type BitrefillProduct = {
  product_id: string
  name: string
  currency?: string
  categories?: string[]
  countries?: string[]
  recipient_type?: string
  packages?: BitrefillProductPackage[]
  range?: { min: number; max: number; step: number }
  [key: string]: any
}

type DataPlan = {
  type?: string
  code: string
  description?: string
  amount?: string
  price?: string
  value?: string
  duration?: string
}

type Network = (typeof NIGERIAN_NETWORKS)[number]

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes = 32) {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return Array.from(data).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function cleanEmail(value: unknown) {
  const text = cleanText(value, 254)
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null
}

function cleanCustomerName(value: unknown) {
  return String(value || '').replace(/[^a-zA-Z\s]/g, '').trim().slice(0, 120) || 'TallyStore Customer'
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 500)
  if (!text) return null
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function asStringArray(value: unknown, fallback: readonly string[]) {
  if (!Array.isArray(value)) return fallback
  return value.map((item) => String(item).trim()).filter(Boolean)
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function allowedSections(value: unknown) {
  const requested = asStringArray(value, ALL_SECTIONS)
  const allowed = requested.filter((section) => ALL_SECTIONS.includes(section))
  return allowed.length ? allowed : ALL_SECTIONS
}

function hasSection(partner: any, section: string) {
  const sections = Array.isArray(partner.allowed_sections) ? partner.allowed_sections : ALL_SECTIONS
  return sections.includes(section)
}

function hasScope(auth: PartnerAuth, scope: string) {
  const scopes = Array.isArray(auth.key.scopes) ? auth.key.scopes : []
  return scopes.includes(scope)
}

function partnerMarkup(partner: any, amount: number) {
  const markup = Number(partner.markup_percent || 0)
  return Math.ceil(amount * (1 + Math.max(0, markup) / 100))
}

function splitName(value: unknown): { first: string; last: string } {
  const cleaned = cleanCustomerName(value)
  const parts = cleaned.split(/\s+/)
  return { first: parts[0] || 'Tally', last: parts.slice(1).join(' ') || 'Customer' }
}

function getPocketFiConfig() {
  const token = Deno.env.get('POCKETFI_PUBLIC_KEY') ||
    Deno.env.get('POCKETFI_API_TOKEN') ||
    Deno.env.get('VITE_POCKETFI_API_TOKEN') ||
    Deno.env.get('VITE_POCKETFI_PUBLIC_KEY') ||
    ''
  const businessId = Deno.env.get('POCKETFI_BUSINESS_ID') || Deno.env.get('VITE_POCKETFI_BUSINESS_ID') || ''
  const baseUrl = Deno.env.get('POCKETFI_BASE_URL') || Deno.env.get('VITE_POCKETFI_BASE_URL') || 'https://api.pocketfi.ng/api/v1'
  if (!token || !businessId) throw new Error('PocketFi is not configured')
  return { token, businessId, baseUrl }
}

async function getPocketFiBankOrder(admin: SupabaseAdmin) {
  const validBanks = ['kuda', '9psb', 'paga', 'saveheaven']
  const { data } = await admin.from('app_settings').select('value').eq('key', 'pocketfi_bank').maybeSingle()
  const preferred = data?.value && validBanks.includes(data.value) ? data.value : null
  return preferred ? [preferred, ...validBanks.filter((bank) => bank !== preferred)] : validBanks
}

function getApiKey(req: Request) {
  const explicit = req.headers.get('x-tally-api-key') || req.headers.get('x-api-key')
  if (explicit?.trim()) return explicit.trim()
  const auth = req.headers.get('Authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  return bearer.startsWith('tly_') ? bearer : ''
}

async function requireAdmin(req: Request, admin: SupabaseAdmin) {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) throw new Error('Missing admin authorization')
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const { data: { user }, error } = await anon.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (error || !user) throw new Error('Unauthorized')
  const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Admin access required')
  return user
}

function requireInternal(req: Request) {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const internalSecret = Deno.env.get('PARTNER_API_INTERNAL_SECRET') || ''
  const auth = req.headers.get('authorization') || ''
  const providedSecret = req.headers.get('x-internal-secret') || ''
  if (serviceRole && auth === `Bearer ${serviceRole}`) return
  if (internalSecret && providedSecret === internalSecret) return
  throw new Error('Unauthorized internal request')
}

async function requirePartner(req: Request, admin: SupabaseAdmin): Promise<PartnerAuth> {
  const apiKey = getApiKey(req)
  if (!apiKey) throw new Error('Missing TallyStore API key')
  const keyHash = await sha256Hex(apiKey)
  const { data: key, error } = await admin
    .from('api_partner_keys')
    .select('*, api_partners(*)')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle()

  if (error || !key || !key.api_partners) throw new Error('Invalid API key')
  if (key.api_partners.is_active === false) throw new Error('Partner API access is disabled')

  await admin.from('api_partner_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id)
  return { partner: key.api_partners, key }
}

async function writeLog(
  admin: SupabaseAdmin,
  req: Request,
  auth: PartnerAuth | null,
  action: string,
  statusCode: number,
  success: boolean,
  errorMessage?: string,
  metadata: Record<string, unknown> = {},
) {
  await admin.from('api_partner_logs').insert({
    partner_id: auth?.partner?.id || null,
    key_id: auth?.key?.id || null,
    action,
    method: req.method,
    status_code: statusCode,
    success,
    error_message: errorMessage || null,
    ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
    user_agent: req.headers.get('user-agent') || null,
    metadata,
  })
}

async function debitPartner(admin: SupabaseAdmin, partnerId: string, amount: number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: partner, error } = await admin.from('api_partners').select('balance_ngn').eq('id', partnerId).single()
    if (error || !partner) throw new Error('Partner account not found')
    const current = Number(partner.balance_ngn || 0)
    if (current < amount) throw new Error(`Insufficient partner balance. Required NGN ${amount.toLocaleString()}, available NGN ${current.toLocaleString()}`)
    const next = current - amount
    const { data: updated } = await admin
      .from('api_partners')
      .update({ balance_ngn: next, updated_at: new Date().toISOString() })
      .eq('id', partnerId)
      .eq('balance_ngn', current)
      .select('balance_ngn')
      .single()
    if (updated) return { previous: current, next }
  }
  throw new Error('Partner balance changed during purchase. Please retry.')
}

async function creditPartner(admin: SupabaseAdmin, partnerId: string, amount: number) {
  const { data: partner } = await admin.from('api_partners').select('balance_ngn').eq('id', partnerId).single()
  const current = Number(partner?.balance_ngn || 0)
  const next = current + amount
  await admin.from('api_partners').update({ balance_ngn: next, updated_at: new Date().toISOString() }).eq('id', partnerId)
  return next
}

async function getNgnUsdRate(admin: SupabaseAdmin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'ngn_usd_rate').maybeSingle()
  const rate = Number(data?.value)
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

async function getRequiredNgnUsdRate(admin: SupabaseAdmin) {
  const override = await getNgnUsdRate(admin)
  if (override > 0) return override
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD')
    const data = await response.json()
    const rate = Number(data?.rates?.NGN)
    if (Number.isFinite(rate) && rate > 0) return rate
  } catch {
    // Fall through to the explicit configuration error.
  }
  throw new Error('NGN/USD exchange rate is unavailable. Set ngn_usd_rate in admin settings.')
}

async function convertToNgn(admin: SupabaseAdmin, amount: number, currency = 'USD') {
  const normalized = String(currency || 'USD').toUpperCase()
  if (normalized === 'NGN') return amount
  if (normalized !== 'USD') throw new Error(`Unsupported provider currency: ${normalized}`)
  return amount * await getRequiredNgnUsdRate(admin)
}

async function getBitrefillMarkupPct(admin: SupabaseAdmin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'bitrefill_markup_pct').maybeSingle()
  const value = Number(data?.value)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function getBitrefillClient() {
  const apiKey = Deno.env.get('BITREFILL_API_KEY') || ''
  if (!apiKey) throw new Error('Bitrefill provider is not configured')
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${BITREFILL_API_URL}${endpoint}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.headers as Record<string, string>),
      },
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(data?.message || data?.error || `Bitrefill API error ${response.status}`)
    return data
  }
  return {
    listProducts: (limit = 80, cursor?: string) => request(`/products?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) }).toString()}`),
    searchProducts: (query: string, limit = 80) => request(`/products/search?${new URLSearchParams({ q: query, limit: String(limit) }).toString()}`),
    getProductDetails: (productId: string) => request(`/products/${encodeURIComponent(productId)}`),
    getBalance: () => request('/accounts/balance'),
    createInvoice: (params: Record<string, unknown>) => request('/invoices', { method: 'POST', body: JSON.stringify({ payment_method: 'balance', ...params }) }),
    getInvoice: (invoiceId: string) => request(`/invoices/${encodeURIComponent(invoiceId)}`),
    getOrder: (orderId: string) => request(`/orders/${encodeURIComponent(orderId)}`),
  }
}

async function getBlockedBitrefillIds(admin: SupabaseAdmin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'bitrefill_blocked_products').maybeSingle()
  try {
    const parsed = JSON.parse(String(data?.value || '[]'))
    return new Set(Array.isArray(parsed) ? parsed.map((item: any) => String(item.product_id || '')).filter(Boolean) : [])
  } catch {
    return new Set<string>()
  }
}

function sageCloudClient() {
  const publicKey = Deno.env.get('SAGECLOUD_PUBLIC_KEY') || ''
  const secretKey = Deno.env.get('SAGECLOUD_SECRET_KEY') || ''
  if (!publicKey || !secretKey) throw new Error('SageCloud provider is not configured')
  let authToken: string | null = null
  let tokenExpiry = 0
  const getAuthToken = async () => {
    if (authToken && tokenExpiry > Date.now() + 60_000) return authToken
    const response = await fetch(`${SAGECLOUD_API_URL}/merchant/authorization`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${publicKey}:${secretKey}`)}`,
      },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || data?.error || `SageCloud authentication failed ${response.status}`)
    authToken = data?.data?.token?.access_token
    tokenExpiry = Date.parse(data?.data?.token?.expires_at || '') || Date.now() + 4 * 60_000
    if (!authToken) throw new Error('SageCloud did not return an access token')
    return authToken
  }
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const token = await getAuthToken()
    const response = await fetch(`${SAGECLOUD_API_URL}${endpoint}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string>),
      },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || data?.error || `SageCloud API error ${response.status}`)
    return data
  }
  return {
    getBalanceAmount: async () => Number((await request('/wallet/balance'))?.general_wallet?.balance || 0),
    getDataPlans: (provider: `${Network}DATA`) => request(`/internet/data/lookup?provider=${provider}`),
    purchaseAirtime: (params: Record<string, unknown>) => request('/airtime', { method: 'POST', body: JSON.stringify(params) }),
    purchaseData: (params: Record<string, unknown>) => request('/internet/data', { method: 'POST', body: JSON.stringify(params) }),
  }
}

function normalizeNetwork(value: unknown): Network {
  const provider = String(value || '').toUpperCase().replace(/\s+/g, '')
  if (!NIGERIAN_NETWORKS.includes(provider as Network)) throw new Error(`service_provider must be one of: ${NIGERIAN_NETWORKS.join(', ')}`)
  return provider as Network
}

function normalizeNigerianPhone(value: unknown) {
  const phone = String(value || '').replace(/\D/g, '')
  if (!/^0\d{10}$/.test(phone)) throw new Error('phone must be an 11-digit Nigerian phone number')
  return phone
}

function istarHeaders() {
  const apiKey = Deno.env.get('ISTAR_API_KEY') || ''
  if (!apiKey) throw new Error('Telegram provider is not configured')
  return { 'API-Key': apiKey, 'Content-Type': 'application/json' }
}

async function istarGet(path: string) {
  const response = await fetch(`${ISTAR_BASE}${path}`, { headers: istarHeaders() })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || data?.error || `iStar API error ${response.status}`)
  return data
}

async function istarPost(path: string, body: unknown, idempotencyKey: string) {
  const response = await fetch(`${ISTAR_BASE}${path}`, {
    method: 'POST',
    headers: { ...istarHeaders(), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || data?.error || `iStar API error ${response.status}`)
  return data
}

async function getTelegramStarPricing(admin: SupabaseAdmin) {
  const [costRow, tiersRow, walletRow, rate] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_star_cost_usdt').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_star_markup_tiers').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_wallet_type').maybeSingle(),
    getRequiredNgnUsdRate(admin),
  ])
  let tiers: Array<{ min_qty: number; max_qty: number | null; markup_ngn: number }> = []
  try { tiers = JSON.parse(String(tiersRow.data?.value || '[]')) } catch { tiers = [] }
  return {
    cost_per_star_usdt: Number(costRow.data?.value || 0.013),
    markup_tiers: Array.isArray(tiers) ? tiers : [],
    wallet_type: String(walletRow.data?.value || 'USDT').toUpperCase(),
    usdt_to_ngn: rate,
  }
}

function calculateTelegramStarsPrice(quantity: number, cfg: { cost_per_star_usdt: number; markup_tiers: Array<{ min_qty: number; max_qty: number | null; markup_ngn: number }>; usdt_to_ngn: number }) {
  const base = cfg.cost_per_star_usdt * quantity * cfg.usdt_to_ngn
  const tier = cfg.markup_tiers.find((item) => quantity >= item.min_qty && (item.max_qty === null || quantity <= item.max_qty))
  return Math.ceil((base + Number(tier?.markup_ngn || 0)) / 10) * 10
}

async function getTelegramPremiumPricing(admin: SupabaseAdmin) {
  const [markup3, markup6, markup12, rate] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_3m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_6m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_12m').maybeSingle(),
    getRequiredNgnUsdRate(admin),
  ])
  const markups: Record<string, number> = {
    '3': Number(markup3.data?.value || 0),
    '6': Number(markup6.data?.value || 0),
    '12': Number(markup12.data?.value || 0),
  }
  try {
    const packages = await istarGet('/premium/packages')
    const costs: Record<string, number> = {}
    for (const pkg of Array.isArray(packages) ? packages : []) {
      if (pkg.months && pkg.usd_value) costs[String(pkg.months)] = Number(pkg.usd_value)
    }
    if (Object.keys(costs).length) return { costs, markups, usdt_to_ngn: rate }
  } catch {
    // Stored costs keep the catalogue usable if iStar pricing lookup is slow.
  }
  const [cost3, cost6, cost12] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_3m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_6m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_12m').maybeSingle(),
  ])
  return {
    costs: {
      '3': Number(cost3.data?.value || 0),
      '6': Number(cost6.data?.value || 0),
      '12': Number(cost12.data?.value || 0),
    },
    markups,
    usdt_to_ngn: rate,
  }
}

function calculateTelegramPremiumPrice(months: number, cfg: { costs: Record<string, number>; markups: Record<string, number>; usdt_to_ngn: number }) {
  const cost = cfg.costs[String(months)] || 0
  return cost > 0 ? Math.ceil((cost * cfg.usdt_to_ngn + Number(cfg.markups[String(months)] || 0)) / 10) * 10 : 0
}

function nowPaymentsClient() {
  const apiKey = Deno.env.get('NOWPAYMENTS_API_KEY') || ''
  if (!apiKey) throw new Error('NowPayments provider is not configured')
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${NOWPAYMENTS_API_URL}${endpoint}`, {
      ...options,
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || data?.error || `NowPayments API error ${response.status}`)
    return data
  }
  return {
    getCurrencies: () => request('/currencies?fixed_rate=true'),
    getEstimate: (amount: number, from: string, to: string) => request(`/estimate?${new URLSearchParams({ amount: String(amount), currency_from: from, currency_to: to }).toString()}`),
    createPayment: (params: Record<string, unknown>) => request('/payment', { method: 'POST', body: JSON.stringify(params) }),
    getPaymentStatus: (paymentId: string) => request(`/payment/${encodeURIComponent(paymentId)}`),
  }
}

function stockStatus(stock: number, isSellable: boolean, availability: string) {
  if (!isSellable || ['UNAVAILABLE', 'PAUSED'].includes(availability)) return 'out_of_stock'
  if (availability === 'UNLIMITED' || availability === 'PREORDER' || availability === 'BACKORDER') return availability.toLowerCase()
  if (stock <= 0) return 'out_of_stock'
  return stock <= 3 ? 'low_stock' : 'in_stock'
}

async function productCatalogue(admin: SupabaseAdmin, partner: any) {
  if (!hasSection(partner, 'products')) return []
  let { data, error } = await admin
    .from('product_groups')
    .select('id, category_id, name, description, price, stock_count, availability_status, is_sellable, is_active, created_at, categories(name)')
    .eq('is_active', true)
    .order('name')
  if (error) {
    const legacy = await admin
      .from('product_groups')
      .select('id, category_id, name, description, price, stock_count, is_active, created_at, categories(name)')
      .eq('is_active', true)
      .order('name')
    data = legacy.data
    error = legacy.error
  }
  if (error) throw new Error(`Failed to load products: ${error.message}`)

  return (data || []).map((product: any) => {
    const stock = Number(product.stock_count || 0)
    const availability = String(product.availability_status || '').toUpperCase()
    const isSellable = product.is_sellable !== false
    const status = stockStatus(stock, isSellable, availability)
    return {
      type: 'product',
      section: 'products',
      id: product.id,
      name: product.name,
      description: product.description || '',
      category: product.categories?.name || null,
      price_ngn: partnerMarkup(partner, Number(product.price || 0)),
      currency: 'NGN',
      availability: status === 'in_stock' || status === 'low_stock' ? 'available' : 'out_of_stock',
      stock: { status, available_quantity: stock },
      min_quantity: 1,
      max_quantity: stock,
      created_at: product.created_at,
    }
  })
}

type DaisyService = { code: string; name: string; count: number; priceUsd: number }

async function daisyGet(apiKey: string, params: Record<string, string>) {
  const url = new URL(Deno.env.get('DAISYSMS_BASE_URL') || DEFAULT_DAISY_BASE)
  url.searchParams.set('api_key', apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url.toString(), { headers: { Accept: 'text/plain' } })
  const text = (await response.text()).trim()
  if (!response.ok) throw new Error(`SMS provider request failed with HTTP ${response.status}`)
  return text
}

function parseDaisyEntry(code: string, value: any): DaisyService | null {
  if (!value || typeof value !== 'object') return null
  const count = Number(value.count ?? value.qty ?? value.quantity ?? 0)
  const priceUsd = Number(value.price ?? value.cost ?? value.rate ?? 0)
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return null
  return { code, name: String(value.name || code.toUpperCase()), count: Number.isFinite(count) ? Math.max(0, count) : 0, priceUsd }
}

function collectDaisy(raw: unknown) {
  const map = new Map<string, DaisyService>()
  if (!raw || typeof raw !== 'object') return map
  const obj = raw as Record<string, any>
  const country = obj[String(DAISY_COUNTRY)]
  const source = country && typeof country === 'object' ? country : obj
  for (const [code, entry] of Object.entries(source)) {
    if (/^\d+$/.test(code) || code === 'status' || code === 'services') continue
    const countryEntry = entry && typeof entry === 'object' && (entry as any)[String(DAISY_COUNTRY)] ? (entry as any)[String(DAISY_COUNTRY)] : entry
    const parsed = parseDaisyEntry(code, countryEntry)
    if (!parsed) continue
    const existing = map.get(parsed.code)
    if (!existing || parsed.count > existing.count) map.set(parsed.code, parsed)
  }
  return map
}

async function getDaisyServices() {
  const apiKey = Deno.env.get('DAISYSMS_API_KEY') || ''
  if (!apiKey) return new Map<string, DaisyService>()
  const services = new Map<string, DaisyService>()
  for (const params of [
    { action: 'getPricesVerification' },
    { action: 'getPricesVerification', country: String(DAISY_COUNTRY) },
    { action: 'getPrices' },
    { action: 'getPrices', country: String(DAISY_COUNTRY) },
  ]) {
    try {
      const text = await daisyGet(apiKey, params)
      if (text === 'BAD_KEY') throw new Error('SMS provider key is invalid')
      const parsed = collectDaisy(JSON.parse(text))
      for (const [code, svc] of parsed) {
        const existing = services.get(code)
        if (!existing || svc.count > existing.count) services.set(code, svc)
      }
    } catch {
      // Try the next provider shape. Catalogue should degrade instead of failing all sections.
    }
  }
  return services
}

async function smsCatalogue(admin: SupabaseAdmin, partner: any) {
  if (!hasSection(partner, 'sms')) return []
  const [rate, live] = await Promise.all([getNgnUsdRate(admin), getDaisyServices()])
  const { data: settings } = await admin
    .from('sms_product_settings')
    .select('service_code, service_name, is_enabled, price_override_ngn, margin_ngn, provider_cost_usd, available_count')
  const rows = new Map<string, any>()
  for (const item of settings || []) rows.set(item.service_code, item)
  for (const [code, service] of live) {
    rows.set(code, { ...(rows.get(code) || {}), service_code: code, service_name: rows.get(code)?.service_name || service.name, provider_cost_usd: service.priceUsd, available_count: service.count })
  }

  return [...rows.values()]
    .filter((row) => row.is_enabled !== false)
    .map((row) => {
      const liveService = live.get(row.service_code)
      const providerCostUsd = Number(liveService?.priceUsd ?? row.provider_cost_usd ?? 0)
      const count = Number(liveService?.count ?? row.available_count ?? 0)
      const margin = Number(row.margin_ngn ?? DEFAULT_SMS_MARGIN_NGN)
      const basePrice = Number(row.price_override_ngn || 0) > 0
        ? Number(row.price_override_ngn)
        : rate > 0 && providerCostUsd >= 0 ? Math.ceil(providerCostUsd * rate + margin) : 0
      return {
        type: 'sms',
        section: 'sms',
        id: row.service_code,
        name: row.service_name || String(row.service_code).toUpperCase(),
        description: 'US/Canada verification number',
        category: 'SMS',
        price_ngn: basePrice > 0 ? partnerMarkup(partner, basePrice) : null,
        currency: 'NGN',
        availability: count > 0 && basePrice > 0 ? 'available' : 'out_of_stock',
        stock: { status: count > 0 ? 'in_stock' : 'out_of_stock', available_quantity: count },
        min_quantity: 1,
        max_quantity: count > 0 ? 1 : 0,
      }
    })
    .sort((a, b) => Number(b.stock.available_quantity) - Number(a.stock.available_quantity) || String(a.name).localeCompare(String(b.name)))
}

const SMM_TYPES_WITH_QUANTITY = [
  'Default',
  'Mentions',
  'Mentions with Hashtags',
  'Mentions Hashtag',
  'Mentions User Followers',
  'Mentions Media Likers',
  'Comment Likes',
  'Invites from Groups',
  'Subscriptions',
  'Web Traffic',
]

function smmOrderParams(service: any, body: Record<string, unknown>, actualQuantity: number) {
  const params: Record<string, string | number> = { action: 'add', service: Number(service.external_id) }
  const serviceType = String(service.service_type || 'Default')
  const link = cleanText(body.link || body.target_url, 1000)
  if (serviceType !== 'Subscriptions') {
    if (!link) throw new Error('link is required for this Social Boost service')
    params.link = link
  }
  if (SMM_TYPES_WITH_QUANTITY.includes(serviceType)) params.quantity = actualQuantity
  for (const key of ['comments', 'usernames', 'username', 'hashtags', 'hashtag', 'keywords', 'groups']) {
    const text = cleanText(body[key], 4000)
    if (text) params[key] = text
  }
  const answerNumber = Number(body.answer_number)
  if (Number.isInteger(answerNumber) && answerNumber > 0) params.answer_number = answerNumber
  return params
}

async function smmRequest(params: Record<string, string | number>) {
  const apiKey = Deno.env.get('SMM_PANEL_API_KEY') || ''
  if (!apiKey) throw new Error('Social Boost provider is not configured')
  const form = new URLSearchParams()
  form.set('key', apiKey)
  for (const [key, value] of Object.entries(params)) form.set(key, String(value))
  const response = await fetch(SMM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!response.ok) throw new Error(`Social Boost provider failed with HTTP ${response.status}`)
  const data = await response.json()
  if (data?.error) throw new Error(`Social Boost provider error: ${data.error}`)
  return data
}

async function socialCatalogue(admin: SupabaseAdmin, partner: any) {
  if (!hasSection(partner, 'social_boost')) return []
  const { data, error } = await admin
    .from('smm_services')
    .select('id, external_id, name, category, platform, service_type, price_ngn, min_quantity, max_quantity, has_refill, has_cancel, is_active')
    .eq('is_active', true)
    .order('platform')
    .order('category')
  if (error) throw new Error(`Failed to load Social Boost services: ${error.message}`)
  return (data || []).map((service: any) => ({
    type: 'social_boost',
    section: 'social_boost',
    id: service.id,
    name: service.name,
    description: `${service.platform || 'Social'} ${service.service_type || 'service'}`,
    category: service.category,
    platform: service.platform,
    service_type: service.service_type,
    price_ngn: partnerMarkup(partner, Number(service.price_ngn || 0)),
    price_basis: service.service_type === 'Package' || !SMM_TYPES_WITH_QUANTITY.includes(service.service_type) ? 'fixed' : 'per_1000',
    currency: 'NGN',
    availability: 'available',
    stock: { status: 'available', available_quantity: null },
    min_quantity: Number(service.min_quantity || 1),
    max_quantity: Number(service.max_quantity || 1),
    has_refill: service.has_refill,
    has_cancel: service.has_cancel,
  }))
}

async function billsCatalogue(admin: SupabaseAdmin, partner: any) {
  if (!hasSection(partner, 'bills_airtime')) return []
  const items: any[] = NIGERIAN_NETWORKS.map((network) => ({
    type: 'bills_airtime',
    section: 'bills_airtime',
    id: `airtime:${network}`,
    name: `${network} Airtime`,
    description: `${network} VTU airtime`,
    category: 'Airtime',
    provider: network,
    transaction_type: 'airtime',
    price_ngn: null,
    price_basis: 'variable',
    currency: 'NGN',
    availability: 'available',
    stock: { status: 'provider_checked', available_quantity: null },
    min_amount_ngn: 50,
    max_amount_ngn: 50000,
  }))
  const client = sageCloudClient()
  const planResults = await Promise.allSettled(NIGERIAN_NETWORKS.map((network) => client.getDataPlans(`${network}DATA`)))
  planResults.forEach((result, index) => {
    const network = NIGERIAN_NETWORKS[index]
    if (result.status !== 'fulfilled' || !Array.isArray(result.value?.data)) {
      items.push({
        type: 'bills_airtime',
        section: 'bills_airtime',
        id: `data:${network}:unavailable`,
        name: `${network} Data`,
        description: 'Data plans are temporarily unavailable from provider',
        category: 'Data',
        provider: network,
        transaction_type: 'data',
        price_ngn: null,
        price_basis: 'plan_price',
        currency: 'NGN',
        availability: 'out_of_stock',
        stock: { status: 'provider_unavailable', available_quantity: 0 },
      })
      return
    }
    for (const plan of result.value.data as DataPlan[]) {
      const price = Number(plan.price)
      const code = String(plan.code || '').trim()
      if (!code || !Number.isFinite(price) || price <= 0) continue
      items.push({
        type: 'bills_airtime',
        section: 'bills_airtime',
        id: `data:${network}:${code}`,
        name: `${network} ${plan.description || plan.value || 'Data'}`,
        description: [plan.value, plan.duration].filter(Boolean).join(' • '),
        category: 'Data',
        provider: network,
        transaction_type: 'data',
        data_plan_code: code,
        price_ngn: partnerMarkup(partner, price),
        provider_price_ngn: price,
        price_basis: 'fixed',
        currency: 'NGN',
        availability: 'available',
        stock: { status: 'provider_checked', available_quantity: null },
        min_quantity: 1,
        max_quantity: 1,
      })
    }
  })
  return items
}

function describeBitrefillPrice(product: BitrefillProduct, adminMarkupPct: number, partner: any, rate: number) {
  const currency = String(product.currency || 'USD').toUpperCase()
  const toNgn = (value: number) => {
    if (currency === 'NGN') return value
    if (currency === 'USD' && rate > 0) return value * rate
    return 0
  }
  const applyMarkups = (value: number) => partnerMarkup(partner, Math.ceil(value * (1 + Math.max(0, adminMarkupPct) / 100)))
  if (Array.isArray(product.packages) && product.packages.length) {
    const prices = product.packages.map((pkg) => applyMarkups(toNgn(Number(pkg.value || 0)))).filter((value) => value > 0)
    return {
      price_ngn: prices.length ? Math.min(...prices) : null,
      price_min_ngn: prices.length ? Math.min(...prices) : null,
      price_max_ngn: prices.length ? Math.max(...prices) : null,
      price_basis: 'package',
      packages: product.packages.map((pkg) => ({
        package_id: pkg.package_id,
        value: pkg.value,
        currency,
        price_ngn: applyMarkups(toNgn(Number(pkg.value || 0))),
      })),
    }
  }
  if (product.range) {
    return {
      price_ngn: null,
      price_min_ngn: applyMarkups(toNgn(Number(product.range.min || 0))),
      price_max_ngn: applyMarkups(toNgn(Number(product.range.max || 0))),
      price_basis: 'range',
      range: { ...product.range, currency },
    }
  }
  return { price_ngn: null, price_basis: 'provider_denominated' }
}

async function giftcardCatalogue(admin: SupabaseAdmin, partner: any, body: Record<string, unknown>) {
  if (!hasSection(partner, 'giftcards')) return []
  const [blockedIds, rate, markupPct] = await Promise.all([getBlockedBitrefillIds(admin), getRequiredNgnUsdRate(admin), getBitrefillMarkupPct(admin)])
  const query = cleanText(body.query || body.search, 80)
  const limit = Math.min(100, Math.max(1, Math.round(Number(body.limit || 80))))
  const bitrefill = getBitrefillClient()
  const result = query ? await bitrefill.searchProducts(query, limit) : await bitrefill.listProducts(limit, cleanText(body.cursor, 200) || undefined)
  return ((result?.data || []) as BitrefillProduct[])
    .filter((product) => !blockedIds.has(product.product_id))
    .map((product) => ({
      type: 'giftcards',
      section: 'giftcards',
      id: product.product_id,
      name: product.name,
      description: [product.recipient_type, product.countries?.join(', ')].filter(Boolean).join(' • '),
      category: 'Gift Cards & eSIMs',
      currency: 'NGN',
      availability: 'available',
      stock: { status: 'provider_checked', available_quantity: null },
      provider_currency: String(product.currency || 'USD').toUpperCase(),
      ...describeBitrefillPrice(product, markupPct, partner, rate),
    }))
}

async function telegramCatalogue(admin: SupabaseAdmin, partner: any) {
  if (!hasSection(partner, 'telegram_stars')) return []
  const [starCfg, premiumCfg, premiumRows] = await Promise.all([
    getTelegramStarPricing(admin),
    getTelegramPremiumPricing(admin),
    admin.from('telegram_products').select('*').eq('product_type', 'premium').eq('is_active', true).order('sort_order'),
  ])
  const starSamples = [50, 100, 250, 500, 1000, 5000]
  return [
    ...starSamples.map((quantity) => ({
      type: 'telegram_stars',
      section: 'telegram_stars',
      id: `stars:${quantity}`,
      name: `${quantity.toLocaleString()} Telegram Stars`,
      description: 'Telegram Stars delivered through iStar',
      category: 'Telegram Stars',
      quantity,
      price_ngn: partnerMarkup(partner, calculateTelegramStarsPrice(quantity, starCfg)),
      currency: 'NGN',
      availability: 'available',
      stock: { status: 'provider_checked', available_quantity: null },
      min_quantity: 50,
      max_quantity: 1000000,
    })),
    ...((premiumRows.data || []) as any[]).map((product) => ({
      type: 'telegram_stars',
      section: 'telegram_stars',
      id: `premium:${product.id}`,
      name: product.label || `${product.months}-Month Telegram Premium`,
      description: 'Telegram Premium subscription delivered through iStar',
      category: 'Telegram Premium',
      product_id: product.id,
      months: product.months,
      price_ngn: partnerMarkup(partner, calculateTelegramPremiumPrice(product.months, premiumCfg) || Number(product.price_ngn || 0)),
      currency: 'NGN',
      availability: 'available',
      stock: { status: 'provider_checked', available_quantity: null },
      min_quantity: 1,
      max_quantity: 1,
    })),
  ]
}

async function cryptoCatalogue(partner: any) {
  if (!hasSection(partner, 'crypto')) return []
  const client = nowPaymentsClient()
  const currencies = await client.getCurrencies().catch(() => ({ currencies: [] }))
  const allowed = Array.isArray(currencies.currencies) ? currencies.currencies.slice(0, 120) : []
  return allowed.length ? allowed.map((currency: string) => ({
    type: 'crypto',
    section: 'crypto',
    id: `crypto:${String(currency).toUpperCase()}`,
    name: `Sell ${String(currency).toUpperCase()}`,
    description: 'Create a crypto sell payment address and payout quote',
    category: 'Crypto',
    crypto_type: String(currency).toUpperCase(),
    price_ngn: null,
    price_basis: 'live_quote',
    currency: 'NGN',
    availability: 'available',
    stock: { status: 'provider_checked', available_quantity: null },
    min_usd: 20,
  })) : [{
    type: 'crypto',
    section: 'crypto',
    id: 'crypto:quote',
    name: 'Crypto sell order',
    description: 'Live quote required',
    category: 'Crypto',
    price_ngn: null,
    price_basis: 'live_quote',
    currency: 'NGN',
    availability: 'out_of_stock',
    stock: { status: 'provider_unavailable', available_quantity: 0 },
  }]
}

async function handleCatalogue(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>): Promise<ApiResult> {
  if (!hasScope(auth, 'catalogue:read')) throw new Error('Missing catalogue:read scope')
  const requestedSection = cleanText(body.section, 40)
  if (requestedSection && !ALL_SECTIONS.includes(requestedSection)) {
    throw new Error(`Unsupported catalogue section. Use one of: ${ALL_SECTIONS.join(', ')}`)
  }
  if (requestedSection && !hasSection(auth.partner, requestedSection)) {
    throw new Error(`${requestedSection} is not enabled for this API key`)
  }
  const include = (section: string) => !requestedSection || requestedSection === section
  const fallbackItem = (section: string, name: string, error: unknown) => [{
    type: section,
    section,
    id: `${section}-unavailable`,
    name,
    price_ngn: null,
    currency: 'NGN',
    availability: 'out_of_stock',
    stock: { status: 'provider_unavailable', available_quantity: 0 },
    error: error instanceof Error ? error.message : `${name} catalogue unavailable`,
  }]
  const loadSection = async <T extends any[]>(section: string, name: string, loader: () => Promise<T>) => {
    if (!include(section) || !hasSection(auth.partner, section)) return []
    try {
      return await withTimeout(loader(), 12_000, `${name} catalogue`)
    } catch (error) {
      return fallbackItem(section, name, error)
    }
  }
  const [products, sms, social, bills, giftcards, telegram, crypto] = await Promise.all([
    loadSection('products', 'Products', () => productCatalogue(admin, auth.partner)),
    loadSection('sms', 'SMS', () => smsCatalogue(admin, auth.partner)),
    loadSection('social_boost', 'Social Boost', () => socialCatalogue(admin, auth.partner)),
    loadSection('bills_airtime', 'Bills & Airtime', () => billsCatalogue(admin, auth.partner)),
    loadSection('giftcards', 'Gift cards', () => giftcardCatalogue(admin, auth.partner, body)),
    loadSection('telegram_stars', 'Telegram', () => telegramCatalogue(admin, auth.partner)),
    loadSection('crypto', 'Crypto', () => cryptoCatalogue(auth.partner)),
  ])
  const items = [...(include('products') ? products : []), ...(include('sms') ? sms : []), ...(include('social_boost') ? social : []), ...bills, ...giftcards, ...telegram, ...crypto]
  const allowed = ALL_SECTIONS.filter((section) => hasSection(auth.partner, section))
  const sections = ALL_SECTIONS.map((section) => ({
    key: section,
    items: items.filter((item: any) => item.section === section),
  })).filter((section) => hasSection(auth.partner, section.key) && include(section.key))
  const sectionCounts = Object.fromEntries(sections.map((section) => [section.key, section.items.length]))
  const availableCounts = Object.fromEntries(sections.map((section) => [
    section.key,
    section.items.filter((item: any) => item.availability === 'available').length,
  ]))
  const sectionErrors = items
    .filter((item: any) => item.error)
    .map((item: any) => ({
      section: item.section,
      item_id: item.id,
      message: item.error,
    }))
  const data = {
    store: 'TallyStore',
    currency: 'NGN',
    generated_at: new Date().toISOString(),
    requested_section: requestedSection || null,
    allowed_sections: allowed,
    items,
    sections,
    summary: {
      item_count: items.length,
      available_item_count: items.filter((item: any) => item.availability === 'available').length,
      section_count: sections.length,
      section_counts: sectionCounts,
      available_counts: availableCounts,
      section_errors: sectionErrors,
    },
  }
  return {
    body: {
      success: true,
      data,
      items: data.items,
      sections: data.sections,
      summary: data.summary,
    },
  }
}

async function handleBalance(auth: PartnerAuth): Promise<ApiResult> {
  if (!hasScope(auth, 'wallet:read')) throw new Error('Missing wallet:read scope')
  return { body: { success: true, data: { balance_ngn: Number(auth.partner.balance_ngn || 0), currency: 'NGN' } } }
}

async function createPartnerOrder(admin: SupabaseAdmin, partnerId: string, body: Record<string, unknown>, seed: Record<string, unknown>) {
  const idempotencyKey = cleanText(body.idempotency_key, 160)
  if (!idempotencyKey || idempotencyKey.length < 10) throw new Error('Valid idempotency_key is required')
  const { data: existing } = await admin
    .from('api_partner_orders')
    .select('*')
    .eq('partner_id', partnerId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existing) return { order: existing, idempotencyHit: true }

  const { data: order, error } = await admin.from('api_partner_orders').insert({
    partner_id: partnerId,
    partner_reference: cleanText(body.partner_reference || body.reference, 180),
    idempotency_key: idempotencyKey,
    customer_email: cleanEmail(body.customer_email),
    customer_phone: cleanText(body.customer_phone, 80),
    request_payload: body,
    ...seed,
  }).select().single()
  if (error || !order) throw new Error(`Failed to create partner order: ${error?.message}`)
  return { order, idempotencyHit: false }
}

async function updatePartnerOrder(admin: SupabaseAdmin, id: string, updates: Record<string, unknown>) {
  const { data, error } = await admin.from('api_partner_orders').update({
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()
  if (error) throw new Error(`Failed to update partner order: ${error.message}`)
  return data
}

function publicPartnerOrder(order: any) {
  return {
    id: order.id,
    partner_reference: order.partner_reference,
    item_type: order.item_type,
    item_id: order.item_id,
    item_name: order.item_name,
    quantity: order.quantity,
    amount_ngn: Number(order.amount_ngn || 0),
    currency: order.currency || 'NGN',
    status: order.status,
    customer_email: order.customer_email,
    customer_phone: order.customer_phone,
    payment_provider: order.payment_provider,
    payment_reference: order.payment_reference,
    payment_transaction_reference: order.payment_transaction_reference,
    payment_account_number: order.payment_account_number,
    payment_amount_ngn: order.payment_amount_ngn,
    paid_at: order.paid_at,
    fulfillment_source: order.fulfillment_source,
    fulfillment_id: order.fulfillment_id,
    response_payload: order.response_payload,
    error_message: order.error_message,
    refunded_at: order.refunded_at,
    refund_amount_ngn: order.refund_amount_ngn,
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

async function deliverPartnerWebhook(admin: SupabaseAdmin, partner: any, order: any, eventType: string) {
  const targetUrl = cleanUrl(partner.webhook_url)
  if (!targetUrl) return
  const payload = {
    event: eventType,
    created_at: new Date().toISOString(),
    partner_id: partner.id,
    data: { order: publicPartnerOrder(order) },
  }
  const payloadBody = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const webhookSecret = cleanText(partner.webhook_secret, 240)
  const signature = webhookSecret
    ? `sha256=${await hmacSha256Hex(webhookSecret, `${timestamp}.${payloadBody}`)}`
    : null

  let deliveryId: string | null = null
  const inserted = await admin.from('api_partner_webhook_deliveries').insert({
    partner_id: partner.id,
    order_id: order.id,
    event_type: eventType,
    target_url: targetUrl,
    payload,
    attempts: 1,
  }).select('id').maybeSingle()
  deliveryId = inserted.data?.id || null

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TallyStore-Partner-API/1.0',
        'X-Tally-Event': eventType,
        'X-Tally-Partner-Id': String(partner.id),
        'X-Tally-Timestamp': timestamp,
        ...(signature ? { 'X-Tally-Signature': signature } : {}),
      },
      body: payloadBody,
    })
    const responseBody = (await response.text()).slice(0, 4000)
    const updates = {
      status: response.ok ? 'delivered' : 'failed',
      status_code: response.status,
      response_body: responseBody,
      delivered_at: response.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    if (deliveryId) await admin.from('api_partner_webhook_deliveries').update(updates).eq('id', deliveryId)
    await admin.from('api_partner_logs').insert({
      partner_id: partner.id,
      action: `webhook:${eventType}`,
      method: 'POST',
      status_code: response.status,
      success: response.ok,
      error_message: response.ok ? null : responseBody.slice(0, 500),
      metadata: { order_id: order.id, target_url: targetUrl },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook delivery failed'
    if (deliveryId) {
      await admin.from('api_partner_webhook_deliveries').update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      }).eq('id', deliveryId)
    }
    await admin.from('api_partner_logs').insert({
      partner_id: partner.id,
      action: `webhook:${eventType}`,
      method: 'POST',
      status_code: 0,
      success: false,
      error_message: message,
      metadata: { order_id: order.id, target_url: targetUrl },
    })
  }
}

async function updatePartnerOrderAndNotify(admin: SupabaseAdmin, partner: any, id: string, updates: Record<string, unknown>, eventType: string) {
  const updated = await updatePartnerOrder(admin, id, updates)
  await deliverPartnerWebhook(admin, partner, updated, eventType).catch(() => undefined)
  return updated
}

function getExistingCheckoutOrder(body: Record<string, unknown>) {
  return body.__existing_order && typeof body.__existing_order === 'object' ? body.__existing_order as any : null
}

function isGatewayMode(body: Record<string, unknown>) {
  return body.payment_mode === 'gateway' || Boolean(getExistingCheckoutOrder(body))
}

async function getOrCreatePartnerOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>, seed: Record<string, unknown>) {
  const existing = getExistingCheckoutOrder(body)
  if (existing) return { order: existing, idempotencyHit: false }
  return createPartnerOrder(admin, auth.partner.id, body, seed)
}

async function getOrCreatePartnerPocketFiCustomer(admin: SupabaseAdmin, partner: any, body: Record<string, unknown>) {
  const customerEmail = cleanEmail(body.customer_email)
  const customerReference = cleanText(body.customer_reference || body.external_customer_id || customerEmail, 180)
  if (!customerReference) throw new Error('customer_reference or customer_email is required')

  const { data: existing, error: existingError } = await admin
    .from('api_partner_customers')
    .select('*')
    .eq('partner_id', partner.id)
    .eq('customer_reference', customerReference)
    .maybeSingle()
  if (existingError) throw new Error(`Failed to load partner customer: ${existingError.message}`)
  if (existing?.pocketfi_account_number) return existing

  const { token, businessId, baseUrl } = getPocketFiConfig()
  const { first, last } = splitName(body.customer_name || customerEmail || customerReference)
  const banks = await getPocketFiBankOrder(admin)
  let response: Response | null = null
  let result: Record<string, any> | null = null
  let lastMessage = 'Unable to create PocketFi account for partner customer'

  for (const bank of banks) {
    const createBody = {
      first_name: first,
      last_name: last,
      phone: String(body.customer_phone || '08000000000').replace(/[^\d+]/g, '') || '08000000000',
      email: customerEmail || `${customerReference.replace(/[^a-z0-9]/gi, '').slice(0, 40) || 'customer'}@partner.tallystore.org`,
      businessId,
      bank,
    }
    response = await fetch(`${baseUrl}/virtual-accounts/create`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(createBody),
    })
    result = await response.json().catch(() => null) as Record<string, any> | null
    if (response.ok && result?.status !== false) break
    lastMessage = result?.message || result?.error || lastMessage
  }

  if (!response || !response.ok || result?.status === false) throw new Error(lastMessage)
  const bankEntry = result?.banks?.[0]
  if (!bankEntry?.accountNumber) throw new Error('PocketFi did not return an account number')

  const row = {
    partner_id: partner.id,
    customer_reference: customerReference,
    customer_email: customerEmail,
    customer_phone: cleanText(body.customer_phone, 80),
    customer_name: cleanCustomerName(body.customer_name || customerEmail || customerReference),
    pocketfi_account_number: String(bankEntry.accountNumber),
    pocketfi_account_name: String(bankEntry.accountName || `${first} ${last}`),
    pocketfi_bank: String(bankEntry.bankName || ''),
    raw_provider_response: result || {},
    updated_at: new Date().toISOString(),
  }

  const { data: inserted, error } = await admin
    .from('api_partner_customers')
    .upsert(row, { onConflict: 'partner_id,customer_reference' })
    .select()
    .single()
  if (error || !inserted) throw new Error(`Failed to save partner customer account: ${error?.message}`)
  return inserted
}

async function handleProductOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'products')) throw new Error('Products are not enabled for this API key')
  const productGroupId = cleanText(body.item_id || body.product_group_id, 80)
  const quantity = Math.max(1, Math.round(Number(body.quantity || 1)))
  if (!productGroupId) throw new Error('item_id is required')

  const { data: product, error: productError } = await admin
    .from('product_groups')
    .select('*, categories(name)')
    .eq('id', productGroupId)
    .eq('is_active', true)
    .single()
  if (productError || !product) throw new Error('Product not found')

  const availability = String(product.availability_status || '').toUpperCase()
  if (product.is_sellable === false || ['UNAVAILABLE', 'PAUSED'].includes(availability)) throw new Error('Product is out of stock')
  const stock = Number(product.stock_count || 0)
  if (stock < quantity) throw new Error(`Only ${stock} unit(s) available`)

  const price = partnerMarkup(auth.partner, Number(product.price || 0) * quantity)
  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'product',
    item_id: productGroupId,
    item_name: product.name,
    quantity,
    amount_ngn: price,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  const accountIds = await admin
    .from('individual_accounts')
    .select('*')
    .eq('product_group_id', productGroupId)
    .eq('status', 'available')
    .limit(quantity)
  if (accountIds.error || !accountIds.data || accountIds.data.length < quantity) {
    await updatePartnerOrderAndNotify(admin, auth.partner, order.id, { status: 'failed', error_message: 'Not enough stock available' }, 'partner.order.failed')
    throw new Error('Not enough stock available')
  }

  const ids = accountIds.data.map((account: any) => account.id)
  const { data: reserved } = await admin.from('individual_accounts').update({ status: 'reserved' }).in('id', ids).eq('status', 'available').select('*')
  if (!reserved || reserved.length < quantity) {
    await updatePartnerOrderAndNotify(admin, auth.partner, order.id, { status: 'failed', error_message: 'Stock was taken before reservation' }, 'partner.order.failed')
    throw new Error('Stock was taken before reservation')
  }

  try {
    const debit = gatewayMode ? null : await debitPartner(admin, auth.partner.id, price)
    await admin.from('individual_accounts').update({ status: 'sold', sold_at: new Date().toISOString() }).in('id', ids)
    const { count } = await admin.from('individual_accounts').select('*', { count: 'exact', head: true }).eq('product_group_id', productGroupId).eq('status', 'available')
    await admin.from('product_groups').update({
      stock_count: count || 0,
      availability_status: (count || 0) > 0 ? (count || 0) <= 3 ? 'LOW_STOCK' : 'AVAILABLE' : 'UNAVAILABLE',
      is_sellable: (count || 0) > 0,
    }).eq('id', productGroupId)
    const completed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      response_payload: {
        product_name: product.name,
        category: product.categories?.name || null,
        accounts: reserved.map((account: any) => ({
          username: account.username,
          password: account.password,
          email: account.email,
          email_password: account.email_password,
          two_fa_code: account.two_fa_code,
          recovery_email: account.recovery_email,
          recovery_email_password: account.recovery_email_password,
          additional_info: account.additional_info,
        })),
        partner_balance_after: debit?.next ?? null,
      },
    }, 'partner.order.completed')
    return { success: true, data: completed }
  } catch (error) {
    await admin.from('individual_accounts').update({ status: 'available' }).in('id', ids)
    await updatePartnerOrderAndNotify(admin, auth.partner, order.id, { status: 'failed', error_message: error instanceof Error ? error.message : 'Product order failed' }, 'partner.order.failed')
    throw error
  }
}

async function handleSmsOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'sms')) throw new Error('SMS is not enabled for this API key')
  const serviceCode = cleanText(body.item_id || body.service_id, 40)
  if (!serviceCode) throw new Error('item_id is required')
  const catalogue = await smsCatalogue(admin, auth.partner)
  const item = catalogue.find((entry: any) => entry.id === serviceCode)
  if (!item || item.availability !== 'available' || !item.price_ngn) throw new Error('SMS product is out of stock')

  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'sms',
    item_id: serviceCode,
    item_name: item.name,
    quantity: 1,
    amount_ngn: item.price_ngn,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  let activationId: string | null = null
  let debited = false
  try {
    if (!gatewayMode) {
      await debitPartner(admin, auth.partner.id, Number(item.price_ngn))
      debited = true
    }
    const maxProviderPrice = Number(item.price_ngn) / Math.max(await getNgnUsdRate(admin), 1)
    const text = await daisyGet(Deno.env.get('DAISYSMS_API_KEY') || '', {
      action: 'getNumber',
      service: serviceCode,
      max_price: Math.max(maxProviderPrice, 0.01).toFixed(4),
    })
    if (text === 'NO_NUMBERS') throw new Error('No numbers available for this SMS product right now')
    if (text === 'MAX_PRICE_EXCEEDED') throw new Error('SMS price changed before purchase')
    if (text === 'NO_MONEY') throw new Error('SMS provider balance is unavailable')
    if (text === 'BAD_KEY') throw new Error('SMS provider is not configured correctly')
    const match = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/)
    if (!match) throw new Error(`Unexpected SMS provider response: ${text}`)
    activationId = match[1]
    const completed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'active',
      fulfillment_source: 'sms',
      fulfillment_id: activationId,
      response_payload: {
        service_name: item.name,
        phone_number: `+${match[2]}`,
        raw_phone_number: match[2],
        expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      },
    }, 'partner.order.active')
    return { success: true, data: completed }
  } catch (error) {
    if (activationId) {
      await daisyGet(Deno.env.get('DAISYSMS_API_KEY') || '', { action: 'setStatus', id: activationId, status: '8' }).catch(() => '')
    }
    if (debited) await creditPartner(admin, auth.partner.id, Number(item.price_ngn))
    await updatePartnerOrderAndNotify(admin, auth.partner, order.id, { status: 'failed', error_message: error instanceof Error ? error.message : 'SMS order failed', refunded_at: debited ? new Date().toISOString() : null, refund_amount_ngn: debited ? item.price_ngn : null }, debited ? 'partner.order.refunded' : 'partner.order.failed')
    throw error
  }
}

async function handleSocialOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'social_boost')) throw new Error('Social Boost is not enabled for this API key')
  const serviceId = cleanText(body.item_id || body.service_id, 80)
  if (!serviceId) throw new Error('item_id is required')
  const { data: service, error } = await admin.from('smm_services').select('*').eq('id', serviceId).eq('is_active', true).single()
  if (error || !service) throw new Error('Social Boost service not found')
  const actualQuantity = String(service.service_type) === 'Package' ? 1 : Math.round(Number(body.quantity || service.min_quantity || 1))
  if (String(service.service_type) !== 'Package') {
    if (actualQuantity < Number(service.min_quantity || 1)) throw new Error(`Minimum quantity is ${service.min_quantity}`)
    if (actualQuantity > Number(service.max_quantity || actualQuantity)) throw new Error(`Maximum quantity is ${service.max_quantity}`)
  }
  const baseAmount = String(service.service_type) === 'Package' || !SMM_TYPES_WITH_QUANTITY.includes(service.service_type)
    ? Math.ceil(Number(service.price_ngn || 0))
    : Math.ceil((Number(service.price_ngn || 0) / 1000) * actualQuantity)
  const amount = partnerMarkup(auth.partner, baseAmount)
  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'social_boost',
    item_id: serviceId,
    item_name: service.name,
    quantity: actualQuantity,
    amount_ngn: amount,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  let debited = false
  try {
    const debit = gatewayMode ? null : await debitPartner(admin, auth.partner.id, amount)
    debited = !gatewayMode
    const providerResponse = await smmRequest(smmOrderParams(service, body, actualQuantity))
    const providerOrderId = providerResponse.order ? String(providerResponse.order) : null
    if (!providerOrderId) throw new Error('Social Boost provider did not return an order id')
    const completed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'processing',
      fulfillment_source: 'social_boost',
      fulfillment_id: providerOrderId,
      response_payload: {
        provider_order_id: providerOrderId,
        partner_balance_after: debit?.next ?? null,
      },
    }, 'partner.order.processing')
    return { success: true, data: completed }
  } catch (error) {
    if (debited) await creditPartner(admin, auth.partner.id, amount)
    await updatePartnerOrderAndNotify(admin, auth.partner, order.id, { status: 'failed', error_message: error instanceof Error ? error.message : 'Social Boost order failed', refunded_at: debited ? new Date().toISOString() : null, refund_amount_ngn: debited ? amount : null }, debited ? 'partner.order.refunded' : 'partner.order.failed')
    throw error
  }
}

async function handleBillsOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'bills_airtime')) throw new Error('Bills & Airtime is not enabled for this API key')
  const transactionType = cleanText(body.transaction_type || body.service || body.item_id, 40)
  const normalizedType = String(transactionType || '').toLowerCase().includes('data') ? 'data' : 'airtime'
  if (!['airtime', 'data'].includes(normalizedType)) throw new Error('transaction_type must be airtime or data')
  const provider = normalizeNetwork(body.service_provider || body.provider || String(body.item_id || '').split(':')[1])
  const phone = normalizeNigerianPhone(body.phone || body.customer_phone)
  const client = sageCloudClient()

  let providerAmount = Math.round(Number(body.amount_ngn || body.amount || 0))
  let dataPlanCode = cleanText(body.data_plan_code || String(body.item_id || '').split(':')[2], 80)
  let itemName = `${provider} Airtime`

  if (normalizedType === 'airtime') {
    if (!Number.isFinite(providerAmount) || providerAmount < 50 || providerAmount > 50000) throw new Error('Airtime amount must be between NGN 50 and NGN 50,000')
  } else {
    if (!dataPlanCode) throw new Error('data_plan_code is required for data purchases')
    const plansResponse = await client.getDataPlans(`${provider}DATA`)
    if (!plansResponse?.success || !Array.isArray(plansResponse.data)) throw new Error('Could not verify live data plan price')
    const livePlan = (plansResponse.data as DataPlan[]).find((plan) => String(plan.code) === String(dataPlanCode))
    const livePrice = Number(livePlan?.price)
    if (!livePlan || !Number.isFinite(livePrice) || livePrice <= 0) throw new Error('Selected data plan is no longer available')
    providerAmount = Math.round(livePrice)
    itemName = `${provider} ${livePlan.description || livePlan.value || 'Data'}`
  }

  const amount = partnerMarkup(auth.partner, providerAmount)
  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'bills_airtime',
    item_id: normalizedType === 'data' ? `data:${provider}:${dataPlanCode}` : `airtime:${provider}`,
    item_name: itemName,
    quantity: 1,
    amount_ngn: amount,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  let debited = false
  try {
    const providerBalance = await client.getBalanceAmount()
    if (providerBalance < providerAmount) throw new Error('Bills provider balance is temporarily unavailable')
    const debit = gatewayMode ? null : await debitPartner(admin, auth.partner.id, amount)
    debited = !gatewayMode
    const reference = `PARTNER-BILLS-${order.id}`
    const response = normalizedType === 'airtime'
      ? await client.purchaseAirtime({
        reference,
        network: provider,
        service: `${provider}VTU`,
        phone,
        amount: String(providerAmount),
      })
      : await client.purchaseData({
        reference,
        type: `${provider}DATA`,
        code: dataPlanCode,
        network: provider,
        phone,
        provider,
      })
    const success = Boolean(response?.success) && String(response?.status || '').toLowerCase() === 'success'
    const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: success ? 'completed' : 'failed',
      fulfillment_source: 'sagecloud',
      fulfillment_id: response?.reference || reference,
      error_message: success ? null : response?.message || 'Provider returned failed status',
      response_payload: {
        transaction_type: normalizedType,
        provider,
        phone,
        provider_amount_ngn: providerAmount,
        partner_balance_after: debit?.next ?? null,
        provider_reference: response?.reference || reference,
        provider_status: response?.status,
        provider_message: response?.message,
      },
      completed_at: success ? new Date().toISOString() : null,
    }, success ? 'partner.order.completed' : 'partner.order.failed')
    if (!success) {
      if (debited) await creditPartner(admin, auth.partner.id, amount)
      const refunded = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: debited ? 'failed' : 'refund_required',
        refunded_at: debited ? new Date().toISOString() : null,
        refund_amount_ngn: debited ? amount : null,
        error_message: debited ? response?.message || 'Provider returned failed status' : response?.message || 'Fulfillment failed after customer payment',
      }, debited ? 'partner.order.refunded' : 'partner.checkout.refund_required')
      return { success: false, data: refunded, error: debited ? 'Bills purchase failed. Partner balance was refunded.' : 'Bills purchase failed after customer payment. Refund required.' }
    }
    return { success: true, data: updated }
  } catch (error) {
    if (debited) await creditPartner(admin, auth.partner.id, amount)
    const failed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Bills order failed',
      refunded_at: debited ? new Date().toISOString() : null,
      refund_amount_ngn: debited ? amount : null,
    }, debited ? 'partner.order.refunded' : 'partner.order.failed')
    return { success: false, data: failed, error: error instanceof Error ? error.message : 'Bills order failed' }
  }
}

async function handleGiftcardOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'giftcards')) throw new Error('Gift Cards are not enabled for this API key')
  const productId = cleanText(body.item_id || body.product_id, 180)
  const packageId = cleanText(body.package_id, 180)
  const quantity = Math.min(20, Math.max(1, Math.round(Number(body.quantity || 1))))
  const recipientPhone = cleanText(body.recipient_phone || body.phone, 80)
  if (!productId) throw new Error('item_id is required')
  if (!packageId && body.value === undefined) throw new Error('package_id or value is required')

  const bitrefill = getBitrefillClient()
  const [blockedIds, markupPct] = await Promise.all([getBlockedBitrefillIds(admin), getBitrefillMarkupPct(admin)])
  if (blockedIds.has(productId)) throw new Error('This gift card product is no longer available')
  const product = await bitrefill.getProductDetails(productId) as BitrefillProduct
  const currency = String(product.currency || 'USD').toUpperCase()
  let unitValue = 0
  if (packageId) {
    const pkg = product.packages?.find((entry) => entry.package_id === packageId)
    if (!pkg) throw new Error('Selected denomination is no longer available')
    unitValue = Number(pkg.value)
  } else {
    const requestedValue = Number(body.value)
    if (!product.range || requestedValue < Number(product.range.min) || requestedValue > Number(product.range.max)) throw new Error('Selected amount is outside the allowed range for this product')
    unitValue = requestedValue
  }
  const providerTotal = unitValue * quantity
  const adminMarkedNgn = Math.ceil(await convertToNgn(admin, providerTotal, currency) * (1 + Math.max(0, markupPct) / 100))
  const amount = partnerMarkup(auth.partner, adminMarkedNgn)
  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'giftcards',
    item_id: productId,
    item_name: product.name,
    quantity,
    amount_ngn: amount,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  let debited = false
  try {
    const balance = await bitrefill.getBalance()
    if (Number(balance?.balance || 0) < providerTotal) throw new Error('Gift card provider balance is temporarily unavailable')
    const debit = gatewayMode ? null : await debitPartner(admin, auth.partner.id, amount)
    debited = !gatewayMode
    const invoice = await bitrefill.createInvoice({
      products: [{
        product_id: productId,
        package_id: packageId || undefined,
        value: packageId ? undefined : unitValue,
        quantity,
        phone_number: recipientPhone || undefined,
      }],
      payment_method: 'balance',
      auto_pay: true,
      email: cleanEmail(body.customer_email) || undefined,
    })
    const providerOrderId = invoice?.orders?.[0]?.id ? String(invoice.orders[0].id) : null
    let redemption = null
    if (invoice.status === 'complete' && providerOrderId) {
      const orderDetail = await bitrefill.getOrder(providerOrderId)
      redemption = orderDetail?.redemption_info || null
    }
    const failed = ['blocked', 'denied', 'payment_error'].includes(String(invoice.status))
    const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: failed ? 'failed' : invoice.status === 'complete' ? 'completed' : 'processing',
      fulfillment_source: 'bitrefill',
      fulfillment_id: providerOrderId || invoice.id,
      error_message: failed ? `Bitrefill returned ${invoice.status}` : null,
      response_payload: {
        invoice_id: invoice.id,
        bitrefill_order_id: providerOrderId,
        provider_status: invoice.status,
        provider_currency: currency,
        provider_amount: providerTotal,
        partner_balance_after: debit?.next ?? null,
        redemption,
      },
      completed_at: invoice.status === 'complete' ? new Date().toISOString() : null,
    }, failed ? 'partner.order.failed' : invoice.status === 'complete' ? 'partner.order.completed' : 'partner.order.processing')
    if (failed) {
      if (debited) await creditPartner(admin, auth.partner.id, amount)
      const refunded = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: debited ? 'failed' : 'refund_required',
        refunded_at: debited ? new Date().toISOString() : null,
        refund_amount_ngn: debited ? amount : null,
        error_message: debited ? `Bitrefill returned ${invoice.status}` : `Bitrefill returned ${invoice.status}; refund required`,
      }, debited ? 'partner.order.refunded' : 'partner.checkout.refund_required')
      return { success: false, data: refunded, error: debited ? 'Gift card purchase was declined. Partner balance was refunded.' : 'Gift card purchase was declined after customer payment. Refund required.' }
    }
    return { success: true, data: updated }
  } catch (error) {
    if (debited) await creditPartner(admin, auth.partner.id, amount)
    const failed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Gift card order failed',
      refunded_at: debited ? new Date().toISOString() : null,
      refund_amount_ngn: debited ? amount : null,
    }, debited ? 'partner.order.refunded' : 'partner.order.failed')
    return { success: false, data: failed, error: error instanceof Error ? error.message : 'Gift card order failed' }
  }
}

async function handleTelegramOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (!hasSection(auth.partner, 'telegram_stars')) throw new Error('Telegram is not enabled for this API key')
  const subtype = String(body.telegram_type || body.subtype || body.item_id || '').toLowerCase().includes('premium') ? 'premium' : 'stars'
  const username = String(body.username || '').replace(/^@/, '').trim()
  const recipientHash = cleanText(body.recipient_hash, 500)
  const recipientName = cleanText(body.recipient_name, 200)
  if (!username || !recipientHash) throw new Error('username and recipient_hash are required')

  let amount = 0
  let quantity = 1
  let itemId = ''
  let itemName = ''
  let providerBody: Record<string, unknown>
  let providerPath = ''
  if (subtype === 'stars') {
    quantity = Math.round(Number(body.quantity || String(body.item_id || '').split(':')[1] || 0))
    if (quantity < 50 || quantity > 1000000) throw new Error('Telegram Stars quantity must be between 50 and 1,000,000')
    const cfg = await getTelegramStarPricing(admin)
    amount = partnerMarkup(auth.partner, calculateTelegramStarsPrice(quantity, cfg))
    itemId = `stars:${quantity}`
    itemName = `${quantity.toLocaleString()} Telegram Stars`
    providerPath = '/orders/star'
    providerBody = { username, recipient_hash: recipientHash, quantity, wallet_type: cfg.wallet_type }
  } else {
    const rawProductId = String(body.product_id || body.item_id || '').replace(/^premium:/, '')
    if (!rawProductId) throw new Error('product_id is required for Telegram Premium')
    const [{ data: product, error }, premiumCfg, walletRow] = await Promise.all([
      admin.from('telegram_products').select('*').eq('id', rawProductId).eq('product_type', 'premium').eq('is_active', true).single(),
      getTelegramPremiumPricing(admin),
      admin.from('app_settings').select('value').eq('key', 'telegram_wallet_type').maybeSingle(),
    ])
    if (error || !product) throw new Error('Telegram Premium product not found')
    amount = partnerMarkup(auth.partner, calculateTelegramPremiumPrice(product.months, premiumCfg) || Number(product.price_ngn || 0))
    quantity = 1
    itemId = `premium:${product.id}`
    itemName = product.label || `${product.months}-Month Telegram Premium`
    providerPath = '/orders/premium'
    providerBody = { username, recipient_hash: recipientHash, months: product.months, wallet_type: String(walletRow.data?.value || 'USDT').toUpperCase() }
  }

  if (!amount || amount <= 0) throw new Error('Telegram pricing is not configured')
  const gatewayMode = isGatewayMode(body)
  const { order, idempotencyHit } = await getOrCreatePartnerOrder(admin, auth, body, {
    item_type: 'telegram_stars',
    item_id: itemId,
    item_name: itemName,
    quantity,
    amount_ngn: amount,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  let debited = false
  try {
    const debit = gatewayMode ? null : await debitPartner(admin, auth.partner.id, amount)
    debited = !gatewayMode
    const providerOrder = await istarPost(providerPath, providerBody, `PARTNER-TG-${order.id}`)
    const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'processing',
      fulfillment_source: 'istar',
      fulfillment_id: providerOrder?.order_id ? String(providerOrder.order_id) : null,
      response_payload: {
        telegram_type: subtype,
        username,
        recipient_name: recipientName,
        provider_order_id: providerOrder?.order_id || null,
        provider_amount: providerOrder?.amount || null,
        partner_balance_after: debit?.next ?? null,
      },
    }, 'partner.order.processing')
    return { success: true, data: updated }
  } catch (error) {
    if (debited) await creditPartner(admin, auth.partner.id, amount)
    const failed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Telegram order failed',
      refunded_at: debited ? new Date().toISOString() : null,
      refund_amount_ngn: debited ? amount : null,
    }, debited ? 'partner.order.refunded' : 'partner.order.failed')
    return { success: false, data: failed, error: error instanceof Error ? error.message : 'Telegram order failed' }
  }
}

async function handleCryptoOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  if (String(Deno.env.get('CRYPTO_TOPUP_ENABLED') || '').trim().toLowerCase() !== 'true') {
    throw new Error('Crypto payments are temporarily disabled.')
  }
  if (!hasSection(auth.partner, 'crypto')) throw new Error('Crypto is not enabled for this API key')
  const cryptoType = String(body.crypto_type || String(body.item_id || '').replace(/^crypto:/, '')).toLowerCase()
  const cryptoAmount = Number(body.crypto_amount)
  if (!cryptoType || !Number.isFinite(cryptoAmount) || cryptoAmount <= 0) throw new Error('crypto_type and crypto_amount are required')
  const client = nowPaymentsClient()
  const estimate = await client.getEstimate(cryptoAmount, cryptoType, 'usd')
  const usdAmount = Number(estimate?.estimated_amount)
  if (!Number.isFinite(usdAmount) || usdAmount < 20) throw new Error('Minimum crypto sell order is $20 USD')
  const rate = await getRequiredNgnUsdRate(admin)
  const amountNgn = Math.round(usdAmount * rate * 1.05 * 100) / 100
  const { order, idempotencyHit } = await createPartnerOrder(admin, auth.partner.id, body, {
    item_type: 'crypto',
    item_id: `crypto:${cryptoType.toUpperCase()}`,
    item_name: `Sell ${cryptoType.toUpperCase()}`,
    quantity: 1,
    amount_ngn: amountNgn,
    status: 'pending',
  })
  if (idempotencyHit) return { success: true, data: order, idempotency_hit: true }

  const payment = await client.createPayment({
    price_amount: Number(usdAmount.toFixed(2)),
    price_currency: 'usd',
    pay_currency: cryptoType,
    order_id: `PARTNER-CRYPTO-${order.id}`,
    order_description: `Partner crypto sell order - ${cryptoAmount} ${cryptoType.toUpperCase()}`,
    ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/nowpayments-webhook`,
    is_fixed_rate: true,
    is_fee_paid_by_user: true,
  })
  const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
    status: 'waiting_payment',
    fulfillment_source: 'nowpayments',
    fulfillment_id: String(payment.payment_id),
    response_payload: {
      crypto_type: cryptoType.toUpperCase(),
      crypto_amount: cryptoAmount,
      naira_amount: amountNgn,
      usd_amount: Number(usdAmount.toFixed(2)),
      pay_address: payment.pay_address,
      pay_amount: payment.pay_amount,
      pay_currency: payment.pay_currency,
      payin_extra_id: payment.payin_extra_id || null,
      network: payment.network || body.network || null,
      smart_contract: payment.smart_contract || null,
      expiration_date: payment.expiration_estimate_date || null,
      payment_status: payment.payment_status,
    },
  }, 'partner.order.waiting_payment')
  return { success: true, data: updated }
}

async function resolveCheckoutSeed(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>) {
  const itemType = cleanText(body.item_type || body.type, 40)
  if (!itemType) throw new Error('item_type is required')
  if (itemType === 'crypto') throw new Error('Crypto uses crypto payment addresses through create_order, not PocketFi bank transfer checkout')

  if (itemType === 'product') {
    if (!hasSection(auth.partner, 'products')) throw new Error('Products are not enabled for this API key')
    const productGroupId = cleanText(body.item_id || body.product_group_id, 80)
    const quantity = Math.max(1, Math.round(Number(body.quantity || 1)))
    if (!productGroupId) throw new Error('item_id is required')
    const { data: product, error } = await admin.from('product_groups').select('id, name, price, stock_count, availability_status, is_sellable, is_active').eq('id', productGroupId).eq('is_active', true).single()
    if (error || !product) throw new Error('Product not found')
    const availability = String(product.availability_status || '').toUpperCase()
    if (product.is_sellable === false || ['UNAVAILABLE', 'PAUSED'].includes(availability) || Number(product.stock_count || 0) < quantity) throw new Error('Product is out of stock')
    return {
      item_type: 'product',
      item_id: productGroupId,
      item_name: product.name,
      quantity,
      amount_ngn: partnerMarkup(auth.partner, Number(product.price || 0) * quantity),
    }
  }

  if (itemType === 'sms') {
    if (!hasSection(auth.partner, 'sms')) throw new Error('SMS is not enabled for this API key')
    const serviceCode = cleanText(body.item_id || body.service_id, 40)
    if (!serviceCode) throw new Error('item_id is required')
    const item = (await smsCatalogue(admin, auth.partner)).find((entry: any) => entry.id === serviceCode)
    if (!item || item.availability !== 'available' || !item.price_ngn) throw new Error('SMS product is out of stock')
    return { item_type: 'sms', item_id: serviceCode, item_name: item.name, quantity: 1, amount_ngn: Number(item.price_ngn) }
  }

  if (itemType === 'social_boost') {
    if (!hasSection(auth.partner, 'social_boost')) throw new Error('Social Boost is not enabled for this API key')
    const serviceId = cleanText(body.item_id || body.service_id, 80)
    if (!serviceId) throw new Error('item_id is required')
    const { data: service, error } = await admin.from('smm_services').select('*').eq('id', serviceId).eq('is_active', true).single()
    if (error || !service) throw new Error('Social Boost service not found')
    const actualQuantity = String(service.service_type) === 'Package' ? 1 : Math.round(Number(body.quantity || service.min_quantity || 1))
    if (String(service.service_type) !== 'Package') {
      if (actualQuantity < Number(service.min_quantity || 1)) throw new Error(`Minimum quantity is ${service.min_quantity}`)
      if (actualQuantity > Number(service.max_quantity || actualQuantity)) throw new Error(`Maximum quantity is ${service.max_quantity}`)
    }
    const baseAmount = String(service.service_type) === 'Package' || !SMM_TYPES_WITH_QUANTITY.includes(service.service_type)
      ? Math.ceil(Number(service.price_ngn || 0))
      : Math.ceil((Number(service.price_ngn || 0) / 1000) * actualQuantity)
    return { item_type: 'social_boost', item_id: serviceId, item_name: service.name, quantity: actualQuantity, amount_ngn: partnerMarkup(auth.partner, baseAmount) }
  }

  if (itemType === 'bills_airtime') {
    if (!hasSection(auth.partner, 'bills_airtime')) throw new Error('Bills & Airtime is not enabled for this API key')
    const transactionType = cleanText(body.transaction_type || body.service || body.item_id, 40)
    const normalizedType = String(transactionType || '').toLowerCase().includes('data') ? 'data' : 'airtime'
    const provider = normalizeNetwork(body.service_provider || body.provider || String(body.item_id || '').split(':')[1])
    normalizeNigerianPhone(body.phone || body.customer_phone)
    if (normalizedType === 'airtime') {
      const amount = Math.round(Number(body.amount_ngn || body.amount || 0))
      if (!Number.isFinite(amount) || amount < 50 || amount > 50000) throw new Error('Airtime amount must be between NGN 50 and NGN 50,000')
      return { item_type: 'bills_airtime', item_id: `airtime:${provider}`, item_name: `${provider} Airtime`, quantity: 1, amount_ngn: partnerMarkup(auth.partner, amount) }
    }
    const dataPlanCode = cleanText(body.data_plan_code || String(body.item_id || '').split(':')[2], 80)
    if (!dataPlanCode) throw new Error('data_plan_code is required for data purchases')
    const plans = await sageCloudClient().getDataPlans(`${provider}DATA`)
    const livePlan = Array.isArray(plans?.data) ? (plans.data as DataPlan[]).find((plan) => String(plan.code) === String(dataPlanCode)) : null
    const livePrice = Number(livePlan?.price)
    if (!livePlan || !Number.isFinite(livePrice) || livePrice <= 0) throw new Error('Selected data plan is no longer available')
    return { item_type: 'bills_airtime', item_id: `data:${provider}:${dataPlanCode}`, item_name: `${provider} ${livePlan.description || livePlan.value || 'Data'}`, quantity: 1, amount_ngn: partnerMarkup(auth.partner, Math.round(livePrice)) }
  }

  if (itemType === 'giftcards') {
    if (!hasSection(auth.partner, 'giftcards')) throw new Error('Gift Cards are not enabled for this API key')
    const productId = cleanText(body.item_id || body.product_id, 180)
    const packageId = cleanText(body.package_id, 180)
    const quantity = Math.min(20, Math.max(1, Math.round(Number(body.quantity || 1))))
    if (!productId) throw new Error('item_id is required')
    if (!packageId && body.value === undefined) throw new Error('package_id or value is required')
    if ((await getBlockedBitrefillIds(admin)).has(productId)) throw new Error('This gift card product is no longer available')
    const product = await getBitrefillClient().getProductDetails(productId) as BitrefillProduct
    const currency = String(product.currency || 'USD').toUpperCase()
    const unitValue = packageId
      ? Number(product.packages?.find((entry) => entry.package_id === packageId)?.value || 0)
      : Number(body.value)
    if (!Number.isFinite(unitValue) || unitValue <= 0) throw new Error('Selected denomination is no longer available')
    if (!packageId && (!product.range || unitValue < Number(product.range.min) || unitValue > Number(product.range.max))) throw new Error('Selected amount is outside the allowed range for this product')
    const markupPct = await getBitrefillMarkupPct(admin)
    const adminMarkedNgn = Math.ceil(await convertToNgn(admin, unitValue * quantity, currency) * (1 + Math.max(0, markupPct) / 100))
    return { item_type: 'giftcards', item_id: productId, item_name: product.name, quantity, amount_ngn: partnerMarkup(auth.partner, adminMarkedNgn) }
  }

  if (itemType === 'telegram_stars') {
    if (!hasSection(auth.partner, 'telegram_stars')) throw new Error('Telegram is not enabled for this API key')
    const subtype = String(body.telegram_type || body.subtype || body.item_id || '').toLowerCase().includes('premium') ? 'premium' : 'stars'
    const username = String(body.username || '').replace(/^@/, '').trim()
    const recipientHash = cleanText(body.recipient_hash, 500)
    if (!username || !recipientHash) throw new Error('username and recipient_hash are required')
    if (subtype === 'stars') {
      const quantity = Math.round(Number(body.quantity || String(body.item_id || '').split(':')[1] || 0))
      if (quantity < 50 || quantity > 1000000) throw new Error('Telegram Stars quantity must be between 50 and 1,000,000')
      return { item_type: 'telegram_stars', item_id: `stars:${quantity}`, item_name: `${quantity.toLocaleString()} Telegram Stars`, quantity, amount_ngn: partnerMarkup(auth.partner, calculateTelegramStarsPrice(quantity, await getTelegramStarPricing(admin))) }
    }
    const rawProductId = String(body.product_id || body.item_id || '').replace(/^premium:/, '')
    const [{ data: product, error }, premiumCfg] = await Promise.all([
      admin.from('telegram_products').select('*').eq('id', rawProductId).eq('product_type', 'premium').eq('is_active', true).single(),
      getTelegramPremiumPricing(admin),
    ])
    if (error || !product) throw new Error('Telegram Premium product not found')
    const amount = calculateTelegramPremiumPrice(product.months, premiumCfg) || Number(product.price_ngn || 0)
    return { item_type: 'telegram_stars', item_id: `premium:${product.id}`, item_name: product.label || `${product.months}-Month Telegram Premium`, quantity: 1, amount_ngn: partnerMarkup(auth.partner, amount) }
  }

  throw new Error('Unsupported item_type')
}

async function handleCreateCheckout(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>): Promise<ApiResult> {
  if (!hasScope(auth, 'orders:create')) throw new Error('Missing orders:create scope')
  const idempotencyKey = cleanText(body.idempotency_key, 160)
  if (!idempotencyKey || idempotencyKey.length < 10) throw new Error('Valid idempotency_key is required')

  const seed = await resolveCheckoutSeed(admin, auth, body)
  const amount = Math.round(Number(seed.amount_ngn || 0))
  if (!Number.isFinite(amount) || amount < 100) throw new Error('Checkout amount must be at least NGN 100')
  if (amount > 1000000) throw new Error('Maximum checkout amount is NGN 1,000,000')
  const customer = await getOrCreatePartnerPocketFiCustomer(admin, auth.partner, body)

  const { order, idempotencyHit } = await createPartnerOrder(admin, auth.partner.id, body, {
    ...seed,
    amount_ngn: amount,
    status: 'awaiting_bank_transfer',
    payment_provider: 'pocketfi',
    payment_reference: `POCKETFI-${customer.pocketfi_account_number}`,
    payment_account_number: customer.pocketfi_account_number,
    payment_amount_ngn: amount,
  })
  if (idempotencyHit) {
    const payment = order.response_payload?.payment || {
      provider: 'pocketfi',
      mode: 'permanent_virtual_account',
      account_number: order.payment_account_number,
      expected_amount_ngn: Number(order.payment_amount_ngn || order.amount_ngn || 0),
      permanent: true,
    }
    return {
      body: {
        success: true,
        idempotency_hit: true,
        data: publicPartnerOrder(order),
        payment,
      },
    }
  }

  try {
    const payment = {
      provider: 'pocketfi',
      mode: 'permanent_virtual_account',
      account_number: customer.pocketfi_account_number,
      account_name: customer.pocketfi_account_name,
      bank_name: customer.pocketfi_bank,
      expected_amount_ngn: amount,
      permanent: true,
      customer_reference: customer.customer_reference,
      instructions: 'Transfer the exact amount to this PocketFi account. TallyStore will fulfill the order after the webhook confirms payment.',
    }
    const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      response_payload: {
        ...(order.response_payload || {}),
        payment,
      },
    }, 'partner.checkout.created')
    return {
      body: {
        success: true,
        data: publicPartnerOrder(updated),
        order_id: order.id,
        payment,
        account_number: customer.pocketfi_account_number,
        account_name: customer.pocketfi_account_name,
        bank_name: customer.pocketfi_bank,
        amount_ngn: amount,
        status: 'awaiting_bank_transfer',
      },
    }
  } catch (error) {
    const failed = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Checkout creation failed',
    }, 'partner.checkout.failed')
    return { body: { success: false, data: publicPartnerOrder(failed), error: error instanceof Error ? error.message : 'Checkout creation failed' }, status: 400 }
  }
}

async function handleCreateOrder(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>): Promise<ApiResult> {
  if (!hasScope(auth, 'orders:create')) throw new Error('Missing orders:create scope')
  const itemType = cleanText(body.item_type || body.type, 40)
  if (!itemType) throw new Error('item_type is required')

  if (itemType === 'product') return { body: await handleProductOrder(admin, auth, body) }
  if (itemType === 'sms') return { body: await handleSmsOrder(admin, auth, body) }
  if (itemType === 'social_boost') return { body: await handleSocialOrder(admin, auth, body) }
  if (itemType === 'bills_airtime') return { body: await handleBillsOrder(admin, auth, body) }
  if (itemType === 'giftcards') return { body: await handleGiftcardOrder(admin, auth, body) }
  if (itemType === 'telegram_stars') return { body: await handleTelegramOrder(admin, auth, body) }
  if (itemType === 'crypto') return { body: await handleCryptoOrder(admin, auth, body) }
  throw new Error('Unsupported item_type')
}

async function handleInternalConfirmCheckout(admin: SupabaseAdmin, req: Request, body: Record<string, unknown>) {
  requireInternal(req)
  const accountNumber = cleanText(body.account_number || body.accountNumber, 80)
  const amount = Number(body.amount_ngn || body.amount || 0)
  const transactionReference = cleanText(body.transaction_reference || body.transactionReference || body.reference, 180)
  const orderId = cleanText(body.order_id || body.partner_order_id, 80)
  if ((!accountNumber || !Number.isFinite(amount) || amount <= 0) && !orderId) throw new Error('account_number and amount are required')
  if (!transactionReference) throw new Error('transaction_reference is required to confirm a partner checkout payment')

  const { data: existingPaid, error: existingPaidError } = await admin
    .from('api_partner_orders')
    .select('*')
    .eq('payment_transaction_reference', transactionReference)
    .maybeSingle()
  if (existingPaidError) throw new Error(`Failed to check payment reference: ${existingPaidError.message}`)
  if (existingPaid) {
    return { success: true, data: publicPartnerOrder(existingPaid), already_processed: true }
  }

  let query = admin.from('api_partner_orders').select('*')
  if (orderId) {
    query = query.eq('id', orderId)
  } else {
    query = query
      .eq('payment_provider', 'pocketfi')
      .eq('payment_account_number', accountNumber)
      .in('status', ['awaiting_bank_transfer', 'payment_pending', 'payment_partial', 'payment_confirmed'])
      .order('created_at', { ascending: true })
      .limit(20)
  }
  const { data: rows, error } = orderId ? await query.maybeSingle() : await query
  if (error) throw new Error(`Partner checkout order lookup failed: ${error.message}`)
  const order = orderId ? rows : (Array.isArray(rows) ? (rows.find((entry: any) => Number(entry.payment_amount_ngn || entry.amount_ngn || 0) === amount) || rows.find((entry: any) => Number(entry.payment_amount_ngn || entry.amount_ngn || 0) <= amount) || rows[0]) : null)
  if (!order) {
    const { data: customer } = accountNumber ? await admin
      .from('api_partner_customers')
      .select('partner_id, customer_reference')
      .eq('pocketfi_account_number', accountNumber)
      .maybeSingle() : { data: null }
    await admin.from('api_partner_logs').insert({
      partner_id: customer?.partner_id || null,
      action: 'internal_confirm_checkout:unmatched',
      method: 'POST',
      status_code: 200,
      success: false,
      error_message: 'No pending partner checkout order matched this PocketFi payment',
      metadata: { account_number: accountNumber || null, amount_ngn: amount || null, transaction_reference: transactionReference || null },
    })
    return { success: false, status: 'unmatched', message: 'No pending partner checkout order matched this PocketFi payment' }
  }
  if (!['awaiting_bank_transfer', 'payment_pending', 'payment_partial', 'payment_confirmed', 'refund_required'].includes(String(order.status)) && order.status !== 'completed') {
    return { success: true, data: publicPartnerOrder(order), already_processed: true }
  }
  if (order.status === 'completed' || order.status === 'processing' || order.status === 'active') {
    return { success: true, data: publicPartnerOrder(order), already_processed: true }
  }

  const priorPaymentReferences = Array.isArray(order.response_payload?.payment?.payment_references)
    ? order.response_payload.payment.payment_references.map((entry: unknown) => String(entry))
    : []
  if (transactionReference && priorPaymentReferences.includes(transactionReference)) {
    return { success: true, data: publicPartnerOrder(order), already_processed: true }
  }
  const paymentReferences = transactionReference
    ? [...new Set([...priorPaymentReferences, transactionReference])]
    : priorPaymentReferences

  const expectedAmount = Number(order.payment_amount_ngn || order.amount_ngn || 0)
  const previousReceived = order.status === 'payment_partial'
    ? Number(order.response_payload?.payment?.received_amount_ngn || order.response_payload?.payment?.paid_amount_ngn || 0)
    : 0
  const paidAmount = previousReceived + amount
  const { data: partner, error: partnerError } = await admin.from('api_partners').select('*').eq('id', order.partner_id).single()
  if (partnerError || !partner) throw new Error('Partner not found for checkout order')

  if (!Number.isFinite(expectedAmount) || !Number.isFinite(paidAmount) || paidAmount < expectedAmount) {
    const updated = await updatePartnerOrderAndNotify(admin, partner || { id: order.partner_id, webhook_url: null }, order.id, {
      status: 'payment_partial',
      error_message: `Payment is below expected amount. Expected NGN ${expectedAmount}, got NGN ${paidAmount}`,
      response_payload: {
        ...(order.response_payload || {}),
        payment: {
          ...(order.response_payload?.payment || {}),
          provider: 'pocketfi',
          received_amount_ngn: paidAmount,
          latest_amount_ngn: amount,
          transaction_reference: transactionReference || null,
          payment_references: paymentReferences,
          webhook_payload: body.webhook_payload || null,
        },
      },
    }, 'partner.checkout.payment_partial')
    return { success: false, status: 'payment_partial', data: publicPartnerOrder(updated) }
  }

  const paidOrder = await updatePartnerOrderAndNotify(admin, partner, order.id, {
    status: 'payment_confirmed',
    paid_at: new Date().toISOString(),
    payment_reference: order.payment_reference || `POCKETFI-${order.payment_account_number || accountNumber}`,
    payment_transaction_reference: transactionReference,
    payment_amount_ngn: paidAmount,
    response_payload: {
      ...(order.response_payload || {}),
      payment: {
        ...(order.response_payload?.payment || {}),
        provider: 'pocketfi',
        status: 'confirmed',
        paid_amount_ngn: paidAmount,
        latest_amount_ngn: amount,
        transaction_reference: transactionReference || null,
        payment_references: paymentReferences,
        webhook_payload: body.webhook_payload || null,
      },
    },
  }, 'partner.checkout.payment_confirmed')

  const auth: PartnerAuth = { partner, key: { scopes: DEFAULT_SCOPES } }
  try {
    const fulfillment = await handleCreateOrder(admin, auth, {
      ...(paidOrder.request_payload || {}),
      payment_mode: 'gateway',
      __existing_order: paidOrder,
    })
    const bodyResult = fulfillment.body as Record<string, any>
    if (bodyResult?.success === false) {
      const updated = await updatePartnerOrderAndNotify(admin, partner, paidOrder.id, {
        status: 'refund_required',
        error_message: bodyResult.error || 'Fulfillment failed after customer payment',
      }, 'partner.checkout.refund_required')
      return { success: false, status: 'refund_required', data: publicPartnerOrder(updated), fulfillment: bodyResult }
    }
    return { success: true, data: bodyResult?.data || publicPartnerOrder(paidOrder), fulfillment: bodyResult }
  } catch (fulfillmentError) {
    const updated = await updatePartnerOrderAndNotify(admin, partner, paidOrder.id, {
      status: 'refund_required',
      error_message: fulfillmentError instanceof Error ? fulfillmentError.message : 'Fulfillment failed after customer payment',
    }, 'partner.checkout.refund_required')
    return { success: false, status: 'refund_required', data: publicPartnerOrder(updated) }
  }
}

async function handleOrderStatus(admin: SupabaseAdmin, auth: PartnerAuth, body: Record<string, unknown>): Promise<ApiResult> {
  if (!hasScope(auth, 'orders:read')) throw new Error('Missing orders:read scope')
  const id = cleanText(body.order_id, 80)
  const partnerReference = cleanText(body.partner_reference || body.reference, 180)
  let query = admin.from('api_partner_orders').select('*').eq('partner_id', auth.partner.id)
  if (id) query = query.eq('id', id)
  else if (partnerReference) query = query.eq('partner_reference', partnerReference)
  else throw new Error('order_id or partner_reference is required')
  const { data: order, error } = await query.maybeSingle()
  if (error || !order) throw new Error('Partner order not found')

  if (order.item_type === 'sms' && order.fulfillment_id && !['completed', 'cancelled', 'failed', 'expired'].includes(order.status)) {
    const text = await daisyGet(Deno.env.get('DAISYSMS_API_KEY') || '', { action: 'getStatus', id: order.fulfillment_id }).catch(() => '')
    if (text.startsWith('STATUS_OK:')) {
      const code = text.replace(/^STATUS_OK:/, '')
      const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        response_payload: { ...(order.response_payload || {}), code, completed_at: new Date().toISOString() },
      }, 'partner.order.completed')
      return { body: { success: true, data: updated } }
    }
    if (text === 'STATUS_CANCEL' || text === 'NO_ACTIVATION') {
      const walletFunded = order.payment_provider !== 'pocketfi'
      if (walletFunded && !order.refunded_at) await creditPartner(admin, auth.partner.id, Number(order.amount_ngn || 0))
      const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: walletFunded ? 'cancelled' : 'refund_required',
        cancelled_at: new Date().toISOString(),
        refunded_at: walletFunded ? new Date().toISOString() : null,
        refund_amount_ngn: walletFunded ? Number(order.amount_ngn || 0) : null,
        error_message: walletFunded ? null : 'SMS provider cancelled after customer payment. Refund required.',
      }, walletFunded ? 'partner.order.refunded' : 'partner.checkout.refund_required')
      return { body: { success: true, data: updated } }
    }
  }

  if (order.item_type === 'telegram_stars' && order.fulfillment_source === 'istar' && order.fulfillment_id && order.status === 'processing') {
    const providerOrder = await istarGet(`/orders/${order.fulfillment_id}`).catch(() => null)
    if (providerOrder?.status === 'completed') {
      const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: 'completed',
        completed_at: providerOrder.updated_at || new Date().toISOString(),
        response_payload: { ...(order.response_payload || {}), provider_status: providerOrder.status },
      }, 'partner.order.completed')
      return { body: { success: true, data: updated } }
    }
    if (providerOrder?.status === 'failed') {
      const walletFunded = order.payment_provider !== 'pocketfi'
      if (walletFunded && !order.refunded_at) await creditPartner(admin, auth.partner.id, Number(order.amount_ngn || 0))
      const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
        status: walletFunded ? 'failed' : 'refund_required',
        error_message: walletFunded ? providerOrder?.payload?.reason || 'Telegram provider returned failed status' : providerOrder?.payload?.reason || 'Telegram provider failed after customer payment. Refund required.',
        refunded_at: walletFunded ? order.refunded_at || new Date().toISOString() : null,
        refund_amount_ngn: walletFunded ? Number(order.amount_ngn || 0) : null,
      }, walletFunded ? 'partner.order.refunded' : 'partner.checkout.refund_required')
      return { body: { success: true, data: updated } }
    }
  }

  if (order.item_type === 'giftcards' && order.fulfillment_source === 'bitrefill' && order.status === 'processing') {
    const invoiceId = order.response_payload?.invoice_id
    if (invoiceId) {
      const bitrefill = getBitrefillClient()
      const invoice = await bitrefill.getInvoice(String(invoiceId)).catch(() => null)
      const providerOrderId = invoice?.orders?.[0]?.id || order.response_payload?.bitrefill_order_id || order.fulfillment_id
      if (invoice?.status === 'complete') {
        const detail = providerOrderId ? await bitrefill.getOrder(String(providerOrderId)).catch(() => null) : null
        const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          response_payload: { ...(order.response_payload || {}), provider_status: invoice.status, redemption: detail?.redemption_info || order.response_payload?.redemption || null },
        }, 'partner.order.completed')
        return { body: { success: true, data: updated } }
      }
      if (['blocked', 'denied', 'payment_error'].includes(String(invoice?.status))) {
        const walletFunded = order.payment_provider !== 'pocketfi'
        if (walletFunded && !order.refunded_at) await creditPartner(admin, auth.partner.id, Number(order.amount_ngn || 0))
        const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
          status: walletFunded ? 'failed' : 'refund_required',
          error_message: walletFunded ? `Bitrefill returned ${invoice.status}` : `Bitrefill returned ${invoice.status}; refund required`,
          refunded_at: walletFunded ? order.refunded_at || new Date().toISOString() : null,
          refund_amount_ngn: walletFunded ? Number(order.amount_ngn || 0) : null,
        }, walletFunded ? 'partner.order.refunded' : 'partner.checkout.refund_required')
        return { body: { success: true, data: updated } }
      }
    }
  }

  if (order.item_type === 'crypto' && order.fulfillment_source === 'nowpayments' && order.fulfillment_id && order.status === 'waiting_payment') {
    const payment = await nowPaymentsClient().getPaymentStatus(String(order.fulfillment_id)).catch(() => null)
    if (payment?.payment_status) {
      const terminalSuccess = ['finished', 'confirmed', 'sending'].includes(String(payment.payment_status))
      const terminalFailure = ['failed', 'refunded', 'expired'].includes(String(payment.payment_status))
      if (terminalSuccess || terminalFailure) {
        const updated = await updatePartnerOrderAndNotify(admin, auth.partner, order.id, {
          status: terminalSuccess ? 'completed' : String(payment.payment_status),
          completed_at: terminalSuccess ? new Date().toISOString() : null,
          error_message: terminalFailure ? `NowPayments returned ${payment.payment_status}` : null,
          response_payload: {
            ...(order.response_payload || {}),
            payment_status: payment.payment_status,
            actually_paid: payment.actually_paid,
            payin_hash: payment.payin_hash,
            payout_hash: payment.payout_hash,
          },
        }, terminalSuccess ? 'partner.order.completed' : 'partner.order.failed')
        return { body: { success: true, data: updated } }
      }
    }
  }

  return { body: { success: true, data: order } }
}

async function handleAdminList(admin: SupabaseAdmin) {
  const { data: partners, error } = await admin
    .from('api_partners')
    .select(`${API_PARTNER_ADMIN_SELECT}, webhook_secret, api_partner_keys(id, key_name, key_prefix, scopes, revoked_at, last_used_at, created_at)`)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Failed to load API partners: ${error.message}`)
  const { data: orders } = await admin.from('api_partner_orders').select('*').order('created_at', { ascending: false }).limit(100)
  const { data: logs } = await admin.from('api_partner_logs').select('*').order('created_at', { ascending: false }).limit(100)
  const { data: webhooks } = await admin.from('api_partner_webhook_deliveries').select('*').order('created_at', { ascending: false }).limit(100)
  const safePartners = (partners || []).map((partner: any) => {
    const { webhook_secret: webhookSecret, ...safePartner } = partner
    return { ...safePartner, has_webhook_secret: Boolean(webhookSecret) }
  })
  return { success: true, data: { partners: safePartners, orders: orders || [], logs: logs || [], webhooks: webhooks || [] } }
}

async function handleAdminCreate(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const { data, error } = await admin.from('api_partners').insert({
    name: cleanText(body.name, 120) || 'API Partner',
    contact_email: cleanEmail(body.contact_email),
    is_active: body.is_active !== false,
    allowed_sections: allowedSections(body.allowed_sections),
    markup_percent: 0,
    balance_ngn: 0,
    webhook_url: cleanUrl(body.webhook_url),
    notes: null,
  }).select(API_PARTNER_ADMIN_SELECT).single()
  if (error || !data) throw new Error(`Failed to create partner: ${error?.message}`)
  return { success: true, data }
}

async function handleAdminUpdate(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const id = cleanText(body.partner_id, 80)
  if (!id) throw new Error('partner_id is required')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of ['name', 'contact_email', 'webhook_url', 'notes']) {
    if (key in body) updates[key] = key === 'contact_email' ? cleanEmail(body[key]) : key === 'webhook_url' ? cleanUrl(body[key]) : cleanText(body[key], key === 'notes' ? 1000 : 180)
  }
  if ('is_active' in body) updates.is_active = body.is_active === true
  if ('allowed_sections' in body) updates.allowed_sections = allowedSections(body.allowed_sections)
  const { data, error } = await admin.from('api_partners').update(updates).eq('id', id).select(API_PARTNER_ADMIN_SELECT).single()
  if (error || !data) throw new Error(`Failed to update partner: ${error?.message}`)
  return { success: true, data }
}

async function handleAdminGenerateKey(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const partnerId = cleanText(body.partner_id, 80)
  if (!partnerId) throw new Error('partner_id is required')
  const apiKey = `tly_live_${randomHex(32)}`
  const webhookSecret = `tly_whsec_${randomHex(32)}`
  const keyHash = await sha256Hex(apiKey)
  const { data, error } = await admin.from('api_partner_keys').insert({
    partner_id: partnerId,
    key_name: cleanText(body.key_name, 120) || 'Default key',
    key_prefix: apiKey.slice(0, 16),
    key_hash: keyHash,
    scopes: asStringArray(body.scopes, DEFAULT_SCOPES).filter((scope) => DEFAULT_SCOPES.includes(scope)),
  }).select('id, partner_id, key_name, key_prefix, scopes, created_at').single()
  if (error || !data) throw new Error(`Failed to create API key: ${error?.message}`)
  const { error: secretError } = await admin
    .from('api_partners')
    .update({ webhook_secret: webhookSecret, updated_at: new Date().toISOString() })
    .eq('id', partnerId)
  if (secretError) throw new Error(`Failed to save webhook secret: ${secretError.message}`)
  return { success: true, data: { ...data, api_key: apiKey, webhook_secret: webhookSecret } }
}

async function handleAdminRevokeKey(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const keyId = cleanText(body.key_id, 80)
  if (!keyId) throw new Error('key_id is required')
  const { error } = await admin.from('api_partner_keys').update({ revoked_at: new Date().toISOString() }).eq('id', keyId)
  if (error) throw new Error(`Failed to revoke key: ${error.message}`)
  return { success: true }
}

async function handleAdminAdjustBalance(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const partnerId = cleanText(body.partner_id, 80)
  const amount = Math.round(Number(body.amount_ngn || 0))
  if (!partnerId || !Number.isFinite(amount) || amount === 0) throw new Error('partner_id and non-zero amount_ngn are required')
  const { data: partner, error } = await admin.from('api_partners').select('balance_ngn').eq('id', partnerId).single()
  if (error || !partner) throw new Error('Partner not found')
  const next = Number(partner.balance_ngn || 0) + amount
  if (next < 0) throw new Error('Adjustment would make partner balance negative')
  const { data, error: updateError } = await admin.from('api_partners').update({ balance_ngn: next, updated_at: new Date().toISOString() }).eq('id', partnerId).select(API_PARTNER_ADMIN_SELECT).single()
  if (updateError || !data) throw new Error(`Failed to adjust partner balance: ${updateError?.message}`)
  await admin.from('api_partner_logs').insert({
    partner_id: partnerId,
    action: 'admin_adjust_balance',
    method: 'POST',
    status_code: 200,
    success: true,
    metadata: { amount_ngn: amount, reason: cleanText(body.reason, 500) },
  })
  return { success: true, data }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const url = new URL(req.url)
  const body = req.method === 'GET' ? Object.fromEntries(url.searchParams.entries()) : await req.json().catch(() => ({}))
  const action = cleanText((body as any).action || url.searchParams.get('action'), 80) || (req.method === 'GET' ? 'catalogue' : '')
  let auth: PartnerAuth | null = null

  try {
    if (action === 'internal_confirm_checkout') {
      return json(await handleInternalConfirmCheckout(admin, req, body))
    }

    if (action.startsWith('admin_')) {
      await requireAdmin(req, admin)
      if (action === 'admin_list_partners') return json(await handleAdminList(admin))
      if (action === 'admin_create_partner') return json(await handleAdminCreate(admin, body))
      if (action === 'admin_update_partner') return json(await handleAdminUpdate(admin, body))
      if (action === 'admin_generate_key') return json(await handleAdminGenerateKey(admin, body))
      if (action === 'admin_revoke_key') return json(await handleAdminRevokeKey(admin, body))
      if (action === 'admin_adjust_balance') return json(await handleAdminAdjustBalance(admin, body))
      throw new Error('Unknown admin action')
    }

    auth = await requirePartner(req, admin)

    let result: ApiResult
    if (action === 'catalogue' || action === 'products') result = await handleCatalogue(admin, auth, body)
    else if (action === 'balance') result = await handleBalance(auth)
    else if (action === 'create_order') result = await handleCreateOrder(admin, auth, body)
    else if (action === 'create_checkout') result = await handleCreateCheckout(admin, auth, body)
    else if (action === 'order_status') result = await handleOrderStatus(admin, auth, body)
    else throw new Error('Unknown partner API action')

    await writeLog(admin, req, auth, action, result.status || 200, true)
    return json(result.body, result.status || 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Partner API request failed'
    const status = /missing|invalid|unauthorized|access|required scope|admin/i.test(message) ? 401 : 400
    await writeLog(admin, req, auth, action, status, false, message).catch(() => undefined)
    return json({ success: false, error: message }, status)
  }
})
