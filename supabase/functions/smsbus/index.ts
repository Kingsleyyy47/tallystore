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

async function getSmsExchangeRate(admin: SupabaseAdmin): Promise<{ rate: number; source: 'override' | 'live' | 'fallback' }> {
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', 'ngn_usd_rate').maybeSingle()
    const rate = Number(data?.value)
    if (Number.isFinite(rate) && rate > 0) return { rate, source: 'override' }
  } catch {
    // Fall through to live rate.
  }

  const liveRate = await getUsdToNgnRate()
  if (liveRate > 0) return { rate: liveRate, source: 'live' }
  return { rate: 1600, source: 'fallback' }
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
  const { text } = await daisyRequest(apiKey, params)
  return text
}

async function daisyRequest(apiKey: string, params: Record<string, string>): Promise<{ text: string; headers: Headers }> {
  const url = new URL(Deno.env.get('DAISYSMS_BASE_URL') || DEFAULT_DAISY_BASE)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  const text = (await res.text()).trim()
  if (!res.ok) throw new DaisySmsError('HTTP_ERROR', `SMS service request failed with HTTP ${res.status}`)
  return { text, headers: res.headers }
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
  quantity?: number | string
  qty?: number | string
  available?: number | string
  total?: number | string
  stock?: number | string
  price?: number | string
  cost?: number | string
  rate?: number | string
  retail_price?: number | string
  multipleMessages?: number | string | boolean
  canGetAnotherSms?: number | string | boolean
}

type ParsedDaisyPrice = { count: number; priceUsd: number }

function numberFrom(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function parseDaisyPriceEntry(entry: unknown): ParsedDaisyPrice | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const directCount = numberFrom(record.count ?? record.quantity ?? record.qty ?? record.available ?? record.total ?? record.stock)
  const directPrice = numberFrom(record.price ?? record.cost ?? record.rate ?? record.retail_price)
  if (directCount !== null && directPrice !== null) return { count: directCount, priceUsd: directPrice }

  let totalCount = 0
  let lowestPrice: number | null = null
  for (const [key, value] of Object.entries(record)) {
    if (['multipleMessages', 'canGetAnotherSms'].includes(key)) continue

    const keyPrice = numberFrom(key)
    const valueCount = numberFrom(value)
    if (keyPrice !== null && valueCount !== null) {
      totalCount += valueCount
      lowestPrice = lowestPrice === null ? keyPrice : Math.min(lowestPrice, keyPrice)
      continue
    }

    const nested = parseDaisyPriceEntry(value)
    if (nested) {
      totalCount += nested.count
      lowestPrice = lowestPrice === null ? nested.priceUsd : Math.min(lowestPrice, nested.priceUsd)
    }
  }

  return totalCount > 0 && lowestPrice !== null ? { count: totalCount, priceUsd: lowestPrice } : null
}

function normalizeDaisyService(code: string, entry: unknown): DaisyService | null {
  const parsed = parseDaisyPriceEntry(entry)
  if (!parsed) return null
  const count = parsed.count
  const priceUsd = parsed.priceUsd
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
    const usa = (countries as Record<string, unknown>)[String(DAISY_COUNTRY)]
    collectDaisyService(services, normalizeDaisyService(code, usa))
  }

  return [...services.values()]
}

function parseCountryServicePrices(raw: unknown): DaisyService[] {
  const services = new Map<string, DaisyService>()
  if (!raw || typeof raw !== 'object') return []

  const usa = (raw as Record<string, unknown>)[String(DAISY_COUNTRY)]
  if (!usa || typeof usa !== 'object') return []

  for (const [code, entry] of Object.entries(usa as Record<string, unknown>)) {
    collectDaisyService(services, normalizeDaisyService(code, entry))
  }

  return [...services.values()]
}

function parseFlatServicePrices(raw: unknown): DaisyService[] {
  const services = new Map<string, DaisyService>()
  if (!raw || typeof raw !== 'object') return []

  for (const [code, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(code) || code === 'status' || code === 'services') continue
    collectDaisyService(services, normalizeDaisyService(code, entry))
  }

  return [...services.values()]
}

async function daisyGetPriceObject(apiKey: string, action: 'getPricesVerification' | 'getPrices', country?: number): Promise<unknown> {
  const text = await daisyGet(apiKey, country ? { action, country: String(country) } : { action })
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

type DaisyServiceDiagnostics = {
  provider_host: string
  provider_base_configured: boolean
  configured: boolean
  country_id: number
  verification_ok: boolean
  verification_services: number
  verification_country_services: number
  prices_ok: boolean
  prices_services: number
  prices_country_services: number
  selected_source: 'getPricesVerification' | 'getPrices' | 'none'
}

async function daisyGetServicesWithDiagnostics(apiKey: string): Promise<{ services: DaisyService[]; diagnostics: DaisyServiceDiagnostics }> {
  const baseUrl = Deno.env.get('DAISYSMS_BASE_URL') || DEFAULT_DAISY_BASE
  const diagnostics: DaisyServiceDiagnostics = {
    provider_host: new URL(baseUrl).host,
    provider_base_configured: !!Deno.env.get('DAISYSMS_BASE_URL'),
    configured: !!apiKey,
    country_id: DAISY_COUNTRY,
    verification_ok: false,
    verification_services: 0,
    verification_country_services: 0,
    prices_ok: false,
    prices_services: 0,
    prices_country_services: 0,
    selected_source: 'none',
  }

  try {
    const rawVerification = await daisyGetPriceObject(apiKey, 'getPricesVerification')
    const rawCountryVerification = await daisyGetPriceObject(apiKey, 'getPricesVerification', DAISY_COUNTRY).catch(() => null)
    const verificationServices = uniqueSortedServices([
      ...parseServiceCountryPrices(rawVerification),
      ...parseCountryServicePrices(rawVerification),
      ...parseServiceCountryPrices(rawCountryVerification),
      ...parseCountryServicePrices(rawCountryVerification),
      ...parseFlatServicePrices(rawCountryVerification),
    ])
    diagnostics.verification_ok = true
    diagnostics.verification_services = verificationServices.length
    diagnostics.verification_country_services = uniqueSortedServices([
      ...parseServiceCountryPrices(rawCountryVerification),
      ...parseCountryServicePrices(rawCountryVerification),
      ...parseFlatServicePrices(rawCountryVerification),
    ]).length

    if (verificationServices.length > 0) {
      diagnostics.selected_source = 'getPricesVerification'
      return { services: verificationServices, diagnostics }
    }
  } catch (error) {
    console.warn('Daisy getPricesVerification did not produce services:', error)
  }

  try {
    const rawPrices = await daisyGetPriceObject(apiKey, 'getPrices')
    const rawCountryPrices = await daisyGetPriceObject(apiKey, 'getPrices', DAISY_COUNTRY).catch(() => null)
    const priceServices = uniqueSortedServices([
      ...parseCountryServicePrices(rawPrices),
      ...parseServiceCountryPrices(rawPrices),
      ...parseCountryServicePrices(rawCountryPrices),
      ...parseServiceCountryPrices(rawCountryPrices),
      ...parseFlatServicePrices(rawCountryPrices),
    ])
    diagnostics.prices_ok = true
    diagnostics.prices_services = priceServices.length
    diagnostics.prices_country_services = uniqueSortedServices([
      ...parseCountryServicePrices(rawCountryPrices),
      ...parseServiceCountryPrices(rawCountryPrices),
      ...parseFlatServicePrices(rawCountryPrices),
    ]).length

    if (priceServices.length > 0) {
      diagnostics.selected_source = 'getPrices'
      return { services: priceServices, diagnostics }
    }
  } catch (error) {
    console.warn('Daisy getPrices did not produce services:', error)
  }

  return { services: [], diagnostics }
}

async function daisyGetNumber(apiKey: string, serviceCode: string, maxPriceUsd?: number): Promise<{ activationId: string; phoneNumber: string; priceUsd?: number }> {
  const params: Record<string, string> = { action: 'getNumber', service: serviceCode }
  if (maxPriceUsd !== undefined) params.max_price = maxPriceUsd.toFixed(4)
  const { text, headers } = await daisyRequest(apiKey, params)
  if (text === 'NO_NUMBERS') throw new DaisySmsError('NO_NUMBERS', 'No numbers available for this service right now.')
  if (text === 'MAX_PRICE_EXCEEDED') throw new DaisySmsError('MAX_PRICE_EXCEEDED', 'Service price has changed. Please try again.')
  if (text === 'NO_MONEY') throw new DaisySmsError('NO_MONEY', 'SMS purchases are temporarily unavailable.')
  if (text === 'TOO_MANY_ACTIVE_RENTALS') throw new DaisySmsError('TOO_MANY_ACTIVE_RENTALS', 'Too many active SMS orders. Cancel one first.')
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'SMS service is temporarily unavailable.')
  const match = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/)
  if (!match) throw new DaisySmsError('PARSE_ERROR', `Unexpected rent response: ${text}`)
  const headerPrice = Number(headers.get('x-price') || headers.get('X-Price') || '')
  return {
    activationId: match[1],
    phoneNumber: match[2],
    priceUsd: Number.isFinite(headerPrice) && headerPrice >= 0 ? headerPrice : undefined,
  }
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
  return { cancelled: text === 'ACCESS_CANCEL', response: text }
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

const DEFAULT_SMS_MARGIN_NGN = 700

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

type SmsProductSetting = {
  service_code: string
  service_name?: string | null
  is_enabled?: boolean | null
  is_favorite?: boolean | null
  price_override_ngn?: number | null
  auto_markup_enabled?: boolean | null
  margin_ngn?: number | null
}

type SmsCatalogItem = {
  service_id: string
  service_code: string
  service_name: string
  project_id: number
  country_id: number
  country_code: string
  provider_cost_usd: number
  provider_cost_ngn: number
  margin_usd: number
  margin_ngn: number
  total_cost_usd: number
  exchange_rate: number
  price_ngn: number
  available_count: number
  customer_buy_count: number
  recommended_score: number
  is_enabled: boolean
  is_favorite: boolean
  price_override_ngn: number | null
  auto_markup_enabled: boolean
  pricing_mode: 'auto_markup' | 'manual_margin' | 'override'
}

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

async function requireAdminUser(admin: SupabaseAdmin, userId: string) {
  const { data, error } = await admin.from('profiles').select('is_admin').eq('id', userId).single()
  if (error || !data?.is_admin) throw new Error('Admin access required')
}

async function getNumericAppSetting(admin: SupabaseAdmin, key: string, fallback: number) {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const value = Number(data?.value)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

async function getBooleanAppSetting(admin: SupabaseAdmin, key: string, fallback: boolean) {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (data?.value === 'true') return true
  if (data?.value === 'false') return false
  return fallback
}

function optionalNaira(value: unknown) {
  if (value === null || value === '') return null
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : null
}

function roundUpToNearestTen(value: number) {
  return Math.ceil(value / 10) * 10
}

function priceSmsService(
  providerCostUsd: number,
  exchangeRate: number,
  setting: Partial<SmsProductSetting>,
  globalMarginNgn: number,
  roundAutoPricesToNearestTen: boolean,
) {
  const providerCostNgn = Math.ceil(providerCostUsd * exchangeRate)
  const overrideNgn = optionalNaira(setting.price_override_ngn)
  const marginNgn = optionalNaira(setting.margin_ngn) ?? Math.round(globalMarginNgn)
  const autoPriceNgn = Math.max(0, providerCostNgn + marginNgn)
  const priceNgn = overrideNgn !== null
    ? overrideNgn
    : roundAutoPricesToNearestTen ? roundUpToNearestTen(autoPriceNgn) : autoPriceNgn
  const marginUsd = Math.max(0, (priceNgn - providerCostNgn) / exchangeRate)
  return {
    providerCostNgn,
    marginNgn,
    marginUsd,
    priceNgn,
    totalUsd: priceNgn / exchangeRate,
    pricingMode: overrideNgn !== null
      ? 'override'
      : setting.auto_markup_enabled === false ? 'manual_margin' : 'auto_markup',
  } as const
}

async function syncSmsProductSettings(admin: SupabaseAdmin, services: DaisyService[], exchangeRate: number) {
  if (services.length === 0) return
  const now = new Date().toISOString()
  const rows = services.map((svc) => ({
    service_code: svc.code,
    service_name: svc.name,
    provider_cost_usd: Number(svc.priceUsd.toFixed(4)),
    exchange_rate: Number(exchangeRate.toFixed(4)),
    available_count: svc.count,
    last_synced_at: now,
    updated_at: now,
  }))
  const { error } = await admin.from('sms_product_settings').upsert(rows, { onConflict: 'service_code' })
  if (error) throw new Error(`Failed to sync SMS products: ${error.message}`)
}

async function getSmsServiceBuyCounts(admin: SupabaseAdmin) {
  const counts = new Map<string, number>()
  const { data, error } = await admin
    .from('sms_orders')
    .select('service_id, status, refunded_at, order_type, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.warn('Failed to load SMS buy counts:', error.message)
    return counts
  }

  for (const row of data || []) {
    if (row.order_type && row.order_type !== 'otp') continue
    if (!row.service_id || row.refunded_at) continue
    if (['cancelled', 'expired', 'failed'].includes(String(row.status || '').toLowerCase())) continue
    counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1)
  }

  return counts
}

function getRecommendedScore(isFavorite: boolean, buyCount: number, availableCount: number, priceNgn: number) {
  const favoriteBoost = isFavorite ? 2500 : 0
  const buyBoost = buyCount * 100
  const stockBoost = Math.min(availableCount, 100)
  const pricePenalty = Math.min(Math.floor(priceNgn / 1000), 50)
  return favoriteBoost + buyBoost + stockBoost - pricePenalty
}

async function buildSmsCatalog(admin: SupabaseAdmin) {
  const key = getDaisyKey()
  if (!key) return { products: [] as SmsCatalogItem[], diagnostics: null, exchangeRate: 0, globalMarginNgn: DEFAULT_SMS_MARGIN_NGN }

  const { rate: exchangeRate, source: exchangeRateSource } = await getSmsExchangeRate(admin)
  const globalMarginNgn = await getNumericAppSetting(admin, 'sms_default_margin_ngn', DEFAULT_SMS_MARGIN_NGN)
  const roundAutoPricesToNearestTen = await getBooleanAppSetting(admin, 'sms_round_markup_to_nearest_10', false)
  const { services, diagnostics } = await daisyGetServicesWithDiagnostics(key)
  await syncSmsProductSettings(admin, services, exchangeRate)
  if (services.length === 0) {
    return { products: [] as SmsCatalogItem[], diagnostics, exchangeRate, exchangeRateSource, globalMarginNgn, roundAutoPricesToNearestTen }
  }

  const { data: settingsRows, error } = await admin
    .from('sms_product_settings')
    .select('service_code, service_name, is_enabled, is_favorite, price_override_ngn, auto_markup_enabled, margin_ngn')
    .in('service_code', services.map((svc) => svc.code))
  if (error) throw new Error(`Failed to load SMS product settings: ${error.message}`)

  const settings = new Map<string, SmsProductSetting>((settingsRows || []).map((row: SmsProductSetting) => [row.service_code, row]))
  const buyCounts = await getSmsServiceBuyCounts(admin)
  const products = services.map((svc, index) => {
    const setting = settings.get(svc.code) || { service_code: svc.code }
    const pricing = priceSmsService(svc.priceUsd, exchangeRate, setting, globalMarginNgn, roundAutoPricesToNearestTen)
    const isFavorite = setting.is_favorite === true
    const buyCount = buyCounts.get(svc.code) || 0
    return {
      service_id: svc.code,
      service_code: svc.code,
      service_name: setting.service_name || svc.name,
      project_id: index + 1,
      country_id: DAISY_COUNTRY,
      country_code: 'us',
      provider_cost_usd: Number(svc.priceUsd.toFixed(4)),
      provider_cost_ngn: pricing.providerCostNgn,
      margin_usd: Number(pricing.marginUsd.toFixed(4)),
      margin_ngn: pricing.marginNgn,
      total_cost_usd: Number(pricing.totalUsd.toFixed(4)),
      exchange_rate: Number(exchangeRate.toFixed(4)),
      price_ngn: pricing.priceNgn,
      available_count: svc.count,
      customer_buy_count: buyCount,
      recommended_score: getRecommendedScore(isFavorite, buyCount, svc.count, pricing.priceNgn),
      is_enabled: setting.is_enabled !== false,
      is_favorite: isFavorite,
      price_override_ngn: optionalNaira(setting.price_override_ngn),
      auto_markup_enabled: setting.auto_markup_enabled !== false,
      pricing_mode: pricing.pricingMode,
    }
  })

  products.sort((a, b) => b.recommended_score - a.recommended_score || b.customer_buy_count - a.customer_buy_count || b.available_count - a.available_count || a.price_ngn - b.price_ngn)
  return { products, diagnostics, exchangeRate, exchangeRateSource, globalMarginNgn, roundAutoPricesToNearestTen }
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
  if (amount <= 0) return { refunded: true, amount: 0 }
  const refundRef = `REFUND-${order.reference}`

  const { data: currentOrder } = await admin
    .from('sms_orders')
    .select('refunded_at, refund_reference')
    .eq('id', order.id)
    .maybeSingle()
  if (currentOrder?.refunded_at) return { refunded: true, amount, reference: currentOrder.refund_reference, alreadyRefunded: true }

  const { data: existing } = await admin.from('transactions').select('id, status').eq('reference', refundRef).maybeSingle()
  if (existing?.status === 'completed') {
    await admin.from('sms_orders')
      .update({ refunded_at: new Date().toISOString(), refund_amount_ngn: amount, refund_reference: refundRef })
      .eq('id', order.id)
      .is('refunded_at', null)
    return { refunded: true, amount, reference: refundRef, alreadyRefunded: true }
  }

  const tx = existing || (await admin.from('transactions').insert({
    user_id: order.user_id, type: 'refund', amount, balance_after: 0,
    description: reason, reference: refundRef, status: 'pending',
  }).select('id, status').single()).data
  if (!tx) throw new Error('Refund transaction could not be created. Please try again.')

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
      return { refunded: true, amount, reference: refundRef }
    }
  }

  throw new Error('Refund could not be credited. Please try again.')
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

async function handleServices(admin: SupabaseAdmin) {
  const { products, diagnostics } = await buildSmsCatalog(admin)
  const customerDiagnostics = diagnostics ? {
    configured: diagnostics.configured,
    country_id: diagnostics.country_id,
    verification_ok: diagnostics.verification_ok,
    verification_services: diagnostics.verification_services,
    prices_ok: diagnostics.prices_ok,
    prices_services: diagnostics.prices_services,
  } : null
  return json({
    success: true,
    data: products.filter((service) => service.is_enabled && service.available_count > 0 && service.price_ngn > 0),
    diagnostics: customerDiagnostics,
  })
}

async function handleAdminSmsProducts(admin: SupabaseAdmin, userId: string) {
  await requireAdminUser(admin, userId)
  const { products, diagnostics, exchangeRate, exchangeRateSource, globalMarginNgn, roundAutoPricesToNearestTen } = await buildSmsCatalog(admin)
  return json({
    success: true,
    configured: !!getDaisyKey(),
    data: products,
    diagnostics,
    exchange_rate: Number(exchangeRate.toFixed(4)),
    exchange_rate_source: exchangeRateSource || 'unknown',
    global_margin_ngn: Math.round(globalMarginNgn),
    round_to_nearest_10: roundAutoPricesToNearestTen === true,
  })
}

async function handleAdminUpdateSmsProduct(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdminUser(admin, userId)
  const serviceCode = String(body.service_code || body.service_id || '').trim()
  if (!serviceCode) throw new Error('service_code is required')

  const updates: Record<string, unknown> = {
    service_code: serviceCode,
    updated_at: new Date().toISOString(),
  }

  if (typeof body.service_name === 'string') updates.service_name = body.service_name.trim()
  if (typeof body.is_enabled === 'boolean') updates.is_enabled = body.is_enabled
  if (typeof body.is_favorite === 'boolean') updates.is_favorite = body.is_favorite
  if (typeof body.auto_markup_enabled === 'boolean') updates.auto_markup_enabled = body.auto_markup_enabled
  if (Object.prototype.hasOwnProperty.call(body, 'price_override_ngn')) updates.price_override_ngn = optionalNaira(body.price_override_ngn)
  if (Object.prototype.hasOwnProperty.call(body, 'margin_ngn')) updates.margin_ngn = optionalNaira(body.margin_ngn)

  const { error } = await admin.from('sms_product_settings').upsert(updates, { onConflict: 'service_code' })
  if (error) throw new Error(`Failed to update SMS product: ${error.message}`)
  return json({ success: true })
}

async function handleAdminBulkSmsProducts(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdminUser(admin, userId)
  if (typeof body.is_enabled !== 'boolean') throw new Error('is_enabled is required')
  const { products } = await buildSmsCatalog(admin)
  const now = new Date().toISOString()
  const rows = products.map((product) => ({
    service_code: product.service_code,
    service_name: product.service_name,
    is_enabled: body.is_enabled,
    updated_at: now,
  }))
  if (rows.length > 0) {
    const { error } = await admin.from('sms_product_settings').upsert(rows, { onConflict: 'service_code' })
    if (error) throw new Error(`Failed to update SMS products: ${error.message}`)
  }
  return json({ success: true, count: rows.length })
}

async function handleAdminApplySmsMarkup(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdminUser(admin, userId)
  const marginNgn = optionalNaira(body.margin_ngn)
  if (marginNgn === null) throw new Error('Enter a valid markup amount')
  const keepAutoApplying = body.keep_auto_applying !== false
  const now = new Date().toISOString()

  const { error: settingError } = await admin
    .from('app_settings')
    .upsert({ key: 'sms_default_margin_ngn', value: String(marginNgn), updated_at: now }, { onConflict: 'key' })
  if (settingError) throw new Error(`Failed to save SMS markup: ${settingError.message}`)

  const { products } = await buildSmsCatalog(admin)
  const rows = products.map((product) => ({
    service_code: product.service_code,
    service_name: product.service_name,
    margin_ngn: marginNgn,
    auto_markup_enabled: keepAutoApplying,
    updated_at: now,
  }))
  if (rows.length > 0) {
    const { error } = await admin.from('sms_product_settings').upsert(rows, { onConflict: 'service_code' })
    if (error) throw new Error(`Failed to apply SMS markup: ${error.message}`)
  }
  return json({ success: true, count: rows.length })
}

async function handleAdminSetSmsRounding(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdminUser(admin, userId)
  if (typeof body.round_to_nearest_10 !== 'boolean') throw new Error('round_to_nearest_10 is required')
  const { error } = await admin
    .from('app_settings')
    .upsert({
      key: 'sms_round_markup_to_nearest_10',
      value: body.round_to_nearest_10 ? 'true' : 'false',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  if (error) throw new Error(`Failed to save SMS rounding: ${error.message}`)
  return json({ success: true, round_to_nearest_10: body.round_to_nearest_10 })
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

  const { products, exchangeRate, globalMarginNgn, roundAutoPricesToNearestTen } = await buildSmsCatalog(admin)
  const svc = products.find(s => s.service_code === serviceCode)
  if (!svc || !svc.is_enabled || svc.available_count <= 0) throw new Error('Service not available')

  const estimatedPriceNgn = svc.price_ngn

  const { data: profile } = await admin.from('profiles').select('wallet_balance').eq('id', userId).single()
  if (!profile || Number(profile.wallet_balance || 0) < estimatedPriceNgn) {
    throw new Error(`Insufficient wallet balance. Required: ₦${estimatedPriceNgn.toLocaleString()}`)
  }

  const number = await daisyGetNumber(key, serviceCode, Math.max(svc.provider_cost_usd * 1.25, svc.provider_cost_usd + 0.05))
  const effectiveProviderUsd = number.priceUsd ?? svc.provider_cost_usd
  const effectivePricing = priceSmsService(effectiveProviderUsd, exchangeRate, svc, globalMarginNgn, roundAutoPricesToNearestTen === true)
  const totalUsd = effectivePricing.totalUsd
  const priceNgn = effectivePricing.priceNgn
  const reference = generateReference('SMS')
  let debit: { prev: number; next: number } | null = null

  try {
    debit = await debitWallet(admin, userId, priceNgn)
    const { data: order, error: orderErr } = await admin.from('sms_orders').insert({
      user_id: userId, reference, idempotency_key: idempotencyKey, order_type: 'otp',
      provider_request_id: number.activationId,
      service_id: serviceCode, service_name: svc.service_name,
      country_id: DAISY_COUNTRY, country_code: 'us',
      phone_number: `+${number.phoneNumber}`, raw_phone_number: number.phoneNumber,
      provider_cost_usd: effectiveProviderUsd, margin_usd: effectivePricing.marginUsd,
      total_cost_usd: totalUsd, exchange_rate: exchangeRate, price_ngn: priceNgn,
      status: 'active',
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      provider_payload: {
        activation_id: number.activationId,
        service: svc,
        effective_provider_price_usd: number.priceUsd ?? null,
        margin_ngn: effectivePricing.marginNgn,
        price_override_ngn: svc.price_override_ngn,
        pricing_mode: effectivePricing.pricingMode,
        round_to_nearest_10: roundAutoPricesToNearestTen === true,
      },
    }).select().single()
    if (orderErr || !order) throw new Error(`Failed to create order: ${orderErr?.message}`)
    await recordPurchase(admin, userId, reference, priceNgn, debit.next, `SMS OTP: ${svc.service_name}`)
    return json({ success: true, data: order, new_balance: debit.next })
  } catch (err) {
    try { await daisyCancelNumber(key, number.activationId) } catch { /* ignore */ }
    if (debit) await refundWallet(admin, { id: '00000000-0000-0000-0000-000000000000', user_id: userId, reference, price_ngn: priceNgn }, `Auto-refund for failed SMS order: ${svc.service_name}`)
    throw err
  }
}

async function handleCheckOtp(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const key = getDaisyKey()
  const { data: order, error } = await admin.from('sms_orders').select('*').eq('id', String(body.order_id || '')).eq('user_id', userId).single()
  if (error || !order) throw new Error('SMS order not found')
  if (TERMINAL_STATUSES.includes(order.status)) {
    if (order.status === 'cancelled' && !order.refunded_at) {
      await refundWallet(admin, order, `Refund for cancelled SMS order: ${order.reference}`)
      const { data: refreshed } = await admin.from('sms_orders').select('*').eq('id', order.id).single()
      return json({ success: true, data: refreshed || order })
    }
    return json({ success: true, data: order })
  }

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
  if (TERMINAL_STATUSES.includes(order.status)) {
    if (order.status === 'cancelled' && !order.refunded_at) {
      await refundWallet(admin, order, `Refund for cancelled SMS order: ${order.reference}`)
      const { data: refreshed } = await admin.from('sms_orders').select('*').eq('id', order.id).single()
      return json({ success: true, data: refreshed || order, already_final: true })
    }
    return json({ success: true, data: order, already_final: true })
  }
  if (!order.provider_request_id) throw new Error('Order is missing activation ID')

  const cancelResult = await daisyCancelNumber(key, order.provider_request_id)
  if (!cancelResult.cancelled) {
    const reason = cancelResult.response === 'ACCESS_READY'
      ? 'This number is already ready or has received a code, so it cannot be cancelled.'
      : cancelResult.response === 'EARLY_CANCEL_DENIED'
        ? 'This number cannot be cancelled yet. Please try again after 2 minutes.'
        : `The SMS service did not confirm cancellation (${cancelResult.response}).`
    throw new Error(reason)
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
      case 'services':     return await handleServices(admin)
      case 'admin_sms_products':
        return await handleAdminSmsProducts(admin, user.id)
      case 'admin_update_sms_product':
        return await handleAdminUpdateSmsProduct(admin, user.id, body)
      case 'admin_bulk_sms_products':
        return await handleAdminBulkSmsProducts(admin, user.id, body)
      case 'admin_apply_sms_markup':
        return await handleAdminApplySmsMarkup(admin, user.id, body)
      case 'admin_set_sms_rounding':
        return await handleAdminSetSmsRounding(admin, user.id, body)
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
