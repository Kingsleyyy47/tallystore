import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── revenue-events.ts ──
export const REVENUE_EVENT_TYPES = [
  'SESSION_STARTED',
  'PAGE_VIEWED',
  'PRODUCT_IMPRESSION',
  'PRODUCT_VIEWED',
  'SEARCHED',
  'FILTER_USED',
  'SORT_USED',
  'PRODUCT_CLICKED',
  'BUY_CLICKED',
  'PAYMENT_STARTED',
  'PAYMENT_PROVIDER_LOADED',
  'PAYMENT_ATTEMPTED',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'PRODUCT_PURCHASED',
  'PRODUCT_PURCHASE_REVERSED',
  'PRODUCT_REJECTED',
  'SMS_ORDER_CANCELLED',
  'SMS_ORDER_COMPLETED',
  'SMS_ORDER_REFUNDED',
  'RECOMMENDATION_SHOWN',
  'RECOMMENDATION_CLICKED',
  'RECOMMENDATION_DISMISSED',
  'PROMOTION_SHOWN',
  'PROMOTION_CLICKED',
  'OFFER_SHOWN',
  'OFFER_ACCEPTED',
  'OFFER_DISMISSED',
  'CHAT_OPENED',
  'CHAT_MESSAGE',
  'CHAT_INTENT',
  'CHAT_PRODUCT_SHOWN',
  'SUPPORT_HANDOFF',
  'CHECKOUT_ABANDONED',
  'RETURN_VISIT',
] as const

export type RevenueEventType = (typeof REVENUE_EVENT_TYPES)[number]

export type RevenueRequestContext = {
  visitor_id?: string | null
  session_id?: string | null
  path?: string | null
  referrer?: string | null
  device?: string | null
  display_currency?: string | null
  attribution?: Record<string, unknown> | null
  traffic_quality?: string | null
}

const knownRevenueEventTypes = new Set<string>(REVENUE_EVENT_TYPES as readonly string[])

export function isKnownRevenueEventType(eventType: string): eventType is RevenueEventType {
  return knownRevenueEventTypes.has(eventType)
}

export function sanitizeRevenueEventType(source: string, eventType: string): RevenueEventType | null {
  if (!isKnownRevenueEventType(eventType)) {
    console.warn(`Unsupported revenue event type from ${source}: ${eventType}`)
    return null
  }
  return eventType
}

const SENSITIVE_REVENUE_METADATA_KEY = /(^|_|\b)(password|passcode|otp|pin|token|secret|api[_-]?key|authorization|cookie|session|email|phone|account[_-]?number|accountnumber|account[_-]?name|bank[_-]?name|wallet[_-]?address|pay[_-]?address|address|memo|tag|hash|reference|payment[_-]?reference|transaction[_-]?reference|transaction[_-]?id|payment[_-]?id|purchase[_-]?id|provider[_-]?request[_-]?id|provider[_-]?response|api[_-]?response|raw[_-]?response|response[_-]?body|activation[_-]?id|external[_-]?order[_-]?id|order[_-]?id|idempotency[_-]?key|recipient|username|login|profile[_-]?url|url|link|comment|comments|group|groups)(\b|_)?/i

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sanitizeRevenueEventId(source: string, eventId: string) {
  const normalizedSource = source.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'event'
  const hash = await sha256Hex(`${source}:${eventId}`)
  return `server:${normalizedSource}:${hash.slice(0, 48)}`
}

function sanitizeRevenueMetadataValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 4) return '[truncated]'

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const redacted = value
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted_url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
      .replace(/(?:\+?\d[\s().-]*){10,}/g, '[redacted_number]')
      .replace(/\b(?:[a-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b/g, '[redacted_token]')
    return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeRevenueMetadataValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      output[key] = SENSITIVE_REVENUE_METADATA_KEY.test(key)
        ? '[redacted]'
        : sanitizeRevenueMetadataValue(child, depth + 1)
    }
    return output
  }

  return String(value)
}

export function sanitizeRevenueMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeRevenueMetadataValue(metadata) as Record<string, unknown>
}

function cleanRevenueContextText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function cleanRevenueContextId(value: unknown) {
  const text = cleanRevenueContextText(value, 120)
  if (!text) return null
  return /^[a-z0-9:_-]{8,120}$/i.test(text) ? text : null
}

function cleanRevenueContextPath(value: unknown) {
  const text = cleanRevenueContextText(value, 240)
  if (!text) return null
  try {
    const url = new URL(text, 'https://tallystore.local')
    return url.pathname || '/'
  } catch {
    return text.split('?')[0].slice(0, 240) || null
  }
}

function cleanRevenueContextReferrer(value: unknown) {
  const text = cleanRevenueContextText(value, 240)
  if (!text) return null
  try {
    const url = new URL(text)
    return `${url.origin}${url.pathname || '/'}`.slice(0, 240)
  } catch {
    return null
  }
}

export function sanitizeRevenueRequestContext(input: unknown): RevenueRequestContext {
  const context = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const device = cleanRevenueContextText(context.device, 40)
  const displayCurrency = cleanRevenueContextText(context.display_currency, 12)
  const trafficQuality = cleanRevenueContextText(context.traffic_quality, 40)
  const attribution = context.attribution && typeof context.attribution === 'object'
    ? sanitizeRevenueMetadata(context.attribution as Record<string, unknown>)
    : null

  return {
    visitor_id: cleanRevenueContextId(context.visitor_id),
    session_id: cleanRevenueContextId(context.session_id),
    path: cleanRevenueContextPath(context.path),
    referrer: cleanRevenueContextReferrer(context.referrer),
    device: device && ['mobile', 'desktop', 'tablet', 'unknown'].includes(device.toLowerCase()) ? device.toLowerCase() : null,
    display_currency: displayCurrency && /^[A-Z]{3,8}$/.test(displayCurrency) ? displayCurrency : null,
    attribution,
    traffic_quality: trafficQuality && /^[a-z_ -]{3,40}$/i.test(trafficQuality) ? trafficQuality.toLowerCase().replace(/\s+/g, '_') : null,
  }
}

export function revenueContextEventColumns(context?: RevenueRequestContext | null) {
  return {
    visitor_id: context?.visitor_id || null,
    session_id: context?.session_id || null,
    path: context?.path || null,
    referrer: context?.referrer || null,
    device: context?.device || null,
  }
}

export function revenueContextMetadata(context?: RevenueRequestContext | null) {
  if (!context) return {}
  return {
    display_currency: context.display_currency || undefined,
    attribution: context.attribution || undefined,
    traffic_quality: context.traffic_quality || undefined,
  }
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type SupabaseAdmin = ReturnType<typeof createClient>

type ProductGroup = {
  id: string
  category_id: string | null
  name: string
  description?: string | null
  price: number | string | null
  stock_count: number | string | null
  is_active: boolean | null
  created_at?: string | null
  auto_fulfill_enabled?: boolean | null
  muabanvia_product_id?: string | null
  shopclone_product_id?: string | null
  shopviaclone_product_id?: string | null
}

type RevenueFinding = {
  check_key: string
  severity: 'info' | 'warning' | 'critical'
  status: 'passed' | 'failed' | 'paused'
  scope: string
  message: string
  evidence?: Record<string, unknown>
}

type CroOpportunity = {
  opportunity_key: string
  type: string
  scope: string
  expected_value: number
  confidence: number
  risk: number
  effort: number
  priority: number
  status: 'open' | 'watching' | 'testing' | 'resolved' | 'dismissed'
  evidence: Record<string, unknown>
}

type RevenueFeatureSnapshot = {
  snapshot_key: string
  scope_type: string
  scope_id: string
  window_start: string
  window_end: string
  features: Record<string, unknown>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function dateOrNull(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date
}

function isoHour(date = new Date()) {
  return date.toISOString().slice(0, 13)
}

function normalizeCommerceStatus(status: unknown) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_')
}

function isSuccessfulCommerceStatus(status: unknown) {
  return [
    'completed',
    'success',
    'successful',
    'credited',
    'active',
    'fulfilled',
    'delivered',
    'processing',
    'in_progress',
    'partial',
    'partially_paid',
  ].includes(normalizeCommerceStatus(status))
}

function isReversedCommerceStatus(status: unknown) {
  return ['cancelled', 'canceled', 'expired', 'failed', 'refunded', 'reversed', 'void'].includes(normalizeCommerceStatus(status))
}

function linkedCommerceOrderForEvent(
  event: any,
  productOrderById: Map<string, any>,
  smsOrderById: Map<string, any>,
  serviceOrderById?: Map<string, any>,
) {
  const metadata = event?.metadata || {}
  const candidateIds = [
    metadata.order_id,
    metadata.transaction_id,
    metadata.payment_reference,
    metadata.reference,
  ].filter((value) => value != null && String(value).trim().length > 0).map((value) => String(value))
  if (candidateIds.length === 0) return null

  const isSmsEvent = Boolean(event?.metadata?.sms_service_id) || String(event?.surface || '').includes('sms') || String(event?.event_id || '').includes(':SMS_')
  const surface = String(event?.surface || '').toLowerCase()
  const eventId = String(event?.event_id || '').toLowerCase()
  if (
    surface.includes('giftcards') ||
    surface.includes('bills') ||
    surface.includes('social_boost') ||
    surface.includes('crypto') ||
    eventId.startsWith('bitrefill:') ||
    eventId.startsWith('bills:') ||
    eventId.startsWith('smm:') ||
    eventId.startsWith('crypto:')
  ) {
    for (const id of candidateIds) {
      const linkedOrder = serviceOrderById?.get(id) || productOrderById.get(id)
      if (linkedOrder) return linkedOrder
    }
    return null
  }

  for (const id of candidateIds) {
    if (isSmsEvent) {
      const smsOrder = smsOrderById.get(id)
      if (smsOrder) return smsOrder
    } else {
      const productOrder = productOrderById.get(id)
      if (productOrder) return productOrder
    }
  }

  for (const id of candidateIds) {
    const linkedOrder = productOrderById.get(id) || smsOrderById.get(id) || serviceOrderById?.get(id)
    if (linkedOrder) return linkedOrder
  }
  return null
}

function isOrderBackedPurchaseEvent(
  event: any,
  productOrderById: Map<string, any>,
  smsOrderById: Map<string, any>,
  serviceOrderById?: Map<string, any>,
) {
  if (event?.event_type !== 'PRODUCT_PURCHASED') return false
  if (linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)) return true
  const surface = String(event?.surface || '').toLowerCase()
  const eventId = String(event?.event_id || '').toLowerCase()
  return ['server_purchase', 'checkout', 'sms', 'sms_webhook', 'giftcards', 'bills', 'social_boost', 'crypto'].includes(surface) ||
    eventId.startsWith('server:product_purchased:') ||
    eventId.startsWith('sms:product_purchased:') ||
    eventId.startsWith('bitrefill:product_purchased:') ||
    eventId.startsWith('bills:product_purchased:') ||
    eventId.startsWith('smm:product_purchased:') ||
    eventId.startsWith('crypto:product_purchased:')
}

function isCommercePaymentCompletedEvent(event: any) {
  if (event?.event_type !== 'PAYMENT_COMPLETED') return false
  const surface = String(event?.surface || '').toLowerCase()
  const eventId = String(event?.event_id || '').toLowerCase()
  return !surface.includes('wallet') && !eventId.startsWith('wallet_topup:')
}

function orderQuantity(order: any) {
  return Math.max(1, Math.round(toNumber(order?.account_details?.quantity, 1)))
}

function canAutoFulfill(product: ProductGroup) {
  return Boolean(
    product.auto_fulfill_enabled &&
      (product.muabanvia_product_id ||
        product.shopclone_product_id ||
        product.shopviaclone_product_id),
  )
}

function productIsSellable(product: ProductGroup) {
  const active = product.is_active !== false
  const validPrice = Number.isFinite(Number(product.price)) && Number(product.price) > 0
  const explicitSellable = (product as any).is_sellable
  const availabilityStatus = String((product as any).availability_status || '').toUpperCase()
  const statusSellable = ['AVAILABLE', 'LOW_STOCK', 'PREORDER', 'BACKORDER', 'UNLIMITED'].includes(availabilityStatus)
  const statusBlocked = ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus)
  const blocked = explicitSellable === false || statusBlocked
  const available = !blocked && (statusSellable || Number(product.stock_count || 0) > 0 || canAutoFulfill(product))
  return active && validPrice && available
}

function normalizeServiceCommerceOrders(input: {
  billsRows?: any[]
  giftRows?: any[]
  socialRows?: any[]
  cryptoRows?: any[]
}) {
  return [
    ...(input.billsRows || []).map((row) => ({
      ...row,
      id: `bill:${row.id}`,
      amount: toNumber(row.amount),
      product_group_id: null,
      commerce_source: 'bills',
    })),
    ...(input.giftRows || []).map((row) => ({
      ...row,
      id: `giftcard:${row.id}`,
      amount: toNumber(row.amount_ngn),
      product_group_id: null,
      commerce_source: 'giftcards',
    })),
    ...(input.socialRows || []).map((row) => ({
      ...row,
      id: `social:${row.id}`,
      amount: toNumber(row.amount_ngn),
      product_group_id: null,
      commerce_source: 'social_boost',
    })),
    ...(input.cryptoRows || []).map((row) => ({
      ...row,
      id: `crypto:${row.id}`,
      amount: toNumber(row.naira_amount),
      product_group_id: null,
      commerce_source: 'crypto',
    })),
  ]
}

function normalizedText(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function actionTypeForOpportunity(type: string) {
  const normalized = String(type || '').toUpperCase()
  if (normalized.includes('PAYMENT') || normalized.includes('CHECKOUT_LOAD') || normalized.includes('CHECKOUT_ATTEMPT')) return 'DIAGNOSE_FUNNEL'
  if (normalized.includes('CHECKOUT_ABANDONMENT') || normalized.includes('BUY_CLICK')) return 'CHANGE_CTA_COPY_VARIANT'
  if (normalized.includes('CUSTOMER_REACTIVATION')) return 'SHOW_POST_PURCHASE_OFFER'
  if (normalized.includes('FIRST_PURCHASE')) return 'CHANGE_OFFER_SEQUENCE'
  if (normalized.includes('TOP_PRODUCT_LOW_STOCK')) return 'RESTOCK_PRODUCT'
  if (normalized.includes('HIGH_INTEREST_LOW_CONVERSION_PRODUCT')) return 'SHOW_RECOMMENDATION'
  if (normalized.includes('TRAFFIC_SOURCE')) return 'AUDIT_TRAFFIC_SOURCE'
  if (normalized.includes('ACQUISITION_SCALE')) return 'CHANGE_PROMOTION_EXPOSURE'
  if (normalized.includes('DEVICE_')) return 'CHANGE_RECOMMENDATION_POSITION'
  if (normalized.includes('REVENUE_DRIVER_TRAFFIC')) return 'AUDIT_TRAFFIC_SOURCE'
  if (normalized.includes('REVENUE_DRIVER_CONVERSION')) return 'REORDER_PRODUCTS'
  if (normalized.includes('REVENUE_DRIVER_PURCHASE_VALUE')) return 'SHOW_RECOMMENDATION'
  if (normalized.includes('REVENUE_DRIVER_REPEAT_RATE')) return 'SHOW_POST_PURCHASE_OFFER'
  if (normalized.includes('CONVERSION_DROP')) return 'REORDER_PRODUCTS'
  return 'DO_NOTHING'
}

function surfaceForActionPlan(actionType: string, scope: string) {
  if (actionType === 'SHOW_POST_PURCHASE_OFFER' || actionType === 'CHANGE_OFFER_SEQUENCE') return 'post_purchase'
  if (actionType === 'DIAGNOSE_FUNNEL') return 'checkout'
  if (actionType === 'AUDIT_TRAFFIC_SOURCE' || actionType === 'CHANGE_PROMOTION_EXPOSURE') return 'acquisition'
  if (scope.startsWith('product:')) return 'products'
  if (scope.includes('device:mobile')) return 'mobile'
  return 'products'
}

function promotionActionGuardrails(actionType: string) {
  if (actionType !== 'CHANGE_PROMOTION_EXPOSURE') return {}
  return {
    promotion_exposure_only: true,
    promotion_requires_admin_approval: true,
    promotion_requires_budget_cap: true,
    promotion_requires_incrementality_evidence: true,
    promotion_requires_sellable_scope: true,
    no_fake_scarcity: true,
    no_fake_urgency: true,
    no_invented_prices: true,
    no_dynamic_customer_price_increases: true,
  }
}

async function requireAuthorized(req: Request, supabase: SupabaseAdmin) {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const cronSecret = Deno.env.get('REVENUE_OS_CRON_SECRET') || ''
  const auth = req.headers.get('authorization') || ''
  const providedSecret = req.headers.get('x-cron-secret') || ''
  if (cronSecret && providedSecret === cronSecret) return
  if (serviceRole && auth === `Bearer ${serviceRole}`) return
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (token) {
    const { data: userData } = await supabase.auth.getUser(token)
    const user = userData?.user
    const userId = user?.id
    const userEmail = user?.email?.toLowerCase() || ''
    // Owner email is always authorized (fallback when is_admin column is missing)
    const OWNER_EMAIL = 'wisdomthedev@gmail.com'
    if (userEmail === OWNER_EMAIL) return
    if (userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin, is_staff')
        .eq('id', userId)
        .maybeSingle()
      if (profile?.is_admin === true) return
    }
  }
  throw new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function getSetting(supabase: SupabaseAdmin, key: string, fallback = '') {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? fallback
}

async function upsertSetting(supabase: SupabaseAdmin, key: string, value: string) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as any).message || 'Unknown error')
  return String(error || 'Unknown error')
}

function dependencyFinding(now: Date, dependency: string, error: unknown, severity: RevenueFinding['severity'] = 'critical'): RevenueFinding {
  const message = errorMessage(error)
  return {
    check_key: `dependency:${dependency}:${isoHour(now)}`,
    severity,
    status: 'failed',
    scope: `dependency:${dependency}`,
    message: `Revenue OS dependency failed for ${dependency}: ${message}`,
    evidence: {
      dependency,
      error: message.slice(0, 800),
    },
  }
}

async function safeRead<T>(
  now: Date,
  dependency: string,
  query: PromiseLike<{ data: T | null; error: any }>,
  fallback: T,
  severity: RevenueFinding['severity'] = 'critical',
) {
  try {
    const { data, error } = await query
    if (error) return { data: fallback, finding: dependencyFinding(now, dependency, error, severity) }
    return { data: (data ?? fallback) as T, finding: null as RevenueFinding | null }
  } catch (error) {
    return { data: fallback, finding: dependencyFinding(now, dependency, error, severity) }
  }
}

async function safeWrite(now: Date, dependency: string, write: () => Promise<void>, severity: RevenueFinding['severity'] = 'critical') {
  try {
    await write()
    return null
  } catch (error) {
    console.error(`Revenue OS maintenance write failed for ${dependency}:`, error)
    return dependencyFinding(now, dependency, error, severity)
  }
}

function buildCatalogueFindings(products: ProductGroup[], categories: any[]): RevenueFinding[] {
  const findings: RevenueFinding[] = []
  const categoryIds = new Set(categories.map((category) => category.id))
  const normalizedNames = new Map<string, ProductGroup[]>()

  for (const product of products) {
    const nameKey = normalizedText(product.name)
    if (nameKey) normalizedNames.set(nameKey, [...(normalizedNames.get(nameKey) || []), product])

    const active = product.is_active !== false
    const validPrice = Number.isFinite(Number(product.price)) && Number(product.price) > 0
    const stock = Number(product.stock_count || 0)
    const available = productIsSellable(product)

    if (product.category_id && !categoryIds.has(product.category_id)) {
      findings.push({
        check_key: 'catalogue.missing_category',
        severity: active ? 'critical' : 'warning',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} is linked to a missing category.`,
        evidence: { product_id: product.id, category_id: product.category_id },
      })
    }
    if (!validPrice) {
      findings.push({
        check_key: 'catalogue.invalid_price',
        severity: active ? 'critical' : 'warning',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} has an invalid customer price.`,
        evidence: { product_id: product.id, price: product.price },
      })
    }
    if (stock < 0) {
      findings.push({
        check_key: 'catalogue.negative_stock',
        severity: 'critical',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} has negative stock.`,
        evidence: { product_id: product.id, stock_count: product.stock_count },
      })
    }
    // Active but out-of-stock products are normal catalogue state. They are
    // excluded from sellable/recommendation pools by productIsSellable().
  }

  for (const [name, duplicateProducts] of normalizedNames) {
    const activeDuplicates = duplicateProducts.filter((product) => product.is_active !== false)
    if (activeDuplicates.length > 1) {
      findings.push({
        check_key: 'catalogue.duplicate_normalized_name',
        severity: 'warning',
        status: 'failed',
        scope: name,
        message: `${activeDuplicates.length} active products normalize to the same name.`,
        evidence: { product_ids: activeDuplicates.map((product) => product.id), names: activeDuplicates.map((product) => product.name) },
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      check_key: 'catalogue.health',
      severity: 'info',
      status: 'passed',
      scope: 'catalogue',
      message: 'Catalogue checks passed for scheduled Revenue OS maintenance.',
      evidence: { products_checked: products.length },
    })
  }
  return findings
}

function buildEventFindings(input: {
  events: any[]
  orders: any[]
  smsOrders: any[]
  serviceOrders?: any[]
  products: ProductGroup[]
  profiles: any[]
  identityLinks?: any[]
  since: Date
  now: Date
}): RevenueFinding[] {
  const findings: RevenueFinding[] = []
  const productIds = new Set(input.products.map((product) => product.id))
  const internalUsers = new Set(input.profiles.filter((profile) => profile.is_staff || profile.is_admin).map((profile) => String(profile.id)))
  const exactIdentityLinkByVisitorSession = new Map<string, string>()
  const usersByVisitorId = new Map<string, Set<string>>()
  for (const link of input.identityLinks || []) {
    const userId = String(link.user_id || '')
    const visitorId = String(link.visitor_id || '')
    const sessionId = String(link.session_id || '')
    if (!userId || !visitorId) continue
    if (sessionId) exactIdentityLinkByVisitorSession.set(`${visitorId}:${sessionId}`, userId)
    const userSet = usersByVisitorId.get(visitorId) || new Set<string>()
    userSet.add(userId)
    usersByVisitorId.set(visitorId, userSet)
  }
  const isInternalEvent = (event: any) => {
    if (event.user_id && internalUsers.has(String(event.user_id))) return true
    const visitorId = event.visitor_id ? String(event.visitor_id) : ''
    const sessionId = event.session_id ? String(event.session_id) : ''
    if (visitorId && sessionId) {
      const exactUserId = exactIdentityLinkByVisitorSession.get(`${visitorId}:${sessionId}`)
      if (exactUserId && internalUsers.has(exactUserId)) return true
    }
    const visitorUsers = visitorId ? usersByVisitorId.get(visitorId) : null
    return !!visitorUsers && [...visitorUsers].some((userId) => internalUsers.has(userId))
  }
  const events = input.events.filter((event) => !isInternalEvent(event))
  const orders = input.orders.filter((order) => !internalUsers.has(String(order.user_id || '')))
  const smsOrders = input.smsOrders.filter((order) => !internalUsers.has(String(order.user_id || '')))
  const serviceOrders = (input.serviceOrders || []).filter((order) => !internalUsers.has(String(order.user_id || '')))
  const completedOrders = orders.filter((order) => isSuccessfulCommerceStatus(order.status))
  const completedOrderBackedCommerceOrders = [...completedOrders, ...smsOrders.filter((order) => isSuccessfulCommerceStatus(order.status))]
  const completedCommerceOrders = [
    ...completedOrderBackedCommerceOrders,
    ...serviceOrders.filter((order) => isSuccessfulCommerceStatus(order.status)),
  ]
  const productOrderById = new Map(orders.map((order) => [String(order.id), order]))
  const smsOrderById = new Map(smsOrders.map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of serviceOrders) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }
  const productPurchaseEvents = events.filter((event) => event.event_type === 'PRODUCT_PURCHASED')
  const orderBackedProductPurchaseEvents = productPurchaseEvents.filter((event) => isOrderBackedPurchaseEvent(event, productOrderById, smsOrderById, serviceOrderById))
  const unbackedProductPurchaseEvents = productPurchaseEvents.filter((event) => !isOrderBackedPurchaseEvent(event, productOrderById, smsOrderById, serviceOrderById))
  const buyClicked = events.filter((event) => event.event_type === 'BUY_CLICKED')
  const productImpressions = events.filter((event) => event.event_type === 'PRODUCT_IMPRESSION')
  const productClicks = events.filter((event) => event.event_type === 'PRODUCT_CLICKED' || event.event_type === 'RECOMMENDATION_CLICKED')
  const paymentStarted = events.filter((event) => event.event_type === 'PAYMENT_STARTED')
  const paymentProviderLoaded = events.filter((event) => event.event_type === 'PAYMENT_PROVIDER_LOADED')
  const paymentAttempts = events.filter((event) => event.event_type === 'PAYMENT_ATTEMPTED')
  const commercePaymentCompleted = events.filter(isCommercePaymentCompletedEvent)
  const paymentFailures = events.filter((event) => event.event_type === 'PAYMENT_FAILED')
  const uniqueVisitors = new Set(events.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size

  const missingEventIds = events.filter((event) => !event.event_id)
  if (missingEventIds.length > 0) {
    findings.push({
      check_key: 'events.missing_event_id',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${missingEventIds.length} revenue event(s) are missing event_id, so retries cannot be deduplicated safely.`,
      evidence: { rows: missingEventIds.slice(0, 20).map((event) => ({ id: event.id, event_type: event.event_type })) },
    })
  }

  const unknownEventTypes = [...new Set(events
    .map((event) => String(event.event_type || ''))
    .filter((eventType) => !isKnownRevenueEventType(eventType)))]
  if (unknownEventTypes.length > 0) {
    findings.push({
      check_key: 'events.schema_drift_unknown_event_type',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${unknownEventTypes.length} unknown revenue event type(s) were recorded. Revenue OS must pause until tracking schema drift is fixed.`,
      evidence: { event_types: unknownEventTypes.slice(0, 30) },
    })
  }

  const unsupportedCurrencies = [...new Set(events
    .map((event) => String(event.metadata?.display_currency || event.metadata?.currency || '').toUpperCase())
    .filter((currency) => currency && !['NGN', 'USD'].includes(currency)))]
  if (unsupportedCurrencies.length > 0) {
    findings.push({
      check_key: 'events.currency_inconsistency',
      severity: 'warning',
      status: 'failed',
      scope: 'revenue_events',
      message: `${unsupportedCurrencies.length} unsupported display/transaction currency value(s) appeared in revenue events.`,
      evidence: { currencies: unsupportedCurrencies.slice(0, 20) },
    })
  }

  const missingActorIdentityEvents = events.filter((event) => !event.user_id && !event.visitor_id && !event.session_id)
  if (events.length >= 20 && missingActorIdentityEvents.length / events.length > 0.05) {
    findings.push({
      check_key: 'events.missing_actor_identity',
      severity: 'warning',
      status: 'failed',
      scope: 'identity_resolution',
      message: 'More than 5% of recent revenue events are missing user, visitor, and session identifiers. CRO visitor, conversion, and personalization metrics may be unreliable.',
      evidence: {
        missing_actor_events: missingActorIdentityEvents.length,
        total_events: events.length,
        sample_event_ids: missingActorIdentityEvents.map((event) => event.event_id).filter(Boolean).slice(0, 20),
      },
    })
  }

  const missingAttributionEvents = events.filter((event) => {
    const attribution = event.metadata?.attribution
    return !attribution || typeof attribution !== 'object' || !String(attribution.channel || '').trim()
  })
  if (events.length >= 20 && missingAttributionEvents.length / events.length > 0.15) {
    findings.push({
      check_key: 'events.missing_attribution',
      severity: 'warning',
      status: 'failed',
      scope: 'attribution',
      message: 'More than 15% of recent revenue events are missing channel attribution. Traffic-source and acquisition opportunities should be treated cautiously.',
      evidence: {
        missing_attribution_events: missingAttributionEvents.length,
        total_events: events.length,
        sample_event_ids: missingAttributionEvents.map((event) => event.event_id).filter(Boolean).slice(0, 20),
      },
    })
  }

  const eventIds = new Map<string, number>()
  for (const event of events) {
    if (!event.event_id) continue
    eventIds.set(event.event_id, (eventIds.get(event.event_id) || 0) + 1)
  }
  const duplicateEventIds = [...eventIds.entries()].filter(([, count]) => count > 1)
  if (duplicateEventIds.length > 0) {
    findings.push({
      check_key: 'events.duplicate_event_ids',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${duplicateEventIds.length} duplicate revenue event id(s) were found in the maintenance window.`,
      evidence: { duplicates: duplicateEventIds.slice(0, 20) },
    })
  }

  const orphanProductEvents = events.filter((event) => event.product_group_id && !productIds.has(event.product_group_id))
  if (orphanProductEvents.length > 0) {
    findings.push({
      check_key: 'events.orphan_product_group_id',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${orphanProductEvents.length} revenue event(s) reference products that no longer exist, so product-level CRO attribution is unsafe.`,
      evidence: { product_group_ids: [...new Set(orphanProductEvents.map((event) => event.product_group_id))].slice(0, 30) },
    })
  }

  const impossibleOrders = completedOrders.filter((order) => toNumber(order.amount) <= 0 || (order.product_group_id && !productIds.has(order.product_group_id)))
  if (impossibleOrders.length > 0) {
    findings.push({
      check_key: 'orders.impossible_completed_orders',
      severity: 'critical',
      status: 'failed',
      scope: 'orders',
      message: `${impossibleOrders.length} completed order(s) have zero/negative amount or missing product records.`,
      evidence: { order_ids: impossibleOrders.map((order) => order.id).slice(0, 30) },
    })
  }

  const displayChargeMismatches = completedOrders
    .map((order) => {
      const details = order.account_details && typeof order.account_details === 'object' ? order.account_details : {}
      const expected = toNumber(details.expected_amount_ngn, NaN)
      const charged = toNumber(details.charged_amount_ngn ?? order.amount, NaN)
      if (!Number.isFinite(expected) || !Number.isFinite(charged)) return null
      const delta = Math.abs(expected - charged)
      return delta > 1 ? { order_id: order.id, product_group_id: order.product_group_id, expected_amount_ngn: expected, charged_amount_ngn: charged, delta } : null
    })
    .filter(Boolean)
  if (displayChargeMismatches.length > 0) {
    findings.push({
      check_key: 'orders.display_charge_mismatch',
      severity: 'critical',
      status: 'failed',
      scope: 'orders',
      message: `${displayChargeMismatches.length} completed order(s) charged a different amount than the customer-confirmed displayed price.`,
      evidence: { mismatches: displayChargeMismatches.slice(0, 20) },
    })
  }

  if (completedOrderBackedCommerceOrders.length >= 3 && orderBackedProductPurchaseEvents.length === 0) {
    findings.push({
      check_key: 'events.missing_purchase_events',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Completed orders exist but no PRODUCT_PURCHASED events were recorded in the maintenance window, so Revenue OS cannot safely learn from purchases.',
      evidence: {
        completed_order_backed_orders: completedOrderBackedCommerceOrders.length,
        completed_all_commerce_orders: completedCommerceOrders.length,
      },
    })
  }

  if (completedOrderBackedCommerceOrders.length >= 3 && orderBackedProductPurchaseEvents.length > completedOrderBackedCommerceOrders.length * 2) {
    findings.push({
      check_key: 'events.purchase_event_overcount',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Order-backed PRODUCT_PURCHASED events are more than 2x completed orders.',
      evidence: {
        order_backed_product_purchase_events: orderBackedProductPurchaseEvents.length,
        all_product_purchase_events: productPurchaseEvents.length,
        completed_order_backed_orders: completedOrderBackedCommerceOrders.length,
        completed_all_commerce_orders: completedCommerceOrders.length,
      },
    })
  }

  if (unbackedProductPurchaseEvents.length >= 3 || (productPurchaseEvents.length >= 6 && unbackedProductPurchaseEvents.length / productPurchaseEvents.length > 0.25)) {
    findings.push({
      check_key: 'events.unbacked_purchase_events',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Some PRODUCT_PURCHASED events could not be tied to a real product, SMS, bills, gift card, social boost, or crypto order, so purchase credit is unsafe.',
      evidence: {
        unbacked_product_purchase_events: unbackedProductPurchaseEvents.length,
        all_product_purchase_events: productPurchaseEvents.length,
        event_ids: unbackedProductPurchaseEvents.map((event) => event.event_id).filter(Boolean).slice(0, 30),
      },
    })
  }

  const purchaseEventsByOrderId = new Map<string, any[]>()
  for (const event of orderBackedProductPurchaseEvents) {
    const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
    const linkedOrderId = linkedOrder?.id ? String(linkedOrder.id) : ''
    if (!linkedOrderId) continue
    purchaseEventsByOrderId.set(linkedOrderId, [...(purchaseEventsByOrderId.get(linkedOrderId) || []), event])
  }
  const duplicatePurchaseCredits = [...purchaseEventsByOrderId.entries()]
    .filter(([, eventsForOrder]) => eventsForOrder.length > 1)
    .map(([orderId, eventsForOrder]) => ({
      order_id: orderId,
      purchase_events: eventsForOrder.length,
      event_ids: eventsForOrder.map((event) => event.event_id).filter(Boolean).slice(0, 10),
    }))
  if (duplicatePurchaseCredits.length > 0) {
    findings.push({
      check_key: 'events.duplicate_purchase_credit',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${duplicatePurchaseCredits.length} order(s) have more than one PRODUCT_PURCHASED event, so Revenue OS may double-count reward unless deduped.`,
      evidence: { duplicates: duplicatePurchaseCredits.slice(0, 20) },
    })
  }

  const reversedPurchaseEvents = orderBackedProductPurchaseEvents.filter((event) => {
    const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
    return linkedOrder && isReversedCommerceStatus(linkedOrder.status)
  })
  if (reversedPurchaseEvents.length > 0) {
    findings.push({
      check_key: 'events.reversed_purchase_reward',
      severity: 'warning',
      status: 'failed',
      scope: 'revenue_events',
      message: `${reversedPurchaseEvents.length} purchase event(s) are linked to cancelled, failed, expired, or refunded orders and will not receive CRO reward credit.`,
      evidence: { event_ids: reversedPurchaseEvents.map((event) => event.event_id).filter(Boolean).slice(0, 30) },
    })
  }

  const conversion = uniqueVisitors > 0 ? completedCommerceOrders.length / uniqueVisitors : 0
  if (uniqueVisitors >= 20 && conversion >= 0.95) {
    findings.push({
      check_key: 'events.impossible_conversion_rate',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Conversion is near 100% with meaningful traffic; tracking or bot filtering is probably broken.',
      evidence: { unique_visitors: uniqueVisitors, completed_orders: completedCommerceOrders.length, conversion_rate: conversion },
    })
  }

  if (productPurchaseEvents.length >= 3 && paymentStarted.length === 0) {
    findings.push({
      check_key: 'events.missing_payment_started',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Purchase events exist but no PAYMENT_STARTED events were recorded, so payment funnel diagnosis is unsafe.',
      evidence: { product_purchase_events: productPurchaseEvents.length },
    })
  }

  if (productClicks.length >= 10 && productImpressions.length === 0) {
    findings.push({
      check_key: 'events.missing_product_impressions',
      severity: 'critical',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Product/recommendation clicks exist but no PRODUCT_IMPRESSION events were recorded, so ranking and recommendation attribution are unsafe.',
      evidence: {
        product_click_events: productClicks.length,
        buy_clicks: buyClicked.length,
        product_purchase_events: productPurchaseEvents.length,
      },
    })
  }

  if (productClicks.length >= 20 && productImpressions.length > 0 && productClicks.length > productImpressions.length) {
    findings.push({
      check_key: 'events.low_product_impression_coverage',
      severity: 'warning',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Product/recommendation clicks exceed recorded impressions, which usually means some pages are missing PRODUCT_IMPRESSION tracking.',
      evidence: {
        product_click_events: productClicks.length,
        product_impression_events: productImpressions.length,
        coverage_ratio: productImpressions.length / productClicks.length,
      },
    })
  }

  if (orderBackedProductPurchaseEvents.length >= 3 && productImpressions.length === 0) {
    findings.push({
      check_key: 'events.purchase_without_exposure',
      severity: 'critical',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Order-backed purchases exist but no PRODUCT_IMPRESSION events were recorded, so CRO cannot measure whether product placement caused the sale.',
      evidence: {
        order_backed_product_purchase_events: orderBackedProductPurchaseEvents.length,
        completed_orders: completedCommerceOrders.length,
      },
    })
  }

  if (paymentStarted.length >= 3 && buyClicked.length >= 3 && paymentProviderLoaded.length === 0) {
    findings.push({
      check_key: 'events.missing_payment_provider_loaded',
      severity: 'warning',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Payment starts exist but no PAYMENT_PROVIDER_LOADED events were recorded, so provider/form-load outages may be misdiagnosed as merchandising problems.',
      evidence: { payment_starts: paymentStarted.length, buy_clicks: buyClicked.length },
    })
  }

  if (orderBackedProductPurchaseEvents.length >= 3 && commercePaymentCompleted.length === 0) {
    findings.push({
      check_key: 'events.missing_payment_completed',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Order-backed purchase events exist but no commerce PAYMENT_COMPLETED events were recorded. Wallet top-ups are excluded; CRO attribution is unsafe.',
      evidence: { order_backed_product_purchase_events: orderBackedProductPurchaseEvents.length },
    })
  }

  if (orderBackedProductPurchaseEvents.length >= 3 && commercePaymentCompleted.length > orderBackedProductPurchaseEvents.length * 2) {
    findings.push({
      check_key: 'events.payment_completed_overcount',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Commerce PAYMENT_COMPLETED events are unusually high relative to order-backed purchases, so revenue attribution may be inflated.',
      evidence: {
        commerce_payment_completed: commercePaymentCompleted.length,
        order_backed_product_purchase_events: orderBackedProductPurchaseEvents.length,
      },
    })
  }

  if (paymentFailures.length >= 5 && paymentAttempts.length === 0) {
    findings.push({
      check_key: 'events.failed_without_attempts',
      severity: 'warning',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Payment failures exist without PAYMENT_ATTEMPTED events, weakening funnel diagnosis.',
      evidence: { payment_failures: paymentFailures.length },
    })
  }

  const lowQualityEvents = events.filter((event) => ['bot', 'suspect', 'internal'].includes(String(event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || '').toLowerCase()))
  if (events.length >= 50 && lowQualityEvents.length / events.length > 0.35) {
    const ratio = lowQualityEvents.length / events.length
    findings.push({
      check_key: 'traffic.low_quality_event_ratio',
      severity: ratio > 0.5 ? 'critical' : 'warning',
      status: 'failed',
      scope: 'traffic_quality',
      message: 'A large share of recent events are bot, suspect, or internal traffic.',
      evidence: { low_quality_events: lowQualityEvents.length, total_events: events.length, ratio },
    })
  }

  if (findings.length === 0) {
    findings.push({
      check_key: 'events.health',
      severity: 'info',
      status: 'passed',
      scope: 'revenue_events',
      message: 'Scheduled event, order, payment, and traffic checks passed.',
      evidence: {
        events: events.length,
        completed_orders: completedCommerceOrders.length,
        payment_started: paymentStarted.length,
        payment_failures: paymentFailures.length,
      },
    })
  }

  return findings
}

function buildOperationalFindings(input: {
  pendingPayments: any[]
  ercasEnabled: boolean
  now: Date
}): RevenueFinding[] {
  const findings: RevenueFinding[] = []
  const hasNowPayments = Boolean(Deno.env.get('NOWPAYMENTS_API_KEY'))
  const hasDaisy = Boolean(Deno.env.get('DAISYSMS_API_KEY'))
  const hasPocketFi = Boolean(
    (Deno.env.get('POCKETFI_PUBLIC_KEY') ||
      Deno.env.get('POCKETFI_API_TOKEN') ||
      Deno.env.get('VITE_POCKETFI_API_TOKEN') ||
      Deno.env.get('VITE_POCKETFI_PUBLIC_KEY')) &&
    (Deno.env.get('POCKETFI_BUSINESS_ID') ||
      Deno.env.get('VITE_POCKETFI_BUSINESS_ID')),
  )
  const hasErcas = Boolean(
    Deno.env.get('ERCASPAY_SECRET_KEY') ||
    Deno.env.get('ERCAS_SECRET_KEY') ||
    Deno.env.get('VITE_ERCASPAY_SECRET_KEY') ||
    Deno.env.get('VITE_ERCAS_SECRET_KEY'),
  )

  if (hasNowPayments && !Deno.env.get('NOWPAYMENTS_IPN_SECRET')) {
    findings.push({
      check_key: 'operations.missing_nowpayments_ipn_secret',
      severity: 'critical',
      status: 'failed',
      scope: 'crypto_webhook',
      message: 'NOWPAYMENTS_API_KEY is configured but NOWPAYMENTS_IPN_SECRET is missing, so signed crypto deposit webhooks cannot be trusted or processed.',
      evidence: { nowpayments_api_configured: true, nowpayments_ipn_secret_configured: false },
    })
  }

  if (hasPocketFi && !(Deno.env.get('POCKETFI_WEBHOOK_SECRET') || Deno.env.get('POCKETFI_SECRET_KEY') || Deno.env.get('POCKETFI_SECRET_API_KEY'))) {
    findings.push({
      check_key: 'operations.missing_pocketfi_webhook_secret',
      severity: 'critical',
      status: 'failed',
      scope: 'wallet_topup_webhook',
      message: 'PocketFi account creation is configured but no PocketFi webhook secret is configured, so bank-transfer top-ups cannot be credited safely.',
      evidence: { pocketfi_api_configured: true, webhook_secret_configured: false },
    })
  }

  if (hasDaisy && !Deno.env.get('DAISYSMS_WEBHOOK_SECRET')) {
    findings.push({
      check_key: 'operations.missing_daisysms_webhook_secret',
      severity: 'warning',
      status: 'failed',
      scope: 'sms_webhook',
      message: 'DAISYSMS_API_KEY is configured but DAISYSMS_WEBHOOK_SECRET is missing. SMS webhook completions will be rejected and orders must rely on polling/manual checks.',
      evidence: { daisysms_api_configured: true, webhook_secret_configured: false },
    })
  }

  if (input.ercasEnabled && !hasErcas) {
    findings.push({
      check_key: 'operations.missing_ercaspay_secret',
      severity: 'warning',
      status: 'failed',
      scope: 'wallet_topup',
      message: 'Ercas secret is missing. Set ERCASPAY_SECRET_KEY, ERCAS_SECRET_KEY, VITE_ERCASPAY_SECRET_KEY, or VITE_ERCAS_SECRET_KEY so wallet top-ups and recovery checks can run.',
      evidence: { ercaspay_secret_configured: false },
    })
  }

  const stalePending = input.pendingPayments.filter((payment) => {
    if (String(payment.status || '').toLowerCase() !== 'pending') return false
    const created = dateOrNull(payment.created_at)
    if (!created) return false
    return input.now.getTime() - created.getTime() > 48 * 60 * 60 * 1000
  })

  if (stalePending.length > 0) {
    findings.push({
      check_key: 'payments.stale_pending_recovery_rows',
      severity: 'critical',
      status: 'failed',
      scope: 'pending_payments',
      message: `${stalePending.length} pending payment recovery row(s) are older than 48 hours and may mislead payment recovery.`,
      evidence: {
        payment_ids: stalePending.slice(0, 30).map((payment) => payment.id),
        oldest_created_at: stalePending
          .map((payment) => String(payment.created_at || ''))
          .sort()[0] || null,
      },
    })
  }

  const uncheckedPending = input.pendingPayments.filter((payment) => {
    if (String(payment.status || '').toLowerCase() !== 'pending') return false
    const created = dateOrNull(payment.created_at)
    if (!created) return false
    if (input.now.getTime() - created.getTime() < 30 * 60 * 1000) return false
    return !payment.last_check_at
  })

  if (uncheckedPending.length > 0) {
    findings.push({
      check_key: 'payments.unchecked_pending_recovery_rows',
      severity: 'warning',
      status: 'failed',
      scope: 'pending_payments',
      message: `${uncheckedPending.length} pending payment row(s) older than 30 minutes have never been checked by recovery.`,
      evidence: { payment_ids: uncheckedPending.slice(0, 30).map((payment) => payment.id) },
    })
  }

  if (findings.length === 0) {
    findings.push({
      check_key: 'operations.health',
      severity: 'info',
      status: 'passed',
      scope: 'operations',
      message: 'Provider secrets and payment recovery operational checks passed.',
      evidence: {
        pending_payments_checked: input.pendingPayments.length,
        nowpayments_api_configured: hasNowPayments,
        pocketfi_configured: hasPocketFi,
        daisysms_configured: hasDaisy,
        ercaspay_configured: hasErcas,
      },
    })
  }

  return findings
}

function buildPromotionFindings(input: {
  discountCodes: any[]
  orders: any[]
  products: ProductGroup[]
  maxDiscountPct: number
  monthlyBudgetNgn: number
  now: Date
}): RevenueFinding[] {
  const findings: RevenueFinding[] = []
  const monthStart = new Date(input.now.getFullYear(), input.now.getMonth(), 1)
  const activeCodes = (input.discountCodes || []).filter((code) => code.is_active !== false)
  const productById = new Map(input.products.map((product) => [product.id, product]))
  const maxDiscountPct = Math.max(0, toNumber(input.maxDiscountPct, 20))
  const monthlyBudgetNgn = Math.max(0, toNumber(input.monthlyBudgetNgn, 0))
  const completedOrdersThisMonth = (input.orders || []).filter((order) => {
    const created = dateOrNull(order.created_at)
    return isSuccessfulCommerceStatus(order.status) && created && created >= monthStart && created <= input.now
  })
  const discountSpend = completedOrdersThisMonth.reduce((sum, order) => {
    const original = toNumber(order.account_details?.original_total)
    const amount = toNumber(order.amount)
    return sum + (original > amount ? original - amount : 0)
  }, 0)

  if (monthlyBudgetNgn > 0 && discountSpend > monthlyBudgetNgn) {
    findings.push({
      check_key: 'promotion.monthly_budget_exceeded',
      severity: 'critical',
      status: 'failed',
      scope: 'promotions',
      message: 'Promotion discount spend exceeded the configured monthly Revenue OS budget.',
      evidence: { discount_spend_ngn: discountSpend, monthly_budget_ngn: monthlyBudgetNgn },
    })
  }

  for (const code of activeCodes) {
    const percentOff = toNumber(code.percent_off)
    const scoped = Boolean(code.product_group_id || code.category_id || code.user_id)
    const usageRemaining = code.max_uses == null ? null : Math.max(0, toNumber(code.max_uses) - toNumber(code.used_count))
    const expiresAt = code.expires_at ? dateOrNull(code.expires_at) : null
    const product = code.product_group_id ? productById.get(String(code.product_group_id)) : null

    if (percentOff > maxDiscountPct) {
      findings.push({
        check_key: 'promotion.discount_pct_above_guardrail',
        severity: percentOff >= maxDiscountPct * 1.75 ? 'critical' : 'warning',
        status: 'failed',
        scope: 'promotions',
        message: `${code.code || 'Discount code'} gives ${percentOff}% off, above the configured Revenue OS max of ${maxDiscountPct}%.`,
        evidence: { code_id: code.id, percent_off: percentOff, max_discount_pct: maxDiscountPct },
      })
    }

    if (!scoped && !code.max_uses) {
      findings.push({
        check_key: 'promotion.unbounded_storewide_code',
        severity: 'critical',
        status: 'failed',
        scope: 'promotions',
        message: `${code.code || 'Discount code'} is store-wide with no usage limit.`,
        evidence: { code_id: code.id, percent_off: percentOff },
      })
    }

    if (expiresAt && expiresAt < input.now) {
      findings.push({
        check_key: 'promotion.expired_active_code',
        severity: 'warning',
        status: 'failed',
        scope: 'promotions',
        message: `${code.code || 'Discount code'} is still active after expiry.`,
        evidence: { code_id: code.id, expires_at: code.expires_at },
      })
    }

    if (code.max_uses && usageRemaining === 0) {
      findings.push({
        check_key: 'promotion.used_up_active_code',
        severity: 'warning',
        status: 'failed',
        scope: 'promotions',
        message: `${code.code || 'Discount code'} is still active after reaching its usage limit.`,
        evidence: { code_id: code.id, max_uses: code.max_uses, used_count: code.used_count },
      })
    }

    if (product && !productIsSellable(product)) {
      findings.push({
        check_key: 'promotion.scoped_to_unsellable_product',
        severity: 'warning',
        status: 'failed',
        scope: 'promotions',
        message: `${code.code || 'Discount code'} points to a product customers cannot buy right now.`,
        evidence: { code_id: code.id, product_group_id: product.id },
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      check_key: 'promotion.guardrails',
      severity: 'info',
      status: 'passed',
      scope: 'promotions',
      message: 'Scheduled promotion guardrails passed.',
      evidence: {
        active_codes: activeCodes.length,
        discount_spend_ngn: discountSpend,
        monthly_budget_ngn: monthlyBudgetNgn,
        max_discount_pct: maxDiscountPct,
      },
    })
  }

  return findings
}

function buildRuntimeIntelligence(input: {
  events: any[]
  orders: any[]
  smsOrders: any[]
  serviceOrders?: any[]
  products: ProductGroup[]
  categories: any[]
  profiles: any[]
  identityLinks?: any[]
  monthlyTarget: number
  now: Date
}) {
  const now = input.now
  const dayMs = 86400000
  const window30Start = new Date(now.getTime() - 30 * dayMs)
  const current7Start = new Date(now.getTime() - 7 * dayMs)
  const previous7Start = new Date(now.getTime() - 14 * dayMs)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const productById = new Map(input.products.map((product) => [product.id, product]))
  const pricesByCategory = input.products.reduce<Record<string, number[]>>((acc, product) => {
    const price = toNumber(product.price)
    if (price > 0) {
      const key = product.category_id || 'uncategorized'
      acc[key] = [...(acc[key] || []), price]
    }
    return acc
  }, {})
  for (const key of Object.keys(pricesByCategory)) pricesByCategory[key].sort((a, b) => a - b)
  const categoryPricePercentile = (product: ProductGroup | undefined) => {
    if (!product) return null
    const price = toNumber(product.price)
    const prices = pricesByCategory[product.category_id || 'uncategorized'] || []
    if (price <= 0 || prices.length <= 1) return null
    const lowerOrEqual = prices.filter((candidate) => candidate <= price).length
    return clamp((lowerOrEqual - 1) / Math.max(1, prices.length - 1))
  }
  const internalUsers = new Set(input.profiles.filter((profile) => profile.is_staff || profile.is_admin).map((profile) => String(profile.id)))
  const exactIdentityLinkByVisitorSession = new Map<string, string>()
  const usersByVisitorId = new Map<string, Set<string>>()
  for (const link of input.identityLinks || []) {
    const userId = String(link.user_id || '')
    const visitorId = String(link.visitor_id || '')
    const sessionId = String(link.session_id || '')
    if (!userId || !visitorId) continue
    if (sessionId) exactIdentityLinkByVisitorSession.set(`${visitorId}:${sessionId}`, userId)
    const userSet = usersByVisitorId.get(visitorId) || new Set<string>()
    userSet.add(userId)
    usersByVisitorId.set(visitorId, userSet)
  }
  const isInternalEvent = (event: any) => {
    if (event.user_id && internalUsers.has(String(event.user_id))) return true
    const visitorId = event.visitor_id ? String(event.visitor_id) : ''
    const sessionId = event.session_id ? String(event.session_id) : ''
    if (visitorId && sessionId) {
      const exactUserId = exactIdentityLinkByVisitorSession.get(`${visitorId}:${sessionId}`)
      if (exactUserId && internalUsers.has(exactUserId)) return true
    }
    const visitorUsers = visitorId ? usersByVisitorId.get(visitorId) : null
    return !!visitorUsers && [...visitorUsers].some((userId) => internalUsers.has(userId))
  }
  const trustedEvents = input.events.filter((event) => {
    if (isInternalEvent(event)) return false
    const quality = String(event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human').toLowerCase()
    return !['bot', 'internal', 'suspect'].includes(quality)
  })
  const productOrders = input.orders.filter((order) => !internalUsers.has(String(order.user_id || '')) && isSuccessfulCommerceStatus(order.status))
  const smsOrders = input.smsOrders.filter((order) => !internalUsers.has(String(order.user_id || '')) && isSuccessfulCommerceStatus(order.status))
  const serviceOrders = (input.serviceOrders || []).filter((order) => !internalUsers.has(String(order.user_id || '')) && isSuccessfulCommerceStatus(order.status))
  const allCommerceOrders = [...productOrders, ...smsOrders, ...serviceOrders]
  const ordersInWindow = (start: Date, end: Date) => allCommerceOrders.filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= start && created < end
  })
  const eventsInWindow = (start: Date, end: Date) => trustedEvents.filter((event) => {
    const created = dateOrNull(event.created_at)
    return created && created >= start && created < end
  })
  const currentOrders = ordersInWindow(current7Start, now)
  const previousOrders = ordersInWindow(previous7Start, current7Start)
  const currentEvents = eventsInWindow(current7Start, now)
  const previousEvents = eventsInWindow(previous7Start, current7Start)
  const currentVisitors = new Set(currentEvents.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size
  const previousVisitors = new Set(previousEvents.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size
  const currentRevenue = currentOrders.reduce((sum, order) => sum + toNumber(order.amount), 0)
  const previousRevenue = previousOrders.reduce((sum, order) => sum + toNumber(order.amount), 0)
  const currentConversion = currentVisitors > 0 ? currentOrders.length / currentVisitors : 0
  const previousConversion = previousVisitors > 0 ? previousOrders.length / previousVisitors : 0
  const currentAov = currentOrders.length > 0 ? currentRevenue / currentOrders.length : 0
  const previousAov = previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0
  const monthlyOrders = allCommerceOrders.filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= monthStart && created <= now
  })
  const monthlyRevenue = monthlyOrders.reduce((sum, order) => sum + toNumber(order.amount), 0)
  const elapsedMonthDays = Math.max(1, (now.getTime() - monthStart.getTime()) / dayMs)
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const medianForecast = Math.round((monthlyRevenue / elapsedMonthDays) * monthDays)
  const lowerForecast = Math.round(medianForecast * 0.88)
  const upperForecast = Math.round(medianForecast * 1.12)
  const targetProbability = input.monthlyTarget > 0 ? clamp((medianForecast - lowerForecast) / Math.max(1, upperForecast - lowerForecast)) : null

  const productStats = new Map<string, { revenue: number; units: number; orders: number; views: number; clicks: number; reversals: number }>()
  for (const order of productOrders) {
    const created = dateOrNull(order.created_at)
    if (!created || created < new Date(now.getTime() - 30 * dayMs)) continue
    const productId = String(order.product_group_id || '')
    if (!productId) continue
    const stats = productStats.get(productId) || { revenue: 0, units: 0, orders: 0, views: 0, clicks: 0, reversals: 0 }
    stats.revenue += toNumber(order.amount)
    stats.units += orderQuantity(order)
    stats.orders += 1
    productStats.set(productId, stats)
  }
  for (const event of trustedEvents) {
    const created = dateOrNull(event.created_at)
    if (!created || created < new Date(now.getTime() - 30 * dayMs)) continue
    const productId = String(event.product_group_id || '')
    if (!productId) continue
    const stats = productStats.get(productId) || { revenue: 0, units: 0, orders: 0, views: 0, clicks: 0, reversals: 0 }
    if (event.event_type === 'PRODUCT_VIEWED' || event.event_type === 'PRODUCT_IMPRESSION') stats.views += 1
    if (event.event_type === 'PRODUCT_CLICKED' || event.event_type === 'BUY_CLICKED') stats.clicks += 1
    if (event.event_type === 'PRODUCT_PURCHASE_REVERSED') stats.reversals += 1
    productStats.set(productId, stats)
  }

  const trafficChange = previousVisitors > 0 ? (currentVisitors - previousVisitors) / previousVisitors : 0
  const conversionChange = previousConversion > 0 ? (currentConversion - previousConversion) / previousConversion : 0
  const aovChange = previousAov > 0 ? (currentAov - previousAov) / previousAov : 0
  const driver = [
    { key: 'traffic', value: trafficChange },
    { key: 'conversion', value: conversionChange },
    { key: 'purchase_value', value: aovChange },
  ].sort((a, b) => a.value - b.value)[0]
  const revenueDriver = previousRevenue > 0 && driver.value < -0.08 ? driver.key : 'balanced'

  const featureSnapshots: RevenueFeatureSnapshot[] = [
    {
      snapshot_key: `store:maintenance:${isoHour(now)}`,
      scope_type: 'store',
      scope_id: 'maintenance',
      window_start: current7Start.toISOString(),
      window_end: now.toISOString(),
      features: {
        current_revenue_7d: currentRevenue,
        previous_revenue_7d: previousRevenue,
        current_visitors_7d: currentVisitors,
        previous_visitors_7d: previousVisitors,
        current_conversion_7d: currentConversion,
        previous_conversion_7d: previousConversion,
        current_aov_7d: currentAov,
        previous_aov_7d: previousAov,
        completed_product_orders_7d: currentOrders.filter((order) => order.commerce_source === 'products' || !order.commerce_source).length,
        completed_sms_orders_7d: currentOrders.filter((order) => order.commerce_source === 'sms').length,
        completed_service_orders_7d: currentOrders.filter((order) => order.commerce_source && !['products', 'sms'].includes(String(order.commerce_source))).length,
        revenue_driver: revenueDriver,
        source: 'scheduled_maintenance',
      },
    },
    {
      snapshot_key: 'store:maintenance:last',
      scope_type: 'store',
      scope_id: 'maintenance',
      window_start: current7Start.toISOString(),
      window_end: now.toISOString(),
      features: {
        current_revenue_7d: currentRevenue,
        current_visitors_7d: currentVisitors,
        current_conversion_7d: currentConversion,
        completed_commerce_orders_7d: currentOrders.length,
        open_products: input.products.filter(productIsSellable).length,
        source: 'scheduled_maintenance',
      },
    },
  ]

  const commerceSectionForOrder = (order: any) => {
    const source = String(order.commerce_source || '').toLowerCase()
    if (source) return source
    return order.product_group_id ? 'products' : 'unknown'
  }
  const orders30 = allCommerceOrders.filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= window30Start && created <= now
  })
  const commerceSections = [...new Set(orders30.map(commerceSectionForOrder).filter((section) => section !== 'unknown'))]
  for (const section of commerceSections) {
    const sectionOrders30 = orders30.filter((order) => commerceSectionForOrder(order) === section)
    const sectionOrders7 = currentOrders.filter((order) => commerceSectionForOrder(order) === section)
    const previousSectionOrders7 = previousOrders.filter((order) => commerceSectionForOrder(order) === section)
    const sectionRevenue30 = sectionOrders30.reduce((sum, order) => sum + toNumber(order.amount), 0)
    const sectionRevenue7 = sectionOrders7.reduce((sum, order) => sum + toNumber(order.amount), 0)
    const previousSectionRevenue7 = previousSectionOrders7.reduce((sum, order) => sum + toNumber(order.amount), 0)
    const sectionCustomers30 = new Set(sectionOrders30.map((order) => order.user_id).filter(Boolean))
    const sectionBuyerCounts = new Map<string, number>()
    for (const order of sectionOrders30) {
      if (!order.user_id) continue
      sectionBuyerCounts.set(order.user_id, (sectionBuyerCounts.get(order.user_id) || 0) + 1)
    }

    featureSnapshots.push({
      snapshot_key: `commerce_section:${section}:maintenance:30d`,
      scope_type: 'commerce_section',
      scope_id: section,
      window_start: window30Start.toISOString(),
      window_end: now.toISOString(),
      features: {
        section: section,
        revenue_30d: Math.round(sectionRevenue30),
        orders_30d: sectionOrders30.length,
        unique_customers_30d: sectionCustomers30.size,
        repeat_customers_30d: [...sectionBuyerCounts.values()].filter((count) => count > 1).length,
        average_order_value_30d: sectionOrders30.length > 0 ? sectionRevenue30 / sectionOrders30.length : 0,
        revenue_7d: Math.round(sectionRevenue7),
        previous_revenue_7d: Math.round(previousSectionRevenue7),
        orders_7d: sectionOrders7.length,
        previous_orders_7d: previousSectionOrders7.length,
        revenue_change_7d: previousSectionRevenue7 > 0
          ? (sectionRevenue7 - previousSectionRevenue7) / previousSectionRevenue7
          : sectionRevenue7 > 0 ? 1 : 0,
        order_change_7d: previousSectionOrders7.length > 0
          ? (sectionOrders7.length - previousSectionOrders7.length) / previousSectionOrders7.length
          : sectionOrders7.length > 0 ? 1 : 0,
        source: 'scheduled_maintenance',
      },
    })
  }

  for (const [productId, stats] of [...productStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 100)) {
    const product = productById.get(productId)
    const stockCount = toNumber(product?.stock_count)
    const stockVelocityDaily = stats.units / 30
    const daysOfInventory = stockVelocityDaily > 0 ? stockCount / stockVelocityDaily : null
    featureSnapshots.push({
      snapshot_key: `product:${productId}:maintenance:30d`,
      scope_type: 'product',
      scope_id: productId,
      window_start: new Date(now.getTime() - 30 * dayMs).toISOString(),
      window_end: now.toISOString(),
      features: {
        revenue_30d: stats.revenue,
        units_30d: stats.units,
        orders_30d: stats.orders,
        views_30d: stats.views,
        clicks_30d: stats.clicks,
        conversion_proxy: stats.views > 0 ? stats.orders / stats.views : null,
        revenue_per_view: stats.views > 0 ? stats.revenue / stats.views : 0,
        revenue_per_click: stats.clicks > 0 ? stats.revenue / stats.clicks : 0,
        reversal_count: stats.reversals,
        reversal_rate: stats.orders > 0 ? stats.reversals / stats.orders : 0,
        stock_count: stockCount,
        stock_velocity_daily: stockVelocityDaily,
        days_of_inventory: daysOfInventory,
        price: toNumber(product?.price),
        category_price_percentile: categoryPricePercentile(product),
        is_sellable: product ? productIsSellable(product) : false,
      },
    })
  }

  const opportunities: CroOpportunity[] = []
  const paymentFailures = currentEvents.filter((event) => event.event_type === 'PAYMENT_FAILED').length
  const paymentStarts = currentEvents.filter((event) => event.event_type === 'PAYMENT_STARTED').length
  const paymentFailureRate = paymentStarts > 0 ? paymentFailures / paymentStarts : 0
  if (paymentStarts >= 5 && paymentFailureRate >= 0.15) {
    opportunities.push({
      opportunity_key: `maintenance:payment_failure:${isoHour(now)}`,
      type: 'PAYMENT_FUNNEL_FAILURE_RATE',
      scope: 'checkout',
      expected_value: Math.round(currentRevenue * paymentFailureRate),
      confidence: clamp(0.45 + paymentStarts / 100),
      risk: 0.12,
      effort: 0.25,
      priority: clamp(paymentFailureRate * 10, 0, 10),
      status: 'open',
      evidence: { payment_starts: paymentStarts, payment_failures: paymentFailures, payment_failure_rate: paymentFailureRate },
    })
  }

  if (revenueDriver !== 'balanced') {
    opportunities.push({
      opportunity_key: `maintenance:revenue_driver:${revenueDriver}:${isoHour(now)}`,
      type: `REVENUE_DRIVER_${String(revenueDriver).toUpperCase()}_GAP`,
      scope: 'store',
      expected_value: Math.round(Math.max(0, previousRevenue - currentRevenue)),
      confidence: 0.66,
      risk: 0.18,
      effort: 0.2,
      priority: clamp(Math.abs(driver.value) * 6, 1, 8),
      status: 'open',
      evidence: { revenue_driver: revenueDriver, traffic_change: trafficChange, conversion_change: conversionChange, aov_change: aovChange },
    })
  }

  for (const [productId, stats] of [...productStats.entries()].sort((a, b) => b[1].units - a[1].units).slice(0, 10)) {
    const product = productById.get(productId)
    if (!product) continue
    const stock = toNumber(product.stock_count)
    if (stats.units >= 3 && stock <= Math.max(2, Math.ceil(stats.units / 7))) {
      opportunities.push({
        opportunity_key: `maintenance:low_stock:${productId}:${isoHour(now)}`,
        type: 'TOP_PRODUCT_LOW_STOCK',
        scope: `product:${productId}`,
        expected_value: Math.round((stats.revenue / Math.max(1, stats.units)) * Math.max(1, Math.ceil(stats.units / 7))),
        confidence: 0.74,
        risk: 0.08,
        effort: 0.15,
        priority: 7,
        status: 'open',
        evidence: { product_id: productId, units_30d: stats.units, stock_count: stock },
      })
    }
  }

  const forecast = {
    forecast_key: `revenue:monthly:${now.toISOString().slice(0, 7)}:maintenance:${now.toISOString().slice(8, 10)}`,
    period_start: monthStart.toISOString(),
    period_end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
    metric: 'revenue',
    median_value: medianForecast,
    lower_bound: lowerForecast,
    upper_bound: upperForecast,
    probability_to_target: targetProbability,
    method: 'DETERMINISTIC_TRAILING_RATE',
    evidence: { monthly_revenue: monthlyRevenue, elapsed_month_days: elapsedMonthDays, target: input.monthlyTarget },
  }

  return { featureSnapshots, opportunities, forecasts: [forecast], currentConversion, previousConversion, currentRevenue, previousRevenue }
}

function actionPlansFromOpportunities(opportunities: CroOpportunity[]) {
  return opportunities.map((opportunity) => {
    const actionType = actionTypeForOpportunity(opportunity.type)
    const manuallyApprovedActions = ['DIAGNOSE_FUNNEL', 'RESTOCK_PRODUCT', 'AUDIT_TRAFFIC_SOURCE', 'CHANGE_PROMOTION_EXPOSURE']
    const safeToAutoRun = opportunity.confidence >= 0.75 && opportunity.risk <= 0.25 && !manuallyApprovedActions.includes(actionType)
    return {
      action_key: `action:${opportunity.opportunity_key}:${actionType}`,
      opportunity_key: opportunity.opportunity_key,
      action_type: actionType,
      surface: surfaceForActionPlan(actionType, opportunity.scope),
      scope: opportunity.scope,
      status: 'proposed',
      priority: opportunity.priority,
      expected_value: opportunity.expected_value,
      confidence: opportunity.confidence,
      risk: opportunity.risk,
      guardrails: {
        approved_action_vocabulary_only: true,
        no_arbitrary_code_changes: true,
        no_invented_products: true,
        no_invented_prices: true,
        requires_admin_approval: !safeToAutoRun,
        safe_to_auto_run: safeToAutoRun,
        generated_by: 'scheduled_maintenance',
        ...promotionActionGuardrails(actionType),
      },
      payload: {
        intervention_type: actionType,
        surface: surfaceForActionPlan(actionType, opportunity.scope),
        scope: opportunity.scope,
        source_opportunity_type: opportunity.type,
        ...(actionType === 'CHANGE_PROMOTION_EXPOSURE'
          ? {
              permitted_operation: 'promotion_exposure_only',
              cannot_create_discount_code: true,
              cannot_change_price: true,
              cannot_fabricate_scarcity_or_timers: true,
            }
          : {}),
      },
      evidence: opportunity.evidence,
      updated_at: new Date().toISOString(),
    }
  })
}

function classifyLifecycle(customerOrders: any[], profileCreatedAt: string | null, now: Date) {
  const sorted = customerOrders
    .slice()
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
  const created = dateOrNull(profileCreatedAt)
  const daysSinceSignup = created ? (now.getTime() - created.getTime()) / 86400000 : null
  if (sorted.length === 0) return daysSinceSignup != null && daysSinceSignup <= 14 ? 'NEW' : 'LAPSED'
  const lastOrderDate = dateOrNull(sorted.at(-1)?.created_at)
  const daysSinceLast = lastOrderDate ? (now.getTime() - lastOrderDate.getTime()) / 86400000 : 999
  if (sorted.length === 1 && daysSinceLast <= 14) return 'FIRST_PURCHASE'
  if (daysSinceLast <= 30) return sorted.length >= 3 ? 'REPEAT' : 'ACTIVE'
  if (daysSinceLast <= 60) return 'COOLING'
  if (daysSinceLast <= 120) return 'AT_RISK'
  return 'LAPSED'
}

function buildLifecycleActions(input: {
  orders: any[]
  products: ProductGroup[]
  profiles: any[]
  communicationPreferences?: any[]
  existingLifecycleActions?: any[]
  now: Date
}) {
  const now = input.now
  const productRevenue = new Map<string, number>()
  for (const order of input.orders.filter((row) => isSuccessfulCommerceStatus(row.status))) {
    const productId = String(order.product_group_id || '')
    if (!productId) continue
    productRevenue.set(productId, (productRevenue.get(productId) || 0) + toNumber(order.amount))
  }
  const fallbackProductId = [...productRevenue.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const prefsByUser = new Map((input.communicationPreferences || []).map((row) => [String(row.user_id), row]))
  const existingActionsByUser = new Map<string, any[]>()
  for (const action of input.existingLifecycleActions || []) {
    const userId = String(action.user_id || '')
    if (!userId) continue
    existingActionsByUser.set(userId, [...(existingActionsByUser.get(userId) || []), action])
  }
  const ordersByUser = new Map<string, any[]>()
  for (const order of input.orders.filter((row) => row.user_id && isSuccessfulCommerceStatus(row.status))) {
    ordersByUser.set(String(order.user_id), [...(ordersByUser.get(String(order.user_id)) || []), order])
  }

  const rows: any[] = []
  for (const profile of input.profiles) {
    if (profile.is_admin || profile.is_staff) continue
    const userId = String(profile.id || '')
    if (!userId) continue
    const customerOrders = ordersByUser.get(userId) || []
    const stage = classifyLifecycle(customerOrders, profile.created_at || null, now)
    const lastOrder = customerOrders.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
    const revenue = customerOrders.reduce((sum, order) => sum + toNumber(order.amount), 0)
    const avgOrder = customerOrders.length > 0 ? revenue / customerOrders.length : 0
    const lastProductId = lastOrder?.product_group_id || fallbackProductId
    const dayKey = now.toISOString().slice(0, 10)
    let recommendedAction = 'NO_OFFER'
    let reason = 'no lifecycle action is commercially appropriate yet'
    let expectedValue = 0
    let confidence = 0.35

    if (stage === 'FIRST_PURCHASE') {
      recommendedAction = 'FIRST_PURCHASE_FOLLOWUP'
      reason = 'first purchase customer eligible for measured next-purchase follow-up'
      expectedValue = Math.round(Math.max(avgOrder * 0.12, 1))
      confidence = 0.52
    } else if (stage === 'COOLING') {
      recommendedAction = 'COOLING_REACTIVATION'
      reason = 'customer buying interval is cooling compared with recent activity'
      expectedValue = Math.round(Math.max(avgOrder * 0.16, 1))
      confidence = 0.55
    } else if (stage === 'AT_RISK') {
      recommendedAction = 'AT_RISK_REACTIVATION'
      reason = 'customer is at risk and should only receive permissioned reactivation'
      expectedValue = Math.round(Math.max(avgOrder * 0.18, 1))
      confidence = 0.58
    } else if (stage === 'LAPSED' && customerOrders.length > 0) {
      recommendedAction = 'LAPSED_REACTIVATION'
      reason = 'previous buyer has lapsed and requires consent before outbound contact'
      expectedValue = Math.round(Math.max(avgOrder * 0.1, 1))
      confidence = 0.44
    }

    if (recommendedAction === 'NO_OFFER') continue
    const prefs = prefsByUser.get(userId) as any
    const hasLifecycleEmailConsent = prefs?.email_lifecycle_opt_in === true
    const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email || ''))
    const existingUserActions = existingActionsByUser.get(userId) || []
    const recentLifecyclePressure = existingUserActions.filter((action) => {
      const created = dateOrNull(action.updated_at || action.created_at)
      const status = String(action.status || '').toLowerCase()
      return created && (now.getTime() - created.getTime()) <= 30 * 86400000 && ['needs_consent', 'queued', 'approved', 'sent'].includes(status)
    })
    const recentOpenOrSent = existingUserActions.find((action) => {
      const created = dateOrNull(action.updated_at || action.created_at)
      const status = String(action.status || '').toLowerCase()
      return created && (now.getTime() - created.getTime()) <= 14 * 86400000 && ['needs_consent', 'queued', 'approved', 'sent'].includes(status)
    })
    if (recentOpenOrSent) continue
    const lifecyclePressureScore = Math.min(20, recentLifecyclePressure.length * 4)

    rows.push({
      action_key: `lifecycle:${userId}:${recommendedAction}:${dayKey}`,
      user_id: userId,
      lifecycle_stage: stage,
      recommended_action: recommendedAction,
      channel: 'email',
      status: hasLifecycleEmailConsent && hasValidEmail ? 'queued' : 'needs_consent',
      requires_consent: true,
      product_group_id: lastProductId || null,
      expected_value: expectedValue,
      confidence,
      pressure_score: lifecyclePressureScore,
      reason,
      evidence: {
        generated_by: 'scheduled_maintenance',
        orders: customerOrders.length,
        revenue,
        avg_order_value: avgOrder,
        last_order_at: lastOrder?.created_at || null,
        consent_present: hasLifecycleEmailConsent,
        outbound_email_available: hasValidEmail,
        lifecycle_frequency_cap_days: 14,
        lifecycle_pressure_score: lifecyclePressureScore,
        recent_lifecycle_actions_30d: recentLifecyclePressure.length,
        guardrails: ['requires_consent', 'admin_review_before_send', 'no_secret_data', 'no_fake_urgency', 'frequency_cap_14d'],
      },
      updated_at: now.toISOString(),
    })
  }

  return rows
}

async function upsertActionPlans(supabase: SupabaseAdmin, actionPlans: any[]) {
  if (actionPlans.length === 0) return
  const keys = actionPlans.map((plan) => plan.action_key)
  const { data: existingRows, error: existingError } = await supabase
    .from('cro_action_plans')
    .select('action_key,status,evidence')
    .in('action_key', keys)
  if (existingError) throw existingError
  const existingByKey = new Map((existingRows || []).map((row: any) => [String(row.action_key), row]))
  const protectedStatuses = new Set(['approved', 'running', 'paused', 'completed', 'rejected'])
  const rows = actionPlans.map((plan) => {
    const existing = existingByKey.get(plan.action_key) as any
    return {
      ...plan,
      status: existing && protectedStatuses.has(String(existing.status || '').toLowerCase()) ? existing.status : plan.status,
      evidence: {
        ...(existing?.evidence && typeof existing.evidence === 'object' ? existing.evidence : {}),
        ...plan.evidence,
        regenerated_by: 'scheduled_maintenance',
        regenerated_at: new Date().toISOString(),
      },
    }
  })
  const { error } = await supabase.from('cro_action_plans').upsert(rows, { onConflict: 'action_key' })
  if (error) throw error
}

async function upsertLifecycleActions(supabase: SupabaseAdmin, actions: any[]) {
  if (actions.length === 0) return
  const { error } = await supabase
    .from('cro_lifecycle_actions')
    .upsert(actions, { onConflict: 'action_key' })
  if (error) throw error
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function featureValueColumns(value: unknown) {
  return {
    numeric_value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    text_value: typeof value === 'string' ? value : null,
    boolean_value: typeof value === 'boolean' ? value : null,
    json_value: value !== null && typeof value === 'object' ? value : null,
  }
}

function featureEntries(snapshot: any, source: string, now: Date) {
  return Object.entries(snapshot.features || {})
    .filter(([, value]) => value !== undefined)
    .map(([featureKey, value]) => ({
      feature_key: featureKey,
      ...featureValueColumns(value),
      confidence: typeof snapshot.features?.confidence === 'number' ? Number(snapshot.features.confidence) : 0.6,
      window_start: snapshot.window_start || snapshot.windowStart || null,
      window_end: snapshot.window_end || snapshot.windowEnd || now.toISOString(),
      source,
      updated_at: now.toISOString(),
    }))
}

async function upsertFeatureStoreSnapshots(supabase: SupabaseAdmin, snapshots: any[], source: string, now: Date) {
  const productRows: any[] = []
  const customerRows: any[] = []
  const sessionRows: any[] = []
  const businessRows: any[] = []

  for (const snapshot of snapshots) {
    const scopeType = String(snapshot.scope_type || snapshot.scopeType || '')
    const scopeId = String(snapshot.scope_id || snapshot.scopeId || 'global')
    const entries = featureEntries(snapshot, source, now)
    if (entries.length === 0) continue

    if (scopeType === 'product' && isUuid(scopeId)) {
      productRows.push(...entries.map((entry) => ({ ...entry, product_group_id: scopeId })))
    } else if (scopeType === 'customer') {
      customerRows.push(...entries.map((entry) => ({
        ...entry,
        subject_key: scopeId,
        user_id: isUuid(scopeId) ? scopeId : null,
        visitor_id: isUuid(scopeId) ? null : scopeId,
      })))
    } else if (scopeType === 'session') {
      sessionRows.push(...entries.map((entry) => ({ ...entry, session_id: scopeId })))
    } else {
      const scope = scopeType === 'store' ? 'store' : `${scopeType}:${scopeId}`
      businessRows.push(...entries.map((entry) => ({ ...entry, scope })))
    }
  }

  if (productRows.length > 0) {
    const { error } = await supabase.from('product_features').upsert(productRows, { onConflict: 'product_group_id,feature_key' })
    if (error) throw error
  }
  if (customerRows.length > 0) {
    const { error } = await supabase.from('customer_features').upsert(customerRows, { onConflict: 'subject_key,feature_key' })
    if (error) throw error
  }
  if (sessionRows.length > 0) {
    const { error } = await supabase.from('session_features').upsert(sessionRows, { onConflict: 'session_id,feature_key' })
    if (error) throw error
  }
  if (businessRows.length > 0) {
    const { error } = await supabase.from('business_features').upsert(businessRows, { onConflict: 'scope,feature_key' })
    if (error) throw error
  }
}

async function writeMaintenanceRecords(supabase: SupabaseAdmin, input: {
  findings: RevenueFinding[]
  featureSnapshots: any[]
  opportunities: CroOpportunity[]
  forecasts: any[]
  conversionDriftScore: number
  revenueDriftScore: number
  simulationRecommendation: 'insufficient_data' | 'safe' | 'watch' | 'pause'
  now: Date
}) {
  const writeFindings: RevenueFinding[] = []

  if (input.findings.length > 0) {
    const finding = await safeWrite(input.now, 'revenue_data_quality_checks', async () => {
      const { error } = await supabase.from('revenue_data_quality_checks').insert(input.findings)
      if (error) throw error
    })
    if (finding) writeFindings.push(finding)
  }

  if (input.featureSnapshots.length > 0) {
    const snapshotFinding = await safeWrite(input.now, 'revenue_feature_snapshots', async () => {
      const { error } = await supabase.from('revenue_feature_snapshots').upsert(
        input.featureSnapshots.map((snapshot) => ({
          ...snapshot,
          source: 'SCHEDULED_MAINTENANCE',
          updated_at: input.now.toISOString(),
        })),
        { onConflict: 'snapshot_key' },
      )
      if (error) throw error
    })
    if (snapshotFinding) writeFindings.push(snapshotFinding)

    const featureStoreFinding = await safeWrite(input.now, 'feature_store', async () => {
      await upsertFeatureStoreSnapshots(supabase, input.featureSnapshots, 'SCHEDULED_MAINTENANCE', input.now)
    })
    if (featureStoreFinding) writeFindings.push(featureStoreFinding)
  }

  if (input.opportunities.length > 0) {
    const finding = await safeWrite(input.now, 'cro_opportunities', async () => {
      const { error } = await supabase.from('cro_opportunities').upsert(
        input.opportunities.map((opportunity) => ({
          ...opportunity,
          updated_at: input.now.toISOString(),
        })),
        { onConflict: 'opportunity_key' },
      )
      if (error) throw error
    })
    if (finding) writeFindings.push(finding)
  }

  if (input.forecasts.length > 0) {
    const finding = await safeWrite(input.now, 'revenue_forecasts', async () => {
      const { error } = await supabase.from('revenue_forecasts').upsert(input.forecasts, { onConflict: 'forecast_key' })
      if (error) throw error
    })
    if (finding) writeFindings.push(finding)
  }

  const periodStart = new Date(input.now.getTime() - 7 * 86400000).toISOString()
  const periodEnd = input.now.toISOString()
  const driftRows = [
    {
      check_key: `maintenance:conversion:${isoHour(input.now)}`,
      model_key: 'conversion_monitor',
      period_start: periodStart,
      period_end: periodEnd,
      status: input.conversionDriftScore >= 0.45 ? 'drift' : input.conversionDriftScore >= 0.25 ? 'watch' : 'stable',
      drift_score: input.conversionDriftScore,
      evidence: { source: 'scheduled_maintenance' },
    },
    {
      check_key: `maintenance:revenue:${isoHour(input.now)}`,
      model_key: 'revenue_monitor',
      period_start: periodStart,
      period_end: periodEnd,
      status: input.revenueDriftScore >= 0.5 ? 'drift' : input.revenueDriftScore >= 0.25 ? 'watch' : 'stable',
      drift_score: input.revenueDriftScore,
      evidence: { source: 'scheduled_maintenance' },
    },
  ]
  const driftFinding = await safeWrite(input.now, 'cro_drift_checks', async () => {
    const { error: driftError } = await supabase.from('cro_drift_checks').upsert(driftRows, { onConflict: 'check_key' })
    if (driftError) throw driftError
  })
  if (driftFinding) writeFindings.push(driftFinding)

  const simulationFinding = await safeWrite(input.now, 'cro_simulation_runs', async () => {
    const { error: simulationError } = await supabase.from('cro_simulation_runs').upsert(
      {
        simulation_key: `maintenance:guardrail:${isoHour(input.now)}`,
        mode: 'guardrail',
        period_start: periodStart,
        period_end: periodEnd,
        sessions_evaluated: 0,
        decisions_evaluated: 0,
        violations: input.findings.filter((finding) => finding.status === 'failed' && finding.severity === 'critical'),
        concentration: {},
        recommendation: input.simulationRecommendation,
        evidence: { source: 'scheduled_maintenance' },
      },
      { onConflict: 'simulation_key' },
    )
    if (simulationError) throw simulationError
  })
  if (simulationFinding) writeFindings.push(simulationFinding)

  const modelFinding = await safeWrite(input.now, 'cro_model_registry', async () => {
    const { error: modelError } = await supabase.from('cro_model_registry').upsert(
      [
        {
          model_key: 'scheduled_revenue_os_maintenance',
          version: '1.0.0',
          model_type: 'deterministic_guardrail_scheduler',
          training_period: { mode: 'not_trained', reason: 'deterministic_rules' },
          features: [
            'catalogue_health',
            'duplicate_event_id',
            'missing_event_id',
            'unknown_event_type',
            'currency_consistency',
            'orphan_product_event',
            'unbacked_purchase_event_blocking',
            'duplicate_purchase_credit_detection',
            'payment_funnel',
            'provider_webhook_secrets',
            'pending_payment_recovery_health',
            'conversion_drift',
            'revenue_drift',
            'low_stock_velocity',
          ],
          performance: { last_run_at: input.now.toISOString(), simulation_recommendation: input.simulationRecommendation },
          deployment_state: 'active',
          rollback_to: null,
          updated_at: input.now.toISOString(),
        },
      ],
      { onConflict: 'model_key,version' },
    )
    if (modelError) throw modelError
  })
  if (modelFinding) writeFindings.push(modelFinding)

  return writeFindings
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['POST', 'GET'].includes(req.method)) return json({ success: false, error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  try {
    await requireAuthorized(req, supabase)
  } catch (response) {
    return response instanceof Response ? response : json({ success: false, error: 'Unauthorized' }, 401)
  }

  const now = new Date()
  const since = new Date(now.getTime() - 30 * 86400000)
  const maintenanceEnabled = await getSetting(supabase, 'cro_maintenance_enabled', 'true')
  if (maintenanceEnabled === 'false') {
    await upsertSetting(supabase, 'cro_maintenance_last_status', 'skipped_disabled')
    await upsertSetting(supabase, 'cro_maintenance_last_run_at', now.toISOString())
    return json({ success: true, skipped: true, reason: 'cro_maintenance_disabled' })
  }

  try {
    const [
      productsResult,
      categoriesResult,
      profilesResult,
      ordersResult,
      smsOrdersResult,
      billsResult,
      giftResult,
      socialResult,
      cryptoResult,
      pendingPaymentsResult,
      eventsResult,
      identityLinksResult,
      discountCodesResult,
      communicationPreferencesResult,
      existingLifecycleActionsResult,
      targetValue,
      ercasEnabledValue,
      promotionMaxDiscountValue,
      promotionMonthlyBudgetValue,
    ] = await Promise.all([
      safeRead<any[]>(now, 'product_groups', supabase.from('product_groups').select('*').limit(5000), []),
      safeRead<any[]>(now, 'categories', supabase.from('categories').select('id,name,is_active').limit(1000), []),
      safeRead<any[]>(now, 'profiles', supabase.from('profiles').select('id,email,is_admin,is_staff,created_at').limit(10000), []),
      safeRead<any[]>(now, 'orders', supabase.from('orders').select('id,user_id,product_group_id,amount,status,account_details,created_at').gte('created_at', since.toISOString()).limit(10000), []),
      safeRead<any[]>(now, 'sms_orders', supabase.from('sms_orders').select('id,user_id,amount_ngn,total_cost,status,created_at').gte('created_at', since.toISOString()).limit(10000), []),
      safeRead<any[]>(now, 'bills_transactions', supabase.from('bills_transactions').select('id,user_id,amount,status,created_at,transaction_type,service_provider').gte('created_at', since.toISOString()).limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'bitrefill_orders', supabase.from('bitrefill_orders').select('id,user_id,amount_ngn,status,created_at,product_id,product_name,quantity').gte('created_at', since.toISOString()).limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'smm_orders', supabase.from('smm_orders').select('id,user_id,amount_ngn,status,created_at,service_id,quantity').gte('created_at', since.toISOString()).limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'crypto_transactions', supabase.from('crypto_transactions').select('id,user_id,naira_amount,status,created_at,transaction_type,crypto_type').gte('created_at', since.toISOString()).limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'pending_payments', supabase.from('pending_payments').select('id,user_id,transaction_reference,amount,status,created_at,last_check_at,check_count,error_message').gte('created_at', new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString()).limit(10000), []),
      safeRead<any[]>(now, 'revenue_events', supabase.from('revenue_events').select('*').gte('created_at', since.toISOString()).limit(20000), []),
      safeRead<any[]>(now, 'revenue_identity_links', supabase.from('revenue_identity_links').select('user_id,visitor_id,session_id,last_seen_at').gte('last_seen_at', since.toISOString()).limit(20000), [], 'warning'),
      safeRead<any[]>(now, 'discount_codes', supabase.from('discount_codes').select('*').limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'customer_communication_preferences', supabase.from('customer_communication_preferences').select('user_id,email_lifecycle_opt_in,email_promotions_opt_in').limit(10000), [], 'warning'),
      safeRead<any[]>(now, 'cro_lifecycle_actions', supabase.from('cro_lifecycle_actions').select('id,action_key,user_id,status,updated_at,created_at').gte('created_at', new Date(now.getTime() - 30 * 86400000).toISOString()).limit(10000), [], 'warning'),
      getSetting(supabase, 'sales_monthly_target_ngn', '0'),
      getSetting(supabase, 'ercas_enabled', 'false'),
      getSetting(supabase, 'cro_promotion_max_discount_pct', '20'),
      getSetting(supabase, 'cro_promotion_monthly_budget_ngn', '0'),
    ])

    const dependencyFindings = [
      productsResult.finding,
      categoriesResult.finding,
      profilesResult.finding,
      ordersResult.finding,
      smsOrdersResult.finding,
      billsResult.finding,
      giftResult.finding,
      socialResult.finding,
      cryptoResult.finding,
      pendingPaymentsResult.finding,
      eventsResult.finding,
      identityLinksResult.finding,
      discountCodesResult.finding,
      communicationPreferencesResult.finding,
      existingLifecycleActionsResult.finding,
    ].filter(Boolean) as RevenueFinding[]

    const productRows = productsResult.data as ProductGroup[]
    const categoryRows = categoriesResult.data || []
    const profileRows = profilesResult.data || []
    const orderRows = (ordersResult.data || []).map((order: any) => ({ ...order, commerce_source: 'products' }))
    const smsOrderRows = (smsOrdersResult.data || []).map((order: any) => ({
      ...order,
      amount: toNumber(order.amount_ngn, toNumber(order.total_cost)),
      commerce_source: 'sms',
    }))
    const serviceOrderRows = normalizeServiceCommerceOrders({
      billsRows: billsResult.data || [],
      giftRows: giftResult.data || [],
      socialRows: socialResult.data || [],
      cryptoRows: cryptoResult.data || [],
    })
    const allCommerceOrderRows = [...orderRows, ...smsOrderRows, ...serviceOrderRows]
    const eventRows = eventsResult.data || []
    const identityLinkRows = identityLinksResult.data || []

    const findings = [
      ...dependencyFindings,
      ...buildCatalogueFindings(productRows, categoryRows),
      ...buildEventFindings({
        events: eventRows,
        orders: orderRows,
        smsOrders: smsOrderRows,
        serviceOrders: serviceOrderRows,
        products: productRows,
        profiles: profileRows,
        identityLinks: identityLinkRows,
        since,
        now,
      }),
      ...buildOperationalFindings({
        pendingPayments: pendingPaymentsResult.data || [],
        ercasEnabled: ercasEnabledValue === 'true',
        now,
      }),
      ...buildPromotionFindings({
        discountCodes: discountCodesResult.data || [],
        orders: orderRows,
        products: productRows,
        maxDiscountPct: toNumber(promotionMaxDiscountValue, 20),
        monthlyBudgetNgn: toNumber(promotionMonthlyBudgetValue, 0),
        now,
      }),
    ]
    const intelligence = buildRuntimeIntelligence({
      events: eventRows,
      orders: orderRows,
      smsOrders: smsOrderRows,
      serviceOrders: serviceOrderRows,
      products: productRows,
      categories: categoryRows,
      profiles: profileRows,
      identityLinks: identityLinkRows,
      monthlyTarget: toNumber(targetValue),
      now,
    })
    const actionPlans = actionPlansFromOpportunities(intelligence.opportunities)
    const lifecycleActions = buildLifecycleActions({
      orders: allCommerceOrderRows,
      products: productRows,
      profiles: profileRows,
      communicationPreferences: communicationPreferencesResult.data || [],
      existingLifecycleActions: existingLifecycleActionsResult.data || [],
      now,
    })
    const conversionDriftScore = intelligence.previousConversion > 0
      ? Math.abs(intelligence.currentConversion - intelligence.previousConversion) / intelligence.previousConversion
      : 0
    const revenueDriftScore = intelligence.previousRevenue > 0
      ? Math.abs(intelligence.currentRevenue - intelligence.previousRevenue) / intelligence.previousRevenue
      : 0
    let criticalFindings = findings.filter((finding) => finding.status === 'failed' && finding.severity === 'critical')
    const simulationRecommendation = criticalFindings.length > 0 || revenueDriftScore >= 0.65 || conversionDriftScore >= 0.65
      ? 'pause'
      : revenueDriftScore >= 0.35 || conversionDriftScore >= 0.35
        ? 'watch'
        : 'safe'
    let freezeReason = criticalFindings.length > 0
      ? `${criticalFindings.length} critical scheduled data-quality issue(s)`
      : simulationRecommendation === 'pause'
        ? `scheduled drift guardrail: revenue=${revenueDriftScore.toFixed(2)}, conversion=${conversionDriftScore.toFixed(2)}`
        : ''

    const writeFindings = await writeMaintenanceRecords(supabase, {
      findings,
      featureSnapshots: intelligence.featureSnapshots,
      opportunities: intelligence.opportunities,
      forecasts: intelligence.forecasts,
      conversionDriftScore,
      revenueDriftScore,
      simulationRecommendation,
      now,
    })
    if (writeFindings.length > 0) {
      findings.push(...writeFindings)
      criticalFindings = findings.filter((finding) => finding.status === 'failed' && finding.severity === 'critical')
      if (!freezeReason && criticalFindings.length > 0) {
        freezeReason = `${criticalFindings.length} critical scheduled maintenance dependency issue(s)`
      }
    }

    const actionPlansToWrite = freezeReason ? [] : actionPlans
    const lifecycleActionsToWrite = freezeReason ? [] : lifecycleActions
    if (actionPlansToWrite.length > 0) {
      const finding = await safeWrite(now, 'cro_action_plans', () => upsertActionPlans(supabase, actionPlansToWrite))
      if (finding) {
        findings.push(finding)
        criticalFindings = findings.filter((item) => item.status === 'failed' && item.severity === 'critical')
        if (!freezeReason) freezeReason = `${criticalFindings.length} critical scheduled maintenance dependency issue(s)`
      }
    }
    if (lifecycleActionsToWrite.length > 0) {
      const finding = await safeWrite(now, 'cro_lifecycle_actions', () => upsertLifecycleActions(supabase, lifecycleActionsToWrite))
      if (finding) {
        findings.push(finding)
        criticalFindings = findings.filter((item) => item.status === 'failed' && item.severity === 'critical')
        if (!freezeReason) freezeReason = `${criticalFindings.length} critical scheduled maintenance dependency issue(s)`
      }
    }

    if (freezeReason) {
      await upsertSetting(supabase, 'cro_global_enabled', 'false')
      await upsertSetting(supabase, 'cro_maintenance_freeze_reason', freezeReason)
    } else {
      await upsertSetting(supabase, 'cro_maintenance_freeze_reason', '')
    }

    const summary = {
      findings: findings.length,
      critical_findings: criticalFindings.length,
      dependency_findings: dependencyFindings.length,
      maintenance_write_failures: writeFindings.length,
      feature_snapshots: intelligence.featureSnapshots.length,
      opportunities: intelligence.opportunities.length,
      action_plans: actionPlansToWrite.length,
      lifecycle_actions: lifecycleActionsToWrite.length,
      skipped_action_plans_due_to_freeze: freezeReason ? actionPlans.length : 0,
      skipped_lifecycle_actions_due_to_freeze: freezeReason ? lifecycleActions.length : 0,
      forecasts: intelligence.forecasts.length,
      simulation_recommendation: simulationRecommendation,
      revenue_drift_score: revenueDriftScore,
      conversion_drift_score: conversionDriftScore,
      freeze_reason: freezeReason,
    }

    await Promise.all([
      upsertSetting(supabase, 'cro_maintenance_last_run_at', now.toISOString()),
      upsertSetting(supabase, 'cro_maintenance_last_status', freezeReason ? 'paused_cro' : 'ok'),
      upsertSetting(supabase, 'cro_maintenance_last_summary', JSON.stringify(summary)),
    ])

    return json({ success: true, summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Revenue OS maintenance failed'
    await Promise.all([
      upsertSetting(supabase, 'cro_maintenance_last_run_at', now.toISOString()).catch(() => null),
      upsertSetting(supabase, 'cro_maintenance_last_status', 'failed').catch(() => null),
      upsertSetting(supabase, 'cro_maintenance_last_summary', JSON.stringify({ error: message })).catch(() => null),
    ])
    return json({ success: false, error: message }, 500)
  }
})
