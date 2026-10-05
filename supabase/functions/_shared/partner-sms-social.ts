/** Paid partner adapters. The caller must reserve an external-order journal entry
 * and claim its one dispatch before calling plan.dispatch(). No adapter retries. */

export type PartnerExternalOutcome =
  | { kind: 'accepted'; source: 'daisy' | 'smm'; id: string; status: 'active' | 'processing' | 'completed'; payload: Record<string, unknown> }
  | { kind: 'rejected'; reason: 'NO_STOCK' | 'INSUFFICIENT_BALANCE' | 'PRICE_CHANGED' | 'INVALID_RECIPIENT' }
  | { kind: 'unknown' }

export type PartnerPurchasePlan = {
  section: 'sms' | 'social_boost'
  itemId: string
  itemName: string
  quantity: number
  amountNgn: number
  requestPayload: Record<string, unknown>
  dispatch: (orderId: string) => Promise<PartnerExternalOutcome>
}

type Admin = any
type Partner = { markup_percent?: unknown }
type Body = Record<string, unknown>
type Transport = { fetchImpl?: typeof fetch; env?: (name: string) => string | undefined; timeoutMs?: number }
type SmsDeps = Transport & {
  smsCatalogue: (admin: Admin, partner: Partner) => Promise<any[]>
  getNgnUsdRate: (admin: Admin) => Promise<number>
}
type SocialDeps = Transport & {
  // Kept for the caller's dependency contract; paid parameters are constructed
  // here because the legacy helper omits required fields for some types.
  smmOrderParams: (service: any, body: Body, qty: number) => Record<string, string | number>
  SMM_TYPES_WITH_QUANTITY: readonly string[]
}

const DAISY_URL = 'https://daisysms.com/stubs/handler_api.php'
const SMM_URL = 'https://thelordofthepanels.com/api/v2'
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 30_000
const SMM_REQUIRED: Record<string, readonly string[]> = {
  Default: ['link', 'quantity'], Package: ['link'],
  'Custom Comments': ['link', 'comments'], 'Custom Comments Package': ['link', 'comments'],
  Mentions: ['link', 'quantity', 'usernames'],
  'Mentions with Hashtags': ['link', 'quantity', 'usernames', 'hashtags'],
  'Mentions Custom List': ['link', 'usernames'],
  'Mentions Hashtag': ['link', 'quantity', 'hashtag'],
  'Mentions User Followers': ['link', 'quantity', 'username'],
  'Mentions Media Likers': ['link', 'quantity', 'media'],
  'Comment Likes': ['link', 'quantity', 'username'],
  'Comment Replies': ['link', 'username', 'comments'],
  Poll: ['link', 'quantity', 'answer_number'],
  'Invites from Groups': ['link', 'quantity', 'groups'],
  SEO: ['link', 'keywords'],
}
const EXTRA_FIELDS = ['comments', 'usernames', 'username', 'hashtags', 'hashtag', 'keywords', 'groups'] as const

function env(deps: Transport, name: string): string {
  const deno = (globalThis as typeof globalThis & { Deno?: { env: { get: (name: string) => string | undefined } } }).Deno
  return deps.env ? deps.env(name) || '' : deno?.env.get(name) || ''
}

function timeout(deps: Transport): AbortSignal {
  const ms = deps.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : deps.timeoutMs
  return AbortSignal.timeout(Number.isInteger(ms) && ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : DEFAULT_TIMEOUT_MS)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value.trim() : ''
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function amount(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(Math.round(n * 100)) && Math.abs(Math.round(n * 100) - n * 100) < 0.00001 ? n : null
}

function markedAmount(partner: Partner, base: number): number | null {
  const markup = partner.markup_percent == null ? 0 : Number(partner.markup_percent)
  if (!Number.isFinite(markup) || markup < 0 || markup > 10_000) return null
  const basisPoints = Math.round(markup * 100)
  if (Math.abs(basisPoints / 100 - markup) > 0.000001) return null
  const numerator = base * (10_000 + basisPoints)
  if (!Number.isSafeInteger(numerator)) return null
  return amount(Math.ceil(numerator / 10_000))
}

function fail(message: string): never { throw new Error(message) }

export async function preparePartnerSmsPlan(admin: Admin, partner: Partner, body: Body, deps: SmsDeps): Promise<PartnerPurchasePlan> {
  const serviceCode = text(body.item_id ?? body.service_id, 40)
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(serviceCode)) fail('Invalid SMS service')
  if (body.quantity !== undefined && positiveInteger(body.quantity) !== 1) fail('SMS quantity must be 1')
  const catalogue = await deps.smsCatalogue(admin, partner)
  const item = catalogue.find((entry) => entry.id === serviceCode)
  if (!item || item.live_verified !== true || item.availability !== 'available' || Number(item.stock?.available_quantity) <= 0) fail('SMS service is unavailable')
  const price = amount(item.price_ngn)
  const providerCostUsd = Number(item.provider_cost_usd)
  const rate = Number(await deps.getNgnUsdRate(admin))
  if (!price || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(providerCostUsd) || providerCostUsd <= 0) fail('SMS quote is unavailable')
  const maxUsd = Math.floor(Math.min(providerCostUsd, price / rate) * 10000) / 10000
  if (!Number.isFinite(maxUsd) || maxUsd < 0.01) fail('SMS quote is unavailable')
  const name = text(item.name, 180) || serviceCode
  const maxPrice = maxUsd.toFixed(4)

  return {
    section: 'sms', itemId: serviceCode, itemName: name, quantity: 1, amountNgn: price,
    requestPayload: { item_id: serviceCode, quantity: 1 },
    async dispatch(_orderId: string): Promise<PartnerExternalOutcome> {
      const key = env(deps, 'DAISYSMS_API_KEY')
      if (!key) return { kind: 'unknown' }
      const url = new URL(DAISY_URL)
      url.searchParams.set('api_key', key)
      url.searchParams.set('action', 'getNumber')
      url.searchParams.set('service', serviceCode)
      url.searchParams.set('max_price', maxPrice)
      try {
        const response = await (deps.fetchImpl || fetch)(url, {
          method: 'GET', headers: { Accept: 'text/plain' }, redirect: 'error', cache: 'no-store', signal: timeout(deps),
        })
        if (!response.ok) return { kind: 'unknown' }
        const result = (await response.text()).trim()
        const match = /^ACCESS_NUMBER:([1-9]\d*):([1-9]\d{6,16})$/.exec(result)
        if (match) return {
          kind: 'accepted', source: 'daisy', id: match[1], status: 'active',
          payload: { service_name: name, phone_number: `+${match[2]}`, raw_phone_number: match[2], provider_order_id: match[1] },
        }
        if (result === 'NO_NUMBERS') return { kind: 'rejected', reason: 'NO_STOCK' }
        if (result === 'NO_MONEY') return { kind: 'rejected', reason: 'INSUFFICIENT_BALANCE' }
        if (result === 'MAX_PRICE_EXCEEDED') return { kind: 'rejected', reason: 'PRICE_CHANGED' }
        return { kind: 'unknown' }
      } catch {
        return { kind: 'unknown' }
      }
    },
  }
}

export async function preparePartnerSocialPlan(admin: Admin, partner: Partner, body: Body, deps: SocialDeps): Promise<PartnerPurchasePlan> {
  const serviceId = text(body.item_id ?? body.service_id, 80)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId)) fail('Invalid Social Boost service')
  const { data: service, error } = await admin.from('smm_services').select('id, external_id, name, service_type, price_ngn, rate_usd, min_quantity, max_quantity, is_active').eq('id', serviceId).eq('is_active', true).maybeSingle()
  if (error || !service || service.is_active === false) fail('Social Boost service is unavailable')
  const serviceType = text(service.service_type, 100)
  const required = SMM_REQUIRED[serviceType]
  if (!required) fail('Unsupported Social Boost service type')
  const externalId = positiveInteger(service.external_id)
  const unitPrice = amount(service.price_ngn)
  const providerRate = Number(service.rate_usd)
  if (!externalId || !unitPrice || !Number.isFinite(providerRate) || providerRate < 0) fail('Social Boost quote is unavailable')
  const min = positiveInteger(service.min_quantity)
  const max = positiveInteger(service.max_quantity)
  if (!min || !max || max < min) fail('Social Boost limits are unavailable')
  const perThousand = deps.SMM_TYPES_WITH_QUANTITY.includes(serviceType)
  const providerQuantity = required.includes('quantity')
  const quantity = providerQuantity ? positiveInteger(body.quantity ?? min) : 1
  if (!quantity || (providerQuantity && (quantity < min || quantity > max))) fail('Invalid Social Boost quantity')
  if (!providerQuantity && body.quantity !== undefined && positiveInteger(body.quantity) !== 1) fail('Fixed-price Social Boost quantity must be 1')
  // Poll is documented as quantity-bearing although the legacy catalogue marks
  // it fixed-price. Never send more than one price unit on that fixed quote.
  if (providerQuantity && !perThousand && quantity > 1000) fail('Social Boost quantity exceeds fixed quote')

  const selected: Body = {}
  const link = text(body.link ?? body.target_url, 1000)
  if (required.includes('link')) {
    if (!link || !/^https?:\/\/[^\s]+$/i.test(link)) fail('Valid link is required')
    selected.link = link
  }
  if (required.includes('media')) {
    const media = text(body.media, 1000)
    if (!media || !/^https?:\/\/[^\s]+$/i.test(media)) fail('Valid media URL is required')
    selected.media = media
  }
  for (const key of EXTRA_FIELDS) {
    if (required.includes(key)) {
      const value = text(body[key], 4000)
      if (!value) fail(`${key} is required`)
      // Fixed-price list services cannot create an unbounded number of paid
      // provider units from a single retail price.
      if (['comments', 'usernames', 'keywords', 'groups'].includes(key) &&
          value.split(/\r?\n/).filter((entry) => entry.trim()).length > 1000) fail(`${key} list is too long`)
      selected[key] = value
    }
  }
  if (required.includes('answer_number')) {
    const answer = positiveInteger(body.answer_number)
    if (!answer) fail('answer_number is required')
    selected.answer_number = answer
  }
  const base = Math.ceil(perThousand ? unitPrice / 1000 * quantity : unitPrice)
  const price = markedAmount(partner, base)
  if (!price) fail('Social Boost quote is unavailable')
  const requestPayload: Record<string, unknown> = { item_id: serviceId, quantity, ...selected }
  const params: Record<string, string | number> = { action: 'add', service: externalId }
  for (const field of required) {
    if (field === 'quantity') params.quantity = quantity
    else params[field] = String(selected[field])
  }
  const name = text(service.name, 180) || 'Social Boost'
  return {
    section: 'social_boost', itemId: serviceId, itemName: name, quantity, amountNgn: price, requestPayload,
    async dispatch(_orderId: string): Promise<PartnerExternalOutcome> {
      const key = env(deps, 'SMM_PANEL_API_KEY')
      if (!key) return { kind: 'unknown' }
      const form = new URLSearchParams({ key })
      for (const [name, value] of Object.entries(params)) form.set(name, String(value))
      try {
        const response = await (deps.fetchImpl || fetch)(SMM_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form, redirect: 'error', cache: 'no-store', signal: timeout(deps),
        })
        if (!response.ok) return { kind: 'unknown' }
        const result = await response.json()
        const orderId = result && typeof result === 'object' ? positiveInteger(result.order) : null
        if (!orderId || result.error) return { kind: 'unknown' }
        return { kind: 'accepted', source: 'smm', id: String(orderId), status: 'processing', payload: { provider_order_id: String(orderId) } }
      } catch {
        return { kind: 'unknown' }
      }
    },
  }
}
