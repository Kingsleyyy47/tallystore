import { supabase, type Category, type ProductGroup } from '@/lib/supabase'

export type RevenueEventType =
  | 'SESSION_STARTED'
  | 'PAGE_VIEWED'
  | 'PRODUCT_IMPRESSION'
  | 'PRODUCT_VIEWED'
  | 'SEARCHED'
  | 'FILTER_USED'
  | 'SORT_USED'
  | 'PRODUCT_CLICKED'
  | 'BUY_CLICKED'
  | 'PAYMENT_STARTED'
  | 'PAYMENT_PROVIDER_LOADED'
  | 'PAYMENT_ATTEMPTED'
  | 'PAYMENT_COMPLETED'
  | 'PAYMENT_FAILED'
  | 'PRODUCT_PURCHASED'
  | 'PRODUCT_PURCHASE_REVERSED'
  | 'PRODUCT_REJECTED'
  | 'SMS_ORDER_CANCELLED'
  | 'SMS_ORDER_COMPLETED'
  | 'SMS_ORDER_REFUNDED'
  | 'RECOMMENDATION_SHOWN'
  | 'RECOMMENDATION_CLICKED'
  | 'RECOMMENDATION_DISMISSED'
  | 'PROMOTION_SHOWN'
  | 'PROMOTION_CLICKED'
  | 'OFFER_SHOWN'
  | 'OFFER_ACCEPTED'
  | 'OFFER_DISMISSED'
  | 'CHAT_OPENED'
  | 'CHAT_MESSAGE'
  | 'CHAT_INTENT'
  | 'CHAT_PRODUCT_SHOWN'
  | 'SUPPORT_HANDOFF'
  | 'CHECKOUT_ABANDONED'
  | 'RETURN_VISIT'

const KNOWN_REVENUE_EVENT_TYPES = new Set<RevenueEventType>([
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
])

const isProductClickEvent = (eventType: string | null | undefined) =>
  eventType === 'PRODUCT_CLICKED' || eventType === 'RECOMMENDATION_CLICKED'

export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'LOW_STOCK'
  | 'PREORDER'
  | 'BACKORDER'
  | 'UNLIMITED'
  | 'UNAVAILABLE'
  | 'PAUSED'
  | 'UNKNOWN'

export type CroActionType =
  | 'SHOW_REQUESTED_PRODUCT'
  | 'SHOW_ALTERNATIVE'
  | 'SHOW_UPGRADE'
  | 'SHOW_DOWNGRADE'
  | 'SHOW_COMPLEMENT'
  | 'ASK_BUDGET'
  | 'ASK_FEATURE'
  | 'COMPARE'
  | 'SHOW_PROMOTION'
  | 'SHOW_TRENDING'
  | 'CLOSE_PURCHASE'
  | 'DO_NOTHING'
  | 'POST_PURCHASE_RECOMMENDATION'
  | 'SUPPORT_HANDOFF'

export type RevenueOsSettings = {
  enabled: boolean
  shadowMode: boolean
  autonomyLevel: number
  explorationPct: number
  pressureLimit: number
  globalHoldoutPct: number
  experimentationEnabled: boolean
  freezeReason?: string
}

export type CustomerCommerceProfile = {
  productGroupCounts: Record<string, number>
  categoryCounts: Record<string, number>
  lastPurchasedAtByProductGroup?: Record<string, string>
  lastPurchasedAtByCategory?: Record<string, string>
  lastProductGroupId?: string | null
}

export type CustomerPressureState = {
  pressureScore: number
  recommendationsShown: number
  recentDismissals: number
  recentRejections: number
  buyClicks: number
  lastUpdated: string | null
}

export type TrafficQuality = 'human' | 'suspect' | 'bot' | 'internal'

export type RevenueAttribution = {
  channel: string
  source: string
  medium: string | null
  campaign: string | null
  term: string | null
  content: string | null
  referrerHost: string | null
  landingPath: string | null
  trafficQuality: TrafficQuality
}

export type RevenueOsContext = {
  surface: string
  query?: string
  selectedCategoryId?: string
  topSellingIds?: string[]
  favoriteProductIds?: string[]
  restockedIds?: string[]
  actionPlans?: Array<CroActionPlan | any>
  relationshipBoosts?: Record<string, number>
  customer?: CustomerCommerceProfile
  pressure?: CustomerPressureState
  settings?: RevenueOsSettings
  assignment?: CroAssignment
}

export type ProductEligibility = {
  exists: boolean
  published: boolean
  active: boolean
  purchasable: boolean
  validPrice: boolean
  available: boolean
  blocked: boolean
  isSellable: boolean
  availabilityStatus: AvailabilityStatus
  reasons: string[]
}

export type RankedProduct = {
  product: ProductGroup
  action: CroActionType
  score: number
  confidence: number
  eligibility: ProductEligibility
  reasons: string[]
}

export type ProductRetrievalResult = {
  product: ProductGroup
  score: number
  matched: boolean
  evidence: {
    exactName: boolean
    phrase: boolean
    exactTokenMatches: number
    prefixMatches: number
    missingTokens: number
    ngramSimilarity: number
    categoryMatch: boolean
  }
}

export type NextBestActionCandidate = {
  action: CroActionType
  productId?: string | null
  score: number
  confidence: number
  eligible: boolean
  reasons: string[]
}

export type CroActionArbitration = {
  selectedAction: CroActionType
  hardGuardrailApplied: boolean
  rulesApplied: string[]
  eligibleCandidates: number
  rejectedCandidates: number
  conflictSet: CroActionType[]
}

export type NextBestCommerceAction = {
  action: CroActionType
  selected: RankedProduct | null
  candidates: NextBestActionCandidate[]
  arbitration: CroActionArbitration
  confidence: number
  expectedValue: number
  pressureScore: number
  reason: string
}

export type RevenueDataQualityFinding = {
  checkKey: string
  severity: 'info' | 'warning' | 'critical'
  status: 'passed' | 'failed'
  scope: string
  message: string
  evidence?: Record<string, unknown>
}

export type CatalogueProductRelationship = {
  fromProductGroupId: string
  toProductGroupId: string
  relationshipType:
    | 'SUBSTITUTE'
    | 'ALTERNATIVE'
    | 'UPGRADE'
    | 'DOWNGRADE'
    | 'COMPLEMENT'
    | 'VARIANT'
    | 'VIEWED_NEXT'
    | 'PURCHASED_NEXT'
    | 'SAME_INTENT'
    | 'COMPATIBLE_WITH'
    | 'REPLACEMENT_FOR'
    | 'REQUIRES'
  strength: number
  confidence: number
  sampleSize?: number
  source?: 'CATALOGUE' | 'BEHAVIOR' | 'EXPLICIT' | 'EXPERIMENTAL'
  metadata?: Record<string, unknown>
}

export type RevenueProductAttribute = {
  productGroupId: string
  key: string
  label: string
  valueType: 'text' | 'number' | 'boolean' | 'date'
  textValue?: string | null
  numericValue?: number | null
  booleanValue?: boolean | null
  dateValue?: string | null
  unit: string
  source: 'CATALOGUE' | 'BEHAVIOR' | 'ADMIN'
  confidence: number
  categoryId?: string | null
}

export type RevenueFeatureSnapshot = {
  snapshotKey: string
  scopeType: 'store' | 'product' | 'category' | 'customer' | 'session'
  scopeId: string
  windowStart?: string | null
  windowEnd: string
  features: Record<string, unknown>
}

export type CroOpportunity = {
  opportunityKey: string
  type: string
  scope: string
  expectedValue: number
  confidence: number
  risk: number
  effort: number
  priority: number
  status?: 'open' | 'watching' | 'testing' | 'resolved' | 'dismissed'
  evidence: Record<string, unknown>
}

export type CroApprovedActionType =
  | 'REORDER_PRODUCTS'
  | 'FEATURE_PRODUCT'
  | 'SUPPRESS_PRODUCT'
  | 'SHOW_RECOMMENDATION'
  | 'CHANGE_RECOMMENDATION_POSITION'
  | 'CHANGE_TEMPLATE_VARIANT'
  | 'SHOW_POST_PURCHASE_OFFER'
  | 'CHANGE_OFFER_SEQUENCE'
  | 'CHANGE_PROMOTION_EXPOSURE'
  | 'CHANGE_CHAT_OPENING'
  | 'CHANGE_CTA_COPY_VARIANT'
  | 'AUDIT_TRAFFIC_SOURCE'
  | 'DIAGNOSE_FUNNEL'
  | 'RESTOCK_PRODUCT'
  | 'DO_NOTHING'

export type CroActionPlan = {
  actionKey: string
  opportunityKey?: string | null
  actionType: CroApprovedActionType
  surface: string
  scope: string
  status: 'proposed' | 'approved' | 'running' | 'paused' | 'completed' | 'rejected'
  priority: number
  expectedValue: number
  confidence: number
  risk: number
  guardrails: Record<string, unknown>
  payload: Record<string, unknown>
  evidence: Record<string, unknown>
}

export type RevenueForecast = {
  forecastKey: string
  periodStart: string
  periodEnd: string
  metric: string
  medianValue: number
  lowerBound: number
  upperBound: number
  probabilityToTarget?: number | null
  evidence: Record<string, unknown>
}

export type RevenueOsRuntimeIntelligence = {
  featureSnapshots: RevenueFeatureSnapshot[]
  opportunities: CroOpportunity[]
  insights: Array<{
    scope: string
    finding: string
    effect: number
    confidence: number
    sampleSize: number
    evidence: Record<string, unknown>
  }>
  forecasts: RevenueForecast[]
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

function featureEntries(snapshot: RevenueFeatureSnapshot) {
  return Object.entries(snapshot.features || {})
    .filter(([, value]) => value !== undefined)
    .map(([featureKey, value]) => ({
      feature_key: featureKey,
      ...featureValueColumns(value),
      confidence: typeof snapshot.features?.confidence === 'number' ? Number(snapshot.features.confidence) : 0.6,
      window_start: snapshot.windowStart || null,
      window_end: snapshot.windowEnd,
      source: 'DETERMINISTIC',
      updated_at: new Date().toISOString(),
    }))
}

async function recordFeatureStoreSnapshots(featureSnapshots: RevenueFeatureSnapshot[]) {
  const productRows = []
  const customerRows = []
  const sessionRows = []
  const businessRows = []

  for (const snapshot of featureSnapshots) {
    const entries = featureEntries(snapshot)
    if (!entries.length) continue

    if (snapshot.scopeType === 'product' && isUuid(snapshot.scopeId)) {
      productRows.push(...entries.map((entry) => ({ ...entry, product_group_id: snapshot.scopeId })))
    } else if (snapshot.scopeType === 'customer') {
      const subjectKey = snapshot.scopeId
      customerRows.push(...entries.map((entry) => ({
        ...entry,
        subject_key: subjectKey,
        user_id: isUuid(subjectKey) ? subjectKey : null,
        visitor_id: isUuid(subjectKey) ? null : subjectKey,
      })))
    } else if (snapshot.scopeType === 'session') {
      sessionRows.push(...entries.map((entry) => ({ ...entry, session_id: snapshot.scopeId })))
    } else {
      const scope = snapshot.scopeType === 'store' ? 'store' : `${snapshot.scopeType}:${snapshot.scopeId}`
      businessRows.push(...entries.map((entry) => ({ ...entry, scope })))
    }
  }

  if (productRows.length > 0) {
    const { error } = await supabase.from('product_features' as any).upsert(productRows, { onConflict: 'product_group_id,feature_key' })
    if (error) throw error
  }
  if (customerRows.length > 0) {
    const { error } = await supabase.from('customer_features' as any).upsert(customerRows, { onConflict: 'subject_key,feature_key' })
    if (error) throw error
  }
  if (sessionRows.length > 0) {
    const { error } = await supabase.from('session_features' as any).upsert(sessionRows, { onConflict: 'session_id,feature_key' })
    if (error) throw error
  }
  if (businessRows.length > 0) {
    const { error } = await supabase.from('business_features' as any).upsert(businessRows, { onConflict: 'scope,feature_key' })
    if (error) throw error
  }
}

export type CroBanditAllocation = {
  snapshotKey: string
  experimentKey: string
  surface: string
  allocation: Array<{
    variantId: string
    weight: number
    reward: number
    visitors: number
    confidence: number
    eligible: boolean
    reasons: string[]
  }>
  recommendation: 'insufficient_data' | 'explore' | 'allocate' | 'pause'
  evidence: Record<string, unknown>
}

export type CustomerLifecycleStage =
  | 'NEW'
  | 'FIRST_PURCHASE'
  | 'ACTIVE'
  | 'REPEAT'
  | 'COOLING'
  | 'AT_RISK'
  | 'LAPSED'
  | 'REACTIVATED'

export type PromotionGuardrailFinding = {
  checkKey: string
  severity: 'info' | 'warning' | 'critical'
  status: 'passed' | 'failed'
  code?: string | null
  message: string
  evidence: Record<string, unknown>
}

export type CroExperimentEvaluation = {
  evaluationKey: string
  experimentKey: string
  periodStart: string
  periodEnd: string
  primaryMetric: string
  control: Record<string, unknown>
  variants: Array<Record<string, unknown>>
  guardrails: Record<string, unknown>
  decision: 'insufficient_data' | 'keep_running' | 'promote' | 'rollback' | 'pause'
  confidence: number
  minimumPracticalEffect: number
  evidence: Record<string, unknown>
}

type RawCroExperimentEvaluation = CroExperimentEvaluation & {
  _statistical?: {
    falseDiscoveryRisk: number
    multipleTestingQValue: number
    falseDiscoveryPassed: boolean
  }
}

export type CroSimulationRun = {
  simulationKey: string
  mode: 'shadow' | 'historical' | 'guardrail'
  periodStart: string
  periodEnd: string
  sessionsEvaluated: number
  decisionsEvaluated: number
  violations: Array<Record<string, unknown>>
  concentration: Record<string, unknown>
  recommendation: 'insufficient_data' | 'safe' | 'watch' | 'pause'
  evidence: Record<string, unknown>
}

export type CroDriftCheck = {
  checkKey: string
  modelKey: string
  periodStart: string
  periodEnd: string
  status: 'stable' | 'watch' | 'drift' | 'insufficient_data'
  driftScore: number
  evidence: Record<string, unknown>
}

export type CroAssignment = {
  assignmentKey: string
  bucket: number
  isHoldout: boolean
  experimentId: string | null
  variantId: string | null
  mode: 'holdout' | 'shadow' | 'control' | 'variant' | 'default'
  rankingEnabled: boolean
  reason: string
}

const VISITOR_ID_KEY = 'tallystore_visitor_id'
const SESSION_ID_KEY = 'tallystore_session_id'
const INTERNAL_REVENUE_USER_KEY = 'tallystore_internal_revenue_user'
const PRESSURE_STATE_KEY = 'tallystore_revenue_pressure_state'
const SESSION_SIGNAL_KEY = 'tallystore_revenue_session_signals'
const LOCAL_REVENUE_EVENT_SEEN_PREFIX = 'tallystore_revenue_event_seen:'
const INTERNAL_PATH_PATTERN = /^\/(?:admin|staff-admin|staff)(?:\/|$)/

const DEFAULT_SETTINGS: RevenueOsSettings = {
  enabled: false,
  shadowMode: true,
  autonomyLevel: 0,
  explorationPct: 5,
  pressureLimit: 2,
  globalHoldoutPct: 5,
  experimentationEnabled: false,
  freezeReason: '',
}

function safeStorage(kind: 'localStorage' | 'sessionStorage') {
  if (typeof window === 'undefined') return null
  try {
    return window[kind]
  } catch {
    return null
  }
}

export function getRevenueVisitorId() {
  const storage = safeStorage('localStorage')
  if (!storage) return null
  let visitorId = storage.getItem(VISITOR_ID_KEY)
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    storage.setItem(VISITOR_ID_KEY, visitorId)
  }
  return visitorId
}

export function getRevenueSessionId() {
  const storage = safeStorage('sessionStorage')
  if (!storage) return null
  let sessionId = storage.getItem(SESSION_ID_KEY)
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    storage.setItem(SESSION_ID_KEY, sessionId)
  }
  return sessionId
}

function readPressureState(): CustomerPressureState {
  const storage = safeStorage('sessionStorage')
  if (!storage) {
    return {
      pressureScore: 0,
      recommendationsShown: 0,
      recentDismissals: 0,
      recentRejections: 0,
      buyClicks: 0,
      lastUpdated: null,
    }
  }
  try {
    const parsed = JSON.parse(storage.getItem(PRESSURE_STATE_KEY) || '{}')
    const lastUpdated = typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : null
    const lastUpdatedTime = lastUpdated ? new Date(lastUpdated).getTime() : NaN
    const elapsedHours = Number.isFinite(lastUpdatedTime)
      ? Math.max(0, (Date.now() - lastUpdatedTime) / 3600000)
      : 0
    const decayFactor = elapsedHours > 0 ? Math.pow(0.82, elapsedHours / 6) : 1
    return {
      pressureScore: clamp(toNumber(parsed.pressureScore) * decayFactor, 0, 20),
      recommendationsShown: Math.max(0, Math.round(toNumber(parsed.recommendationsShown) * decayFactor)),
      recentDismissals: Math.max(0, Math.round(toNumber(parsed.recentDismissals) * decayFactor)),
      recentRejections: Math.max(0, Math.round(toNumber(parsed.recentRejections) * decayFactor)),
      buyClicks: Math.max(0, Math.round(toNumber(parsed.buyClicks) * decayFactor)),
      lastUpdated,
    }
  } catch {
    return {
      pressureScore: 0,
      recommendationsShown: 0,
      recentDismissals: 0,
      recentRejections: 0,
      buyClicks: 0,
      lastUpdated: null,
    }
  }
}

export function getCustomerPressureState() {
  return readPressureState()
}

export type CustomerSessionSignals = {
  productViews: number
  productClicks: number
  searches: number
  filters: number
  buyClicks: number
  paymentStarts: number
  paymentAttempts: number
  paymentFailures: number
  recommendationDismissals: number
  checkoutAbandons: number
  lastSignalAt: string | null
}

const EMPTY_SESSION_SIGNALS: CustomerSessionSignals = {
  productViews: 0,
  productClicks: 0,
  searches: 0,
  filters: 0,
  buyClicks: 0,
  paymentStarts: 0,
  paymentAttempts: 0,
  paymentFailures: 0,
  recommendationDismissals: 0,
  checkoutAbandons: 0,
  lastSignalAt: null,
}

function readSessionSignals(): CustomerSessionSignals {
  const storage = safeStorage('sessionStorage')
  if (!storage) return { ...EMPTY_SESSION_SIGNALS }
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_SIGNAL_KEY) || '{}')
    return {
      productViews: Math.max(0, Math.round(toNumber(parsed.productViews))),
      productClicks: Math.max(0, Math.round(toNumber(parsed.productClicks))),
      searches: Math.max(0, Math.round(toNumber(parsed.searches))),
      filters: Math.max(0, Math.round(toNumber(parsed.filters))),
      buyClicks: Math.max(0, Math.round(toNumber(parsed.buyClicks))),
      paymentStarts: Math.max(0, Math.round(toNumber(parsed.paymentStarts))),
      paymentAttempts: Math.max(0, Math.round(toNumber(parsed.paymentAttempts))),
      paymentFailures: Math.max(0, Math.round(toNumber(parsed.paymentFailures))),
      recommendationDismissals: Math.max(0, Math.round(toNumber(parsed.recommendationDismissals))),
      checkoutAbandons: Math.max(0, Math.round(toNumber(parsed.checkoutAbandons))),
      lastSignalAt: typeof parsed.lastSignalAt === 'string' ? parsed.lastSignalAt : null,
    }
  } catch {
    return { ...EMPTY_SESSION_SIGNALS }
  }
}

export function getCustomerSessionSignals() {
  return readSessionSignals()
}

function decaySessionSignals(signals: CustomerSessionSignals) {
  if (!signals.lastSignalAt) return signals
  const ageMinutes = Math.max(0, (Date.now() - new Date(signals.lastSignalAt).getTime()) / 60000)
  if (ageMinutes < 30) return signals
  const decay = ageMinutes >= 240 ? 0 : ageMinutes >= 120 ? 0.4 : 0.7
  return {
    ...signals,
    productViews: Math.round(signals.productViews * decay),
    productClicks: Math.round(signals.productClicks * decay),
    searches: Math.round(signals.searches * decay),
    filters: Math.round(signals.filters * decay),
    buyClicks: Math.round(signals.buyClicks * decay),
    paymentStarts: Math.round(signals.paymentStarts * decay),
    paymentAttempts: Math.round(signals.paymentAttempts * decay),
    paymentFailures: Math.round(signals.paymentFailures * decay),
    recommendationDismissals: Math.round(signals.recommendationDismissals * decay),
    checkoutAbandons: Math.round(signals.checkoutAbandons * decay),
  }
}

function updateSessionSignals(eventType: RevenueEventType) {
  const storage = safeStorage('sessionStorage')
  if (!storage) return
  const current = decaySessionSignals(readSessionSignals())
  const next: CustomerSessionSignals = {
    ...current,
    productViews: current.productViews + (eventType === 'PRODUCT_VIEWED' ? 1 : 0),
    productClicks: current.productClicks + (isProductClickEvent(eventType) ? 1 : 0),
    searches: current.searches + (eventType === 'SEARCHED' ? 1 : 0),
    filters: current.filters + (['FILTER_USED', 'SORT_USED'].includes(eventType) ? 1 : 0),
    buyClicks: current.buyClicks + (eventType === 'BUY_CLICKED' ? 1 : 0),
    paymentStarts: current.paymentStarts + (eventType === 'PAYMENT_STARTED' ? 1 : 0),
    paymentAttempts: current.paymentAttempts + (eventType === 'PAYMENT_ATTEMPTED' ? 1 : 0),
    paymentFailures: current.paymentFailures + (eventType === 'PAYMENT_FAILED' ? 1 : 0),
    recommendationDismissals: current.recommendationDismissals + (['RECOMMENDATION_DISMISSED', 'OFFER_DISMISSED'].includes(eventType) ? 1 : 0),
    checkoutAbandons: current.checkoutAbandons + (eventType === 'CHECKOUT_ABANDONED' ? 1 : 0),
    lastSignalAt: new Date().toISOString(),
  }
  storage.setItem(SESSION_SIGNAL_KEY, JSON.stringify(next))
}

export function estimatePurchaseIntent(input: {
  query?: string | null
  selectedCategoryId?: string | null
  hasRequestedProduct?: boolean
  signals?: CustomerSessionSignals
  pressure?: CustomerPressureState
}) {
  const signals = input.signals || getCustomerSessionSignals()
  const pressure = input.pressure || getCustomerPressureState()
  const query = String(input.query || '').trim()
  const specificQuery = query.length >= 4 ? 1 : 0
  const hasCategory = input.selectedCategoryId && input.selectedCategoryId !== 'all' ? 1 : 0
  const positive =
    Math.min(signals.productViews, 6) * 0.045 +
    Math.min(signals.productClicks, 4) * 0.08 +
    Math.min(signals.searches, 4) * 0.055 +
    Math.min(signals.filters, 4) * 0.035 +
    Math.min(signals.buyClicks, 3) * 0.18 +
    Math.min(signals.paymentStarts, 2) * 0.28 +
    Math.min(signals.paymentAttempts, 2) * 0.32 +
    specificQuery * 0.11 +
    hasCategory * 0.06 +
    (input.hasRequestedProduct ? 0.18 : 0)
  const negative =
    Math.min(signals.paymentFailures, 3) * 0.14 +
    Math.min(signals.recommendationDismissals, 4) * 0.06 +
    Math.min(signals.checkoutAbandons, 2) * 0.16 +
    Math.min(pressure.recentRejections, 3) * 0.07 +
    Math.min(pressure.pressureScore, 12) * 0.012

  return Number(clamp(0.18 + positive - negative, 0.05, 0.96).toFixed(4))
}

function updatePressureState(eventType: RevenueEventType) {
  const storage = safeStorage('sessionStorage')
  if (!storage) return
  const state = readPressureState()
  const pressureDeltas: Partial<Record<RevenueEventType, number>> = {
    RECOMMENDATION_SHOWN: 1,
    CHAT_PRODUCT_SHOWN: 1,
    PROMOTION_SHOWN: 1.25,
    OFFER_SHOWN: 1.25,
    RECOMMENDATION_DISMISSED: 2,
    OFFER_DISMISSED: 2,
    PRODUCT_REJECTED: 2.5,
    PRODUCT_PURCHASE_REVERSED: 1.5,
    SUPPORT_HANDOFF: 1,
    BUY_CLICKED: -1.5,
    PRODUCT_PURCHASED: -3,
    OFFER_ACCEPTED: -2,
  }
  const pressureScore = clamp(state.pressureScore + (pressureDeltas[eventType] || 0), 0, 20)
  const next: CustomerPressureState = {
    pressureScore,
    recommendationsShown: state.recommendationsShown + (['RECOMMENDATION_SHOWN', 'CHAT_PRODUCT_SHOWN', 'PROMOTION_SHOWN', 'OFFER_SHOWN'].includes(eventType) ? 1 : 0),
    recentDismissals: state.recentDismissals + (['RECOMMENDATION_DISMISSED', 'OFFER_DISMISSED'].includes(eventType) ? 1 : 0),
    recentRejections: state.recentRejections + (eventType === 'PRODUCT_REJECTED' ? 1 : 0),
    buyClicks: state.buyClicks + (eventType === 'BUY_CLICKED' ? 1 : 0),
    lastUpdated: new Date().toISOString(),
  }
  storage.setItem(PRESSURE_STATE_KEY, JSON.stringify(next))
}

export function isInternalRevenueTraffic(path?: string | null) {
  if (typeof window === 'undefined') return false
  const currentPath = path ?? `${window.location.pathname}${window.location.search}`
  const storage = safeStorage('localStorage')
  return INTERNAL_PATH_PATTERN.test(currentPath) || storage?.getItem(INTERNAL_REVENUE_USER_KEY) === 'true'
}

function safeUrl(value: string | null | undefined, base = 'https://tallystore.local') {
  if (!value) return null
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

export function safeRevenuePath(value: string | null | undefined) {
  const url = safeUrl(value || '/', typeof window === 'undefined' ? 'https://tallystore.local' : window.location.origin)
  if (!url) return null
  return url.pathname || '/'
}

export function safeRevenueReferrer(value: string | null | undefined) {
  const url = safeUrl(value || null)
  if (!url) return null
  return `${url.origin}${url.pathname || '/'}`.slice(0, 240)
}

function classifyTrafficQuality(input: { userAgent?: string | null; path?: string | null; internal?: boolean }): TrafficQuality {
  if (input.internal) return 'internal'
  const userAgent = String(input.userAgent || '').toLowerCase()
  if (/\b(bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegrambot|slurp|bingpreview|headless|phantom|curl|wget|python-requests)\b/.test(userAgent)) return 'bot'
  if (!userAgent || userAgent.length < 12) return 'suspect'
  const path = String(input.path || '').toLowerCase()
  if (/\b(wp-admin|xmlrpc|phpmyadmin|\.env|\/admin\/login)\b/.test(path)) return 'bot'
  return 'human'
}

export function deriveRevenueAttribution(input: {
  path?: string | null
  referrer?: string | null
  userAgent?: string | null
  internal?: boolean
}): RevenueAttribution {
  const url = safeUrl(input.path || '/', typeof window === 'undefined' ? 'https://tallystore.local' : window.location.origin)
  const referrerUrl = safeUrl(input.referrer || null)
  const params = url?.searchParams || new URLSearchParams()
  const utmSource = params.get('utm_source') || params.get('source')
  const utmMedium = params.get('utm_medium')
  const utmCampaign = params.get('utm_campaign')
  const utmTerm = params.get('utm_term')
  const utmContent = params.get('utm_content')
  const gclid = params.get('gclid')
  const fbclid = params.get('fbclid')
  const referrerHost = referrerUrl?.hostname?.replace(/^www\./, '') || null
  const source = utmSource || (gclid ? 'google' : fbclid ? 'facebook' : referrerHost || 'direct')
  let channel = 'direct'

  const normalizedSource = source.toLowerCase()
  const normalizedMedium = String(utmMedium || '').toLowerCase()
  if (gclid || normalizedMedium.includes('cpc') || normalizedMedium.includes('paid')) channel = 'paid'
  else if (normalizedMedium.includes('email')) channel = 'email'
  else if (normalizedMedium.includes('affiliate') || normalizedMedium.includes('referral')) channel = 'referral'
  else if (/(facebook|instagram|tiktok|twitter|x\.com|youtube|telegram|whatsapp|snapchat|discord)/.test(normalizedSource)) channel = 'social'
  else if (/(google|bing|yahoo|duckduckgo)/.test(normalizedSource)) channel = 'organic_search'
  else if (referrerHost) channel = 'referral'

  const trafficQuality = classifyTrafficQuality({ userAgent: input.userAgent, path: input.path, internal: input.internal })

  return {
    channel,
    source,
    medium: utmMedium,
    campaign: utmCampaign,
    term: utmTerm,
    content: utmContent,
    referrerHost,
    landingPath: url ? url.pathname : safeRevenuePath(input.path),
    trafficQuality,
  }
}

export function getRevenueRequestContext() {
  if (typeof window === 'undefined') {
    return {
      visitor_id: null,
      session_id: null,
      path: null,
      referrer: null,
      device: null,
      display_currency: 'NGN',
      attribution: null,
      traffic_quality: null,
    }
  }

  const path = `${window.location.pathname}${window.location.search}`
  const width = window.innerWidth
  const device = width > 0 && width < 768 ? 'mobile' : width >= 768 ? 'desktop' : 'unknown'
  const referrer = typeof document === 'undefined' ? null : document.referrer || null
  const userAgent = typeof navigator === 'undefined' ? null : navigator.userAgent
  const attribution = deriveRevenueAttribution({
    path,
    referrer,
    userAgent,
    internal: isInternalRevenueTraffic(path),
  })

  return {
    visitor_id: getRevenueVisitorId(),
    session_id: getRevenueSessionId(),
    path: safeRevenuePath(path),
    referrer: safeRevenueReferrer(referrer),
    device,
    display_currency: safeStorage('localStorage')?.getItem('tallystore_currency') === 'USD' ? 'USD' : 'NGN',
    attribution,
    traffic_quality: attribution.trafficQuality,
  }
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function bucketFor(value: string) {
  return stableHash(value) % 10000
}

function experimentAppliesToSurface(experiment: any, surface: string) {
  const audience = experiment?.audience || {}
  if (!audience || typeof audience !== 'object') return true
  if (audience.surface && audience.surface !== surface) return false
  if (Array.isArray(audience.surfaces) && !audience.surfaces.includes(surface)) return false
  return true
}

export function resolveCroAssignment(input: {
  surface: string
  settings?: RevenueOsSettings | null
  experiments?: any[]
  visitorId?: string | null
  userId?: string | null
}): CroAssignment {
  const settings = input.settings || DEFAULT_SETTINGS
  const identity = input.userId || input.visitorId || getRevenueVisitorId() || getRevenueSessionId() || 'anonymous'
  const assignmentKey = `${input.surface}:${identity}`
  const bucket = bucketFor(assignmentKey)
  const globalHoldoutKey = `global:${identity}`
  const globalHoldoutBucket = bucketFor(globalHoldoutKey)
  const holdoutThreshold = Math.round(Math.min(Math.max(settings.globalHoldoutPct, 0), 100) * 100)

  if (settings.freezeReason) {
    return {
      assignmentKey,
      bucket,
      isHoldout: false,
      experimentId: null,
      variantId: null,
      mode: 'default',
      rankingEnabled: false,
      reason: 'data_quality_freeze',
    }
  }

  if (!settings.enabled) {
    return {
      assignmentKey,
      bucket,
      isHoldout: false,
      experimentId: null,
      variantId: null,
      mode: 'default',
      rankingEnabled: false,
      reason: 'cro_disabled',
    }
  }

  if (globalHoldoutBucket < holdoutThreshold) {
    return {
      assignmentKey: globalHoldoutKey,
      bucket: globalHoldoutBucket,
      isHoldout: true,
      experimentId: 'global_holdout',
      variantId: 'holdout',
      mode: 'holdout',
      rankingEnabled: false,
      reason: 'permanent_global_holdout',
    }
  }

  if (settings.shadowMode) {
    return {
      assignmentKey,
      bucket,
      isHoldout: false,
      experimentId: null,
      variantId: null,
      mode: 'shadow',
      rankingEnabled: false,
      reason: 'shadow_mode',
    }
  }

  if (settings.experimentationEnabled) {
    const experiment = (input.experiments || [])
      .filter((row) => String(row.status || '').toLowerCase() === 'running')
      .find((row) => experimentAppliesToSurface(row, input.surface))

    if (experiment) {
      const variants = Array.isArray(experiment.variants) ? experiment.variants : []
      const weightedVariants = variants
        .map((variant) => ({
          variant,
          variantId: String(variant.id || variant.key || variant.name || '').trim(),
          rawWeight: Math.max(0, Number(variant.weight ?? variant.allocation ?? 0)),
        }))
        .filter((entry) => entry.variantId && Number.isFinite(entry.rawWeight) && entry.rawWeight > 0)
      const totalWeight = weightedVariants.reduce((sum, entry) => sum + entry.rawWeight, 0)
      const variantBucket = bucketFor(`${experiment.experiment_key || experiment.id}:${identity}`) / 10000
      let cumulative = 0
      for (const entry of weightedVariants) {
        const variantId = entry.variantId
        const weight = totalWeight > 1 ? entry.rawWeight / totalWeight : entry.rawWeight
        cumulative += weight
        if (variantBucket <= cumulative || cumulative >= 1) {
          return {
            assignmentKey,
            bucket,
            isHoldout: false,
            experimentId: experiment.experiment_key || experiment.id,
            variantId,
            mode: variantId === 'control' ? 'control' : 'variant',
            rankingEnabled: variantId !== 'control',
            reason: 'running_experiment',
          }
        }
      }

      return {
        assignmentKey,
        bucket,
        isHoldout: false,
        experimentId: experiment.experiment_key || experiment.id,
        variantId: 'control',
        mode: 'control',
        rankingEnabled: false,
        reason: 'experiment_control_fallback',
      }
    }
  }

  return {
    assignmentKey,
    bucket,
    isHoldout: false,
    experimentId: null,
    variantId: null,
    mode: 'default',
    rankingEnabled: true,
    reason: 'default_revenue_os',
  }
}

export function normalizeCatalogueText(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getProductTokens(product: ProductGroup, category?: Category) {
  return normalizeCatalogueText([
    product.name,
    product.description,
    category?.name,
  ].filter(Boolean).join(' ')).split(' ').filter(Boolean)
}

function canAutoFulfill(product: ProductGroup) {
  return !!(
    product.auto_fulfill_enabled &&
    (product.muabanvia_product_id ||
      product.shopclone_product_id ||
      product.shopviaclone_product_id)
  )
}

export function evaluateProductEligibility(product: ProductGroup): ProductEligibility {
  const reasons: string[] = []
  const exists = !!product?.id
  const active = product?.is_active !== false
  const published = active
  const validPrice = Number.isFinite(Number(product?.price)) && Number(product.price) > 0
  const autoFulfillable = canAutoFulfill(product)
  const stock = Number(product?.stock_count || 0)
  const explicitSellable = (product as any)?.is_sellable
  const explicitAvailabilityStatus = String((product as any)?.availability_status || '').toUpperCase()
  const statusSellable = ['AVAILABLE', 'LOW_STOCK', 'PREORDER', 'BACKORDER', 'UNLIMITED'].includes(explicitAvailabilityStatus)
  const statusBlocked = ['UNAVAILABLE', 'PAUSED'].includes(explicitAvailabilityStatus)
  const blocked = explicitSellable === false || statusBlocked
  const available = !blocked && (statusSellable || stock > 0 || autoFulfillable)
  const purchasable = validPrice && available && !blocked

  if (!exists) reasons.push('missing_product')
  if (!active) reasons.push('inactive')
  if (!validPrice) reasons.push('invalid_price')
  if (!available) reasons.push(stock <= 0 && !autoFulfillable ? 'out_of_stock' : 'unavailable')
  if (explicitSellable === false) reasons.push('not_sellable')
  if (blocked) reasons.push('blocked')

  let availabilityStatus: AvailabilityStatus = 'UNAVAILABLE'
  if (!active) availabilityStatus = 'PAUSED'
  else if (statusSellable || statusBlocked) availabilityStatus = explicitAvailabilityStatus as AvailabilityStatus
  else if (autoFulfillable && stock <= 0) availabilityStatus = 'UNLIMITED'
  else if (stock > 0 && stock <= 3) availabilityStatus = 'LOW_STOCK'
  else if (stock > 3) availabilityStatus = 'AVAILABLE'

  return {
    exists,
    published,
    active,
    purchasable,
    validPrice,
    available,
    blocked,
    isSellable: exists && published && active && purchasable,
    availabilityStatus,
    reasons,
  }
}

export function analyzeRevenueDataQuality(
  products: ProductGroup[],
  categories: Category[],
): RevenueDataQualityFinding[] {
  const findings: RevenueDataQualityFinding[] = []
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const activeProducts = products.filter((product) => product.is_active !== false)
  const normalizedNames = new Map<string, ProductGroup[]>()

  for (const product of products) {
    const eligibility = evaluateProductEligibility(product)
    const normalizedName = normalizeCatalogueText(product.name)
    if (normalizedName) {
      normalizedNames.set(normalizedName, [...(normalizedNames.get(normalizedName) || []), product])
    }

    if (!categoryById.has(product.category_id)) {
      findings.push({
        checkKey: 'catalogue.missing_category',
        severity: product.is_active ? 'critical' : 'warning',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} is linked to a missing category.`,
        evidence: { product_id: product.id, category_id: product.category_id },
      })
    }

    if (!eligibility.validPrice) {
      findings.push({
        checkKey: 'catalogue.invalid_price',
        severity: product.is_active ? 'critical' : 'warning',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} has an invalid customer price.`,
        evidence: { product_id: product.id, price: product.price },
      })
    }

    if (Number(product.stock_count || 0) < 0) {
      findings.push({
        checkKey: 'catalogue.negative_stock',
        severity: 'critical',
        status: 'failed',
        scope: product.id,
        message: `${product.name || 'Unnamed product'} has negative stock.`,
        evidence: { product_id: product.id, stock_count: product.stock_count },
      })
    }

    // Ordinary stock exhaustion is not a data-quality failure. Revenue OS and
    // customer surfaces exclude non-sellable products through eligibility.
  }

  for (const [normalizedName, duplicates] of normalizedNames) {
    const activeDuplicates = duplicates.filter((product) => product.is_active !== false)
    if (activeDuplicates.length > 1) {
      findings.push({
        checkKey: 'catalogue.duplicate_normalized_name',
        severity: 'warning',
        status: 'failed',
        scope: normalizedName,
        message: `${activeDuplicates.length} active products normalize to the same name.`,
        evidence: {
          normalized_name: normalizedName,
          product_ids: activeDuplicates.map((product) => product.id),
          names: activeDuplicates.map((product) => product.name),
        },
      })
    }
  }

  const activeCategoryIds = new Set(categories.filter((category) => category.is_active !== false).map((category) => category.id))
  for (const categoryId of activeCategoryIds) {
    const sellableCount = activeProducts.filter((product) => product.category_id === categoryId && evaluateProductEligibility(product).isSellable).length
    if (sellableCount === 0) {
      const category = categoryById.get(categoryId)
      findings.push({
        checkKey: 'catalogue.empty_active_category',
        severity: 'info',
        status: 'failed',
        scope: categoryId,
        message: `${category?.name || 'Active category'} has no currently sellable products.`,
        evidence: { category_id: categoryId },
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      checkKey: 'catalogue.health',
      severity: 'info',
      status: 'passed',
      scope: 'catalogue',
      message: 'Catalogue checks passed. No unsafe pricing, stock, or eligibility issues found.',
    })
  }

  return findings
}

export function analyzeRevenueEventDataQuality(input: {
  revenueEvents: any[]
  orders: any[]
  smsOrders?: any[]
  serviceOrders?: any[]
  products: ProductGroup[]
  profiles?: any[]
  identityLinks?: any[]
  now?: Date
}): RevenueDataQualityFinding[] {
  const now = input.now || new Date()
  const dayMs = 86400000
  const sevenDaysAgo = new Date(now.getTime() - 7 * dayMs)
  const productById = new Map(input.products.map((product) => [product.id, product]))
  const profileById = new Map((input.profiles || []).map((profile) => [profile.id, profile]))
  const isInternalUser = (userId: string | null | undefined) => {
    const profile = userId ? profileById.get(userId) : null
    return !!profile?.is_staff || !!profile?.is_admin
  }
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
  const resolvedInternalUserForEvent = (event: any) => {
    if (isInternalUser(event.user_id)) return true
    const visitorId = event.visitor_id ? String(event.visitor_id) : ''
    const sessionId = event.session_id ? String(event.session_id) : ''
    if (visitorId && sessionId) {
      const exactUserId = exactIdentityLinkByVisitorSession.get(`${visitorId}:${sessionId}`)
      if (isInternalUser(exactUserId)) return true
    }
    const visitorUsers = visitorId ? usersByVisitorId.get(visitorId) : null
    return !!visitorUsers && [...visitorUsers].some((userId) => isInternalUser(userId))
  }
  const recentEvents = (input.revenueEvents || []).filter((event) => {
    const created = dateOrNull(event.created_at)
    return created && created >= sevenDaysAgo && created <= now && !resolvedInternalUserForEvent(event)
  })
  const recentOrders = (input.orders || []).filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= sevenDaysAgo && created <= now && !isInternalUser(order.user_id)
  })
  const recentSmsOrders = (input.smsOrders || []).filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= sevenDaysAgo && created <= now && !isInternalUser(order.user_id)
  })
  const recentServiceOrders = (input.serviceOrders || []).filter((order) => {
    const created = dateOrNull(order.created_at)
    return created && created >= sevenDaysAgo && created <= now && !isInternalUser(order.user_id)
  })
  const findings: RevenueDataQualityFinding[] = []

  const missingEventIds = recentEvents.filter((event) => !event.event_id)
  if (missingEventIds.length > 0) {
    findings.push({
      checkKey: 'events.missing_event_id',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${missingEventIds.length} revenue event(s) are missing event_id, so retries cannot be deduplicated safely.`,
      evidence: { rows: missingEventIds.slice(0, 20).map((event) => ({ id: event.id, event_type: event.event_type })) },
    })
  }

  const unknownEventTypes = [...new Set(recentEvents
    .map((event) => String(event.event_type || ''))
    .filter((eventType) => !KNOWN_REVENUE_EVENT_TYPES.has(eventType as RevenueEventType)))]
  if (unknownEventTypes.length > 0) {
    findings.push({
      checkKey: 'events.schema_drift_unknown_event_type',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${unknownEventTypes.length} unknown revenue event type(s) were recorded. Revenue OS must pause until tracking schema drift is fixed.`,
      evidence: { event_types: unknownEventTypes.slice(0, 30) },
    })
  }

  const unsupportedCurrencies = [...new Set(recentEvents
    .map((event) => String(event.metadata?.display_currency || event.metadata?.currency || '').toUpperCase())
    .filter((currency) => currency && !['NGN', 'USD'].includes(currency)))]
  if (unsupportedCurrencies.length > 0) {
    findings.push({
      checkKey: 'events.currency_inconsistency',
      severity: 'warning',
      status: 'failed',
      scope: 'revenue_events',
      message: `${unsupportedCurrencies.length} unsupported display/transaction currency value(s) appeared in revenue events.`,
      evidence: { currencies: unsupportedCurrencies.slice(0, 20) },
    })
  }

  const missingActorIdentityEvents = recentEvents.filter((event) => !event.user_id && !event.visitor_id && !event.session_id)
  if (recentEvents.length >= 20 && missingActorIdentityEvents.length / recentEvents.length > 0.05) {
    findings.push({
      checkKey: 'events.missing_actor_identity',
      severity: 'warning',
      status: 'failed',
      scope: 'identity_resolution',
      message: 'More than 5% of recent revenue events are missing user, visitor, and session identifiers. CRO visitor, conversion, and personalization metrics may be unreliable.',
      evidence: {
        missing_actor_events_7d: missingActorIdentityEvents.length,
        total_events_7d: recentEvents.length,
        sample_event_ids: missingActorIdentityEvents.map((event) => event.event_id).filter(Boolean).slice(0, 20),
      },
    })
  }

  const missingAttributionEvents = recentEvents.filter((event) => {
    const attribution = event.metadata?.attribution
    return !attribution || typeof attribution !== 'object' || !String(attribution.channel || '').trim()
  })
  if (recentEvents.length >= 20 && missingAttributionEvents.length / recentEvents.length > 0.15) {
    findings.push({
      checkKey: 'events.missing_attribution',
      severity: 'warning',
      status: 'failed',
      scope: 'attribution',
      message: 'More than 15% of recent revenue events are missing channel attribution. Traffic-source and acquisition opportunities should be treated cautiously.',
      evidence: {
        missing_attribution_events_7d: missingAttributionEvents.length,
        total_events_7d: recentEvents.length,
        sample_event_ids: missingAttributionEvents.map((event) => event.event_id).filter(Boolean).slice(0, 20),
      },
    })
  }

  const eventIds = new Map<string, number>()
  for (const event of recentEvents) {
    if (!event.event_id) continue
    eventIds.set(event.event_id, (eventIds.get(event.event_id) || 0) + 1)
  }
  const duplicateEventIds = [...eventIds.entries()].filter(([, count]) => count > 1)
  if (duplicateEventIds.length > 0) {
    findings.push({
      checkKey: 'events.duplicate_event_ids',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${duplicateEventIds.length} duplicate revenue event id(s) were found in the last 7 days.`,
      evidence: { duplicates: duplicateEventIds.slice(0, 20) },
    })
  }

  const orphanProductEvents = recentEvents.filter((event) => event.product_group_id && !productById.has(event.product_group_id))
  if (orphanProductEvents.length > 0) {
    findings.push({
      checkKey: 'events.orphan_product_group_id',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${orphanProductEvents.length} revenue event(s) reference products that no longer exist, so product-level CRO attribution is unsafe.`,
      evidence: { product_group_ids: [...new Set(orphanProductEvents.map((event) => event.product_group_id))].slice(0, 30) },
    })
  }

  const completedOrders = recentOrders.filter((order) => String(order.status || '').toLowerCase() === 'completed')
  const completedCommerceOrders = [
    ...completedOrders,
    ...recentSmsOrders.filter((order) => isSuccessfulCommerceStatus(order.status)),
    ...recentServiceOrders.filter((order) => isSuccessfulCommerceStatus(order.status)),
  ]
  const impossibleOrders = completedOrders.filter((order) => toNumber(order.amount) <= 0 || (order.product_group_id && !productById.has(order.product_group_id)))
  if (impossibleOrders.length > 0) {
    findings.push({
      checkKey: 'orders.impossible_completed_orders',
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
      checkKey: 'orders.display_charge_mismatch',
      severity: 'critical',
      status: 'failed',
      scope: 'orders',
      message: `${displayChargeMismatches.length} completed order(s) charged a different amount than the customer-confirmed displayed price.`,
      evidence: { mismatches: displayChargeMismatches.slice(0, 20) },
    })
  }

  const unitPricesByProduct = new Map<string, number[]>()
  for (const order of completedOrders) {
    if (!order.product_group_id || order.discount_code_id) continue
    const quantity = Math.max(1, Math.round(toNumber(order.account_details?.quantity, 1)))
    const unitPrice = toNumber(order.account_details?.price_per_unit, toNumber(order.amount) / quantity)
    if (unitPrice <= 0) continue
    unitPricesByProduct.set(String(order.product_group_id), [...(unitPricesByProduct.get(String(order.product_group_id)) || []), unitPrice])
  }
  const suspiciousUnitPriceVariance = [...unitPricesByProduct.entries()]
    .map(([productId, prices]) => {
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      return { product_id: productId, min_unit_price: min, max_unit_price: max, sample_size: prices.length, ratio: min > 0 ? max / min : 0 }
    })
    .filter((row) => row.sample_size >= 3 && row.ratio >= 1.2)
  if (suspiciousUnitPriceVariance.length > 0) {
    findings.push({
      checkKey: 'pricing.unit_price_variance',
      severity: 'warning',
      status: 'failed',
      scope: 'orders',
      message: `${suspiciousUnitPriceVariance.length} product(s) have large no-discount unit-price variance in recent completed orders. Verify this came from intentional admin price changes, not customer-personalized pricing.`,
      evidence: { products: suspiciousUnitPriceVariance.slice(0, 20) },
    })
  }

  const paymentStarts = recentEvents.filter((event) => event.event_type === 'PAYMENT_STARTED')
  const paymentProviderLoads = recentEvents.filter((event) => event.event_type === 'PAYMENT_PROVIDER_LOADED')
  const paymentAttempts = recentEvents.filter((event) => event.event_type === 'PAYMENT_ATTEMPTED')
  const commercePaymentCompleted = recentEvents.filter(isCommercePaymentCompletedEvent)
  const paymentFailures = recentEvents.filter((event) => event.event_type === 'PAYMENT_FAILED')
  const productOrderById = new Map(recentOrders.map((order) => [String(order.id), order]))
  const smsOrderById = new Map(recentSmsOrders.map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of recentServiceOrders) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }
  const productPurchases = recentEvents.filter((event) => event.event_type === 'PRODUCT_PURCHASED')
  const orderBackedProductPurchases = productPurchases.filter((event) => isOrderBackedPurchaseEvent(event, productOrderById, smsOrderById, serviceOrderById))
  const unbackedProductPurchases = productPurchases.filter((event) => !isOrderBackedPurchaseEvent(event, productOrderById, smsOrderById, serviceOrderById))
  const buyClicks = recentEvents.filter((event) => event.event_type === 'BUY_CLICKED')
  const productImpressions = recentEvents.filter((event) => event.event_type === 'PRODUCT_IMPRESSION')
  const productClicks = recentEvents.filter((event) => event.event_type === 'PRODUCT_CLICKED' || event.event_type === 'RECOMMENDATION_CLICKED')
  const uniqueVisitors = new Set(recentEvents.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size
  const conversion = uniqueVisitors > 0 ? completedCommerceOrders.length / uniqueVisitors : 0

  if (uniqueVisitors >= 20 && conversion >= 0.95) {
    findings.push({
      checkKey: 'events.impossible_conversion_rate',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Conversion is near 100% with meaningful traffic, which usually means tracking or filtering is broken.',
      evidence: { unique_visitors_7d: uniqueVisitors, completed_orders_7d: completedCommerceOrders.length, conversion_rate: conversion },
    })
  }

  if (completedCommerceOrders.length >= 3 && orderBackedProductPurchases.length === 0) {
    findings.push({
      checkKey: 'events.missing_purchase_events',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Completed orders exist but no PRODUCT_PURCHASED events were recorded, so Revenue OS cannot safely learn from purchases.',
      evidence: { completed_orders_7d: completedCommerceOrders.length },
    })
  }

  if (orderBackedProductPurchases.length > completedCommerceOrders.length * 2 && completedCommerceOrders.length >= 3) {
    findings.push({
      checkKey: 'events.purchase_event_overcount',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Order-backed PRODUCT_PURCHASED events are more than 2x completed orders.',
      evidence: {
        order_backed_product_purchase_events_7d: orderBackedProductPurchases.length,
        all_product_purchase_events_7d: productPurchases.length,
        completed_orders_7d: completedCommerceOrders.length,
      },
    })
  }

  if (unbackedProductPurchases.length >= 3 || (productPurchases.length >= 6 && unbackedProductPurchases.length / productPurchases.length > 0.25)) {
    findings.push({
      checkKey: 'events.unbacked_purchase_events',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: 'Some PRODUCT_PURCHASED events could not be tied to a real product, SMS, bills, gift card, social boost, or crypto order, so purchase credit is unsafe.',
      evidence: {
        unbacked_product_purchase_events_7d: unbackedProductPurchases.length,
        all_product_purchase_events_7d: productPurchases.length,
        event_ids: unbackedProductPurchases.map((event) => event.event_id).filter(Boolean).slice(0, 30),
      },
    })
  }

  const purchaseEventsByOrderId = new Map<string, any[]>()
  for (const event of orderBackedProductPurchases) {
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
      checkKey: 'events.duplicate_purchase_credit',
      severity: 'critical',
      status: 'failed',
      scope: 'revenue_events',
      message: `${duplicatePurchaseCredits.length} order(s) have more than one PRODUCT_PURCHASED event, so Revenue OS may double-count reward unless deduped.`,
      evidence: { duplicates: duplicatePurchaseCredits.slice(0, 20) },
    })
  }

  const reversedPurchaseEvents = orderBackedProductPurchases.filter((event) => {
    const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
    return linkedOrder && isReversedCommerceStatus(linkedOrder.status)
  })
  if (reversedPurchaseEvents.length > 0) {
    findings.push({
      checkKey: 'events.reversed_purchase_reward',
      severity: 'warning',
      status: 'failed',
      scope: 'revenue_events',
      message: `${reversedPurchaseEvents.length} purchase event(s) are linked to cancelled, failed, expired, or refunded orders and will not receive CRO reward credit.`,
      evidence: { event_ids: reversedPurchaseEvents.map((event) => event.event_id).slice(0, 30) },
    })
  }

  if (productPurchases.length >= 3 && paymentStarts.length === 0) {
    findings.push({
      checkKey: 'events.missing_payment_started',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Purchase events exist but no PAYMENT_STARTED events were recorded, so payment funnel diagnosis is unsafe.',
      evidence: { product_purchase_events_7d: productPurchases.length },
    })
  }

  if (productClicks.length >= 10 && productImpressions.length === 0) {
    findings.push({
      checkKey: 'events.missing_product_impressions',
      severity: 'critical',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Product/recommendation clicks exist but no PRODUCT_IMPRESSION events were recorded, so ranking and recommendation attribution are unsafe.',
      evidence: {
        product_click_events_7d: productClicks.length,
        buy_clicks_7d: buyClicks.length,
        product_purchase_events_7d: productPurchases.length,
      },
    })
  }

  if (productClicks.length >= 20 && productImpressions.length > 0 && productClicks.length > productImpressions.length) {
    findings.push({
      checkKey: 'events.low_product_impression_coverage',
      severity: 'warning',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Product/recommendation clicks exceed recorded impressions, which usually means some pages are missing PRODUCT_IMPRESSION tracking.',
      evidence: {
        product_click_events_7d: productClicks.length,
        product_impression_events_7d: productImpressions.length,
        coverage_ratio: productImpressions.length / productClicks.length,
      },
    })
  }

  if (orderBackedProductPurchases.length >= 3 && productImpressions.length === 0) {
    findings.push({
      checkKey: 'events.purchase_without_exposure',
      severity: 'critical',
      status: 'failed',
      scope: 'recommendation_exposure',
      message: 'Order-backed purchases exist but no PRODUCT_IMPRESSION events were recorded, so CRO cannot measure whether product placement caused the sale.',
      evidence: {
        order_backed_product_purchase_events_7d: orderBackedProductPurchases.length,
        completed_orders_7d: completedCommerceOrders.length,
      },
    })
  }

  if (paymentStarts.length >= 3 && buyClicks.length >= 3 && paymentProviderLoads.length === 0) {
    findings.push({
      checkKey: 'events.missing_payment_provider_loaded',
      severity: 'warning',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Payment starts exist but no PAYMENT_PROVIDER_LOADED events were recorded, so provider/form-load outages may be misdiagnosed as merchandising problems.',
      evidence: { payment_starts_7d: paymentStarts.length, buy_clicks_7d: buyClicks.length },
    })
  }

  if (orderBackedProductPurchases.length >= 3 && commercePaymentCompleted.length === 0) {
    findings.push({
      checkKey: 'events.missing_payment_completed',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Order-backed purchase events exist but no commerce PAYMENT_COMPLETED events were recorded. Wallet top-ups are excluded; CRO attribution is unsafe.',
      evidence: { order_backed_product_purchase_events_7d: orderBackedProductPurchases.length },
    })
  }

  if (orderBackedProductPurchases.length >= 3 && commercePaymentCompleted.length > orderBackedProductPurchases.length * 2) {
    findings.push({
      checkKey: 'events.payment_completed_overcount',
      severity: 'critical',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Commerce PAYMENT_COMPLETED events are unusually high relative to order-backed purchases, so revenue attribution may be inflated.',
      evidence: {
        commerce_payment_completed_7d: commercePaymentCompleted.length,
        order_backed_product_purchase_events_7d: orderBackedProductPurchases.length,
      },
    })
  }

  if (paymentFailures.length >= 5 && paymentAttempts.length === 0) {
    findings.push({
      checkKey: 'events.failed_without_attempts',
      severity: 'warning',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'Payment failures exist without PAYMENT_ATTEMPTED events, weakening funnel diagnosis.',
      evidence: { payment_failures_7d: paymentFailures.length },
    })
  }

  if (paymentStarts.length > 0 && buyClicks.length > 0 && paymentStarts.length > buyClicks.length * 3) {
    findings.push({
      checkKey: 'events.payment_start_overcount',
      severity: 'warning',
      status: 'failed',
      scope: 'payment_funnel',
      message: 'PAYMENT_STARTED events are unusually high relative to BUY_CLICKED events.',
      evidence: { payment_starts_7d: paymentStarts.length, buy_clicks_7d: buyClicks.length },
    })
  }

  const botOrSuspect = recentEvents.filter((event) => ['bot', 'suspect', 'internal'].includes(String(event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human').toLowerCase()))
  if (recentEvents.length >= 50 && botOrSuspect.length / recentEvents.length > 0.35) {
    const ratio = botOrSuspect.length / recentEvents.length
    findings.push({
      checkKey: 'traffic.low_quality_event_ratio',
      severity: ratio > 0.5 ? 'critical' : 'warning',
      status: 'failed',
      scope: 'traffic_quality',
      message: 'A large share of recent events are bot, suspect, or internal traffic.',
      evidence: { low_quality_events_7d: botOrSuspect.length, total_events_7d: recentEvents.length, ratio },
    })
  }

  if (findings.length === 0) {
    findings.push({
      checkKey: 'events.health',
      severity: 'info',
      status: 'passed',
      scope: 'revenue_events',
      message: 'Behavioural event and payment-funnel checks passed.',
      evidence: {
        events_7d: recentEvents.length,
        completed_orders_7d: completedCommerceOrders.length,
        payment_starts_7d: paymentStarts.length,
        payment_attempts_7d: paymentAttempts.length,
        payment_failures_7d: paymentFailures.length,
      },
    })
  }

  return findings
}

export async function recordRevenueDataQualityFindings(findings: RevenueDataQualityFinding[]) {
  if (findings.length === 0) return
  const { error } = await supabase.from('revenue_data_quality_checks' as any).insert(
    findings.map((finding) => ({
      check_key: finding.checkKey,
      severity: finding.severity,
      status: finding.status,
      scope: finding.scope,
      message: finding.message,
      evidence: finding.evidence || {},
    })),
  )
  if (error) throw error
}

function tokenSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : intersection / union
}

export function deriveCatalogueProductRelationships(
  products: ProductGroup[],
  categories: Category[],
  maxRelationships = 1000,
): CatalogueProductRelationship[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const eligibleProducts = products
    .filter((product) => evaluateProductEligibility(product).isSellable)
    .slice(0, 600)

  const relationships: CatalogueProductRelationship[] = []

  for (let leftIndex = 0; leftIndex < eligibleProducts.length; leftIndex += 1) {
    const left = eligibleProducts[leftIndex]
    const leftCategory = categoryById.get(left.category_id)
    const leftTokens = getProductTokens(left, leftCategory)

    for (let rightIndex = leftIndex + 1; rightIndex < eligibleProducts.length; rightIndex += 1) {
      const right = eligibleProducts[rightIndex]
      const rightCategory = categoryById.get(right.category_id)
      const sameCategory = left.category_id === right.category_id
      if (!sameCategory) continue

      const similarity = tokenSimilarity(leftTokens, getProductTokens(right, rightCategory))
      if (similarity < 0.18) continue

      const leftPrice = Number(left.price || 0)
      const rightPrice = Number(right.price || 0)
      const maxPrice = Math.max(leftPrice, rightPrice, 1)
      const priceSpread = Math.abs(leftPrice - rightPrice) / maxPrice
      const averageStock = (Number(left.stock_count || 0) + Number(right.stock_count || 0)) / 2
      const confidence = Math.min(0.94, 0.42 + similarity * 0.42 + Math.min(averageStock, 50) / 500)
      const strength = Math.min(1, similarity * 0.78 + (sameCategory ? 0.16 : 0) + Math.max(0, 0.2 - priceSpread))

      const addRelationship = (
        fromProductGroupId: string,
        toProductGroupId: string,
        relationshipType: CatalogueProductRelationship['relationshipType'],
        relationshipStrength = strength,
      ) => {
        relationships.push({
          fromProductGroupId,
          toProductGroupId,
          relationshipType,
          strength: Number(relationshipStrength.toFixed(4)),
          confidence: Number(confidence.toFixed(4)),
          metadata: {
            token_similarity: Number(similarity.toFixed(4)),
            price_spread: Number(priceSpread.toFixed(4)),
            source_basis: 'category_tokens_price',
          },
        })
      }

      if (similarity >= 0.62 && priceSpread <= 0.08) {
        addRelationship(left.id, right.id, 'VARIANT')
        addRelationship(right.id, left.id, 'VARIANT')
      } else if (similarity >= 0.38 && priceSpread <= 0.18) {
        addRelationship(left.id, right.id, 'SAME_INTENT')
        addRelationship(right.id, left.id, 'SAME_INTENT')
      } else if (similarity >= 0.24) {
        addRelationship(left.id, right.id, 'ALTERNATIVE')
        addRelationship(right.id, left.id, 'ALTERNATIVE')
      }

      if (similarity >= 0.22 && priceSpread > 0.08) {
        const cheaper = leftPrice <= rightPrice ? left : right
        const pricier = leftPrice <= rightPrice ? right : left
        addRelationship(cheaper.id, pricier.id, 'UPGRADE', Math.min(1, strength + 0.08))
        addRelationship(pricier.id, cheaper.id, 'DOWNGRADE', Math.min(1, strength + 0.08))
      }

      if (relationships.length >= maxRelationships) {
        return relationships
      }
    }
  }

  return relationships
}

export function deriveBehavioralProductRelationships(
  events: any[],
  products: ProductGroup[],
  options: {
    orders?: any[]
    smsOrders?: any[]
    serviceOrders?: any[]
  } = {},
  maxRelationships = 1000,
): CatalogueProductRelationship[] {
  const sellableIds = new Set(products.filter((product) => evaluateProductEligibility(product).isSellable).map((product) => product.id))
  const productById = new Map(products.map((product) => [product.id, product]))
  const productOrderById = new Map((options.orders || []).map((order) => [String(order.id), order]))
  const smsOrderById = new Map((options.smsOrders || []).map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of options.serviceOrders || []) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }
  const hasOrderContext = productOrderById.size > 0 || smsOrderById.size > 0 || serviceOrderById.size > 0
  const grouped = new Map<string, any[]>()

  for (const event of events || []) {
    const productId = event.product_group_id || event.productGroupId
    if (!productId || !sellableIds.has(productId)) continue
    const eventType = String(event.event_type || event.eventType || '')
    if (!['PRODUCT_VIEWED', 'PRODUCT_PURCHASED'].includes(eventType)) continue
    if (eventType === 'PRODUCT_PURCHASED') {
      const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
      if (hasOrderContext) {
        if (!linkedOrder || !isSuccessfulCommerceStatus(linkedOrder.status)) continue
      } else {
        const eventId = String(event.event_id || event.eventId || '').toLowerCase()
        if (!eventId.startsWith('server:') || event.metadata?.authoritative === false || event.metadata?.server_authoritative === false) continue
      }
    }
    const identity = event.user_id || event.visitor_id || event.session_id
    if (!identity) continue
    const key = `${eventType}:${identity}`
    const rows = grouped.get(key) || []
    rows.push(event)
    grouped.set(key, rows)
  }

  const transitionCounts = new Map<string, {
    from: string
    to: string
    type: CatalogueProductRelationship['relationshipType']
    count: number
    totalGapHours: number
    sameSessionCount: number
  }>()

  for (const [key, rows] of grouped) {
    const eventType = key.split(':')[0]
    const relationshipType: CatalogueProductRelationship['relationshipType'] = eventType === 'PRODUCT_PURCHASED' ? 'PURCHASED_NEXT' : 'VIEWED_NEXT'
    const sorted = rows
      .slice()
      .sort((left, right) => new Date(left.created_at || left.timestamp || 0).getTime() - new Date(right.created_at || right.timestamp || 0).getTime())

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      const from = previous.product_group_id || previous.productGroupId
      const to = current.product_group_id || current.productGroupId
      if (!from || !to || from === to) continue

      const previousTime = new Date(previous.created_at || previous.timestamp || 0).getTime()
      const currentTime = new Date(current.created_at || current.timestamp || 0).getTime()
      const gapHours = Math.abs(currentTime - previousTime) / 3600000
      if (Number.isFinite(gapHours) && gapHours > 24 * 30) continue

      const addTransition = (type: CatalogueProductRelationship['relationshipType']) => {
        const transitionKey = `${from}:${to}:${type}`
        const existing = transitionCounts.get(transitionKey) || {
          from,
          to,
          type,
          count: 0,
          totalGapHours: 0,
          sameSessionCount: 0,
        }
        existing.count += 1
        existing.totalGapHours += Number.isFinite(gapHours) ? gapHours : 0
        if (previous.session_id && current.session_id && previous.session_id === current.session_id) existing.sameSessionCount += 1
        transitionCounts.set(transitionKey, existing)
      }

      addTransition(relationshipType)

      if (eventType === 'PRODUCT_PURCHASED' && Number.isFinite(gapHours) && gapHours <= 24 * 14) {
        const fromCategoryId = productById.get(from)?.category_id
        const toCategoryId = productById.get(to)?.category_id
        if (fromCategoryId && toCategoryId && fromCategoryId !== toCategoryId) {
          addTransition('COMPLEMENT')
        }
      }
    }
  }

  return [...transitionCounts.values()]
    .filter((transition) => transition.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, maxRelationships)
    .map((transition) => {
      const confidence = Math.min(0.96, 0.28 + Math.log10(transition.count + 1) / 1.8)
      const strength = Math.min(1, Math.log10(transition.count + 1) / 2)
      return {
        fromProductGroupId: transition.from,
        toProductGroupId: transition.to,
        relationshipType: transition.type,
        strength: Number(strength.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        sampleSize: transition.count,
        source: 'BEHAVIOR',
        metadata: {
          transition_count: transition.count,
          average_delay_hours: Number((transition.totalGapHours / Math.max(1, transition.count)).toFixed(2)),
          same_session_count: transition.sameSessionCount,
          source_basis: 'customer_sequence',
        },
      }
    })
}

export async function recordCatalogueProductRelationships(relationships: CatalogueProductRelationship[]) {
  if (relationships.length === 0) return
  const { error } = await supabase.from('product_relationships' as any).upsert(
    relationships.map((relationship) => ({
      from_product_group_id: relationship.fromProductGroupId,
      to_product_group_id: relationship.toProductGroupId,
      relationship_type: relationship.relationshipType,
      strength: relationship.strength,
      confidence: relationship.confidence,
      sample_size: relationship.sampleSize || 0,
      source: relationship.source || 'CATALOGUE',
      metadata: relationship.metadata || {},
      last_updated: new Date().toISOString(),
    })),
    { onConflict: 'from_product_group_id,to_product_group_id,relationship_type,source' },
  )
  if (error) throw error
}

function priceBand(price: number) {
  if (price <= 0) return 'free_or_invalid'
  if (price < 1000) return 'under_1000'
  if (price < 5000) return '1000_4999'
  if (price < 10000) return '5000_9999'
  if (price < 50000) return '10000_49999'
  if (price < 100000) return '50000_99999'
  return '100000_plus'
}

type ExtractedUnitAttribute = {
  key: string
  label: string
  value: number
  unit: string
  confidence: number
}

function extractUnitAttributes(rawText: string): ExtractedUnitAttribute[] {
  const normalized = String(rawText || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)\s+([a-z])/g, '$1$2')
  const results = new Map<string, ExtractedUnitAttribute>()
  const add = (attribute: ExtractedUnitAttribute) => {
    if (!Number.isFinite(attribute.value) || attribute.value <= 0) return
    const existing = results.get(attribute.key)
    if (!existing || attribute.confidence > existing.confidence) {
      results.set(attribute.key, {
        ...attribute,
        value: Number(attribute.value.toFixed(3)),
      })
    }
  }

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/g)) {
    const amount = Number(match[1])
    const unit = match[2]
    const value = unit === 'tb' ? amount * 1024 : unit === 'mb' ? amount / 1024 : amount
    add({ key: 'attribute_storage_gb', label: 'Storage', value, unit: 'GB', confidence: unit === 'gb' ? 0.78 : 0.72 })
  }

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|l|litre|liter|litres|liters)\b/g)) {
    const amount = Number(match[1])
    const unit = match[2]
    const value = unit === 'ml' ? amount : amount * 1000
    add({ key: 'attribute_volume_ml', label: 'Volume', value, unit: 'ML', confidence: unit === 'ml' ? 0.78 : 0.72 })
  }

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|gram|grams)\b/g)) {
    const amount = Number(match[1])
    const unit = match[2]
    const value = unit === 'kg' ? amount * 1000 : amount
    add({ key: 'attribute_weight_g', label: 'Weight', value, unit: 'G', confidence: unit === 'g' ? 0.76 : 0.7 })
  }

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(inch|inches|in|cm)\b/g)) {
    const amount = Number(match[1])
    const unit = match[2]
    const value = unit === 'cm' ? amount : amount * 2.54
    add({ key: 'attribute_length_cm', label: 'Length', value, unit: 'CM', confidence: unit === 'cm' ? 0.72 : 0.64 })
  }

  return [...results.values()]
}

export function deriveRevenueProductAttributes(
  products: ProductGroup[],
  categories: Category[],
): RevenueProductAttribute[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const pricesByCategory = products.reduce<Record<string, number[]>>((acc, product) => {
    const categoryKey = product.category_id || 'uncategorized'
    const price = toNumber(product.price)
    if (price > 0) acc[categoryKey] = [...(acc[categoryKey] || []), price]
    return acc
  }, {})
  for (const categoryKey of Object.keys(pricesByCategory)) {
    pricesByCategory[categoryKey].sort((a, b) => a - b)
  }
  const pricePercentile = (categoryId: string | null | undefined, price: number) => {
    const prices = pricesByCategory[categoryId || 'uncategorized'] || []
    if (prices.length <= 1 || price <= 0) return null
    const lowerOrEqual = prices.filter((candidate) => candidate <= price).length
    return clamp((lowerOrEqual - 1) / Math.max(1, prices.length - 1))
  }
  const attributes: RevenueProductAttribute[] = []
  const add = (attribute: RevenueProductAttribute) => attributes.push(attribute)

  for (const product of products.filter((row) => row?.id)) {
    const category = categoryById.get(product.category_id)
    const eligibility = evaluateProductEligibility(product)
    const price = toNumber(product.price)
    const stock = toNumber(product.stock_count)
    const normalizedName = normalizeCatalogueText(product.name)
    const normalizedCategory = normalizeCatalogueText(category?.name)
    const fulfillmentMode = canAutoFulfill(product)
      ? stock > 0 ? 'stock_and_provider' : 'provider'
      : 'stock'

    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'normalized_name',
      label: 'Normalized name',
      valueType: 'text',
      textValue: normalizedName,
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: normalizedName ? 0.98 : 0.2,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'normalized_category',
      label: 'Normalized category',
      valueType: 'text',
      textValue: normalizedCategory,
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: normalizedCategory ? 0.98 : 0.2,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'availability_status',
      label: 'Availability status',
      valueType: 'text',
      textValue: eligibility.availabilityStatus,
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: 1,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'is_sellable',
      label: 'Is sellable',
      valueType: 'boolean',
      booleanValue: eligibility.isSellable,
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: 1,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'price_ngn',
      label: 'Price',
      valueType: 'number',
      numericValue: price,
      unit: 'NGN',
      source: 'CATALOGUE',
      confidence: Number.isFinite(price) ? 1 : 0,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'price_band',
      label: 'Price band',
      valueType: 'text',
      textValue: priceBand(price),
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: Number.isFinite(price) ? 0.95 : 0.2,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'category_price_percentile',
      label: 'Category price percentile',
      valueType: 'number',
      numericValue: pricePercentile(product.category_id, price),
      unit: 'PERCENTILE',
      source: 'CATALOGUE',
      confidence: (pricesByCategory[product.category_id || 'uncategorized'] || []).length > 3 ? 0.85 : 0.35,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'stock_count',
      label: 'Stock count',
      valueType: 'number',
      numericValue: stock,
      unit: 'COUNT',
      source: 'CATALOGUE',
      confidence: Number.isFinite(stock) ? 1 : 0,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'fulfillment_mode',
      label: 'Fulfillment mode',
      valueType: 'text',
      textValue: fulfillmentMode,
      unit: 'VALUE',
      source: 'CATALOGUE',
      confidence: 0.9,
    })
    add({
      productGroupId: product.id,
      categoryId: product.category_id,
      key: 'name_token_count',
      label: 'Name token count',
      valueType: 'number',
      numericValue: normalizedName ? normalizedName.split(' ').filter(Boolean).length : 0,
      unit: 'COUNT',
      source: 'CATALOGUE',
      confidence: 0.95,
    })

    for (const unitAttribute of extractUnitAttributes(`${product.name || ''} ${product.description || ''} ${category?.name || ''}`)) {
      add({
        productGroupId: product.id,
        categoryId: product.category_id,
        key: unitAttribute.key,
        label: unitAttribute.label,
        valueType: 'number',
        numericValue: unitAttribute.value,
        unit: unitAttribute.unit,
        source: 'CATALOGUE',
        confidence: unitAttribute.confidence,
      })
    }
  }

  return attributes
}

export async function recordRevenueProductAttributes(attributes: RevenueProductAttribute[]) {
  if (attributes.length === 0) return
  const definitions = [...new Map(attributes.map((attribute) => [attribute.key, attribute])).values()]

  const { error: definitionError } = await supabase.from('product_attribute_definitions' as any).upsert(
    definitions.map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      value_type: attribute.valueType,
      allowed_units: [...new Set(attributes.filter((row) => row.key === attribute.key).map((row) => row.unit))],
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'key' },
  )
  if (definitionError) throw definitionError

  const { data: definitionRows, error: loadDefinitionError } = await supabase
    .from('product_attribute_definitions' as any)
    .select('id,key')
    .in('key', definitions.map((attribute) => attribute.key))
  if (loadDefinitionError) throw loadDefinitionError

  const definitionIdByKey = new Map((definitionRows || []).map((row: any) => [row.key, row.id]))
  const rows = attributes
    .map((attribute) => {
      const definitionId = definitionIdByKey.get(attribute.key)
      if (!definitionId) return null
      return {
        product_group_id: attribute.productGroupId,
        attribute_definition_id: definitionId,
        text_value: attribute.textValue ?? null,
        numeric_value: attribute.numericValue ?? null,
        boolean_value: attribute.booleanValue ?? null,
        date_value: attribute.dateValue ?? null,
        unit: attribute.unit,
        source: attribute.source,
        confidence: attribute.confidence,
        updated_at: new Date().toISOString(),
      }
    })
    .filter(Boolean)

  const { error: attributeError } = await supabase
    .from('product_attributes' as any)
    .upsert(rows, { onConflict: 'product_group_id,attribute_definition_id,unit' })
  if (attributeError) throw attributeError

  const categoryRows = attributes
    .filter((attribute) => attribute.categoryId)
    .map((attribute) => {
      const definitionId = definitionIdByKey.get(attribute.key)
      if (!definitionId) return null
      return {
        category_id: attribute.categoryId,
        attribute_definition_id: definitionId,
        is_required: ['normalized_name', 'availability_status', 'is_sellable', 'price_ngn'].includes(attribute.key),
        weight: ['normalized_name', 'availability_status', 'is_sellable'].includes(attribute.key) ? 1 : 0.5,
      }
    })
    .filter(Boolean)

  if (categoryRows.length > 0) {
    const { error: categoryError } = await supabase
      .from('category_attribute_definitions' as any)
      .upsert(categoryRows, { onConflict: 'category_id,attribute_definition_id' })
    if (categoryError) throw categoryError
  }
}

function characterNgrams(value: string, size = 3) {
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= size) return compact ? [compact] : []
  const grams: string[] = []
  for (let index = 0; index <= compact.length - size; index += 1) {
    grams.push(compact.slice(index, index + size))
  }
  return grams
}

export function scoreProductSearchRelevance(product: ProductGroup, category: Category | undefined, query: string) {
  return retrieveProductForQuery(product, category, query).score
}

export function retrieveProductForQuery(product: ProductGroup, category: Category | undefined, query: string): ProductRetrievalResult {
  const normalizedQuery = normalizeCatalogueText(query)
  const normalizedName = normalizeCatalogueText(product.name)
  const normalizedCategory = normalizeCatalogueText(category?.name)
  const haystack = normalizeCatalogueText(`${product.name} ${product.description || ''} ${category?.name || ''}`)
  const queryTokens = normalizedQuery.split(' ').filter(Boolean)
  if (!normalizedQuery) {
    return {
      product,
      score: 0,
      matched: true,
      evidence: {
        exactName: false,
        phrase: false,
        exactTokenMatches: 0,
        prefixMatches: 0,
        missingTokens: 0,
        ngramSimilarity: 0,
        categoryMatch: false,
      },
    }
  }

  const productTokens = haystack.split(' ').filter(Boolean)
  const productTokenSet = new Set(productTokens)
  const exactName = normalizedName === normalizedQuery
  const phrase = haystack.includes(normalizedQuery)
  const exactMatches = queryTokens.filter((token) => productTokenSet.has(token)).length
  const prefixMatches = queryTokens.filter((token) =>
    token.length >= 2 && !productTokenSet.has(token) && productTokens.some((productToken) => productToken.startsWith(token)),
  ).length
  const missingTokens = Math.max(0, queryTokens.length - exactMatches - prefixMatches)
  const ngramSimilarity = tokenSimilarity(characterNgrams(normalizedQuery), characterNgrams(haystack))
  const categoryMatch = normalizedCategory.length > 0 && (
    normalizedCategory === normalizedQuery ||
    normalizedCategory.includes(normalizedQuery) ||
    queryTokens.some((token) => normalizedCategory.split(' ').includes(token))
  )
  const exactScore = exactName ? 5000 : phrase ? 3500 : 0
  const tokenScore = exactMatches * 700 + prefixMatches * 360 - missingTokens * 110
  const ngramScore = ngramSimilarity * 520
  const categoryScore = categoryMatch ? 420 : 0
  const score = Math.round(exactScore + tokenScore + ngramScore + categoryScore)
  const matched = exactName || phrase || exactMatches > 0 || prefixMatches > 0 || ngramSimilarity >= 0.16 || categoryMatch

  return {
    product,
    score,
    matched,
    evidence: {
      exactName,
      phrase,
      exactTokenMatches: exactMatches,
      prefixMatches,
      missingTokens,
      ngramSimilarity,
      categoryMatch,
    },
  }
}

export function retrieveProductsForQuery(products: ProductGroup[], categories: Category[], query: string) {
  const normalizedQuery = normalizeCatalogueText(query)
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  if (!normalizedQuery) {
    return products.map((product) => retrieveProductForQuery(product, categoryById.get(product.category_id), query))
  }
  return products
    .map((product) => retrieveProductForQuery(product, categoryById.get(product.category_id), query))
    .filter((result) => result.matched && result.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.product.created_at).getTime() - new Date(a.product.created_at).getTime())
}

export function rankProductsForRevenueOs(
  products: ProductGroup[],
  categories: Category[],
  context: RevenueOsContext,
): RankedProduct[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const topSellingIds = context.topSellingIds || []
  const favoriteProductIds = context.favoriteProductIds || []
  const restockedIds = context.restockedIds || []
  const settings = context.settings || DEFAULT_SETTINGS
  const query = context.query || ''
  const croRankingEnabled = settings.enabled && !settings.freezeReason && !settings.shadowMode
  const runningActionPlans = (context.actionPlans || [])
    .filter((plan) => croRankingEnabled && String(plan.status || '').toLowerCase() === 'running' && actionPlanAppliesToSurface(plan, context.surface))

  return products
    .map((product): RankedProduct => {
      const category = categoryById.get(product.category_id)
      const eligibility = evaluateProductEligibility(product)
      const reasons: string[] = []
      const productPurchaseCount = context.customer?.productGroupCounts[product.id] || 0
      const productLastPurchasedAt = context.customer?.lastPurchasedAtByProductGroup?.[product.id]
      const productDaysSincePurchase = productLastPurchasedAt
        ? Math.max(0, (Date.now() - new Date(productLastPurchasedAt).getTime()) / 86400000)
        : null
      const repeatReadiness =
        productPurchaseCount <= 0
          ? 0
          : productDaysSincePurchase == null
            ? 0.35
            : productDaysSincePurchase < 1
              ? 0
              : productDaysSincePurchase <= 7
                ? 0.16
                : productDaysSincePurchase <= 30
                  ? 0.48
                  : productDaysSincePurchase <= 90
                    ? 0.72
                    : 0.9
      const personalProductScore = Math.min(productPurchaseCount, 6) * 1800 * repeatReadiness
      const personalCategoryScore = (context.customer?.categoryCounts[product.category_id] || 0) * 1200
      const categoryLastPurchasedAt = context.customer?.lastPurchasedAtByCategory?.[product.category_id]
      const categoryDaysSincePurchase = categoryLastPurchasedAt
        ? Math.max(0, (Date.now() - new Date(categoryLastPurchasedAt).getTime()) / 86400000)
        : null
      const categoryRecencyScore = categoryDaysSincePurchase == null
        ? 0
        : categoryDaysSincePurchase <= 7
          ? 900
          : categoryDaysSincePurchase <= 30
            ? 500
            : categoryDaysSincePurchase <= 90
              ? 160
              : 0
      const justBoughtPenalty = context.customer?.lastProductGroupId === product.id && !query
        ? productDaysSincePurchase != null && productDaysSincePurchase < 1
          ? -18000
          : -2200
        : 0
      const relationshipScore = (context.relationshipBoosts?.[product.id] || 0) * 1800
      const topRank = topSellingIds.indexOf(product.id)
      const topSellerScore = topRank === -1 ? 0 : Math.max(0, 900 - topRank * 45)
      const favoriteRank = favoriteProductIds.indexOf(product.id)
      const favoriteScore = favoriteRank === -1 ? 0 : Math.max(0, 1400 - favoriteRank * 55)
      const restockScore = restockedIds.includes(product.id) ? 250 : 0
      const stockScore = Math.min(Number(product.stock_count || 0), 120)
      const freshnessDays = Math.max(0, (Date.now() - new Date(product.created_at).getTime()) / 86400000)
      const freshnessScore = Math.max(0, 80 - freshnessDays)
      const relevanceScore = scoreProductSearchRelevance(product, category, query)
      const actionPlanModifiers = runningActionPlans
        .map((plan) => actionPlanProductModifier(plan, product, category))
        .filter(Boolean) as Array<{ score: number; reason: string }>
      const actionPlanScore = actionPlanModifiers.reduce((sum, modifier) => sum + modifier.score, 0)
      const sellablePenalty = eligibility.isSellable ? 0 : -100000
      const categoryMatch = context.selectedCategoryId && context.selectedCategoryId !== 'all'
        ? product.category_id === context.selectedCategoryId ? 500 : -100000
        : 0

      if (personalProductScore > 0) reasons.push('customer_repeat_purchase_fit')
      if (productPurchaseCount > 0 && personalProductScore === 0) reasons.push('repeat_purchase_cooldown')
      if (personalCategoryScore > 0) reasons.push('customer_category_affinity')
      if (categoryRecencyScore > 0) reasons.push('customer_recent_category_interest')
      if (justBoughtPenalty < 0) reasons.push('suppress_immediate_repeat')
      if (relationshipScore > 0) reasons.push('customer_related_product')
      if (favoriteScore > 0) reasons.push('admin_favorite_product')
      if (topSellerScore > 0) reasons.push('global_top_seller')
      if (restockScore > 0) reasons.push('recently_restocked')
      if (stockScore > 0) reasons.push('available_stock')
      if (relevanceScore > 0) reasons.push('query_relevance')
      for (const modifier of actionPlanModifiers) reasons.push(modifier.reason)
      if (!eligibility.isSellable) reasons.push(...eligibility.reasons)

      const autonomyMultiplier = croRankingEnabled ? Math.min(Math.max(settings.autonomyLevel, 0), 8) / 2 : 0
      const score = sellablePenalty
        + categoryMatch
        + relevanceScore
        + justBoughtPenalty
        + actionPlanScore
        + (personalProductScore + personalCategoryScore + categoryRecencyScore + relationshipScore + favoriteScore + topSellerScore + restockScore + stockScore + freshnessScore) * autonomyMultiplier

      const confidence = Math.min(0.98, 0.35 + (favoriteScore > 0 ? 0.18 : 0) + (topSellerScore > 0 ? 0.2 : 0) + (personalCategoryScore > 0 ? 0.18 : 0) + (categoryRecencyScore > 0 ? 0.08 : 0) + (relationshipScore > 0 ? 0.16 : 0) + (relevanceScore > 0 ? 0.2 : 0) + (actionPlanScore > 0 ? 0.08 : 0) + (eligibility.isSellable ? 0.05 : 0))
      const action: CroActionType = query
        ? 'SHOW_REQUESTED_PRODUCT'
        : relationshipScore > 0
          ? 'POST_PURCHASE_RECOMMENDATION'
          : topSellerScore > 0
            ? 'SHOW_TRENDING'
            : personalCategoryScore > 0 || categoryRecencyScore > 0
              ? 'SHOW_ALTERNATIVE'
              : 'SHOW_ALTERNATIVE'

      return {
        product,
        action,
        score,
        confidence,
        eligibility,
        reasons,
      }
    })
    .filter((ranked) => ranked.eligibility.isSellable)
    .sort((a, b) => b.score - a.score || new Date(b.product.created_at).getTime() - new Date(a.product.created_at).getTime())
}

function arbitrateCommerceActionCandidates(
  candidates: NextBestActionCandidate[],
  context: RevenueOsContext & { supportIntent?: boolean },
): { winning: NextBestActionCandidate; arbitration: CroActionArbitration } {
  const eligible = candidates.filter((candidate) => candidate.eligible)
  const rulesApplied: string[] = []
  let hardGuardrailApplied = false
  let winning = eligible[0] || candidates[0]

  const supportCandidate = eligible.find((candidate) => candidate.action === 'SUPPORT_HANDOFF')
  if (context.supportIntent && supportCandidate) {
    winning = supportCandidate
    hardGuardrailApplied = true
    rulesApplied.push('support_intent_overrides_commercial_actions')
  } else {
    const croBlocked = context.settings?.enabled === false || !!context.settings?.freezeReason || !!context.settings?.shadowMode || context.assignment?.mode === 'holdout' || context.assignment?.mode === 'control'
    const doNothingCandidate = eligible.find((candidate) => candidate.action === 'DO_NOTHING')
    if (croBlocked && doNothingCandidate) {
      winning = doNothingCandidate
      hardGuardrailApplied = true
      rulesApplied.push('cro_disabled_or_holdout_requires_do_nothing')
    } else {
      const pressureCandidate = eligible.find((candidate) => candidate.action === 'DO_NOTHING' && candidate.reasons.includes('customer_pressure_limit_reached'))
      if (pressureCandidate) {
        winning = pressureCandidate
        hardGuardrailApplied = true
        rulesApplied.push('customer_pressure_limit_requires_do_nothing')
      } else {
        winning = eligible
          .sort((left, right) => right.score - left.score || right.confidence - left.confidence)[0] || winning
        rulesApplied.push('highest_expected_incremental_value_wins')
      }
    }
  }

  return {
    winning,
    arbitration: {
      selectedAction: winning.action,
      hardGuardrailApplied,
      rulesApplied,
      eligibleCandidates: eligible.length,
      rejectedCandidates: candidates.length - eligible.length,
      conflictSet: Array.from(new Set(candidates.map((candidate) => candidate.action))),
    },
  }
}

export function decideNextBestCommerceAction(
  rankedProducts: RankedProduct[],
  context: RevenueOsContext & {
    purchaseIntent?: number
    supportIntent?: boolean
    requestedProductId?: string | null
  },
): NextBestCommerceAction {
  const settings = context.settings || DEFAULT_SETTINGS
  const pressure = context.pressure || getCustomerPressureState()
  const pressureLimit = Math.max(0, settings.pressureLimit || DEFAULT_SETTINGS.pressureLimit)
  const sellableCandidates = rankedProducts.filter((ranked) => ranked.eligibility.isSellable)
  const best = sellableCandidates[0] || null
  const requested = context.requestedProductId
    ? sellableCandidates.find((ranked) => ranked.product.id === context.requestedProductId) || null
    : null
  const purchaseIntent = clamp(context.purchaseIntent ?? (pressure.buyClicks > 0 ? 0.82 : context.query ? 0.52 : 0.34))

  const candidates: NextBestActionCandidate[] = []

  const pushCandidate = (
    action: CroActionType,
    selected: RankedProduct | null,
    score: number,
    confidence: number,
    reasons: string[],
    eligible = true,
  ) => {
    candidates.push({
      action,
      productId: selected?.product.id || null,
      score: Number(score.toFixed(4)),
      confidence: Number(clamp(confidence).toFixed(4)),
      eligible,
      reasons,
    })
  }

  if (context.supportIntent) {
    pushCandidate('SUPPORT_HANDOFF', null, 100000, 0.99, ['support_intent_overrides_selling'])
  }

  if (!settings.enabled || settings.freezeReason || settings.shadowMode || context.assignment?.mode === 'holdout' || context.assignment?.mode === 'control') {
    pushCandidate('DO_NOTHING', null, 90000, 0.96, [settings.freezeReason ? 'data_quality_freeze' : settings.shadowMode ? 'shadow_mode_observe_only' : context.assignment?.reason || 'cro_not_active_for_customer'])
  }

  if (pressure.pressureScore >= pressureLimit && pressureLimit > 0) {
    pushCandidate('DO_NOTHING', null, 85000 + pressure.pressureScore * 100, 0.92, ['customer_pressure_limit_reached'])
  }

  if (purchaseIntent >= 0.82) {
    pushCandidate('CLOSE_PURCHASE', requested || best, 76000 + purchaseIntent * 10000 - pressure.pressureScore * 250, 0.88, ['high_purchase_intent_get_out_of_way'])
  }

  if (requested) {
    pushCandidate('SHOW_REQUESTED_PRODUCT', requested, requested.score + 7000, requested.confidence, ['explicit_customer_request', ...requested.reasons])
  }

  if (best) {
    const baseExpectedValue = Number(best.product.price || 0) * clamp(best.confidence, 0.05, 0.95)
    const frictionCost = pressure.pressureScore * 400
    const action = context.query ? 'SHOW_REQUESTED_PRODUCT' : best.action
    pushCandidate(
      action,
      best,
      best.score + baseExpectedValue * 0.08 - frictionCost,
      best.confidence,
      ['highest_expected_value_candidate', ...best.reasons],
    )
  }

  if (!context.query && sellableCandidates.length > 2 && purchaseIntent < 0.45 && pressure.pressureScore < pressureLimit) {
    pushCandidate('ASK_FEATURE', null, 1200 + sellableCandidates.length * 4, 0.62, ['low_intent_better_to_qualify'])
  }

  if (candidates.length === 0) {
    pushCandidate('DO_NOTHING', null, 0, 0.7, ['no_eligible_candidate'])
  }

  const { winning, arbitration } = arbitrateCommerceActionCandidates(candidates, {
    ...context,
    settings,
  })
  const selected = winning.productId ? sellableCandidates.find((ranked) => ranked.product.id === winning.productId) || null : null

  return {
    action: winning.action,
    selected,
    candidates,
    arbitration,
    confidence: winning.confidence,
    expectedValue: selected ? Math.max(0, Number(selected.product.price || 0) * winning.confidence - pressure.pressureScore * 400) : 0,
    pressureScore: pressure.pressureScore,
    reason: winning.reasons[0] || 'highest_scored_action',
  }
}

export async function loadCustomerRelationshipBoosts(
  productGroupCounts: Record<string, number>,
  lastPurchasedAtByProductGroup: Record<string, string> = {},
) {
  const purchasedProductIds = Object.keys(productGroupCounts).filter((id) => productGroupCounts[id] > 0).slice(0, 100)
  if (purchasedProductIds.length === 0) return {}

  try {
    const { data, error } = await supabase
      .from('product_relationships' as any)
      .select('from_product_group_id,to_product_group_id,relationship_type,strength,confidence')
      .in('from_product_group_id', purchasedProductIds)

    if (error) throw error

    const typeWeights: Record<string, number> = {
      PURCHASED_NEXT: 2.4,
      SAME_INTENT: 1.55,
      VARIANT: 1.45,
      UPGRADE: 1.35,
      ALTERNATIVE: 1.15,
      DOWNGRADE: 1.0,
      COMPLEMENT: 1.3,
      VIEWED_NEXT: 0.9,
    }

    return (data || []).reduce<Record<string, number>>((acc, row: any) => {
      const targetId = row.to_product_group_id
      if (!targetId || productGroupCounts[targetId]) return acc
      const sourceCount = Math.min(productGroupCounts[row.from_product_group_id] || 1, 5)
      const lastPurchasedAt = lastPurchasedAtByProductGroup[row.from_product_group_id]
      const daysSinceSourcePurchase = lastPurchasedAt
        ? Math.max(0, (Date.now() - new Date(lastPurchasedAt).getTime()) / 86400000)
        : 30
      const recencyWeight = daysSinceSourcePurchase <= 7
        ? 1.35
        : daysSinceSourcePurchase <= 30
          ? 1.1
          : daysSinceSourcePurchase <= 90
            ? 0.82
            : 0.45
      const weight = typeWeights[row.relationship_type] || 1
      const score = Number(row.strength || 0) * Number(row.confidence || 0) * weight * sourceCount * recencyWeight
      acc[targetId] = (acc[targetId] || 0) + score
      return acc
    }, {})
  } catch (error) {
    console.warn('Customer relationship boosts unavailable:', error)
    return {}
  }
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dateOrNull(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date
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
  serviceOrderById: Map<string, any> = new Map(),
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
  for (const id of candidateIds) {
    const serviceOrder = serviceOrderById.get(id)
    if (serviceOrder) return serviceOrder
    if (isSmsEvent) {
      const smsOrder = smsOrderById.get(id)
      if (smsOrder) return smsOrder
    } else {
      const productOrder = productOrderById.get(id)
      if (productOrder) return productOrder
    }
  }

  for (const id of candidateIds) {
    const linkedOrder = productOrderById.get(id) || smsOrderById.get(id) || serviceOrderById.get(id)
    if (linkedOrder) return linkedOrder
  }
  return null
}

function isOrderBackedPurchaseEvent(
  event: any,
  productOrderById: Map<string, any>,
  smsOrderById: Map<string, any>,
  serviceOrderById: Map<string, any> = new Map(),
) {
  if (event?.event_type !== 'PRODUCT_PURCHASED') return false
  if (linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)) return true
  const surface = String(event?.surface || '').toLowerCase()
  const eventId = String(event?.event_id || '').toLowerCase()
  return ['server_purchase', 'checkout', 'sms', 'sms_webhook', 'bills_payment', 'giftcards_esims', 'social_boost', 'crypto_exchange'].includes(surface) ||
    eventId.startsWith('server:product_purchased:') ||
    eventId.startsWith('sms:product_purchased:') ||
    eventId.startsWith('bills:product_purchased:') ||
    eventId.startsWith('giftcards:product_purchased:') ||
    eventId.startsWith('social:product_purchased:') ||
    eventId.startsWith('crypto:product_purchased:')
}

function isCommercePaymentCompletedEvent(event: any) {
  if (event?.event_type !== 'PAYMENT_COMPLETED') return false
  const surface = String(event?.surface || '').toLowerCase()
  const eventId = String(event?.event_id || '').toLowerCase()
  return !surface.includes('wallet') && !eventId.startsWith('wallet_topup:')
}

function sumBy<T>(rows: T[], getValue: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getValue(row), 0)
}

function orderQuantity(order: any) {
  return Math.max(1, Math.round(toNumber(order.account_details?.quantity, 1)))
}

function classifyCustomerLifecycle(input: {
  orders: any[]
  createdAt?: string | null
  now: Date
}): CustomerLifecycleStage {
  const sorted = input.orders
    .slice()
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
  const created = dateOrNull(input.createdAt)
  const daysSinceSignup = created ? (input.now.getTime() - created.getTime()) / 86400000 : null
  if (sorted.length === 0) return daysSinceSignup != null && daysSinceSignup <= 14 ? 'NEW' : 'LAPSED'

  const lastOrder = sorted.at(-1)
  const lastDate = dateOrNull(lastOrder?.created_at)
  const daysSinceLast = lastDate ? (input.now.getTime() - lastDate.getTime()) / 86400000 : 999
  if (sorted.length === 1) return daysSinceLast <= 30 ? 'FIRST_PURCHASE' : daysSinceLast <= 90 ? 'COOLING' : 'LAPSED'

  const gaps = sorted.slice(1).map((order, index) => {
    const previous = dateOrNull(sorted[index].created_at)
    const current = dateOrNull(order.created_at)
    return previous && current ? Math.max(0.1, (current.getTime() - previous.getTime()) / 86400000) : null
  }).filter((gap): gap is number => gap != null)
  const averageGap = gaps.length > 0 ? sumBy(gaps, (gap) => gap) / gaps.length : 30
  const previousGap = gaps.at(-1) || averageGap

  if (previousGap > Math.max(45, averageGap * 2.2) && daysSinceLast <= Math.max(14, averageGap * 0.8)) return 'REACTIVATED'
  if (daysSinceLast > Math.max(90, averageGap * 4)) return 'LAPSED'
  if (daysSinceLast > Math.max(45, averageGap * 2.25)) return 'AT_RISK'
  if (daysSinceLast > Math.max(21, averageGap * 1.35)) return 'COOLING'
  return sorted.length >= 3 ? 'REPEAT' : 'ACTIVE'
}

function deriveNextPurchaseCandidatesFromOrders(orders: any[], sellableProductIds: Set<string>) {
  const byCustomer = new Map<string, any[]>()
  for (const order of orders) {
    if (!order.user_id || !order.product_group_id || !sellableProductIds.has(order.product_group_id)) continue
    byCustomer.set(order.user_id, [...(byCustomer.get(order.user_id) || []), order])
  }

  const transitions = new Map<string, Map<string, number>>()
  for (const rows of byCustomer.values()) {
    const sorted = rows
      .slice()
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())

    for (let index = 1; index < sorted.length; index += 1) {
      const from = sorted[index - 1].product_group_id
      const to = sorted[index].product_group_id
      if (!from || !to || from === to) continue
      const fromMap = transitions.get(from) || new Map<string, number>()
      fromMap.set(to, (fromMap.get(to) || 0) + orderQuantity(sorted[index]))
      transitions.set(from, fromMap)
    }
  }

  return transitions
}

export function analyzePromotionGuardrails(input: {
  discountCodes: any[]
  orders: any[]
  products: ProductGroup[]
  revenueEvents?: any[]
  maxDiscountPct?: number
  monthlyBudgetNgn?: number
  now?: Date
}): PromotionGuardrailFinding[] {
  const now = input.now || new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const productById = new Map(input.products.map((product) => [product.id, product]))
  const activeCodes = (input.discountCodes || []).filter((code) => code.is_active !== false)
  const maxDiscountPct = Math.max(0, toNumber(input.maxDiscountPct, 20))
  const monthlyBudgetNgn = Math.max(0, toNumber(input.monthlyBudgetNgn, 0))
  const findings: PromotionGuardrailFinding[] = []

  const completedOrdersThisMonth = (input.orders || []).filter((order) => {
    const created = dateOrNull(order.created_at)
    return String(order.status || '').toLowerCase() === 'completed' && created && created >= monthStart && created <= now
  })
  const discountSpend = sumBy(completedOrdersThisMonth, (order) => {
    const original = toNumber(order.account_details?.original_total)
    const amount = toNumber(order.amount)
    return original > amount ? original - amount : 0
  })
  const discountedOrdersThisMonth = completedOrdersThisMonth.filter((order) => {
    const original = toNumber(order.account_details?.original_total)
    const amount = toNumber(order.amount)
    return original > amount
  })

  if (monthlyBudgetNgn > 0 && discountSpend > monthlyBudgetNgn) {
    findings.push({
      checkKey: 'promotion.monthly_budget_exceeded',
      severity: 'critical',
      status: 'failed',
      message: 'Promotion discount spend has exceeded the configured monthly budget.',
      evidence: { discount_spend_ngn: discountSpend, monthly_budget_ngn: monthlyBudgetNgn },
    })
  }

  for (const code of activeCodes) {
    const percentOff = toNumber(code.percent_off)
    const usageRemaining = code.max_uses == null ? null : Math.max(0, toNumber(code.max_uses) - toNumber(code.used_count))
    const expiresAt = code.expires_at ? dateOrNull(code.expires_at) : null
    const product = code.product_group_id ? productById.get(code.product_group_id) : null
    const scoped = !!code.product_group_id || !!code.category_id || !!code.user_id

    if (percentOff > maxDiscountPct) {
      findings.push({
        checkKey: 'promotion.discount_pct_above_guardrail',
        severity: percentOff >= maxDiscountPct * 1.75 ? 'critical' : 'warning',
        status: 'failed',
        code: code.code,
        message: `${code.code || 'Discount code'} gives ${percentOff}% off, above the Revenue OS max of ${maxDiscountPct}%.`,
        evidence: { code_id: code.id, percent_off: percentOff, max_discount_pct: maxDiscountPct },
      })
    }

    if (!scoped && !code.max_uses) {
      findings.push({
        checkKey: 'promotion.unbounded_storewide_code',
        severity: 'critical',
        status: 'failed',
        code: code.code,
        message: `${code.code || 'Discount code'} is store-wide with no usage limit.`,
        evidence: { code_id: code.id, percent_off: percentOff },
      })
    }

    if (expiresAt && expiresAt < now) {
      findings.push({
        checkKey: 'promotion.expired_active_code',
        severity: 'warning',
        status: 'failed',
        code: code.code,
        message: `${code.code || 'Discount code'} is still active after expiry.`,
        evidence: { code_id: code.id, expires_at: code.expires_at },
      })
    }

    if (code.max_uses && usageRemaining === 0) {
      findings.push({
        checkKey: 'promotion.used_up_active_code',
        severity: 'warning',
        status: 'failed',
        code: code.code,
        message: `${code.code || 'Discount code'} is still active after reaching its usage limit.`,
        evidence: { code_id: code.id, max_uses: code.max_uses, used_count: code.used_count },
      })
    }

    if (product && !evaluateProductEligibility(product).isSellable) {
      findings.push({
        checkKey: 'promotion.scoped_to_unsellable_product',
        severity: 'warning',
        status: 'failed',
        code: code.code,
        message: `${code.code || 'Discount code'} points to a product customers cannot buy right now.`,
        evidence: { code_id: code.id, product_group_id: product.id, eligibility: evaluateProductEligibility(product) },
      })
    }
  }

  const recentEvents = (input.revenueEvents || []).filter((event) => {
    const created = dateOrNull(event.created_at || event.timestamp)
    const quality = event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human'
    return created && created >= monthStart && created <= now && !['bot', 'internal', 'suspect'].includes(String(quality).toLowerCase())
  })

  if (activeCodes.length > 0 && recentEvents.length > 0 && discountedOrdersThisMonth.length > 0) {
    const highIntentSessions = new Set<string>()
    const convertedHighIntentSessions = new Set<string>()

    for (const event of recentEvents) {
      const eventType = String(event.event_type || '').toUpperCase()
      const sessionKey = String(event.session_id || event.anonymous_id || event.customer_id || '')
      if (!sessionKey) continue

      if (eventType === 'BUY_CLICKED' || eventType === 'PAYMENT_STARTED' || eventType === 'PAYMENT_INITIATED') {
        highIntentSessions.add(sessionKey)
      }

      if (eventType === 'PAYMENT_COMPLETED' || eventType === 'PRODUCT_PURCHASED' || eventType === 'PURCHASE_COMPLETED') {
        convertedHighIntentSessions.add(sessionKey)
      }
    }

    const highIntentCount = highIntentSessions.size
    const highIntentConversions = Array.from(convertedHighIntentSessions).filter((sessionKey) => highIntentSessions.has(sessionKey)).length
    const highIntentConversionRate = highIntentCount > 0 ? highIntentConversions / highIntentCount : 0
    const discountedOrderShare = completedOrdersThisMonth.length > 0 ? discountedOrdersThisMonth.length / completedOrdersThisMonth.length : 0
    const measuredDiscountedOrders = discountedOrdersThisMonth.filter((order) => {
      return !!(
        order.account_details?.experiment_id ||
        order.account_details?.variant_id ||
        order.account_details?.promotion_experiment_id ||
        order.experiment_id ||
        order.variant_id
      )
    }).length

    if (highIntentCount >= 20 && highIntentConversionRate >= 0.55 && discountedOrderShare >= 0.25) {
      findings.push({
        checkKey: 'promotion.high_intent_discount_waste',
        severity: highIntentConversionRate >= 0.7 && discountedOrderShare >= 0.4 ? 'critical' : 'warning',
        status: 'failed',
        message: 'Discounts are being used while high-intent traffic is already converting strongly; require incrementality evidence before expanding promotions.',
        evidence: {
          high_intent_sessions: highIntentCount,
          high_intent_conversion_rate: Number(highIntentConversionRate.toFixed(4)),
          discounted_orders_this_month: discountedOrdersThisMonth.length,
          discounted_order_share: Number(discountedOrderShare.toFixed(4)),
          discount_spend_ngn: discountSpend,
        },
      })
    }

    if (discountedOrdersThisMonth.length >= 5 && measuredDiscountedOrders === 0) {
      findings.push({
        checkKey: 'promotion.incrementality_unmeasured',
        severity: 'warning',
        status: 'failed',
        message: 'Discounted orders are not tied to an experiment or promotion variant, so Revenue OS cannot prove the discount created incremental sales.',
        evidence: {
          discounted_orders_this_month: discountedOrdersThisMonth.length,
          measured_discounted_orders: measuredDiscountedOrders,
          required_fields: ['experiment_id', 'variant_id', 'promotion_experiment_id'],
        },
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      checkKey: 'promotion.guardrails',
      severity: 'info',
      status: 'passed',
      message: 'Promotion guardrails passed for active discount codes.',
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

export function deriveRevenueOsRuntimeIntelligence(input: {
  orders: any[]
  commerceOrders?: any[]
  revenueEvents: any[]
  products: ProductGroup[]
  categories: Category[]
  profiles?: any[]
  identityLinks?: any[]
  monthlyTarget?: number
  now?: Date
}): RevenueOsRuntimeIntelligence {
  const now = input.now || new Date()
  const dayMs = 86400000
  const windowEnd = now.toISOString()
  const window30Start = new Date(now.getTime() - 30 * dayMs)
  const window14Start = new Date(now.getTime() - 14 * dayMs)
  const window7Start = new Date(now.getTime() - 7 * dayMs)
  const previous7Start = new Date(now.getTime() - 14 * dayMs)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const elapsedMonthDays = Math.max(1, (now.getTime() - monthStart.getTime()) / dayMs)
  const monthDays = Math.max(1, (monthEnd.getTime() - monthStart.getTime()) / dayMs)

  const productById = new Map(input.products.map((product) => [product.id, product]))
  const categoryById = new Map(input.categories.map((category) => [category.id, category]))
  const categoryPrices = input.products.reduce<Record<string, number[]>>((acc, product) => {
    const price = toNumber(product.price)
    if (price > 0) {
      const key = product.category_id || 'uncategorized'
      acc[key] = [...(acc[key] || []), price]
    }
    return acc
  }, {})
  for (const key of Object.keys(categoryPrices)) categoryPrices[key].sort((a, b) => a - b)
  const categoryPricePercentile = (product: ProductGroup) => {
    const price = toNumber(product.price)
    const prices = categoryPrices[product.category_id || 'uncategorized'] || []
    if (price <= 0 || prices.length <= 1) return null
    const lowerOrEqual = prices.filter((candidate) => candidate <= price).length
    return clamp((lowerOrEqual - 1) / Math.max(1, prices.length - 1))
  }
  const profileById = new Map((input.profiles || []).map((profile) => [profile.id, profile]))
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
  const resolvedUserIdForEvent = (event: any): string | null => {
    if (event.user_id) return String(event.user_id)
    const visitorId = event.visitor_id ? String(event.visitor_id) : ''
    const sessionId = event.session_id ? String(event.session_id) : ''
    if (visitorId && sessionId) {
      const exact = exactIdentityLinkByVisitorSession.get(`${visitorId}:${sessionId}`)
      if (exact) return exact
    }
    const visitorUsers = visitorId ? usersByVisitorId.get(visitorId) : null
    return visitorUsers && visitorUsers.size === 1 ? [...visitorUsers][0] : null
  }
  const resolvedActorKeyForEvent = (event: any) => {
    const resolvedUserId = resolvedUserIdForEvent(event)
    if (resolvedUserId) return `user:${resolvedUserId}`
    if (event.visitor_id) return `anon:${event.visitor_id}`
    if (event.session_id) return `session:${event.session_id}`
    return null
  }
  const isInternalUser = (userId: string | null | undefined) => {
    const profile = userId ? profileById.get(userId) : null
    return !!profile?.is_staff || !!profile?.is_admin
  }
  const commerceOrders = input.commerceOrders?.length ? input.commerceOrders : input.orders
  const productOrderById = new Map(input.orders.map((order) => [String(order.id), order]))
  const smsOrderById = new Map(commerceOrders.filter((order) => order.commerce_source === 'sms').map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of commerceOrders.filter((order) => order.commerce_source && !['products', 'sms'].includes(String(order.commerce_source)))) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }
  const isCompletedOrder = (order: any) => isSuccessfulCommerceStatus(order.status) && !isInternalUser(order.user_id)
  const isRecent = (row: any, start: Date) => {
    const date = dateOrNull(row.created_at)
    return !!date && date >= start && date <= now
  }

  const recentOrders30 = commerceOrders.filter(isCompletedOrder).filter((order) => isRecent(order, window30Start))
  const recentOrders14 = commerceOrders.filter(isCompletedOrder).filter((order) => isRecent(order, window14Start))
  const recentOrders7 = commerceOrders.filter(isCompletedOrder).filter((order) => isRecent(order, window7Start))
  const previousOrders7 = commerceOrders.filter(isCompletedOrder).filter((order) => {
    const date = dateOrNull(order.created_at)
    return !!date && date >= previous7Start && date < window7Start
  })
  const monthOrders = commerceOrders.filter(isCompletedOrder).filter((order) => isRecent(order, monthStart))
  const recentProductOrders30 = input.orders.filter(isCompletedOrder).filter((order) => order.product_group_id && isRecent(order, window30Start))
  const isTrustedTrafficEvent = (event: any) => {
    const quality = event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human'
    return !['bot', 'internal', 'suspect'].includes(String(quality).toLowerCase())
  }
  const recentEvents30 = input.revenueEvents.filter((event) => isRecent(event, window30Start) && !isInternalUser(resolvedUserIdForEvent(event)) && isTrustedTrafficEvent(event))
  const recentEvents7 = input.revenueEvents.filter((event) => isRecent(event, window7Start) && !isInternalUser(resolvedUserIdForEvent(event)) && isTrustedTrafficEvent(event))
  const previousEvents7 = input.revenueEvents.filter((event) => {
    const date = dateOrNull(event.created_at)
    return !!date && date >= previous7Start && date < window7Start && !isInternalUser(resolvedUserIdForEvent(event)) && isTrustedTrafficEvent(event)
  })
  const purchaseEventCredit = (event: any) => {
    const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
    if (!linkedOrder || !isSuccessfulCommerceStatus(linkedOrder.status)) return null
    return {
      amount: Math.max(0, toNumber(linkedOrder.amount, eventAmount(event))),
      order: linkedOrder,
    }
  }

  const countEvent = (events: any[], eventType: RevenueEventType) => events.filter((event) => event.event_type === eventType).length
  const countProductClicks = (events: any[]) => countEvent(events, 'PRODUCT_CLICKED') + countEvent(events, 'RECOMMENDATION_CLICKED')
  const uniqueVisitors = (events: any[]) => new Set(events.map(resolvedActorKeyForEvent).filter(Boolean)).size
  const revenue30 = sumBy(recentOrders30, (order) => toNumber(order.amount))
  const revenue7 = sumBy(recentOrders7, (order) => toNumber(order.amount))
  const previousRevenue7 = sumBy(previousOrders7, (order) => toNumber(order.amount))
  const monthRevenue = sumBy(monthOrders, (order) => toNumber(order.amount))
  const avgOrderValue30 = recentOrders30.length > 0 ? revenue30 / recentOrders30.length : 0
  const avgOrderValue7 = recentOrders7.length > 0 ? revenue7 / recentOrders7.length : 0
  const previousAvgOrderValue7 = previousOrders7.length > 0 ? previousRevenue7 / previousOrders7.length : 0
  const visitors30 = uniqueVisitors(recentEvents30)
  const visitors7 = uniqueVisitors(recentEvents7)
  const previousVisitors7 = uniqueVisitors(previousEvents7)
  const conversion30 = visitors30 > 0 ? recentOrders30.length / visitors30 : 0
  const conversion7 = visitors7 > 0 ? recentOrders7.length / visitors7 : 0
  const previousConversion7 = previousVisitors7 > 0 ? previousOrders7.length / previousVisitors7 : 0
  const paymentStarts7 = countEvent(recentEvents7, 'PAYMENT_STARTED')
  const paymentProviderLoads7 = countEvent(recentEvents7, 'PAYMENT_PROVIDER_LOADED')
  const paymentAttempts7 = countEvent(recentEvents7, 'PAYMENT_ATTEMPTED')
  const paymentFails7 = countEvent(recentEvents7, 'PAYMENT_FAILED')
  const checkoutAbandoned7 = countEvent(recentEvents7, 'CHECKOUT_ABANDONED')
  const buyClicks7 = countEvent(recentEvents7, 'BUY_CLICKED')
  const paymentFailureRate7 = paymentStarts7 > 0 ? paymentFails7 / paymentStarts7 : 0
  const providerLoadRate7 = buyClicks7 > 0 ? paymentProviderLoads7 / buyClicks7 : 0
  const paymentAttemptRate7 = paymentProviderLoads7 > 0 ? paymentAttempts7 / paymentProviderLoads7 : 0
  const checkoutAbandonmentRate7 = paymentProviderLoads7 > 0 ? checkoutAbandoned7 / paymentProviderLoads7 : 0
  const buyToPurchase7 = buyClicks7 > 0 ? recentOrders7.length / buyClicks7 : 0
  const sellableProductIds = new Set(input.products.filter((product) => evaluateProductEligibility(product).isSellable).map((product) => product.id))
  const nextPurchaseTransitions = deriveNextPurchaseCandidatesFromOrders(input.orders.filter(isCompletedOrder), sellableProductIds)
  const recentBuyerCounts = new Map<string, number>()
  for (const order of recentOrders30) {
    if (!order.user_id) continue
    recentBuyerCounts.set(order.user_id, (recentBuyerCounts.get(order.user_id) || 0) + 1)
  }
  const repeatBuyerCount30 = [...recentBuyerCounts.values()].filter((count) => count > 1).length
  const repeatPurchaseShare30 = recentOrders30.length > 0
    ? sumBy([...recentBuyerCounts.values()].filter((count) => count > 1), (count) => count) / recentOrders30.length
    : 0

  const featureSnapshots: RevenueFeatureSnapshot[] = [{
    snapshotKey: `store:30d:${now.toISOString().slice(0, 10)}`,
    scopeType: 'store',
    scopeId: 'global',
    windowStart: window30Start.toISOString(),
    windowEnd,
      features: {
        revenue: Math.round(revenue30),
        orders: recentOrders30.length,
        visitors: visitors30,
        conversion_rate: conversion30,
        average_order_value: avgOrderValue30,
        product_impressions: countEvent(recentEvents30, 'PRODUCT_IMPRESSION'),
        product_clicks: countProductClicks(recentEvents30),
        buy_clicks: countEvent(recentEvents30, 'BUY_CLICKED'),
      checkout_abandoned: countEvent(recentEvents30, 'CHECKOUT_ABANDONED'),
      payment_provider_loaded: countEvent(recentEvents30, 'PAYMENT_PROVIDER_LOADED'),
      payment_starts: countEvent(recentEvents30, 'PAYMENT_STARTED'),
      payment_attempted: countEvent(recentEvents30, 'PAYMENT_ATTEMPTED'),
      payment_failures: countEvent(recentEvents30, 'PAYMENT_FAILED'),
    },
  }]

  featureSnapshots.push({
    snapshotKey: `store:revenue_decomposition:7d:${now.toISOString().slice(0, 10)}`,
    scopeType: 'store',
    scopeId: 'revenue_decomposition',
    windowStart: window7Start.toISOString(),
    windowEnd,
    features: {
      revenue_7d: Math.round(revenue7),
      previous_revenue_7d: Math.round(previousRevenue7),
      traffic_7d: visitors7,
      previous_traffic_7d: previousVisitors7,
      conversion_7d: conversion7,
      previous_conversion_7d: previousConversion7,
      average_order_value_7d: avgOrderValue7,
      previous_average_order_value_7d: previousAvgOrderValue7,
      repeat_buyer_count_30d: repeatBuyerCount30,
      repeat_purchase_share_30d: repeatPurchaseShare30,
      traffic_change: previousVisitors7 > 0 ? (visitors7 - previousVisitors7) / previousVisitors7 : visitors7 > 0 ? 1 : 0,
      conversion_change: previousConversion7 > 0 ? (conversion7 - previousConversion7) / previousConversion7 : conversion7 > 0 ? 1 : 0,
      purchase_value_change: previousAvgOrderValue7 > 0 ? (avgOrderValue7 - previousAvgOrderValue7) / previousAvgOrderValue7 : avgOrderValue7 > 0 ? 1 : 0,
      revenue_driver:
        visitors7 < previousVisitors7 * 0.9 ? 'traffic'
        : previousConversion7 > 0 && conversion7 < previousConversion7 * 0.9 ? 'conversion'
        : previousAvgOrderValue7 > 0 && avgOrderValue7 < previousAvgOrderValue7 * 0.9 ? 'purchase_value'
        : repeatPurchaseShare30 < 0.15 ? 'repeat_rate'
        : 'balanced',
    },
  })

  const commerceSectionForOrder = (order: any) => {
    const source = String(order.commerce_source || '').toLowerCase()
    if (source) return source
    return order.product_group_id ? 'products' : 'unknown'
  }
  const commerceSections = [...new Set(recentOrders30.map(commerceSectionForOrder).filter((section) => section !== 'unknown'))]
  for (const section of commerceSections) {
    const sectionOrders30 = recentOrders30.filter((order) => commerceSectionForOrder(order) === section)
    const sectionOrders7 = recentOrders7.filter((order) => commerceSectionForOrder(order) === section)
    const previousSectionOrders7 = previousOrders7.filter((order) => commerceSectionForOrder(order) === section)
    const sectionRevenue30 = sumBy(sectionOrders30, (order) => toNumber(order.amount))
    const sectionRevenue7 = sumBy(sectionOrders7, (order) => toNumber(order.amount))
    const previousSectionRevenue7 = sumBy(previousSectionOrders7, (order) => toNumber(order.amount))
    const sectionCustomers30 = new Set(sectionOrders30.map((order) => order.user_id).filter(Boolean))
    const sectionBuyerCounts = new Map<string, number>()
    for (const order of sectionOrders30) {
      if (!order.user_id) continue
      sectionBuyerCounts.set(order.user_id, (sectionBuyerCounts.get(order.user_id) || 0) + 1)
    }

    featureSnapshots.push({
      snapshotKey: `commerce_section:${section}:30d:${now.toISOString().slice(0, 10)}`,
      scopeType: 'commerce_section',
      scopeId: section,
      windowStart: window30Start.toISOString(),
      windowEnd,
      features: {
        section,
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
      },
    })
  }

  const attributionStats = new Map<string, {
    channel: string
    source: string
    campaign: string | null
    visitors: Set<string>
    pageViews: number
    productClicks: number
    buyClicks: number
    purchases: number
    revenue: number
    totalEvents: number
    suspectEvents: number
  }>()

  for (const event of recentEvents30) {
    const attribution = event.metadata?.attribution || {}
    const channel = String(attribution.channel || 'unknown')
    const source = String(attribution.source || 'unknown')
    const campaign = attribution.campaign ? String(attribution.campaign) : null
    const key = `${channel}:${source}:${campaign || 'none'}`
    const stats = attributionStats.get(key) || {
      channel,
      source,
      campaign,
      visitors: new Set<string>(),
      pageViews: 0,
      productClicks: 0,
      buyClicks: 0,
      purchases: 0,
      revenue: 0,
      totalEvents: 0,
      suspectEvents: 0,
    }
    const quality = String(event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human').toLowerCase()
    stats.totalEvents += 1
    if (quality === 'suspect') stats.suspectEvents += 1
    const visitorKey = resolvedActorKeyForEvent(event)
    if (visitorKey) stats.visitors.add(visitorKey)
    if (event.event_type === 'PAGE_VIEWED') stats.pageViews += 1
    if (isProductClickEvent(event.event_type)) stats.productClicks += 1
    if (event.event_type === 'BUY_CLICKED') stats.buyClicks += 1
    if (event.event_type === 'PRODUCT_PURCHASED') {
      const credit = purchaseEventCredit(event)
      if (!credit) {
        attributionStats.set(key, stats)
        continue
      }
      stats.purchases += 1
      stats.revenue += credit.amount
    }
    if (isPurchaseReversalEvent(event)) {
      stats.purchases -= 1
      stats.revenue -= eventAmount(event)
    }
    attributionStats.set(key, stats)
  }

  for (const [key, stats] of attributionStats) {
    if (stats.visitors.size === 0 && stats.pageViews === 0) continue
    featureSnapshots.push({
      snapshotKey: `attribution:${key}:30d:${now.toISOString().slice(0, 10)}`,
      scopeType: 'session',
      scopeId: key,
      windowStart: window30Start.toISOString(),
      windowEnd,
      features: {
        channel: stats.channel,
        source: stats.source,
        campaign: stats.campaign,
        visitors: stats.visitors.size,
        page_views: stats.pageViews,
        product_clicks: stats.productClicks,
        buy_clicks: stats.buyClicks,
        purchases: Math.max(0, stats.purchases),
        revenue: Math.round(Math.max(0, stats.revenue)),
        conversion_rate: stats.visitors.size > 0 ? Math.max(0, stats.purchases) / stats.visitors.size : 0,
        revenue_per_visitor: stats.visitors.size > 0 ? Math.max(0, stats.revenue) / stats.visitors.size : 0,
        suspect_event_share: stats.totalEvents > 0 ? stats.suspectEvents / stats.totalEvents : 0,
        traffic_quality: stats.suspectEvents > 0 ? 'mixed_suspect' : 'trusted_human',
      },
    })
  }

  const deviceStats = new Map<string, {
    visitors: Set<string>
    pageViews: number
    productClicks: number
    buyClicks: number
    paymentStarts: number
    paymentProviderLoads: number
    paymentAttempts: number
    paymentFailures: number
    checkoutAbandoned: number
    purchases: number
    revenue: number
  }>()

  for (const event of recentEvents30) {
    const device = String(event.device || event.metadata?.device || 'unknown')
    const stats = deviceStats.get(device) || {
      visitors: new Set<string>(),
      pageViews: 0,
      productClicks: 0,
      buyClicks: 0,
      paymentStarts: 0,
      paymentProviderLoads: 0,
      paymentAttempts: 0,
      paymentFailures: 0,
      checkoutAbandoned: 0,
      purchases: 0,
      revenue: 0,
    }
    const visitorKey = resolvedActorKeyForEvent(event)
    if (visitorKey) stats.visitors.add(visitorKey)
    if (event.event_type === 'PAGE_VIEWED') stats.pageViews += 1
    if (isProductClickEvent(event.event_type)) stats.productClicks += 1
    if (event.event_type === 'BUY_CLICKED') stats.buyClicks += 1
    if (event.event_type === 'PAYMENT_STARTED') stats.paymentStarts += 1
    if (event.event_type === 'PAYMENT_PROVIDER_LOADED') stats.paymentProviderLoads += 1
    if (event.event_type === 'PAYMENT_ATTEMPTED') stats.paymentAttempts += 1
    if (event.event_type === 'PAYMENT_FAILED') stats.paymentFailures += 1
    if (event.event_type === 'CHECKOUT_ABANDONED') stats.checkoutAbandoned += 1
    if (event.event_type === 'PRODUCT_PURCHASED') {
      const credit = purchaseEventCredit(event)
      if (!credit) {
        deviceStats.set(device, stats)
        continue
      }
      stats.purchases += 1
      stats.revenue += credit.amount
    }
    if (isPurchaseReversalEvent(event)) {
      stats.purchases -= 1
      stats.revenue -= eventAmount(event)
    }
    deviceStats.set(device, stats)
  }

  for (const [device, stats] of deviceStats) {
    if (stats.visitors.size === 0 && stats.pageViews === 0) continue
    featureSnapshots.push({
      snapshotKey: `device:${device}:30d:${now.toISOString().slice(0, 10)}`,
      scopeType: 'session',
      scopeId: `device:${device}`,
      windowStart: window30Start.toISOString(),
      windowEnd,
      features: {
        device,
        visitors: stats.visitors.size,
        page_views: stats.pageViews,
        product_clicks: stats.productClicks,
        buy_clicks: stats.buyClicks,
        payment_starts: stats.paymentStarts,
        payment_provider_loaded: stats.paymentProviderLoads,
        payment_attempted: stats.paymentAttempts,
        payment_failures: stats.paymentFailures,
        checkout_abandoned: stats.checkoutAbandoned,
        purchases: Math.max(0, stats.purchases),
        revenue: Math.round(Math.max(0, stats.revenue)),
        product_click_rate: stats.pageViews > 0 ? stats.productClicks / stats.pageViews : 0,
        buy_rate: stats.visitors.size > 0 ? stats.buyClicks / stats.visitors.size : 0,
        buy_to_payment_start_rate: stats.buyClicks > 0 ? stats.paymentStarts / stats.buyClicks : 0,
        payment_attempt_rate: stats.paymentProviderLoads > 0 ? stats.paymentAttempts / stats.paymentProviderLoads : 0,
        payment_failure_rate: stats.paymentStarts > 0 ? stats.paymentFailures / stats.paymentStarts : 0,
        checkout_abandonment_rate: stats.paymentProviderLoads > 0 ? stats.checkoutAbandoned / stats.paymentProviderLoads : 0,
        conversion_rate: stats.visitors.size > 0 ? Math.max(0, stats.purchases) / stats.visitors.size : 0,
        revenue_per_visitor: stats.visitors.size > 0 ? Math.max(0, stats.revenue) / stats.visitors.size : 0,
      },
    })
  }

  const productEvents = new Map<string, any[]>()
  for (const event of recentEvents30) {
    if (!event.product_group_id) continue
    productEvents.set(event.product_group_id, [...(productEvents.get(event.product_group_id) || []), event])
  }
  const storeImpressions30 = Math.max(0, countEvent(recentEvents30, 'PRODUCT_IMPRESSION'))
  const storePriorOrderRate30 = storeImpressions30 > 0 ? recentProductOrders30.length / storeImpressions30 : conversion30
  const bayesianPriorStrength = 30

  const productOrders = new Map<string, any[]>()
  for (const order of recentProductOrders30) {
    const productId = order.product_group_id
    if (!productId) continue
    productOrders.set(productId, [...(productOrders.get(productId) || []), order])
  }

  for (const [productId, events] of productEvents) {
    const product = productById.get(productId)
    if (!product) continue
    const orders = productOrders.get(productId) || []
    const impressions = countEvent(events, 'PRODUCT_IMPRESSION')
    const clicks = countProductClicks(events)
    const reversals = events.filter(isPurchaseReversalEvent)
    const buys = Math.max(0, orders.length - reversals.length)
    const revenue = Math.max(0, sumBy(orders, (order) => toNumber(order.amount)) - sumBy(reversals, eventAmount))
    const unitsSold = Math.max(0, sumBy(orders, orderQuantity) - reversals.length)
    const stockCount = toNumber(product.stock_count)
    const stockVelocityDaily = unitsSold / 30
    const daysOfInventory = stockVelocityDaily > 0 ? stockCount / stockVelocityDaily : null
    const rawOrderRate = impressions > 0 ? buys / impressions : 0
    const bayesianOrderRate = (buys + storePriorOrderRate30 * bayesianPriorStrength) / Math.max(1, impressions + bayesianPriorStrength)
    const productEligibility = evaluateProductEligibility(product)
    const coldStartExposurePriority = impressions < 20
      ? clamp(0.6 + (productEligibility.isSellable ? 0.25 : 0), 0, 1)
      : clamp(Math.max(0, bayesianOrderRate - rawOrderRate) * 8, 0, 0.6)
    featureSnapshots.push({
      snapshotKey: `product:${productId}:30d:${now.toISOString().slice(0, 10)}`,
      scopeType: 'product',
      scopeId: productId,
      windowStart: window30Start.toISOString(),
      windowEnd,
      features: {
        name: product.name,
        category_id: product.category_id,
        availability: productEligibility.availabilityStatus,
        impressions,
        clicks,
        buy_clicks: countEvent(events, 'BUY_CLICKED'),
        orders: buys,
        units_sold: unitsSold,
        revenue,
        revenue_per_impression: impressions > 0 ? revenue / impressions : 0,
        revenue_per_click: clicks > 0 ? revenue / clicks : 0,
        click_rate: impressions > 0 ? clicks / impressions : 0,
        order_rate_per_impression: rawOrderRate,
        bayesian_order_rate_per_impression: bayesianOrderRate,
        reversal_count: reversals.length,
        reversal_rate: orders.length > 0 ? reversals.length / orders.length : 0,
        cold_start_exposure_priority: coldStartExposurePriority,
        bayesian_prior_strength: bayesianPriorStrength,
        store_prior_order_rate: storePriorOrderRate30,
        stock_count: stockCount,
        stock_velocity_daily: stockVelocityDaily,
        days_of_inventory: daysOfInventory,
        price: toNumber(product.price),
        category_price_percentile: categoryPricePercentile(product),
      },
    })
  }

  const categoryStats = new Map<string, { impressions: number; clicks: number; orders: number; revenue: number }>()
  for (const category of input.categories) {
    categoryStats.set(category.id, { impressions: 0, clicks: 0, orders: 0, revenue: 0 })
  }
  for (const event of recentEvents30) {
    const product = event.product_group_id ? productById.get(event.product_group_id) : null
    const categoryId = event.category_id || product?.category_id
    if (!categoryId) continue
    const stats = categoryStats.get(categoryId) || { impressions: 0, clicks: 0, orders: 0, revenue: 0 }
    if (event.event_type === 'PRODUCT_IMPRESSION') stats.impressions += 1
    if (isProductClickEvent(event.event_type)) stats.clicks += 1
    if (isPurchaseReversalEvent(event)) {
      stats.orders -= 1
      stats.revenue -= eventAmount(event)
    }
    categoryStats.set(categoryId, stats)
  }
  for (const order of recentProductOrders30) {
    const product = order.product_group_id ? productById.get(order.product_group_id) : null
    const categoryId = product?.category_id || order.account_details?.category_id
    if (!categoryId) continue
    const stats = categoryStats.get(categoryId) || { impressions: 0, clicks: 0, orders: 0, revenue: 0 }
    stats.orders += 1
    stats.revenue += toNumber(order.amount)
    categoryStats.set(categoryId, stats)
  }
  for (const [categoryId, stats] of categoryStats) {
    if (stats.impressions === 0 && stats.clicks === 0 && stats.orders === 0) continue
    const netOrders = Math.max(0, stats.orders)
    const netRevenue = Math.max(0, stats.revenue)
    featureSnapshots.push({
      snapshotKey: `category:${categoryId}:30d:${now.toISOString().slice(0, 10)}`,
      scopeType: 'category',
      scopeId: categoryId,
      windowStart: window30Start.toISOString(),
      windowEnd,
      features: {
        name: categoryById.get(categoryId)?.name || 'Unknown category',
        impressions: stats.impressions,
        clicks: stats.clicks,
        orders: netOrders,
        revenue: netRevenue,
        click_rate: stats.impressions > 0 ? stats.clicks / stats.impressions : 0,
        order_rate_per_impression: stats.impressions > 0 ? netOrders / stats.impressions : 0,
      },
    })
  }

  const ordersByCustomer = new Map<string, any[]>()
  for (const order of commerceOrders.filter(isCompletedOrder)) {
    if (!order.user_id) continue
    ordersByCustomer.set(order.user_id, [...(ordersByCustomer.get(order.user_id) || []), order])
  }
  const eventsByCustomer = new Map<string, any[]>()
  for (const event of recentEvents30) {
    const resolvedUserId = resolvedUserIdForEvent(event)
    if (!resolvedUserId || isInternalUser(resolvedUserId)) continue
    eventsByCustomer.set(resolvedUserId, [...(eventsByCustomer.get(resolvedUserId) || []), event])
  }

  const lifecycleCounts: Record<CustomerLifecycleStage, number> = {
    NEW: 0,
    FIRST_PURCHASE: 0,
    ACTIVE: 0,
    REPEAT: 0,
    COOLING: 0,
    AT_RISK: 0,
    LAPSED: 0,
    REACTIVATED: 0,
  }

  for (const [userId, orders] of ordersByCustomer) {
    const profile = profileById.get(userId)
    const sorted = orders
      .slice()
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    const lastOrder = sorted.at(-1)
    const firstOrder = sorted[0]
    const lastOrderDate = dateOrNull(lastOrder?.created_at)
    const daysSinceLast = lastOrderDate ? Math.max(0, (now.getTime() - lastOrderDate.getTime()) / dayMs) : null
    const lifecycleStage = classifyCustomerLifecycle({ orders: sorted, createdAt: profile?.created_at, now })
    lifecycleCounts[lifecycleStage] += 1

    const categoryCounts = new Map<string, number>()
    const productCounts = new Map<string, number>()
    for (const order of sorted) {
      const qty = orderQuantity(order)
      const product = order.product_group_id ? productById.get(order.product_group_id) : null
      if (order.product_group_id) productCounts.set(order.product_group_id, (productCounts.get(order.product_group_id) || 0) + qty)
      if (product?.category_id) categoryCounts.set(product.category_id, (categoryCounts.get(product.category_id) || 0) + qty)
    }

    const topCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const lastProductId = lastOrder?.product_group_id || null
    const nextPurchaseCandidates = lastProductId
      ? [...(nextPurchaseTransitions.get(lastProductId)?.entries() || [])]
        .filter(([productId]) => !productCounts.has(productId))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([productId, count]) => ({ product_id: productId, score: count, name: productById.get(productId)?.name || null }))
      : []
    const gaps = sorted.slice(1).map((order, index) => {
      const previous = dateOrNull(sorted[index].created_at)
      const current = dateOrNull(order.created_at)
      return previous && current ? (current.getTime() - previous.getTime()) / dayMs : null
    }).filter((gap): gap is number => gap != null)
    const averageDaysBetweenOrders = gaps.length > 0 ? sumBy(gaps, (gap) => gap) / gaps.length : null
    const customerEvents = eventsByCustomer.get(userId) || []
    const eventProductViews = countEvent(customerEvents, 'PRODUCT_VIEWED')
    const eventProductClicks = countProductClicks(customerEvents)
    const eventSearches = countEvent(customerEvents, 'SEARCHED')
    const eventBuyClicks = countEvent(customerEvents, 'BUY_CLICKED')
    const eventPaymentStarts = countEvent(customerEvents, 'PAYMENT_STARTED')
    const eventPaymentFailures = countEvent(customerEvents, 'PAYMENT_FAILED')
    const eventChatIntents = countEvent(customerEvents, 'CHAT_INTENT')

    featureSnapshots.push({
      snapshotKey: `customer:${userId}:lifecycle:${now.toISOString().slice(0, 10)}`,
      scopeType: 'customer',
      scopeId: userId,
      windowStart: firstOrder?.created_at || null,
      windowEnd,
      features: {
        lifecycle_stage: lifecycleStage,
        completed_orders: sorted.length,
        units: sumBy(sorted, orderQuantity),
        revenue: sumBy(sorted, (order) => toNumber(order.amount)),
        first_order_at: firstOrder?.created_at || null,
        last_order_at: lastOrder?.created_at || null,
        days_since_last_order: daysSinceLast,
        average_days_between_orders: averageDaysBetweenOrders,
        top_category_id: topCategory,
        top_category_name: topCategory ? categoryById.get(topCategory)?.name || null : null,
        last_product_group_id: lastProductId,
        next_purchase_candidates: nextPurchaseCandidates,
        linked_event_count_30d: customerEvents.length,
        product_views_30d: eventProductViews,
        product_clicks_30d: eventProductClicks,
        searches_30d: eventSearches,
        buy_clicks_30d: eventBuyClicks,
        payment_starts_30d: eventPaymentStarts,
        payment_failures_30d: eventPaymentFailures,
        chat_intents_30d: eventChatIntents,
        event_purchase_intent_hint: clamp(
          eventSearches * 0.04 +
          eventProductClicks * 0.08 +
          eventBuyClicks * 0.18 +
          eventPaymentStarts * 0.28 -
          eventPaymentFailures * 0.14,
          0,
          0.95,
        ),
      },
    })
  }

  for (const [userId, customerEvents] of eventsByCustomer) {
    if (ordersByCustomer.has(userId)) continue
    const profile = profileById.get(userId)
    const lifecycleStage = classifyCustomerLifecycle({ orders: [], createdAt: profile?.created_at, now })
    lifecycleCounts[lifecycleStage] += 1
    const eventProductViews = countEvent(customerEvents, 'PRODUCT_VIEWED')
    const eventProductClicks = countProductClicks(customerEvents)
    const eventSearches = countEvent(customerEvents, 'SEARCHED')
    const eventBuyClicks = countEvent(customerEvents, 'BUY_CLICKED')
    const eventPaymentStarts = countEvent(customerEvents, 'PAYMENT_STARTED')
    const eventPaymentFailures = countEvent(customerEvents, 'PAYMENT_FAILED')
    const eventChatIntents = countEvent(customerEvents, 'CHAT_INTENT')

    featureSnapshots.push({
      snapshotKey: `customer:${userId}:lifecycle:${now.toISOString().slice(0, 10)}`,
      scopeType: 'customer',
      scopeId: userId,
      windowStart: customerEvents.at(-1)?.created_at || null,
      windowEnd,
      features: {
        lifecycle_stage: lifecycleStage,
        completed_orders: 0,
        units: 0,
        revenue: 0,
        first_order_at: null,
        last_order_at: null,
        days_since_last_order: null,
        average_days_between_orders: null,
        top_category_id: null,
        top_category_name: null,
        last_product_group_id: null,
        next_purchase_candidates: [],
        linked_event_count_30d: customerEvents.length,
        product_views_30d: eventProductViews,
        product_clicks_30d: eventProductClicks,
        searches_30d: eventSearches,
        buy_clicks_30d: eventBuyClicks,
        payment_starts_30d: eventPaymentStarts,
        payment_failures_30d: eventPaymentFailures,
        chat_intents_30d: eventChatIntents,
        event_purchase_intent_hint: clamp(
          eventSearches * 0.04 +
          eventProductClicks * 0.08 +
          eventBuyClicks * 0.18 +
          eventPaymentStarts * 0.28 -
          eventPaymentFailures * 0.14,
          0,
          0.95,
        ),
      },
    })
  }

  featureSnapshots.push({
    snapshotKey: `store:lifecycle:${now.toISOString().slice(0, 10)}`,
    scopeType: 'store',
    scopeId: 'customer_lifecycle',
    windowStart: null,
    windowEnd,
    features: {
      lifecycle_counts: lifecycleCounts,
      active_customers: lifecycleCounts.ACTIVE + lifecycleCounts.REPEAT + lifecycleCounts.REACTIVATED,
      at_risk_customers: lifecycleCounts.AT_RISK,
      lapsed_customers: lifecycleCounts.LAPSED,
      cooling_customers: lifecycleCounts.COOLING,
    },
  })

  const opportunities: CroOpportunity[] = []
  const addOpportunity = (opportunity: CroOpportunity) => opportunities.push({
    ...opportunity,
    expectedValue: Math.max(0, Math.round(opportunity.expectedValue)),
    confidence: clamp(opportunity.confidence),
    risk: clamp(opportunity.risk),
    effort: clamp(opportunity.effort),
    priority: clamp(opportunity.priority, 0, 10),
    status: opportunity.status || 'open',
  })

  const revenueDriver =
    visitors7 < previousVisitors7 * 0.9 ? 'traffic'
    : previousConversion7 > 0 && conversion7 < previousConversion7 * 0.9 ? 'conversion'
    : previousAvgOrderValue7 > 0 && avgOrderValue7 < previousAvgOrderValue7 * 0.9 ? 'purchase_value'
    : repeatPurchaseShare30 < 0.15 ? 'repeat_rate'
    : 'balanced'

  if (revenueDriver !== 'balanced' && previousRevenue7 > 0) {
    const driverOpportunityType: Record<string, string> = {
      traffic: 'REVENUE_DRIVER_TRAFFIC_GAP',
      conversion: 'REVENUE_DRIVER_CONVERSION_GAP',
      purchase_value: 'REVENUE_DRIVER_PURCHASE_VALUE_GAP',
      repeat_rate: 'REVENUE_DRIVER_REPEAT_RATE_GAP',
    }
    addOpportunity({
      opportunityKey: `revenue_driver:${revenueDriver}:${now.toISOString().slice(0, 10)}`,
      type: driverOpportunityType[revenueDriver],
      scope: 'store:revenue_decomposition',
      expectedValue: Math.max(0, previousRevenue7 - revenue7) * 0.35,
      confidence: Math.min(0.86, 0.38 + Math.max(visitors7, previousVisitors7) / 500),
      risk: revenueDriver === 'traffic' ? 0.22 : 0.18,
      effort: revenueDriver === 'purchase_value' ? 0.24 : 0.32,
      priority: revenueDriver === 'conversion' ? 8 : revenueDriver === 'traffic' ? 7 : 6.5,
      evidence: {
        revenue_7d: revenue7,
        previous_revenue_7d: previousRevenue7,
        visitors_7d: visitors7,
        previous_visitors_7d: previousVisitors7,
        conversion_7d: conversion7,
        previous_conversion_7d: previousConversion7,
        average_order_value_7d: avgOrderValue7,
        previous_average_order_value_7d: previousAvgOrderValue7,
        repeat_purchase_share_30d: repeatPurchaseShare30,
        revenue_driver: revenueDriver,
      },
    })
  }

  for (const snapshot of featureSnapshots.filter((row) => row.scopeType === 'session' && String(row.snapshotKey).startsWith('attribution:'))) {
    const visitors = toNumber(snapshot.features.visitors)
    const conversionRate = toNumber(snapshot.features.conversion_rate)
    const buyClicks = toNumber(snapshot.features.buy_clicks)
    const purchases = toNumber(snapshot.features.purchases)
    const suspectEventShare = toNumber(snapshot.features.suspect_event_share)
    if (visitors >= 20 && suspectEventShare >= 0.3) {
      addOpportunity({
        opportunityKey: `acquisition_audit_suspect_source:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'ACQUISITION_AUDIT_SUSPECT_TRAFFIC',
        scope: `attribution:${snapshot.scopeId}`,
        expectedValue: buyClicks * Math.max(avgOrderValue30 * 0.08, 1),
        confidence: Math.min(0.84, 0.36 + visitors / 350),
        risk: 0.16,
        effort: 0.2,
        priority: Math.min(8, 3 + suspectEventShare * 8),
        evidence: {
          ...snapshot.features,
          allowed_action: 'audit_source_quality_before_scaling',
          scale_blocked_until_quality_improves: true,
        },
      })
    }
    if (visitors >= 25 && buyClicks >= 5 && purchases === 0) {
      addOpportunity({
        opportunityKey: `traffic_quality_no_purchase:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'TRAFFIC_SOURCE_QUALITY_DROP',
        scope: `attribution:${snapshot.scopeId}`,
        expectedValue: buyClicks * Math.max(avgOrderValue30 * 0.15, 1),
        confidence: Math.min(0.82, 0.35 + visitors / 300),
        risk: 0.2,
        effort: 0.28,
        priority: Math.min(8, buyClicks / 4),
        evidence: snapshot.features,
      })
    } else if (visitors >= 40 && conversion30 > 0 && conversionRate < conversion30 * 0.35) {
      addOpportunity({
        opportunityKey: `traffic_source_underperforming:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'TRAFFIC_SOURCE_UNDERPERFORMING',
        scope: `attribution:${snapshot.scopeId}`,
        expectedValue: (conversion30 * 0.35 - conversionRate) * visitors * Math.max(avgOrderValue30, 1),
        confidence: Math.min(0.78, 0.3 + visitors / 400),
        risk: 0.18,
        effort: 0.25,
        priority: Math.min(7.5, ((conversion30 * 0.35 - conversionRate) / Math.max(conversion30, 0.001)) * 6),
        evidence: { ...snapshot.features, store_conversion_rate: conversion30 },
      })
    }

    const revenuePerVisitor = toNumber(snapshot.features.revenue_per_visitor)
    const storeRevenuePerVisitor = visitors30 > 0 ? revenue30 / visitors30 : 0
    if (visitors >= 35 && suspectEventShare < 0.2 && storeRevenuePerVisitor > 0 && revenuePerVisitor >= storeRevenuePerVisitor * 1.6 && conversionRate >= conversion30) {
      addOpportunity({
        opportunityKey: `acquisition_scale_source:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'ACQUISITION_SCALE_STRONG_SOURCE',
        scope: `attribution:${snapshot.scopeId}`,
        expectedValue: visitors * (revenuePerVisitor - storeRevenuePerVisitor) * 0.25,
        confidence: Math.min(0.86, 0.38 + visitors / 450),
        risk: 0.22,
        effort: 0.35,
        priority: Math.min(8.5, (revenuePerVisitor / Math.max(storeRevenuePerVisitor, 1)) * 2.4),
        evidence: {
          ...snapshot.features,
          store_revenue_per_visitor: storeRevenuePerVisitor,
          allowed_action: 'investigate_or_scale_permissioned_channel',
          spend_data_available: false,
        },
      })
    }
    if (visitors >= 60 && storeRevenuePerVisitor > 0 && revenuePerVisitor < storeRevenuePerVisitor * 0.25 && buyClicks >= 5) {
      addOpportunity({
        opportunityKey: `acquisition_audit_source:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'ACQUISITION_AUDIT_LOW_VALUE_SOURCE',
        scope: `attribution:${snapshot.scopeId}`,
        expectedValue: Math.max(1, storeRevenuePerVisitor * 0.25 - revenuePerVisitor) * visitors,
        confidence: Math.min(0.82, 0.34 + visitors / 500),
        risk: 0.18,
        effort: 0.3,
        priority: Math.min(8, (1 - revenuePerVisitor / Math.max(storeRevenuePerVisitor, 1)) * 5),
        evidence: {
          ...snapshot.features,
          store_revenue_per_visitor: storeRevenuePerVisitor,
          allowed_action: 'audit_landing_source_or_campaign_quality',
          spend_data_available: false,
        },
      })
    }
  }

  for (const snapshot of featureSnapshots.filter((row) => row.scopeType === 'session' && String(row.snapshotKey).startsWith('device:'))) {
    const visitors = toNumber(snapshot.features.visitors)
    const deviceConversion = toNumber(snapshot.features.conversion_rate)
    const paymentStarts = toNumber(snapshot.features.payment_starts)
    const paymentFailureRate = toNumber(snapshot.features.payment_failure_rate)
    const buyClicks = toNumber(snapshot.features.buy_clicks)
    const buyToPaymentStartRate = toNumber(snapshot.features.buy_to_payment_start_rate)
    if (visitors >= 30 && conversion30 > 0 && deviceConversion < conversion30 * 0.55) {
      addOpportunity({
        opportunityKey: `device_conversion_gap:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'DEVICE_CONVERSION_GAP',
        scope: String(snapshot.scopeId),
        expectedValue: (conversion30 * 0.55 - deviceConversion) * visitors * Math.max(avgOrderValue30, 1),
        confidence: Math.min(0.84, 0.35 + visitors / 350),
        risk: 0.16,
        effort: 0.28,
        priority: Math.min(8, ((conversion30 * 0.55 - deviceConversion) / Math.max(conversion30, 0.001)) * 7),
        evidence: { ...snapshot.features, store_conversion_rate: conversion30 },
      })
    }
    if (paymentStarts >= 5 && paymentFailureRate >= Math.max(0.15, paymentFailureRate7 * 1.5)) {
      addOpportunity({
        opportunityKey: `device_payment_failure:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'DEVICE_PAYMENT_FUNNEL_FRICTION',
        scope: String(snapshot.scopeId),
        expectedValue: paymentStarts * paymentFailureRate * Math.max(avgOrderValue30, 1),
        confidence: Math.min(0.86, 0.4 + paymentStarts / 70),
        risk: 0.12,
        effort: 0.22,
        priority: Math.min(8.5, paymentFailureRate * 9),
        evidence: { ...snapshot.features, store_payment_failure_rate_7d: paymentFailureRate7 },
      })
    }
    if (buyClicks >= 8 && buyToPaymentStartRate > 0 && buyToPaymentStartRate < 0.45) {
      addOpportunity({
        opportunityKey: `device_payment_start_drop:${snapshot.scopeId}:${now.toISOString().slice(0, 10)}`,
        type: 'DEVICE_CHECKOUT_START_DROP',
        scope: String(snapshot.scopeId),
        expectedValue: (0.45 - buyToPaymentStartRate) * buyClicks * Math.max(avgOrderValue30, 1),
        confidence: Math.min(0.8, 0.32 + buyClicks / 100),
        risk: 0.15,
        effort: 0.2,
        priority: Math.min(7.5, (0.45 - buyToPaymentStartRate) * 12),
        evidence: snapshot.features,
      })
    }
  }

  if (paymentStarts7 >= 5 && paymentFailureRate7 >= 0.15) {
    addOpportunity({
      opportunityKey: `payment_friction:7d:${now.toISOString().slice(0, 10)}`,
      type: 'PAYMENT_FUNNEL_FRICTION',
      scope: 'checkout',
      expectedValue: paymentFails7 * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.9, 0.45 + paymentStarts7 / 80),
      risk: 0.12,
      effort: 0.25,
      priority: paymentFailureRate7 * 8,
      evidence: { payment_starts_7d: paymentStarts7, payment_failures_7d: paymentFails7, payment_failure_rate_7d: paymentFailureRate7 },
    })
  }

  if (lifecycleCounts.AT_RISK + lifecycleCounts.COOLING >= 5) {
    addOpportunity({
      opportunityKey: `customer_lifecycle_at_risk:${now.toISOString().slice(0, 10)}`,
      type: 'CUSTOMER_REACTIVATION_OPPORTUNITY',
      scope: 'customer_lifecycle',
      expectedValue: (lifecycleCounts.AT_RISK + lifecycleCounts.COOLING) * Math.max(avgOrderValue30 * 0.18, 1),
      confidence: Math.min(0.82, 0.35 + (lifecycleCounts.AT_RISK + lifecycleCounts.COOLING) / 150),
      risk: 0.18,
      effort: 0.3,
      priority: Math.min(8, (lifecycleCounts.AT_RISK * 0.9 + lifecycleCounts.COOLING * 0.45) / 10),
      evidence: {
        at_risk_customers: lifecycleCounts.AT_RISK,
        cooling_customers: lifecycleCounts.COOLING,
        avg_order_value_30d: avgOrderValue30,
        allowed_action: 'permissioned_reactivation_only',
      },
    })
  }

  if (lifecycleCounts.FIRST_PURCHASE >= 5) {
    addOpportunity({
      opportunityKey: `first_purchase_repeat_path:${now.toISOString().slice(0, 10)}`,
      type: 'FIRST_PURCHASE_REPEAT_SALES_OPPORTUNITY',
      scope: 'post_purchase',
      expectedValue: lifecycleCounts.FIRST_PURCHASE * Math.max(avgOrderValue30 * 0.12, 1),
      confidence: Math.min(0.78, 0.32 + lifecycleCounts.FIRST_PURCHASE / 120),
      risk: 0.12,
      effort: 0.2,
      priority: Math.min(7.5, lifecycleCounts.FIRST_PURCHASE / 12),
      evidence: {
        first_purchase_customers: lifecycleCounts.FIRST_PURCHASE,
        next_purchase_graph_available: nextPurchaseTransitions.size > 0,
        allowed_action: 'post_purchase_recommendation',
      },
    })
  }

  if (buyClicks7 >= 10 && providerLoadRate7 < 0.85) {
    addOpportunity({
      opportunityKey: `checkout_load_dropoff:7d:${now.toISOString().slice(0, 10)}`,
      type: 'CHECKOUT_LOAD_DROPOFF',
      scope: 'checkout',
      expectedValue: (buyClicks7 * 0.85 - paymentProviderLoads7) * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.84, 0.35 + buyClicks7 / 120),
      risk: 0.2,
      effort: 0.3,
      priority: (0.85 - providerLoadRate7) * 8,
      evidence: { buy_clicks_7d: buyClicks7, provider_loads_7d: paymentProviderLoads7, provider_load_rate_7d: providerLoadRate7 },
    })
  }

  if (paymentProviderLoads7 >= 10 && paymentAttemptRate7 < 0.65) {
    addOpportunity({
      opportunityKey: `checkout_attempt_dropoff:7d:${now.toISOString().slice(0, 10)}`,
      type: 'CHECKOUT_ATTEMPT_DROPOFF',
      scope: 'checkout',
      expectedValue: (paymentProviderLoads7 * 0.65 - paymentAttempts7) * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.84, 0.35 + paymentProviderLoads7 / 120),
      risk: 0.16,
      effort: 0.25,
      priority: (0.65 - paymentAttemptRate7) * 8,
      evidence: { provider_loads_7d: paymentProviderLoads7, payment_attempts_7d: paymentAttempts7, payment_attempt_rate_7d: paymentAttemptRate7 },
    })
  }

  if (paymentProviderLoads7 >= 10 && checkoutAbandonmentRate7 >= 0.25) {
    addOpportunity({
      opportunityKey: `checkout_abandonment:7d:${now.toISOString().slice(0, 10)}`,
      type: 'CHECKOUT_ABANDONMENT',
      scope: 'checkout',
      expectedValue: checkoutAbandoned7 * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.82, 0.32 + paymentProviderLoads7 / 150),
      risk: 0.12,
      effort: 0.2,
      priority: checkoutAbandonmentRate7 * 7,
      evidence: { provider_loads_7d: paymentProviderLoads7, checkout_abandoned_7d: checkoutAbandoned7, checkout_abandonment_rate_7d: checkoutAbandonmentRate7 },
    })
  }

  if (buyClicks7 >= 10 && buyToPurchase7 < 0.25) {
    addOpportunity({
      opportunityKey: `buy_click_dropoff:7d:${now.toISOString().slice(0, 10)}`,
      type: 'BUY_CLICK_TO_PURCHASE_DROPOFF',
      scope: 'store',
      expectedValue: (buyClicks7 * 0.25 - recentOrders7.length) * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.85, 0.35 + buyClicks7 / 120),
      risk: 0.18,
      effort: 0.35,
      priority: (0.25 - buyToPurchase7) * 9,
      evidence: { buy_clicks_7d: buyClicks7, completed_orders_7d: recentOrders7.length, buy_to_purchase_7d: buyToPurchase7 },
    })
  }

  if (previousConversion7 > 0 && conversion7 < previousConversion7 * 0.75 && visitors7 >= 20) {
    addOpportunity({
      opportunityKey: `conversion_drop:7d:${now.toISOString().slice(0, 10)}`,
      type: 'CONVERSION_DROP',
      scope: 'store',
      expectedValue: (previousConversion7 - conversion7) * visitors7 * Math.max(avgOrderValue30, 1),
      confidence: Math.min(0.82, 0.42 + visitors7 / 500),
      risk: 0.24,
      effort: 0.3,
      priority: ((previousConversion7 - conversion7) / previousConversion7) * 8,
      evidence: { conversion_7d: conversion7, previous_conversion_7d: previousConversion7, visitors_7d: visitors7 },
    })
  }

  for (const snapshot of featureSnapshots.filter((row) => row.scopeType === 'product')) {
    const impressions = toNumber(snapshot.features.impressions)
    const clicks = toNumber(snapshot.features.clicks)
    const orders = toNumber(snapshot.features.orders)
    const clickRate = impressions > 0 ? clicks / impressions : 0
    const orderRate = impressions > 0 ? orders / impressions : 0
    if (impressions >= 30 && clickRate >= 0.08 && orderRate < 0.01) {
      addOpportunity({
        opportunityKey: `product_interest_low_conversion:${snapshot.scopeId}:30d`,
        type: 'HIGH_INTEREST_LOW_CONVERSION_PRODUCT',
        scope: `product:${snapshot.scopeId}`,
        expectedValue: Math.max(1, impressions * 0.01 - orders) * Math.max(avgOrderValue30, toNumber(snapshot.features.price)),
        confidence: Math.min(0.84, 0.35 + impressions / 400),
        risk: 0.2,
        effort: 0.2,
        priority: Math.min(8, clickRate * 20),
        evidence: snapshot.features,
      })
    }
  }

  const highRevenueProductSnapshots = featureSnapshots
    .filter((row) => row.scopeType === 'product')
    .sort((a, b) => toNumber(b.features.revenue) - toNumber(a.features.revenue))
    .slice(0, 8)
  for (const snapshot of highRevenueProductSnapshots) {
    const stock = toNumber(snapshot.features.stock_count)
    const orders = toNumber(snapshot.features.orders)
    if (orders >= 2 && stock > 0 && stock <= 3) {
      addOpportunity({
        opportunityKey: `top_product_low_stock:${snapshot.scopeId}:30d`,
        type: 'TOP_PRODUCT_LOW_STOCK',
        scope: `product:${snapshot.scopeId}`,
        expectedValue: toNumber(snapshot.features.price) * Math.max(1, orders / 2),
        confidence: 0.78,
        risk: 0.08,
        effort: 0.15,
        priority: 7.2,
        evidence: snapshot.features,
      })
    }
  }

  const insights = []
  const bestProduct = highRevenueProductSnapshots[0]
  if (bestProduct) {
    insights.push({
      scope: `product:${bestProduct.scopeId}`,
      finding: `${bestProduct.features.name || 'Top product'} is currently the strongest 30-day revenue contributor.`,
      effect: toNumber(bestProduct.features.revenue),
      confidence: Math.min(0.95, 0.45 + toNumber(bestProduct.features.orders) / 50),
      sampleSize: toNumber(bestProduct.features.orders),
      evidence: bestProduct.features,
    })
  }
  if (revenue7 > previousRevenue7 * 1.2 && recentOrders7.length >= 3) {
    insights.push({
      scope: 'store',
      finding: 'Seven-day completed revenue is accelerating versus the previous seven days.',
      effect: revenue7 - previousRevenue7,
      confidence: Math.min(0.9, 0.4 + recentOrders14.length / 80),
      sampleSize: recentOrders14.length,
      evidence: { revenue_7d: revenue7, previous_revenue_7d: previousRevenue7 },
    })
  }

  const trailingDailyRevenue = monthRevenue / elapsedMonthDays
  const medianValue = trailingDailyRevenue * monthDays
  const uncertainty = Math.max(medianValue * 0.18, avgOrderValue30 * 2)
  const target = toNumber(input.monthlyTarget)
  const probabilityToTarget = target > 0
    ? clamp((medianValue + uncertainty - target) / Math.max(uncertainty * 2, 1))
    : null
  const forecasts: RevenueForecast[] = [{
    forecastKey: `monthly_revenue:${monthStart.toISOString().slice(0, 10)}`,
    periodStart: monthStart.toISOString(),
    periodEnd: monthEnd.toISOString(),
    metric: 'monthly_completed_revenue',
    medianValue: Math.round(medianValue),
    lowerBound: Math.max(0, Math.round(medianValue - uncertainty)),
    upperBound: Math.round(medianValue + uncertainty),
    probabilityToTarget,
    evidence: {
      month_revenue_to_date: monthRevenue,
      elapsed_month_days: elapsedMonthDays,
      month_days: monthDays,
      trailing_daily_revenue: trailingDailyRevenue,
      target,
    },
  }]

  return { featureSnapshots, opportunities, insights, forecasts }
}

export async function recordRevenueOsRuntimeIntelligence(intelligence: RevenueOsRuntimeIntelligence) {
  const now = new Date().toISOString()

  if (intelligence.featureSnapshots.length > 0) {
    const { error } = await supabase.from('revenue_feature_snapshots' as any).upsert(
      intelligence.featureSnapshots.map((snapshot) => ({
        snapshot_key: snapshot.snapshotKey,
        scope_type: snapshot.scopeType,
        scope_id: snapshot.scopeId,
        window_start: snapshot.windowStart || null,
        window_end: snapshot.windowEnd,
        features: snapshot.features,
        updated_at: now,
      })),
      { onConflict: 'snapshot_key' },
    )
    if (error) throw error
    await recordFeatureStoreSnapshots(intelligence.featureSnapshots)
  }

  if (intelligence.opportunities.length > 0) {
    const { error } = await supabase.from('cro_opportunities' as any).upsert(
      intelligence.opportunities.map((opportunity) => ({
        opportunity_key: opportunity.opportunityKey,
        type: opportunity.type,
        scope: opportunity.scope,
        expected_value: opportunity.expectedValue,
        confidence: opportunity.confidence,
        risk: opportunity.risk,
        effort: opportunity.effort,
        priority: opportunity.priority,
        status: opportunity.status || 'open',
        evidence: opportunity.evidence,
        updated_at: now,
      })),
      { onConflict: 'opportunity_key' },
    )
    if (error) throw error
  }

  if (intelligence.insights.length > 0) {
    const validUntil = new Date(Date.now() + 45 * 86400000).toISOString()
    const { error } = await supabase.from('cro_commercial_insights' as any).insert(
      intelligence.insights.map((insight) => ({
        scope: insight.scope,
        finding: insight.finding,
        effect: insight.effect,
        confidence: insight.confidence,
        sample_size: insight.sampleSize,
        valid_until: validUntil,
        evidence: insight.evidence,
      })),
    )
    if (error) throw error
  }

  if (intelligence.forecasts.length > 0) {
    const { error } = await supabase.from('revenue_forecasts' as any).upsert(
      intelligence.forecasts.map((forecast) => ({
        forecast_key: forecast.forecastKey,
        period_start: forecast.periodStart,
        period_end: forecast.periodEnd,
        metric: forecast.metric,
        median_value: forecast.medianValue,
        lower_bound: forecast.lowerBound,
        upper_bound: forecast.upperBound,
        probability_to_target: forecast.probabilityToTarget,
        evidence: forecast.evidence,
      })),
      { onConflict: 'forecast_key' },
    )
    if (error) throw error
  }
}

export async function decayCommercialInsights(insightRows: any[], now = new Date()) {
  const updates = (insightRows || [])
    .filter((insight) => String(insight.status || 'active') === 'active')
    .map((insight) => {
      const validUntil = dateOrNull(insight.valid_until)
      const validFrom = dateOrNull(insight.valid_from || insight.created_at)
      const ageDays = validFrom ? Math.max(0, (now.getTime() - validFrom.getTime()) / 86400000) : 0
      const confidence = clamp(toNumber(insight.confidence))
      const sampleSize = toNumber(insight.sample_size)
      const expired = !!validUntil && validUntil < now
      const needsRetest = !expired && ageDays >= 30 && (confidence < 0.7 || sampleSize < 20)
      const status = expired ? 'expired' : needsRetest ? 'retest' : null
      return status ? { id: insight.id, status, ageDays, confidence, sampleSize, evidence: insight.evidence || {} } : null
    })
    .filter(Boolean) as Array<{ id: string; status: 'expired' | 'retest'; ageDays: number; confidence: number; sampleSize: number; evidence: Record<string, unknown> }>

  for (const update of updates) {
    const { error } = await supabase
      .from('cro_commercial_insights' as any)
      .update({
        status: update.status,
        updated_at: now.toISOString(),
        evidence: {
          ...update.evidence,
          decay_reason: update.status,
          age_days: Number(update.ageDays.toFixed(1)),
          confidence: update.confidence,
          sample_size: update.sampleSize,
        },
      })
      .eq('id', update.id)
    if (error) throw error
  }

  return updates
}

function actionTypeForOpportunity(type: string): CroApprovedActionType {
  const normalized = String(type || '').toUpperCase()
  if (normalized.includes('PAYMENT') || normalized.includes('CHECKOUT_LOAD') || normalized.includes('CHECKOUT_ATTEMPT')) return 'DIAGNOSE_FUNNEL'
  if (normalized.includes('CHECKOUT_ABANDONMENT') || normalized.includes('BUY_CLICK')) return 'CHANGE_CTA_COPY_VARIANT'
  if (normalized.includes('CUSTOMER_REACTIVATION')) return 'SHOW_POST_PURCHASE_OFFER'
  if (normalized.includes('FIRST_PURCHASE')) return 'CHANGE_OFFER_SEQUENCE'
  if (normalized.includes('TOP_PRODUCT_LOW_STOCK')) return 'RESTOCK_PRODUCT'
  if (normalized.includes('HIGH_INTEREST_LOW_CONVERSION_PRODUCT')) return 'SHOW_RECOMMENDATION'
  if (normalized.includes('TRAFFIC_SOURCE_QUALITY') || normalized.includes('TRAFFIC_SOURCE_UNDERPERFORMING') || normalized.includes('ACQUISITION_AUDIT')) return 'AUDIT_TRAFFIC_SOURCE'
  if (normalized.includes('ACQUISITION_SCALE')) return 'CHANGE_PROMOTION_EXPOSURE'
  if (normalized.includes('DEVICE_')) return 'CHANGE_RECOMMENDATION_POSITION'
  if (normalized.includes('REVENUE_DRIVER_TRAFFIC')) return 'AUDIT_TRAFFIC_SOURCE'
  if (normalized.includes('REVENUE_DRIVER_CONVERSION')) return 'REORDER_PRODUCTS'
  if (normalized.includes('REVENUE_DRIVER_PURCHASE_VALUE')) return 'SHOW_RECOMMENDATION'
  if (normalized.includes('REVENUE_DRIVER_REPEAT_RATE')) return 'SHOW_POST_PURCHASE_OFFER'
  if (normalized.includes('CONVERSION_DROP')) return 'REORDER_PRODUCTS'
  return 'DO_NOTHING'
}

function surfaceForActionPlan(actionType: CroApprovedActionType, scope: string) {
  if (actionType === 'CHANGE_CHAT_OPENING') return 'chat'
  if (actionType === 'SHOW_POST_PURCHASE_OFFER' || actionType === 'CHANGE_OFFER_SEQUENCE') return 'post_purchase'
  if (actionType === 'DIAGNOSE_FUNNEL') return 'checkout'
  if (actionType === 'AUDIT_TRAFFIC_SOURCE' || actionType === 'CHANGE_PROMOTION_EXPOSURE') return 'acquisition'
  if (scope.startsWith('product:')) return 'products'
  if (scope.includes('device:mobile')) return 'mobile'
  return 'products'
}

function promotionActionGuardrails(actionType: CroApprovedActionType) {
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

function actionPlanAppliesToSurface(plan: CroActionPlan | any, surface: string) {
  const planSurface = String(plan.surface || 'products').toLowerCase()
  const currentSurface = String(surface || 'products').toLowerCase()
  return planSurface === currentSurface || planSurface === 'products' || (planSurface === 'mobile' && currentSurface.includes('mobile'))
}

const PRODUCT_RANKING_ACTION_TYPES = new Set([
  'REORDER_PRODUCTS',
  'FEATURE_PRODUCT',
  'SUPPRESS_PRODUCT',
  'SHOW_RECOMMENDATION',
  'CHANGE_RECOMMENDATION_POSITION',
])

function actionPlanProductModifier(plan: CroActionPlan | any, product: ProductGroup, category?: Category) {
  if (String(plan.status || '').toLowerCase() !== 'running') return null
  const actionType = String(plan.actionType || plan.action_type || '').toUpperCase()
  if (!PRODUCT_RANKING_ACTION_TYPES.has(actionType)) return null
  const scope = String(plan.scope || 'store')
  const confidence = clamp(toNumber(plan.confidence), 0, 0.99)
  const priority = clamp(toNumber(plan.priority), 0, 10)
  const base = Math.round((1200 + priority * 180) * Math.max(0.25, confidence))
  const appliesToProduct = scope === 'store'
    || scope === `product:${product.id}`
    || scope === `category:${product.category_id}`
    || (category?.name && normalizeCatalogueText(scope).includes(normalizeCatalogueText(category.name)))

  if (!appliesToProduct) return null

  if (actionType === 'SUPPRESS_PRODUCT') {
    return { score: -base * 3, reason: 'running_action_plan_suppression' }
  }

  if (['FEATURE_PRODUCT', 'SHOW_RECOMMENDATION'].includes(actionType)) {
    return { score: base * (scope === `product:${product.id}` ? 3 : 1), reason: 'running_action_plan_feature' }
  }

  if (['REORDER_PRODUCTS', 'CHANGE_RECOMMENDATION_POSITION'].includes(actionType)) {
    return { score: Math.round(base * 0.65), reason: 'running_action_plan_placement' }
  }

  return null
}

export function deriveCroActionPlans(opportunities: CroOpportunity[] | any[]): CroActionPlan[] {
  return (opportunities || [])
    .filter((opportunity) => ['open', 'watching', 'testing', undefined, null].includes(opportunity.status))
    .map((opportunity) => {
      const opportunityKey = String(opportunity.opportunityKey || opportunity.opportunity_key || opportunity.id || crypto.randomUUID())
      const type = String(opportunity.type || '')
      const scope = String(opportunity.scope || 'store')
      const actionType = actionTypeForOpportunity(type)
      const surface = surfaceForActionPlan(actionType, scope)
      const priority = clamp(toNumber(opportunity.priority), 0, 10)
      const confidence = clamp(toNumber(opportunity.confidence), 0, 0.99)
      const risk = clamp(toNumber(opportunity.risk), 0, 1)
      const expectedValue = Math.max(0, Math.round(toNumber(opportunity.expectedValue ?? opportunity.expected_value)))
      const manuallyApprovedActions: CroApprovedActionType[] = ['DIAGNOSE_FUNNEL', 'RESTOCK_PRODUCT', 'AUDIT_TRAFFIC_SOURCE', 'CHANGE_PROMOTION_EXPOSURE']
      const safeToAutoRun = confidence >= 0.75 && risk <= 0.25 && !manuallyApprovedActions.includes(actionType)

      return {
        actionKey: `action:${opportunityKey}:${actionType}`,
        opportunityKey,
        actionType,
        surface,
        scope,
        status: 'proposed',
        priority,
        expectedValue,
        confidence,
        risk,
        guardrails: {
          approved_action_vocabulary_only: true,
          no_arbitrary_code_changes: true,
          no_invented_products: true,
          no_invented_prices: true,
          requires_admin_approval: !safeToAutoRun,
          safe_to_auto_run: safeToAutoRun,
          do_nothing_allowed: true,
          ...promotionActionGuardrails(actionType),
        },
        payload: {
          intervention_type: actionType,
          surface,
          scope,
          source_opportunity_type: type,
          source_opportunity_key: opportunityKey,
          ...(actionType === 'CHANGE_PROMOTION_EXPOSURE'
            ? {
                permitted_operation: 'promotion_exposure_only',
                cannot_create_discount_code: true,
                cannot_change_price: true,
                cannot_fabricate_scarcity_or_timers: true,
              }
            : {}),
        },
        evidence: opportunity.evidence || {},
      }
    })
}

export async function recordCroActionPlans(actionPlans: CroActionPlan[]) {
  if (actionPlans.length === 0) return
  const now = new Date().toISOString()
  const keys = actionPlans.map((plan) => plan.actionKey)
  const { data: existingRows, error: existingError } = await supabase
    .from('cro_action_plans' as any)
    .select('action_key,status')
    .in('action_key', keys)
  if (existingError) throw existingError
  const existingStatusByKey = new Map((existingRows || []).map((row: any) => [String(row.action_key), String(row.status || 'proposed')]))
  const { error } = await supabase.from('cro_action_plans' as any).upsert(
    actionPlans.map((plan) => ({
      action_key: plan.actionKey,
      opportunity_key: plan.opportunityKey || null,
      action_type: plan.actionType,
      surface: plan.surface,
      scope: plan.scope,
      status: existingStatusByKey.get(plan.actionKey) || plan.status,
      priority: plan.priority,
      expected_value: plan.expectedValue,
      confidence: plan.confidence,
      risk: plan.risk,
      guardrails: plan.guardrails,
      payload: plan.payload,
      evidence: plan.evidence,
      updated_at: now,
    })),
    { onConflict: 'action_key' },
  )
  if (error) throw error
}

export async function loadRunningCroActionPlans() {
  try {
    const settings = await loadRevenueOsSettings()
    if (!settings.enabled || settings.freezeReason || settings.shadowMode) return []
    const { data, error } = await supabase
      .from('cro_action_plans' as any)
      .select('*')
      .eq('status', 'running')
      .order('priority', { ascending: false })
      .order('confidence', { ascending: false })
      .limit(50)

    if (error) throw error
    return data || []
  } catch (error) {
    console.warn('Running CRO action plans unavailable:', error)
    return []
  }
}

export async function updateCroActionPlanStatus(input: {
  id?: string | null
  actionKey?: string | null
  status: CroActionPlan['status']
  reviewerId?: string | null
  reason?: string
}) {
  const allowedStatuses = new Set(['proposed', 'approved', 'running', 'paused', 'completed', 'rejected'])
  if (!allowedStatuses.has(input.status)) throw new Error('Unsupported action plan status')
  const now = new Date().toISOString()
  let lookup = supabase.from('cro_action_plans' as any).select('id,status,guardrails,evidence').limit(1)
  if (input.id) lookup = lookup.eq('id', input.id)
  else if (input.actionKey) lookup = lookup.eq('action_key', input.actionKey)
  else throw new Error('Missing action plan id')
  const { data: rows, error: lookupError } = await lookup
  if (lookupError) throw lookupError
  const existing = rows?.[0] as any
  if (!existing?.id) throw new Error('Action plan not found')
  const currentStatus = String(existing.status || 'proposed').toLowerCase()
  const safeToAutoRun = existing.guardrails?.safe_to_auto_run === true
  if (input.status === 'running') {
    const settings = await loadRevenueOsSettings()
    if (!settings.enabled || settings.freezeReason || settings.shadowMode) {
      throw new Error(settings.freezeReason
        ? `Revenue OS is frozen by guardrail: ${settings.freezeReason}`
        : settings.shadowMode
          ? 'Revenue OS is in shadow mode'
        : 'Revenue OS is paused')
    }
    if (!safeToAutoRun && !['approved', 'paused'].includes(currentStatus)) {
      throw new Error('Approve this bounded action before it can run')
    }
  }
  const existingEvidence = existing?.evidence && typeof existing.evidence === 'object' ? existing.evidence : {}
  const updates = {
    status: input.status,
    updated_at: now,
    evidence: {
      ...existingEvidence,
      last_status_changed_at: now,
      last_status_changed_by: input.reviewerId || null,
      last_status_change_reason: input.reason || input.status,
      status_history: [
        ...(Array.isArray(existingEvidence.status_history) ? existingEvidence.status_history.slice(-20) : []),
        {
          status: input.status,
          changed_at: now,
          changed_by: input.reviewerId || null,
          reason: input.reason || input.status,
        },
      ],
    },
  }
  let query = supabase.from('cro_action_plans' as any).update(updates)
  if (existing?.id) query = query.eq('id', existing.id)
  else if (input.id) query = query.eq('id', input.id)
  else if (input.actionKey) query = query.eq('action_key', input.actionKey)

  const { error } = await query
  if (error) throw error
}

export function createProductRankingExperimentFromOpportunity(opportunity: any) {
  const keyBase = normalizeCatalogueText(`${opportunity.type || 'opportunity'} ${opportunity.scope || 'store'}`).replace(/\s+/g, '_') || 'revenue_os'
  const day = new Date().toISOString().slice(0, 10)
  const expectedValue = toNumber(opportunity.expected_value ?? opportunity.expectedValue)
  const confidence = clamp(toNumber(opportunity.confidence), 0, 0.99)
  const scope = String(opportunity.scope || 'store')
  const surface = scope.startsWith('product:') ? 'products' : scope.includes('category') ? 'category' : 'products'

  return {
    experiment_key: `cro_${keyBase}_${day}`,
    hypothesis: `${opportunity.type || 'Revenue opportunity'} can improve revenue by applying deterministic Revenue OS ranking on ${scope}.`,
    audience: {
      surface,
      source_opportunity_key: opportunity.opportunity_key || opportunity.opportunityKey || null,
      scope,
    },
    control: {
      id: 'control',
      description: 'Current default ordering without Revenue OS intervention.',
    },
    variants: [
      { id: 'control', weight: 0.5, description: 'Default ranking' },
      { id: 'revenue_os_ranked', weight: 0.5, description: 'Revenue OS deterministic ranked ordering' },
    ],
    primary_metric: 'revenue_per_visitor',
    guardrail_metrics: ['conversion_rate', 'payment_completion', 'refund_rate', 'payment_failure_rate'],
    minimum_practical_effect: Math.max(1000, Math.round(expectedValue * 0.03)),
    confidence_threshold: Math.max(0.8, Math.min(0.95, confidence + 0.1)),
    status: 'draft',
    decision: {
      source: 'opportunity_queue',
      expected_value: expectedValue,
      confidence,
      immutable_guardrails: [
        'never_sell_unavailable_product',
        'never_invent_product',
        'never_invent_price',
        'never_modify_payment_records',
      ],
    },
  }
}

export async function recordCroExperiment(experiment: ReturnType<typeof createProductRankingExperimentFromOpportunity>) {
  const { error } = await supabase.from('cro_experiments' as any).upsert(experiment, { onConflict: 'experiment_key' })
  if (error) throw error
}

function eventAmount(event: any) {
  const metadata = event?.metadata || {}
  const explicitNgn = metadata.normalized_reporting_value_ngn
    ?? metadata.amount_ngn
    ?? metadata.price_ngn
    ?? metadata.charged_price_ngn
  if (explicitNgn != null) return toNumber(explicitNgn)

  const currency = String(metadata.currency || metadata.display_currency || 'NGN').toUpperCase()
  const amount = toNumber(metadata.amount ?? metadata.price)
  if (currency === 'USD') {
    const exchangeRate = toNumber(metadata.exchange_rate ?? metadata.usd_to_ngn_rate)
    return exchangeRate > 0 ? amount * exchangeRate : 0
  }
  return amount
}

function isPurchaseReversalEvent(event: any) {
  return ['PRODUCT_PURCHASE_REVERSED', 'SMS_ORDER_CANCELLED', 'SMS_ORDER_REFUNDED'].includes(String(event?.event_type || ''))
}

export function deriveCroExperimentEvaluations(input: {
  experiments: any[]
  revenueEvents: any[]
  orders?: any[]
  smsOrders?: any[]
  serviceOrders?: any[]
  now?: Date
  windowDays?: number
}): CroExperimentEvaluation[] {
  const now = input.now || new Date()
  const windowDays = input.windowDays || 14
  const periodStart = new Date(now.getTime() - windowDays * 86400000)
  const periodEnd = now
  const events = input.revenueEvents.filter((event) => {
    const createdAt = dateOrNull(event.created_at)
    return createdAt && createdAt >= periodStart && createdAt <= periodEnd && event.experiment_id
  })
  const productOrderById = new Map((input.orders || []).map((order) => [String(order.id), order]))
  const smsOrderById = new Map((input.smsOrders || []).map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of input.serviceOrders || []) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }

  const creditedCommerceOrderForEvent = (event: any) => {
    const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
    return linkedOrder && isSuccessfulCommerceStatus(linkedOrder.status) ? linkedOrder : null
  }

  const rawEvaluations = input.experiments
    .filter((experiment) => experiment.experiment_key || experiment.id)
    .map((experiment): RawCroExperimentEvaluation => {
      const experimentKey = experiment.experiment_key || experiment.id
      const experimentEvents = events.filter((event) => event.experiment_id === experimentKey)
      const variants = new Map<string, any[]>()
      for (const event of experimentEvents) {
        const variantId = event.variant_id || 'unknown'
        variants.set(variantId, [...(variants.get(variantId) || []), event])
      }

      const summarize = (variantId: string, rows: any[]) => {
        const visitors = new Set(rows.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size
        const impressions = rows.filter((event) => event.event_type === 'PRODUCT_IMPRESSION').length
        const clicks = rows.filter((event) => isProductClickEvent(event.event_type)).length
        const buyClicks = rows.filter((event) => event.event_type === 'BUY_CLICKED').length
        const purchaseEvents = rows.filter((event) => event.event_type === 'PRODUCT_PURCHASED')
        const reversalEvents = rows.filter(isPurchaseReversalEvent)
        const creditedPurchaseEvents: any[] = []
        const creditedOrderIds = new Set<string>()
        for (const event of purchaseEvents) {
          const linkedOrder = creditedCommerceOrderForEvent(event)
          const linkedOrderId = linkedOrder?.id ? String(linkedOrder.id) : ''
          if (!linkedOrderId || creditedOrderIds.has(linkedOrderId)) continue
          creditedOrderIds.add(linkedOrderId)
          creditedPurchaseEvents.push(event)
        }
        const reversedPurchases = purchaseEvents.length - creditedPurchaseEvents.length + reversalEvents.length
        const purchases = creditedPurchaseEvents.length
        const paymentStarts = rows.filter((event) => event.event_type === 'PAYMENT_STARTED').length
        const paymentFailures = rows.filter((event) => event.event_type === 'PAYMENT_FAILED').length
        const supportHandoffs = rows.filter((event) => event.event_type === 'SUPPORT_HANDOFF').length
        const revenue = Math.max(0, sumBy(creditedPurchaseEvents, eventAmount) - sumBy(reversalEvents, eventAmount))
        return {
          variant_id: variantId,
          visitors,
          impressions,
          clicks,
          buy_clicks: buyClicks,
          purchases,
          revenue,
          revenue_per_visitor: visitors > 0 ? revenue / visitors : 0,
          conversion_rate: visitors > 0 ? purchases / visitors : 0,
          click_rate: impressions > 0 ? clicks / impressions : 0,
          payment_failure_rate: paymentStarts > 0 ? paymentFailures / paymentStarts : 0,
          support_handoff_rate: visitors > 0 ? supportHandoffs / visitors : 0,
          payment_starts: paymentStarts,
          payment_failures: paymentFailures,
          support_handoffs: supportHandoffs,
          reversed_purchases: reversedPurchases,
        }
      }

      const summaries = [...variants.entries()].map(([variantId, rows]) => summarize(variantId, rows))
      const control = summaries.find((summary) => summary.variant_id === 'control' || summary.variant_id === 'holdout') || summaries[0] || summarize('control', [])
      const treatmentVariants = summaries.filter((summary) => summary.variant_id !== control.variant_id)
      const bestVariant = treatmentVariants.sort((a, b) => b.revenue_per_visitor - a.revenue_per_visitor)[0]
      const minimumPracticalEffect = Math.max(
        toNumber(experiment.minimum_practical_effect, 0),
        toNumber(experiment.minimum_practical_effect_ngn, 0),
        100,
      )
      const confidenceThreshold = clamp(toNumber(experiment.confidence_threshold, 0.95), 0.5, 0.999)
      const minVisitorsPerArm = Math.max(50, Math.round(toNumber(experiment.min_visitors_per_arm, experiment.min_sample_size_per_arm ?? 100)))
      const minPurchases = Math.max(3, Math.round(toNumber(experiment.min_purchases, 5)))
      const minRuntimeDays = Math.max(1, Math.round(toNumber(experiment.min_runtime_days, 3)))
      const startedAt = dateOrNull(experiment.started_at || experiment.start_date || experiment.created_at) || periodStart
      const runtimeDays = Math.max(0, (periodEnd.getTime() - startedAt.getTime()) / 86400000)
      const sampleSize = control.visitors + (bestVariant?.visitors || 0)
      const purchaseSampleSize = control.purchases + (bestVariant?.purchases || 0)
      const uplift = bestVariant ? bestVariant.revenue_per_visitor - control.revenue_per_visitor : 0
      const relativeUplift = control.revenue_per_visitor > 0 ? uplift / control.revenue_per_visitor : uplift > 0 ? 1 : 0
      const confidence = clamp(0.25 + Math.min(sampleSize, 1000) / 1600 + Math.min(Math.abs(relativeUplift), 1) * 0.2)
      const sampleSizeReady = !!bestVariant && control.visitors >= minVisitorsPerArm && bestVariant.visitors >= minVisitorsPerArm
      const purchaseSampleReady = purchaseSampleSize >= minPurchases
      const runtimeReady = runtimeDays >= minRuntimeDays
      const minimumPracticalEffectPassed = uplift >= minimumPracticalEffect
      const negativePracticalEffectPassed = uplift <= -minimumPracticalEffect
      const guardrailFailure = !!bestVariant && (
        bestVariant.payment_failure_rate > Math.max(0.25, control.payment_failure_rate + 0.1) ||
        bestVariant.conversion_rate < control.conversion_rate * 0.8 ||
        bestVariant.support_handoff_rate > Math.max(0.08, control.support_handoff_rate + 0.05)
      )
      const guardrailsPassed = !guardrailFailure
      const practicalEffectRatio = minimumPracticalEffect > 0 ? Math.abs(uplift) / minimumPracticalEffect : Math.abs(uplift)
      const decisionQualityScore = clamp(
        (sampleSizeReady ? 0.25 : 0) +
        (purchaseSampleReady ? 0.15 : 0) +
        (runtimeReady ? 0.15 : 0) +
        (guardrailsPassed ? 0.15 : 0) +
        Math.min(confidence / confidenceThreshold, 1) * 0.2 +
        Math.min(practicalEffectRatio, 1) * 0.1,
      )

      let decision: CroExperimentEvaluation['decision'] = 'insufficient_data'
      if (sampleSizeReady && bestVariant) {
        if (guardrailFailure) decision = 'rollback'
        else if (
          minimumPracticalEffectPassed &&
          purchaseSampleReady &&
          runtimeReady &&
          confidence >= confidenceThreshold
        ) decision = 'promote'
        else if (negativePracticalEffectPassed && purchaseSampleReady && confidence >= 0.8) decision = 'pause'
        else decision = 'keep_running'
      }

      return {
        evaluationKey: `eval:${experimentKey}:${periodStart.toISOString().slice(0, 10)}:${periodEnd.toISOString().slice(0, 10)}`,
        experimentKey,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        primaryMetric: experiment.primary_metric || 'revenue_per_visitor',
        control,
        variants: summaries,
        guardrails: {
          guardrail_failure: guardrailFailure,
          guardrails_passed: guardrailsPassed,
          control_payment_failure_rate: control.payment_failure_rate,
          best_payment_failure_rate: bestVariant?.payment_failure_rate || 0,
          control_support_handoff_rate: control.support_handoff_rate,
          best_support_handoff_rate: bestVariant?.support_handoff_rate || 0,
          control_conversion_rate: control.conversion_rate,
          best_conversion_rate: bestVariant?.conversion_rate || 0,
        },
        decision,
        confidence,
        minimumPracticalEffect,
        evidence: {
          sample_size: sampleSize,
          purchase_sample_size: purchaseSampleSize,
          min_visitors_per_arm: minVisitorsPerArm,
          min_purchases: minPurchases,
          min_runtime_days: minRuntimeDays,
          runtime_days: runtimeDays,
          sample_size_ready: sampleSizeReady,
          purchase_sample_ready: purchaseSampleReady,
          runtime_ready: runtimeReady,
          confidence_threshold: confidenceThreshold,
          minimum_practical_effect_passed: minimumPracticalEffectPassed,
          negative_practical_effect_passed: negativePracticalEffectPassed,
          decision_quality_score: decisionQualityScore,
          preliminary_decision: decision,
          uplift,
          relative_uplift: relativeUplift,
          best_variant_id: bestVariant?.variant_id || null,
          event_count: experimentEvents.length,
        },
      }
    })

  const qThreshold = 0.1
  const sortedByRisk = [...rawEvaluations]
    .map((evaluation, index) => ({
      evaluation,
      originalIndex: index,
      falseDiscoveryRisk: clamp(1 - evaluation.confidence),
    }))
    .sort((a, b) => a.falseDiscoveryRisk - b.falseDiscoveryRisk)

  let runningMinQValue = 1
  for (let index = sortedByRisk.length - 1; index >= 0; index -= 1) {
    const item = sortedByRisk[index]
    const rank = index + 1
    const qValue = clamp((item.falseDiscoveryRisk * sortedByRisk.length) / Math.max(rank, 1))
    runningMinQValue = Math.min(runningMinQValue, qValue)
    const falseDiscoveryPassed = runningMinQValue <= qThreshold
    item.evaluation._statistical = {
      falseDiscoveryRisk: item.falseDiscoveryRisk,
      multipleTestingQValue: runningMinQValue,
      falseDiscoveryPassed,
    }
    if (item.evaluation.decision === 'promote' && !falseDiscoveryPassed) {
      item.evaluation.decision = 'keep_running'
      item.evaluation.evidence = {
        ...item.evaluation.evidence,
        decision_before_multiple_testing: 'promote',
        multiple_testing_decision: 'kept_running_until_false_discovery_risk_falls',
      }
    }
  }

  return rawEvaluations.map((evaluation) => {
    const statistical = evaluation._statistical || {
      falseDiscoveryRisk: clamp(1 - evaluation.confidence),
      multipleTestingQValue: clamp(1 - evaluation.confidence),
      falseDiscoveryPassed: false,
    }
    const { _statistical, ...cleanEvaluation } = evaluation
    return {
      ...cleanEvaluation,
      evidence: {
        ...cleanEvaluation.evidence,
        false_discovery_risk: statistical.falseDiscoveryRisk,
        multiple_testing_q_value: statistical.multipleTestingQValue,
        false_discovery_passed: statistical.falseDiscoveryPassed,
        false_discovery_q_threshold: qThreshold,
        effect_claim: 'incremental_estimate_requires_control_or_holdout_evidence',
      },
    }
  })
}

export function deriveCroBanditAllocations(input: {
  experiments: any[]
  revenueEvents: any[]
  orders?: any[]
  smsOrders?: any[]
  serviceOrders?: any[]
  now?: Date
  windowDays?: number
  minExplorationPct?: number
}): CroBanditAllocation[] {
  const now = input.now || new Date()
  const windowDays = input.windowDays || 14
  const periodStart = new Date(now.getTime() - windowDays * 86400000)
  const minExplorationPct = clamp(toNumber(input.minExplorationPct, 0.08), 0.02, 0.25)
  const productOrderById = new Map((input.orders || []).map((order) => [String(order.id), order]))
  const smsOrderById = new Map((input.smsOrders || []).map((order) => [String(order.id), order]))
  const serviceOrderById = new Map<string, any>()
  for (const order of input.serviceOrders || []) {
    serviceOrderById.set(String(order.id), order)
    const rawId = String(order.id || '').split(':').slice(1).join(':')
    if (rawId) serviceOrderById.set(rawId, order)
  }
  const events = (input.revenueEvents || []).filter((event) => {
    const createdAt = dateOrNull(event.created_at)
    return createdAt && createdAt >= periodStart && createdAt <= now && event.experiment_id
  })
  const eventReward = (event: any, creditedOrderIds?: Set<string>) => {
    if (event.event_type === 'PRODUCT_PURCHASED') {
      const linkedOrder = linkedCommerceOrderForEvent(event, productOrderById, smsOrderById, serviceOrderById)
      if (!linkedOrder || !isSuccessfulCommerceStatus(linkedOrder.status)) return 0
      const linkedOrderId = linkedOrder.id ? String(linkedOrder.id) : ''
      if (!linkedOrderId || creditedOrderIds?.has(linkedOrderId)) return 0
      creditedOrderIds?.add(linkedOrderId)
      return Math.max(0, eventAmount(event))
    }
    if (isPurchaseReversalEvent(event)) return -Math.max(0, eventAmount(event))
    if (event.event_type === 'BUY_CLICKED') return 250
    if (isProductClickEvent(event.event_type)) return 60
    if (event.event_type === 'RECOMMENDATION_DISMISSED' || event.event_type === 'OFFER_DISMISSED') return -120
    if (event.event_type === 'SUPPORT_HANDOFF') return -350
    if (event.event_type === 'PAYMENT_FAILED') return -500
    if (event.event_type === 'CHECKOUT_ABANDONED') return -220
    return 0
  }

  return (input.experiments || [])
    .filter((experiment) => String(experiment.status || '').toLowerCase() === 'running')
    .map((experiment): CroBanditAllocation => {
      const experimentKey = experiment.experiment_key || experiment.id
      const configuredVariants: string[] = Array.isArray(experiment.variants) && experiment.variants.length > 0
        ? experiment.variants.map((variant: any) => String(variant.id || variant.variant_id || variant.name || 'variant'))
        : ['control', 'revenue_os_ranked']
      const variants: string[] = [...new Set(configuredVariants)]
      const variantStats = new Map<string, { visitors: Set<string>; reward: number; events: number; paymentFailures: number; paymentStarts: number; dismissals: number; supportHandoffs: number }>()
      for (const variantId of variants) {
        variantStats.set(variantId, { visitors: new Set(), reward: 0, events: 0, paymentFailures: 0, paymentStarts: 0, dismissals: 0, supportHandoffs: 0 })
      }
      const creditedOrderIdsByVariant = new Map<string, Set<string>>()

      for (const event of events.filter((row) => row.experiment_id === experimentKey)) {
        const variantId = String(event.variant_id || 'unknown')
        if (!variantStats.has(variantId)) {
          variantStats.set(variantId, { visitors: new Set(), reward: 0, events: 0, paymentFailures: 0, paymentStarts: 0, dismissals: 0, supportHandoffs: 0 })
        }
        const stats = variantStats.get(variantId)!
        const visitorKey = event.visitor_id || event.user_id || event.session_id
        if (visitorKey) stats.visitors.add(String(visitorKey))
        const creditedOrderIds = creditedOrderIdsByVariant.get(variantId) || new Set<string>()
        creditedOrderIdsByVariant.set(variantId, creditedOrderIds)
        stats.reward += eventReward(event, creditedOrderIds)
        stats.events += 1
        if (event.event_type === 'PAYMENT_STARTED') stats.paymentStarts += 1
        if (event.event_type === 'PAYMENT_FAILED') stats.paymentFailures += 1
        if (event.event_type === 'RECOMMENDATION_DISMISSED' || event.event_type === 'OFFER_DISMISSED') stats.dismissals += 1
        if (event.event_type === 'SUPPORT_HANDOFF') stats.supportHandoffs += 1
      }

      const rows = [...variantStats.entries()].map(([variantId, stats]) => {
        const visitors = stats.visitors.size
        const rewardPerVisitor = visitors > 0 ? stats.reward / visitors : 0
        const paymentFailureRate = stats.paymentStarts > 0 ? stats.paymentFailures / stats.paymentStarts : 0
        const dismissalRate = visitors > 0 ? stats.dismissals / visitors : 0
        const supportHandoffRate = visitors > 0 ? stats.supportHandoffs / visitors : 0
        const eligible = visitors >= 25 && paymentFailureRate <= 0.3 && dismissalRate <= 0.45 && supportHandoffRate <= 0.12
        const reasons = [
          visitors < 25 ? 'low_sample' : 'sample_ready',
          paymentFailureRate > 0.3 ? 'payment_failure_guardrail' : 'payment_guardrail_ok',
          dismissalRate > 0.45 ? 'pressure_guardrail' : 'pressure_guardrail_ok',
          supportHandoffRate > 0.12 ? 'support_handoff_guardrail' : 'support_guardrail_ok',
        ]
        return {
          variantId,
          reward: rewardPerVisitor,
          visitors,
          confidence: clamp(0.25 + Math.min(visitors, 500) / 800 + Math.min(Math.max(rewardPerVisitor, 0), 5000) / 25000),
          eligible,
          reasons,
          rawReward: stats.reward,
          events: stats.events,
          paymentFailureRate,
          dismissalRate,
          supportHandoffRate,
        }
      })

      const eligibleRows = rows.filter((row) => row.eligible)
      const recommendation: CroBanditAllocation['recommendation'] = rows.length === 0 || rows.every((row) => row.visitors === 0)
        ? 'insufficient_data'
        : eligibleRows.length === 0
          ? rows.some((row) => row.paymentFailureRate > 0.3 || row.supportHandoffRate > 0.12) ? 'pause' : 'explore'
          : 'allocate'
      const rewardFloor = Math.min(...eligibleRows.map((row) => row.reward), 0)
      const positiveTotal = sumBy(eligibleRows, (row) => Math.max(0.01, row.reward - rewardFloor + 1))
      const explorationPool = recommendation === 'allocate' ? minExplorationPct * variants.length : 1
      const exploitationPool = Math.max(0, 1 - explorationPool)
      const allocation = rows
        .map((row) => {
          const baseWeight = recommendation === 'allocate' ? minExplorationPct : 1 / Math.max(rows.length, 1)
          const exploitWeight = recommendation === 'allocate' && row.eligible && positiveTotal > 0
            ? exploitationPool * Math.max(0.01, row.reward - rewardFloor + 1) / positiveTotal
            : 0
          return {
            variantId: row.variantId,
            weight: clamp(baseWeight + exploitWeight, 0, 1),
            reward: row.reward,
            visitors: row.visitors,
            confidence: row.confidence,
            eligible: row.eligible,
            reasons: row.reasons,
          }
        })
      const totalWeight = sumBy(allocation, (row) => row.weight) || 1

      return {
        snapshotKey: `bandit:${experimentKey}:${periodStart.toISOString().slice(0, 10)}:${now.toISOString().slice(0, 10)}`,
        experimentKey,
        surface: experiment.audience?.surface || experiment.audience?.surfaces?.[0] || 'products',
        allocation: allocation.map((row) => ({ ...row, weight: row.weight / totalWeight })),
        recommendation,
        evidence: {
          window_days: windowDays,
          min_exploration_pct: minExplorationPct,
          reward_definition: 'purchase_revenue_plus_click_rewards_minus_failure_pressure_cost',
          reward_penalties: ['purchase_reversal', 'payment_failure', 'checkout_abandonment', 'support_handoff', 'dismissal_pressure'],
          variants: rows,
        },
      }
    })
}

export function deriveCroSimulationRun(input: {
  decisionRows: any[]
  products: ProductGroup[]
  now?: Date
  windowDays?: number
}): CroSimulationRun {
  const now = input.now || new Date()
  const periodStart = new Date(now.getTime() - (input.windowDays || 14) * 86400000)
  const periodEnd = now
  const productById = new Map(input.products.map((product) => [product.id, product]))
  const decisions = input.decisionRows.filter((row) => {
    const createdAt = dateOrNull(row.created_at)
    return createdAt && createdAt >= periodStart && createdAt <= periodEnd
  })

  const violations: Array<Record<string, unknown>> = []
  const selectedCounts = new Map<string, number>()
  const sessions = new Set<string>()

  for (const decision of decisions) {
    if (decision.session_id) sessions.add(decision.session_id)
    const selectedId = decision.selected_product_group_id
    if (selectedId) selectedCounts.set(selectedId, (selectedCounts.get(selectedId) || 0) + 1)
    const selectedProduct = selectedId ? productById.get(selectedId) : null
    if (selectedId && !selectedProduct) {
      violations.push({ type: 'missing_selected_product', decision_id: decision.decision_id, product_group_id: selectedId })
    }
    if (selectedProduct && !evaluateProductEligibility(selectedProduct).isSellable) {
      violations.push({ type: 'selected_product_not_sellable', decision_id: decision.decision_id, product_group_id: selectedId })
    }
    const candidates = Array.isArray(decision.candidates) ? decision.candidates : []
    for (const candidate of candidates.slice(0, 5)) {
      const product = candidate.product_group_id ? productById.get(candidate.product_group_id) : null
      if (!product) continue
      if (!evaluateProductEligibility(product).isSellable) {
        violations.push({ type: 'candidate_not_sellable', decision_id: decision.decision_id, product_group_id: candidate.product_group_id })
      }
    }
  }

  const totalSelections = [...selectedCounts.values()].reduce((sum, count) => sum + count, 0)
  const topSelection = [...selectedCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topShare = totalSelections > 0 && topSelection ? topSelection[1] / totalSelections : 0
  const recommendation: CroSimulationRun['recommendation'] =
    decisions.length < 20 ? 'insufficient_data'
      : violations.length > 0 ? 'pause'
        : topShare > 0.55 ? 'watch'
          : 'safe'

  return {
    simulationKey: `shadow:${periodStart.toISOString().slice(0, 10)}:${periodEnd.toISOString().slice(0, 10)}`,
    mode: 'shadow',
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    sessionsEvaluated: sessions.size,
    decisionsEvaluated: decisions.length,
    violations: violations.slice(0, 50),
    concentration: {
      top_product_group_id: topSelection?.[0] || null,
      top_selection_count: topSelection?.[1] || 0,
      top_share: topShare,
      unique_selected_products: selectedCounts.size,
    },
    recommendation,
    evidence: {
      violation_count: violations.length,
      selected_product_count: totalSelections,
    },
  }
}

export function deriveCroDriftChecks(featureRows: any[], now = new Date()): CroDriftCheck[] {
  const storeRows = featureRows
    .filter((row) => row.scope_type === 'store' && row.features)
    .sort((a, b) => new Date(b.window_end || b.created_at).getTime() - new Date(a.window_end || a.created_at).getTime())

  if (storeRows.length < 2) {
    return [{
      checkKey: `drift:revenue_os_ranker:${now.toISOString().slice(0, 10)}`,
      modelKey: 'revenue_os_ranker',
      periodStart: new Date(now.getTime() - 14 * 86400000).toISOString(),
      periodEnd: now.toISOString(),
      status: 'insufficient_data',
      driftScore: 0,
      evidence: { store_snapshots: storeRows.length },
    }]
  }

  const latest = storeRows[0]
  const previous = storeRows[1]
  const latestConversion = toNumber(latest.features.conversion_rate)
  const previousConversion = toNumber(previous.features.conversion_rate)
  const latestFailure = toNumber(latest.features.payment_failures) / Math.max(1, toNumber(latest.features.payment_starts))
  const previousFailure = toNumber(previous.features.payment_failures) / Math.max(1, toNumber(previous.features.payment_starts))
  const conversionDrift = previousConversion > 0 ? Math.abs(latestConversion - previousConversion) / previousConversion : latestConversion > 0 ? 1 : 0
  const failureDrift = Math.abs(latestFailure - previousFailure)
  const driftScore = clamp(conversionDrift * 0.7 + failureDrift * 0.8)
  const status: CroDriftCheck['status'] = driftScore >= 0.35 ? 'drift' : driftScore >= 0.18 ? 'watch' : 'stable'

  return [{
    checkKey: `drift:revenue_os_ranker:${now.toISOString().slice(0, 10)}`,
    modelKey: 'revenue_os_ranker',
    periodStart: new Date(now.getTime() - 14 * 86400000).toISOString(),
    periodEnd: now.toISOString(),
    status,
    driftScore,
    evidence: {
      latest_snapshot: latest.snapshot_key,
      previous_snapshot: previous.snapshot_key,
      latest_conversion_rate: latestConversion,
      previous_conversion_rate: previousConversion,
      latest_payment_failure_rate: latestFailure,
      previous_payment_failure_rate: previousFailure,
    },
  }]
}

export function deriveRevenueAnomalyChecks(input: {
  featureRows: any[]
  revenueEvents: any[]
  orders: any[]
  commerceOrders?: any[]
  profiles?: any[]
  now?: Date
}): CroDriftCheck[] {
  const now = input.now || new Date()
  const dayMs = 86400000
  const periodStart = new Date(now.getTime() - 7 * dayMs)
  const previousStart = new Date(now.getTime() - 14 * dayMs)
  const profileById = new Map((input.profiles || []).map((profile) => [profile.id, profile]))
  const isInternalUser = (userId: string | null | undefined) => {
    const profile = userId ? profileById.get(userId) : null
    return !!profile?.is_staff || !!profile?.is_admin
  }
  const inWindow = (row: any, start: Date, end: Date) => {
    const created = dateOrNull(row.created_at)
    return created && created >= start && created < end && !isInternalUser(row.user_id)
  }
  const trustedEvent = (event: any) => {
    const quality = event.metadata?.traffic_quality || event.metadata?.attribution?.trafficQuality || 'human'
    return !['bot', 'internal', 'suspect'].includes(String(quality).toLowerCase())
  }
  const commerceOrders = input.commerceOrders?.length ? input.commerceOrders : input.orders
  const recentEvents = (input.revenueEvents || []).filter((event) => inWindow(event, periodStart, now) && trustedEvent(event))
  const previousEvents = (input.revenueEvents || []).filter((event) => inWindow(event, previousStart, periodStart) && trustedEvent(event))
  const recentOrders = (commerceOrders || []).filter((order) => inWindow(order, periodStart, now) && isSuccessfulCommerceStatus(order.status))
  const previousOrders = (commerceOrders || []).filter((order) => inWindow(order, previousStart, periodStart) && isSuccessfulCommerceStatus(order.status))
  const countEvent = (events: any[], eventType: RevenueEventType) => events.filter((event) => event.event_type === eventType).length
  const visitors = (events: any[]) => new Set(events.map((event) => event.visitor_id || event.user_id || event.session_id).filter(Boolean)).size
  const revenue = (orders: any[]) => sumBy(orders, (order) => toNumber(order.amount))
  const recentVisitors = visitors(recentEvents)
  const previousVisitors = visitors(previousEvents)
  const recentRevenue = revenue(recentOrders)
  const previousRevenue = revenue(previousOrders)
  const recentConversion = recentVisitors > 0 ? recentOrders.length / recentVisitors : 0
  const previousConversion = previousVisitors > 0 ? previousOrders.length / previousVisitors : 0
  const recentPaymentStarts = countEvent(recentEvents, 'PAYMENT_STARTED')
  const recentPaymentFailures = countEvent(recentEvents, 'PAYMENT_FAILED')
  const previousPaymentStarts = countEvent(previousEvents, 'PAYMENT_STARTED')
  const previousPaymentFailures = countEvent(previousEvents, 'PAYMENT_FAILED')
  const recentFailureRate = recentPaymentStarts > 0 ? recentPaymentFailures / recentPaymentStarts : 0
  const previousFailureRate = previousPaymentStarts > 0 ? previousPaymentFailures / previousPaymentStarts : 0
  const checks: CroDriftCheck[] = []
  const pushCheck = (inputCheck: Omit<CroDriftCheck, 'periodStart' | 'periodEnd'>) => {
    checks.push({
      ...inputCheck,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
    })
  }

  const revenueDrop = previousRevenue > 0 ? (previousRevenue - recentRevenue) / previousRevenue : 0
  const conversionDrop = previousConversion > 0 ? (previousConversion - recentConversion) / previousConversion : 0
  const paymentSpike = recentFailureRate - previousFailureRate

  pushCheck({
    checkKey: `anomaly:revenue_collapse:${now.toISOString().slice(0, 10)}`,
    modelKey: 'anomaly_revenue_monitor',
    status: previousRevenue >= 1000 && recentVisitors >= 20 && revenueDrop >= 0.65 ? 'drift' : revenueDrop >= 0.35 ? 'watch' : 'stable',
    driftScore: clamp(Math.max(0, revenueDrop)),
    evidence: {
      recent_revenue_7d: recentRevenue,
      previous_revenue_7d: previousRevenue,
      revenue_drop_ratio: revenueDrop,
      recent_visitors_7d: recentVisitors,
      previous_visitors_7d: previousVisitors,
    },
  })
  pushCheck({
    checkKey: `anomaly:conversion_collapse:${now.toISOString().slice(0, 10)}`,
    modelKey: 'anomaly_conversion_monitor',
    status: previousConversion > 0 && recentVisitors >= 20 && conversionDrop >= 0.5 ? 'drift' : conversionDrop >= 0.25 ? 'watch' : 'stable',
    driftScore: clamp(Math.max(0, conversionDrop)),
    evidence: {
      recent_conversion_7d: recentConversion,
      previous_conversion_7d: previousConversion,
      conversion_drop_ratio: conversionDrop,
      recent_orders_7d: recentOrders.length,
      previous_orders_7d: previousOrders.length,
    },
  })
  pushCheck({
    checkKey: `anomaly:payment_failure_spike:${now.toISOString().slice(0, 10)}`,
    modelKey: 'anomaly_payment_funnel_monitor',
    status: recentPaymentStarts >= 5 && recentFailureRate >= 0.3 && paymentSpike >= 0.15 ? 'drift' : recentFailureRate >= 0.18 ? 'watch' : 'stable',
    driftScore: clamp(Math.max(recentFailureRate, paymentSpike)),
    evidence: {
      recent_payment_starts_7d: recentPaymentStarts,
      recent_payment_failures_7d: recentPaymentFailures,
      previous_payment_starts_7d: previousPaymentStarts,
      previous_payment_failures_7d: previousPaymentFailures,
      recent_payment_failure_rate: recentFailureRate,
      previous_payment_failure_rate: previousFailureRate,
      payment_failure_spike: paymentSpike,
    },
  })

  if (checks.length === 0) {
    pushCheck({
      checkKey: `anomaly:insufficient_data:${now.toISOString().slice(0, 10)}`,
      modelKey: 'anomaly_monitor',
      status: 'insufficient_data',
      driftScore: 0,
      evidence: { recent_events: recentEvents.length, previous_events: previousEvents.length },
    })
  }

  return checks
}

export async function recordCroEvaluations(input: {
  evaluations: CroExperimentEvaluation[]
  simulation?: CroSimulationRun
  driftChecks?: CroDriftCheck[]
}) {
  if (input.evaluations.length > 0) {
    const { error } = await supabase.from('cro_experiment_evaluations' as any).upsert(
      input.evaluations.map((evaluation) => ({
        evaluation_key: evaluation.evaluationKey,
        experiment_key: evaluation.experimentKey,
        period_start: evaluation.periodStart,
        period_end: evaluation.periodEnd,
        primary_metric: evaluation.primaryMetric,
        control: evaluation.control,
        variants: evaluation.variants,
        guardrails: evaluation.guardrails,
        decision: evaluation.decision,
        confidence: evaluation.confidence,
        minimum_practical_effect: evaluation.minimumPracticalEffect,
        evidence: evaluation.evidence,
      })),
      { onConflict: 'evaluation_key' },
    )
    if (error) throw error
  }

  if (input.simulation) {
    const { error } = await supabase.from('cro_simulation_runs' as any).upsert({
      simulation_key: input.simulation.simulationKey,
      mode: input.simulation.mode,
      period_start: input.simulation.periodStart,
      period_end: input.simulation.periodEnd,
      sessions_evaluated: input.simulation.sessionsEvaluated,
      decisions_evaluated: input.simulation.decisionsEvaluated,
      violations: input.simulation.violations,
      concentration: input.simulation.concentration,
      recommendation: input.simulation.recommendation,
      evidence: input.simulation.evidence,
    }, { onConflict: 'simulation_key' })
    if (error) throw error
  }

  if (input.driftChecks?.length) {
    const { error } = await supabase.from('cro_drift_checks' as any).upsert(
      input.driftChecks.map((check) => ({
        check_key: check.checkKey,
        model_key: check.modelKey,
        period_start: check.periodStart,
        period_end: check.periodEnd,
        status: check.status,
        drift_score: check.driftScore,
        evidence: check.evidence,
      })),
      { onConflict: 'check_key' },
    )
    if (error) throw error
  }
}

export async function applyCroEvaluationDecisions(evaluations: CroExperimentEvaluation[]) {
  const actionable = evaluations.filter((evaluation) => ['promote', 'rollback', 'pause'].includes(evaluation.decision))
  const result = { promoted: 0, rolledBack: 0, paused: 0 }

  for (const evaluation of actionable) {
    const nextStatus = evaluation.decision === 'promote'
      ? 'completed'
      : evaluation.decision === 'rollback'
        ? 'rolled_back'
        : 'paused'
    const payload = {
      status: nextStatus,
      decision: {
        source: 'experiment_evaluator',
        evaluation_key: evaluation.evaluationKey,
        decision: evaluation.decision,
        confidence: evaluation.confidence,
        primary_metric: evaluation.primaryMetric,
        minimum_practical_effect: evaluation.minimumPracticalEffect,
        control: evaluation.control,
        variants: evaluation.variants,
        guardrails: evaluation.guardrails,
        evidence: evaluation.evidence,
        applied_at: new Date().toISOString(),
      },
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('cro_experiments' as any)
      .update(payload)
      .eq('experiment_key', evaluation.experimentKey)
      .eq('status', 'running')

    if (error) throw error
    if (evaluation.decision === 'promote') result.promoted += 1
    if (evaluation.decision === 'rollback') result.rolledBack += 1
    if (evaluation.decision === 'pause') result.paused += 1
  }

  return result
}

export async function seedDeterministicRevenueOsModelRegistry(settings?: RevenueOsSettings) {
  const deploymentState = settings?.enabled === false
    ? 'paused'
    : settings?.shadowMode
      ? 'shadow'
      : 'active'
  const now = new Date().toISOString()
  const rows = [
    {
      model_key: 'revenue_os_ranker',
      version: 'deterministic-v1',
      model_type: 'deterministic_rules',
      training_period: { source: 'runtime_features', learned_from_events: false },
      features: [
        'sellable_eligibility',
        'text_relevance',
        'category_match',
        'admin_favorite_boost',
        'top_selling_boost',
        'restock_boost',
        'relationship_boost',
        'customer_category_affinity',
        'controlled_exploration',
      ],
      performance: {
        measured_by: 'cro_experiment_evaluations',
        guardrails: ['payment_failure_rate', 'invalid_catalogue_selection', 'product_concentration'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'catalogue_relationship_builder',
      version: 'deterministic-v1',
      model_type: 'catalogue_normalizer_graph_rules',
      training_period: { source: 'live_sellable_catalogue', learned_from_events: false },
      features: [
        'normalized_name_tokens',
        'category',
        'price_position',
        'token_overlap',
        'same_intent_similarity',
        'upgrade_downgrade_price_delta',
      ],
      performance: {
        measured_by: 'relationship_sample_size_and_confidence',
        guardrails: ['sellable_only', 'no_product_name_hardcoding'],
      },
      deployment_state: 'active',
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'opportunity_detector',
      version: 'deterministic-v1',
      model_type: 'diagnostic_rules',
      training_period: { source: 'revenue_events_and_features', learned_from_events: false },
      features: [
        'traffic',
        'conversion',
        'revenue_per_visitor',
        'payment_failure_rate',
        'device_conversion_gap',
        'device_payment_funnel',
        'top_product_share',
        'stock_velocity_proxy',
      ],
      performance: {
        measured_by: 'opportunity_resolution_and_followup_experiments',
        guardrails: ['confidence_threshold', 'risk_score'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'customer_lifecycle_engine',
      version: 'deterministic-v1',
      model_type: 'recency_frequency_rules',
      training_period: { source: 'completed_customer_orders', learned_from_events: false },
      features: [
        'completed_orders',
        'days_since_last_order',
        'average_days_between_orders',
        'first_order_at',
        'last_order_at',
        'top_category',
        'lifecycle_pressure_score',
        'frequency_cap_14d',
      ],
      performance: {
        measured_by: 'repeat_purchase_conversion_and_reactivation_outcomes',
        guardrails: ['non_staff_customers_only', 'permissioned_reactivation_only', 'frequency_cap_14d', 'no_private_data_exposure'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'next_purchase_sequence_engine',
      version: 'deterministic-v1',
      model_type: 'markov_transition_counts',
      training_period: { source: 'completed_customer_order_sequences', learned_from_events: false },
      features: [
        'last_product_group_id',
        'purchase_transition_counts',
        'sellable_product_filter',
        'already_purchased_suppression',
      ],
      performance: {
        measured_by: 'post_purchase_recommendation_click_and_repeat_purchase',
        guardrails: ['sellable_only', 'no_invented_products', 'do_nothing_allowed'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'promotion_guardrail_engine',
      version: 'deterministic-v1',
      model_type: 'bounded_promotion_rules',
      training_period: { source: 'discount_codes_orders_and_catalogue', learned_from_events: false },
      features: [
        'max_discount_pct',
        'monthly_discount_budget',
        'usage_limit',
        'expiry',
        'scope',
        'sellable_product_eligibility',
      ],
      performance: {
        measured_by: 'promotion_spend_and_incremental_purchase_outcomes',
        guardrails: ['no_fake_scarcity', 'budget_cap', 'sellable_only', 'no_margin_destroying_discount'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'attribution_quality_engine',
      version: 'deterministic-v1',
      model_type: 'utm_referrer_traffic_quality_rules',
      training_period: { source: 'first_party_events_and_site_visits', learned_from_events: false },
      features: [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'referrer_host',
        'user_agent',
        'traffic_quality',
        'channel_conversion',
        'revenue_per_visitor',
        'source_economics_opportunities',
      ],
      performance: {
        measured_by: 'channel_revenue_per_visitor_and_source_quality_opportunities',
        guardrails: ['exclude_bots', 'exclude_internal_traffic', 'do_not_blame_merchandising_for_bad_traffic'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'revenue_data_sentinel',
      version: 'deterministic-v1',
      model_type: 'event_payment_data_quality_rules',
      training_period: { source: 'revenue_events_orders_catalogue_and_profiles', learned_from_events: false },
      features: [
        'duplicate_event_id',
        'missing_event_id',
        'unknown_event_type',
        'currency_consistency',
        'orphan_product_event',
        'completed_order_amount',
        'payment_funnel_completeness',
        'purchase_event_order_alignment',
        'unbacked_purchase_event_blocking',
        'duplicate_purchase_credit_detection',
        'traffic_quality_ratio',
        'impossible_conversion_rate',
      ],
      performance: {
        measured_by: 'revenue_data_quality_findings',
        guardrails: ['pause_cro_on_critical_failure', 'exclude_internal_staff', 'idempotent_events_required'],
      },
      deployment_state: 'active',
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'experiment_evaluator',
      version: 'deterministic-v1',
      model_type: 'incrementality_guardrail_rules',
      training_period: { source: 'revenue_events_with_experiment_assignment', learned_from_events: false },
      features: [
        'control_revenue_per_visitor',
        'variant_revenue_per_visitor',
        'conversion_rate',
        'buy_click_rate',
        'payment_failure_rate',
        'minimum_practical_effect',
      ],
      performance: {
        measured_by: 'evaluation_decision_accuracy',
        guardrails: ['minimum_sample_size', 'commercial_relevance', 'payment_failure_delta'],
      },
      deployment_state: 'active',
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'contextual_bandit_allocator',
      version: 'deterministic-v1',
      model_type: 'bounded_reward_allocation_rules',
      training_period: { source: 'running_experiment_revenue_events', learned_from_events: true },
      features: [
        'variant_reward_per_visitor',
        'credited_purchase_revenue',
        'buy_click_reward',
        'payment_failure_penalty',
        'support_handoff_penalty',
        'dismissal_pressure_penalty',
        'minimum_exploration',
        'variant_guardrail_eligibility',
      ],
      performance: {
        measured_by: 'bandit_feature_snapshots_and_experiment_evaluations',
        guardrails: ['approved_variants_only', 'minimum_exploration', 'payment_failure_guardrail', 'support_handoff_guardrail', 'pressure_guardrail'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'anomaly_freeze_monitor',
      version: 'deterministic-v1',
      model_type: 'rolling_window_anomaly_rules',
      training_period: { source: 'trusted_revenue_events_and_completed_orders', learned_from_events: false },
      features: [
        'seven_day_revenue_delta',
        'seven_day_conversion_delta',
        'payment_failure_rate_spike',
        'trusted_visitor_volume',
        'internal_and_bot_exclusion',
      ],
      performance: {
        measured_by: 'cro_drift_checks_with_anomaly_model_keys',
        guardrails: ['pause_cro_on_severe_anomaly', 'payment_funnel_isolated', 'do_not_change_merchandising_for_payment_outage'],
      },
      deployment_state: deploymentState,
      rollback_to: null,
      updated_at: now,
    },
    {
      model_key: 'commerce_chat_intent_router',
      version: 'deterministic-v1',
      model_type: 'regex_token_state_machine',
      training_period: { source: 'bounded_store_intents', learned_from_events: false },
      features: [
        'token_patterns',
        'money_entities',
        'category_aliases',
        'product_search_terms',
        'conversation_stage',
        'response_plan',
        'personality_guard',
        'support_keywords',
      ],
      performance: {
        measured_by: 'chat_intent_events_and_support_handoffs',
        guardrails: ['no_llm_calls', 'support_override', 'no_secret_prefill', 'no_humour_in_payment_or_support_state'],
      },
      deployment_state: 'active',
      rollback_to: null,
      updated_at: now,
    },
  ]

  const { error } = await supabase
    .from('cro_model_registry' as any)
    .upsert(rows, { onConflict: 'model_key,version' })
  if (error) throw error
}

export async function loadRunningCroExperiments() {
  try {
    const settings = await loadRevenueOsSettings()
    if (!settings.enabled || settings.freezeReason || settings.shadowMode || !settings.experimentationEnabled) return []
    const { data, error } = await supabase
      .from('cro_experiments' as any)
      .select('*')
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return data || []
  } catch (error) {
    console.warn('Running CRO experiments unavailable:', error)
    return []
  }
}

export async function loadRevenueOsSettings(): Promise<RevenueOsSettings> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key,value')
      .in('key', [
        'cro_global_enabled',
        'cro_shadow_mode_enabled',
        'cro_autonomy_level',
        'cro_exploration_pct',
        'cro_pressure_limit',
        'cro_global_holdout_pct',
        'cro_experimentation_enabled',
        'cro_maintenance_freeze_reason',
      ])

    if (error) throw error
    const values = new Map((data || []).map((row: any) => [row.key, row.value]))
    const freezeReason = String(values.get('cro_maintenance_freeze_reason') || '').trim()
    return {
      enabled: (values.has('cro_global_enabled') ? values.get('cro_global_enabled') === 'true' : DEFAULT_SETTINGS.enabled) && !freezeReason,
      shadowMode: values.get('cro_shadow_mode_enabled') === 'true',
      autonomyLevel: Number(values.get('cro_autonomy_level') ?? DEFAULT_SETTINGS.autonomyLevel),
      explorationPct: Number(values.get('cro_exploration_pct') ?? DEFAULT_SETTINGS.explorationPct),
      pressureLimit: Number(values.get('cro_pressure_limit') ?? DEFAULT_SETTINGS.pressureLimit),
      globalHoldoutPct: Number(values.get('cro_global_holdout_pct') ?? DEFAULT_SETTINGS.globalHoldoutPct),
      experimentationEnabled: values.has('cro_experimentation_enabled')
        ? values.get('cro_experimentation_enabled') === 'true'
        : DEFAULT_SETTINGS.experimentationEnabled,
      freezeReason,
    }
  } catch (error) {
    console.warn('Revenue OS settings unavailable, using safe defaults:', error)
    return DEFAULT_SETTINGS
  }
}

const SENSITIVE_REVENUE_METADATA_KEY = /(^|_|\b)(password|passcode|otp|pin|token|secret|api[_-]?key|authorization|cookie|session|email|phone|account[_-]?number|accountnumber|account[_-]?name|bank[_-]?name|wallet[_-]?address|pay[_-]?address|address|memo|tag|hash|reference|payment[_-]?reference|transaction[_-]?reference|transaction[_-]?id|payment[_-]?id|purchase[_-]?id|provider[_-]?request[_-]?id|provider[_-]?response|api[_-]?response|raw[_-]?response|response[_-]?body|activation[_-]?id|external[_-]?order[_-]?id|order[_-]?id|idempotency[_-]?key|recipient|username|login|profile[_-]?url|url|link|comment|comments|group|groups)(\b|_)?/i
const REVENUE_METADATA_CONTROL_KEYS = new Set(['forceTrack'])

function sanitizeRevenueMetadataValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 4) return '[truncated]'

  if (typeof value === 'string') {
    const redacted = value
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted_url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
      .replace(/(?:\+?\d[\s().-]*){10,}/g, '[redacted_number]')
      .replace(/\b(?:[a-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b/g, '[redacted_token]')
    if (redacted.length > 500) return `${redacted.slice(0, 500)}...`
    return redacted
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeRevenueMetadataValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (REVENUE_METADATA_CONTROL_KEYS.has(key)) continue
      output[key] = SENSITIVE_REVENUE_METADATA_KEY.test(key)
        ? '[redacted]'
        : sanitizeRevenueMetadataValue(child, depth + 1)
    }
    return output
  }

  return String(value)
}

function sanitizeRevenueMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeRevenueMetadataValue(metadata) as Record<string, unknown>
}

async function hashRevenueValue(value: string) {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const encoded = new TextEncoder().encode(value)
    const digest = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return stableHash(value).toString(16).padStart(8, '0')
}

async function sanitizeRevenueEventId(source: string, eventId: string) {
  const safeSource = normalizeCatalogueText(source).replace(/\s+/g, '-') || 'client'
  const hash = await hashRevenueValue(`${safeSource}:${eventId}`)
  return `${safeSource}:${hash.slice(0, 48)}`
}

export async function trackRevenueEvent(input: {
  eventType: RevenueEventType
  userId?: string | null
  productGroupId?: string | null
  categoryId?: string | null
  surface?: string
  metadata?: Record<string, unknown>
  eventId?: string
  experimentId?: string | null
  variantId?: string | null
  interventionId?: string | null
  decisionId?: string | null
}) {
  const rawEventId = input.eventId || `${input.eventType}-${Date.now()}-${crypto.randomUUID()}`
  try {
    const path = typeof window === 'undefined' ? null : `${window.location.pathname}${window.location.search}`
    const internalTraffic = isInternalRevenueTraffic(path)
    if (internalTraffic && input.metadata?.forceTrack !== true) return
    const storage = safeStorage('sessionStorage')
    const eventId = await sanitizeRevenueEventId('client', rawEventId)
    const seenKey = `${LOCAL_REVENUE_EVENT_SEEN_PREFIX}${eventId}`
    if (storage?.getItem(seenKey) === '1') return
    const width = typeof window === 'undefined' ? 0 : window.innerWidth
    const device = width > 0 && width < 768 ? 'mobile' : width >= 768 ? 'desktop' : null
    const referrer = typeof document === 'undefined' ? null : safeRevenueReferrer(document.referrer || null)
    const userAgent = typeof navigator === 'undefined' ? null : navigator.userAgent
    const attribution = deriveRevenueAttribution({ path, referrer, userAgent, internal: internalTraffic })
    const storedPath = safeRevenuePath(path)
    const storedReferrer = safeRevenueReferrer(referrer)
    const displayCurrency = safeStorage('localStorage')?.getItem('tallystore_currency') === 'USD' ? 'USD' : 'NGN'
    const safeMetadata = sanitizeRevenueMetadata(input.metadata || {})

    const { error } = await supabase
      .from('revenue_events' as any)
      .upsert(
        {
          event_id: eventId,
          event_type: input.eventType,
          visitor_id: getRevenueVisitorId(),
          session_id: getRevenueSessionId(),
          user_id: input.userId || null,
          product_group_id: input.productGroupId || null,
          category_id: input.categoryId || null,
          surface: input.surface || null,
          path: storedPath,
          referrer: storedReferrer,
          device,
          experiment_id: input.experimentId || null,
          variant_id: input.variantId || null,
          intervention_id: input.interventionId || null,
          decision_id: input.decisionId || null,
          metadata: {
            ...safeMetadata,
            client_observed: true,
            authoritative: false,
            display_currency: displayCurrency,
            attribution,
            traffic_quality: attribution.trafficQuality,
          },
        },
        { onConflict: 'event_id', ignoreDuplicates: true },
      )
    if (error) throw error
    if (!internalTraffic) {
      updatePressureState(input.eventType)
      updateSessionSignals(input.eventType)
    }
    storage?.setItem(seenKey, '1')
  } catch (error) {
    console.warn('Revenue event not recorded:', error)
  }
}

export async function linkRevenueIdentity(userId: string, metadata: Record<string, unknown> = {}) {
  if (!userId) return
  try {
    const visitorId = getRevenueVisitorId()
    const sessionId = getRevenueSessionId()
    if (!visitorId || !sessionId) return
    const now = new Date().toISOString()
    const safeMetadata = sanitizeRevenueMetadata(metadata)

    const { error } = await supabase
      .from('revenue_identity_links' as any)
      .upsert(
        {
          user_id: userId,
          visitor_id: visitorId,
          session_id: sessionId,
          last_seen_at: now,
          metadata: safeMetadata,
        },
        { onConflict: 'user_id,visitor_id,session_id' },
      )

    if (error) throw error

    await trackRevenueEvent({
      eventType: 'SESSION_STARTED',
      userId,
      surface: 'identity_resolution',
      eventId: `SESSION_STARTED:${sessionId}:${userId}`,
      metadata: {
        ...safeMetadata,
        visitor_id_linked: true,
        identity_resolution: 'auth_session_link',
      },
    })
  } catch (error) {
    console.warn('Revenue identity link not recorded:', error)
  }
}

// ── Intervention types ────────────────────────────────────────────────────────

export type LearningState =
  | 'NEW'
  | 'EXPLORING'
  | 'PROMISING'
  | 'PROVEN'
  | 'DECLINING'
  | 'HARMFUL'
  | 'RETIRED'

export type CroInterventionInput = {
  decisionId?: string | null
  actionType: CroActionType
  sourceProductId?: string | null
  targetProductId?: string | null
  surface: string
  experimentId?: string | null
  variantId?: string | null
  strategyKey?: string | null
  userId?: string | null
}

// ── Intervention creation & tracking ─────────────────────────────────────────

/**
 * Creates a cro_intervention row and returns the intervention UUID.
 * Call this as soon as a recommendation is rendered (component mounted).
 * Pass the returned ID to useViewabilityTracker and to any follow-on events.
 */
export async function createCroIntervention(input: CroInterventionInput): Promise<string | null> {
  try {
    const visitorId = getRevenueVisitorId()
    const sessionId = getRevenueSessionId()
    const internalTraffic = isInternalRevenueTraffic()
    if (internalTraffic) return null
    const strategyKey = input.strategyKey || `${input.actionType}:${input.surface}`
    const { data, error } = await supabase
      .from('cro_interventions' as any)
      .insert({
        decision_id:        input.decisionId       || null,
        session_id:         sessionId,
        visitor_id:         visitorId,
        customer_id:        input.userId            || null,
        action_type:        input.actionType,
        source_product_id:  input.sourceProductId  || null,
        target_product_id:  input.targetProductId  || null,
        surface:            input.surface,
        experiment_id:      input.experimentId     || null,
        variant_id:         input.variantId        || null,
        strategy_key:       strategyKey,
        rendered_at:        new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as any)?.id || null
  } catch (e) {
    console.warn('[Revenue OS] createCroIntervention failed:', e)
    return null
  }
}

/** Mark an intervention as genuinely viewed (>= 50% visible for >= 500ms). */
export async function markInterventionViewed(interventionId: string): Promise<void> {
  try {
    await supabase
      .from('cro_interventions' as any)
      .update({ viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', interventionId)
      .is('viewed_at', null) // idempotent
  } catch (e) {
    console.warn('[Revenue OS] markInterventionViewed failed:', e)
  }
}

/** Mark an intervention as clicked. */
export async function markInterventionClicked(interventionId: string): Promise<void> {
  try {
    await supabase
      .from('cro_interventions' as any)
      .update({ clicked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', interventionId)
      .is('clicked_at', null)
  } catch (e) {
    console.warn('[Revenue OS] markInterventionClicked failed:', e)
  }
}

/** Mark an intervention as explicitly dismissed by the customer. */
export async function markInterventionDismissed(interventionId: string): Promise<void> {
  try {
    await supabase
      .from('cro_interventions' as any)
      .update({
        dismissed_at:     new Date().toISOString(),
        outcome:          'dismissed',
        outcome_closed_at: new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', interventionId)
      .eq('outcome', 'pending')
  } catch (e) {
    console.warn('[Revenue OS] markInterventionDismissed failed:', e)
  }
}

/** Mark that the customer clicked Buy on the recommended product. */
export async function markInterventionBuyClicked(interventionId: string): Promise<void> {
  try {
    await supabase
      .from('cro_interventions' as any)
      .update({ buy_clicked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', interventionId)
      .is('buy_clicked_at', null)
  } catch (e) {
    console.warn('[Revenue OS] markInterventionBuyClicked failed:', e)
  }
}

/** Write a directly attributed purchase outcome (same session, same product). */
export async function attributeInterventionPurchase(input: {
  interventionId: string
  orderId: string
  revenueNgn: number
  attributionType?: 'direct' | 'assisted'
  windowH?: number
}): Promise<void> {
  try {
    await Promise.all([
      supabase.from('cro_interventions' as any).update({
        attributed_order_id:  input.orderId,
        attributed_at:        new Date().toISOString(),
        attribution_type:     input.attributionType || 'direct',
        attribution_window_h: input.windowH || 0,
        outcome:              'purchased',
        outcome_closed_at:    new Date().toISOString(),
        updated_at:           new Date().toISOString(),
      }).eq('id', input.interventionId).eq('outcome', 'pending'),
      supabase.from('cro_outcomes' as any).insert({
        intervention_id:        input.interventionId,
        order_id:               input.orderId,
        outcome_type:           'purchased',
        revenue_ngn:            input.revenueNgn,
        attribution_type:       input.attributionType || 'direct',
        window_h:               input.windowH || 0,
        is_incremental_estimate: false,
      }),
    ])
  } catch (e) {
    console.warn('[Revenue OS] attributeInterventionPurchase failed:', e)
  }
}

// ── Sticky experiment assignment ──────────────────────────────────────────────

/**
 * Resolves and persists a sticky experiment assignment.
 * Uses deterministic hash first, then writes to DB on first exposure.
 */
export async function resolveAndPersistAssignment(input: {
  surface: string
  experiments?: any[]
  userId?: string | null
  settings?: RevenueOsSettings | null
}): Promise<CroAssignment> {
  const visitorId = getRevenueVisitorId()
  const assignment = resolveCroAssignment({
    surface:     input.surface,
    settings:    input.settings,
    experiments: input.experiments,
    visitorId:   visitorId || undefined,
    userId:      input.userId || undefined,
  })

  if (assignment.experimentId && assignment.variantId) {
    const subjectKey = input.userId || visitorId || 'anonymous'
    try {
      await supabase
        .from('cro_experiment_assignments' as any)
        .upsert({
          subject_key:      subjectKey,
          experiment_key:   assignment.experimentId,
          variant_id:       assignment.variantId,
          is_holdout:       assignment.isHoldout,
          is_global_holdout: assignment.mode === 'holdout',
          exposed_at:       new Date().toISOString(),
        }, { onConflict: 'subject_key,experiment_key', ignoreDuplicates: true })
    } catch (e) {
      console.warn('[Revenue OS] resolveAndPersistAssignment failed:', e)
    }
  }

  return assignment
}

// ── Learning state machine ─────────────────────────────────────────────────────

export type StrategyStatsForEval = {
  totalRendered: number
  totalViewed: number
  totalPurchases: number
  controlRendered: number
  controlPurchases: number
  upliftPp: number
  confidence: number
  guardrailsHealthy: boolean
  recentUpliftPp?: number
  autoRolledBackAt?: string | null
}

export function evaluateLearningState(stats: StrategyStatsForEval): LearningState {
  const {
    totalViewed, upliftPp, confidence, guardrailsHealthy, recentUpliftPp, autoRolledBackAt,
  } = stats

  if (autoRolledBackAt) return 'RETIRED'
  if (!guardrailsHealthy && confidence >= 0.75) return 'HARMFUL'
  if (upliftPp < -1 && confidence >= 0.85 && totalViewed >= 500) return 'HARMFUL'
  if (totalViewed < 50) return 'NEW'
  if (totalViewed < 300) return 'EXPLORING'
  if (recentUpliftPp !== undefined && recentUpliftPp < upliftPp * 0.4 && totalViewed >= 1000) return 'DECLINING'
  if (upliftPp > 0.5 && confidence >= 0.90 && totalViewed >= 1000 && guardrailsHealthy) return 'PROVEN'
  if (upliftPp > 0 && confidence >= 0.60 && totalViewed >= 300) return 'PROMISING'
  return 'EXPLORING'
}

// ── Incremental lift calculation ───────────────────────────────────────────────

export type IncrementalLiftResult = {
  treatmentConversionRate: number
  controlConversionRate:   number
  upliftPp:                number
  incrementalPurchases:    number
  treatmentRpv:            number
  controlRpv:              number
  incrementalRpvNgn:       number
  incrementalRevenueNgn:   number
  confidence:              number
  evidenceGrade:           'INSUFFICIENT' | 'WEAK' | 'MODERATE' | 'STRONG'
}

/** Normal CDF approximation (Abramowitz & Stegun). */
function normalCdf(z: number): number {
  if (z < 0) return 1 - normalCdf(-z)
  const t    = 1 / (1 + 0.2316419 * z)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly
}

/**
 * Calculates incremental lift from treatment vs control counts.
 * Uses pooled z-test for proportions.
 * Never trust results below ~30 per arm.
 */
export function calculateIncrementalLift(input: {
  treatmentViewed:     number
  treatmentPurchases:  number
  treatmentRevenueNgn: number
  controlViewed:       number
  controlPurchases:    number
  controlRevenueNgn:   number
}): IncrementalLiftResult {
  const { treatmentViewed, treatmentPurchases, treatmentRevenueNgn, controlViewed, controlPurchases, controlRevenueNgn } = input

  const tCvr = treatmentViewed > 0 ? treatmentPurchases / treatmentViewed : 0
  const cCvr = controlViewed   > 0 ? controlPurchases  / controlViewed   : 0
  const tRpv = treatmentViewed > 0 ? treatmentRevenueNgn / treatmentViewed : 0
  const cRpv = controlViewed   > 0 ? controlRevenueNgn  / controlViewed   : 0

  const upliftPp            = (tCvr - cCvr) * 100
  const incrementalRpvNgn   = tRpv - cRpv
  const incrementalPurchases = Math.round((tCvr - cCvr) * treatmentViewed)
  const incrementalRevenueNgn = incrementalRpvNgn * treatmentViewed

  let confidence = 0
  if (treatmentViewed >= 30 && controlViewed >= 30) {
    const pooled = (treatmentPurchases + controlPurchases) / (treatmentViewed + controlViewed)
    const se     = Math.sqrt(pooled * (1 - pooled) * (1 / treatmentViewed + 1 / controlViewed))
    if (se > 0) confidence = normalCdf(Math.abs((tCvr - cCvr) / se))
  }

  const minN = Math.min(treatmentViewed, controlViewed)
  let evidenceGrade: IncrementalLiftResult['evidenceGrade'] = 'INSUFFICIENT'
  if      (minN >= 2000 && confidence >= 0.95) evidenceGrade = 'STRONG'
  else if (minN >= 500  && confidence >= 0.85) evidenceGrade = 'MODERATE'
  else if (minN >= 100  && confidence >= 0.70) evidenceGrade = 'WEAK'

  return {
    treatmentConversionRate: tCvr,
    controlConversionRate:   cCvr,
    upliftPp,
    incrementalPurchases,
    treatmentRpv:            tRpv,
    controlRpv:              cRpv,
    incrementalRpvNgn,
    incrementalRevenueNgn,
    confidence,
    evidenceGrade,
  }
}

// ── Auto-promote / auto-rollback decision ─────────────────────────────────────

export type StrategyEvaluationDecision = {
  action:           'promote' | 'rollback' | 'keep_running' | 'insufficient_data'
  reason:           string
  newLearningState: LearningState
}

export function evaluateStrategyPromotion(stats: {
  learningState:            LearningState
  totalViewed:              number
  upliftPp:                 number
  confidence:               number
  guardrailsHealthy:        boolean
  paymentCompletionDelta?:  number | null
  refundRateDelta?:         number | null
  exitRateDelta?:           number | null
}): StrategyEvaluationDecision {
  const { learningState, totalViewed, upliftPp, confidence, guardrailsHealthy } = stats

  // ── Rollback conditions ──────────────────────────────────────────────────────
  if (!guardrailsHealthy && confidence >= 0.75)
    return { action: 'rollback', reason: 'guardrails_breach_confirmed', newLearningState: 'HARMFUL' }

  if ((stats.paymentCompletionDelta ?? 0) < -0.05 && confidence >= 0.80)
    return { action: 'rollback', reason: 'payment_completion_drop', newLearningState: 'HARMFUL' }

  if ((stats.refundRateDelta ?? 0) > 0.10 && confidence >= 0.80)
    return { action: 'rollback', reason: 'refund_rate_increase', newLearningState: 'HARMFUL' }

  if (upliftPp < -2 && confidence >= 0.90 && totalViewed >= 500)
    return { action: 'rollback', reason: 'negative_revenue_uplift_confirmed', newLearningState: 'HARMFUL' }

  if (learningState === 'DECLINING' && upliftPp < 0 && confidence >= 0.80)
    return { action: 'rollback', reason: 'declining_performance', newLearningState: 'HARMFUL' }

  // ── Promote conditions ───────────────────────────────────────────────────────
  if (
    learningState === 'PROVEN' &&
    upliftPp > 1.0 &&
    confidence >= 0.95 &&
    totalViewed >= 1000 &&
    guardrailsHealthy
  ) return { action: 'promote', reason: 'strong_positive_evidence', newLearningState: 'PROVEN' }

  // ── Not enough data ──────────────────────────────────────────────────────────
  if (totalViewed < 100)
    return { action: 'insufficient_data', reason: 'not_enough_observations', newLearningState: learningState }

  return { action: 'keep_running', reason: 'evidence_accumulating', newLearningState: learningState }
}

// ── Opportunity detectors ─────────────────────────────────────────────────────

export type OpportunityDetection = {
  opportunityKey:               string
  type:                         string
  scope:                        string
  description:                  string
  estimatedRevenueOpportunity:  number
  confidence:                   number
  risk:                         number
  priority:                     number
  evidence:                     Record<string, unknown>
}

export function detectRevenueOpportunities(input: {
  productStats: Array<{
    productId:    string
    productName:  string
    views7d:      number
    purchases7d:  number
    exposures7d:  number  // CRO recommendation impressions
  }>
  purchaseSequences: Array<{
    sourceProductId:   string
    targetProductId:   string
    sourceProductName: string
    targetProductName: string
    buyersOfSource7d:  number
    alsoBooughtTarget7d: number
    exposuresToTarget7d: number
  }>
  funnelStats: {
    productViews7d:    number
    buyClicks7d:       number
    paymentStarts7d:   number
    paymentCompleted7d: number
  }
}): OpportunityDetection[] {
  const opportunities: OpportunityDetection[] = []

  // ── Detector 1: Underexposed winner ──────────────────────────────────────────
  for (const p of input.productStats) {
    if (p.views7d < 20 || p.purchases7d < 3) continue
    const cvr         = p.purchases7d / p.views7d
    const exposureRate = p.views7d > 0 ? p.exposures7d / p.views7d : 0
    if (cvr >= 0.12 && exposureRate < 0.25) {
      const potential = Math.round(cvr * p.views7d * 0.3 * 4 * 12000)
      opportunities.push({
        opportunityKey:              `underexposed_winner:${p.productId}`,
        type:                        'UNDEREXPOSED_WINNER',
        scope:                       p.productId,
        description:                 `${p.productName} converts at ${(cvr * 100).toFixed(1)}% but appears in only ${(exposureRate * 100).toFixed(0)}% of eligible CRO placements. Increasing exposure may generate additional sales.`,
        estimatedRevenueOpportunity: potential,
        confidence:                  Math.min(0.75, 0.3 + p.purchases7d * 0.025),
        risk:                        0.2,
        priority:                    cvr * (1 - exposureRate) * p.views7d,
        evidence:                    { product_id: p.productId, conversion_rate: cvr, cro_exposure_rate: exposureRate, views_7d: p.views7d, purchases_7d: p.purchases7d },
      })
    }
  }

  // ── Detector 2: Purchase sequence opportunity ─────────────────────────────────
  for (const seq of input.purchaseSequences) {
    if (seq.buyersOfSource7d < 10 || seq.alsoBooughtTarget7d < 3) continue
    const seqRate      = seq.alsoBooughtTarget7d / seq.buyersOfSource7d
    const exposureRate = seq.exposuresToTarget7d / seq.buyersOfSource7d
    if (seqRate >= 0.10 && exposureRate < 0.30) {
      const potential = Math.round(seq.alsoBooughtTarget7d * 4 * 0.5 * 15000)
      opportunities.push({
        opportunityKey:              `purchase_sequence:${seq.sourceProductId}:${seq.targetProductId}`,
        type:                        'PURCHASE_SEQUENCE',
        scope:                       `${seq.sourceProductId}→${seq.targetProductId}`,
        description:                 `${(seqRate * 100).toFixed(0)}% of customers who buy ${seq.sourceProductName} also buy ${seq.targetProductName} — but ${seq.targetProductName} is only shown post-purchase ${(exposureRate * 100).toFixed(0)}% of the time.`,
        estimatedRevenueOpportunity: potential,
        confidence:                  Math.min(0.75, 0.25 + seq.alsoBooughtTarget7d * 0.03),
        risk:                        0.2,
        priority:                    seqRate * (1 - exposureRate) * seq.buyersOfSource7d,
        evidence:                    { source: seq.sourceProductId, target: seq.targetProductId, sequence_rate: seqRate, exposure_rate: exposureRate },
      })
    }
  }

  // ── Detector 3: Funnel drop — buy click → payment start ──────────────────────
  const { buyClicks7d, paymentStarts7d, paymentCompleted7d } = input.funnelStats
  if (buyClicks7d >= 20) {
    const startRate      = buyClicks7d   > 0 ? paymentStarts7d    / buyClicks7d   : 1
    const completionRate = paymentStarts7d > 0 ? paymentCompleted7d / paymentStarts7d : 1
    if (startRate < 0.75) {
      opportunities.push({
        opportunityKey:              'funnel_drop:buy_to_payment_start',
        type:                        'FUNNEL_DROP',
        scope:                       'payment_funnel',
        description:                 `Only ${(startRate * 100).toFixed(0)}% of buy clicks reach payment start. Resolving this friction could recover significant revenue.`,
        estimatedRevenueOpportunity: Math.round((1 - startRate) * buyClicks7d * 4 * 12000),
        confidence:                  0.85,
        risk:                        0.1,
        priority:                    (1 - startRate) * buyClicks7d * 10,
        evidence:                    { buy_clicks_7d: buyClicks7d, payment_starts_7d: paymentStarts7d, start_rate: startRate },
      })
    }
    if (completionRate < 0.85 && paymentStarts7d >= 10) {
      opportunities.push({
        opportunityKey:              'funnel_drop:payment_completion',
        type:                        'FUNNEL_DROP',
        scope:                       'payment_completion',
        description:                 `Payment completion rate is ${(completionRate * 100).toFixed(0)}%. ${Math.round((1 - completionRate) * paymentStarts7d)} payment starts per week are failing to complete.`,
        estimatedRevenueOpportunity: Math.round((1 - completionRate) * paymentStarts7d * 4 * 12000),
        confidence:                  0.90,
        risk:                        0.05,
        priority:                    (1 - completionRate) * paymentStarts7d * 20,
        evidence:                    { payment_starts_7d: paymentStarts7d, payment_completed_7d: paymentCompleted7d, completion_rate: completionRate },
      })
    }
  }

  return opportunities.sort((a, b) => b.priority - a.priority)
}

/**
 * Persists detected opportunities to the cro_opportunities table.
 * Uses upsert so running detectors repeatedly is idempotent.
 */
export async function persistOpportunities(opportunities: OpportunityDetection[]): Promise<void> {
  if (!opportunities.length) return
  try {
    const rows = opportunities.map((o) => ({
      opportunity_key:                o.opportunityKey,
      type:                           o.type,
      scope:                          o.scope,
      description:                    o.description,
      evidence:                       o.evidence,
      estimated_revenue_opportunity:  o.estimatedRevenueOpportunity,
      confidence:                     o.confidence,
      risk:                           o.risk,
      priority:                       o.priority,
      updated_at:                     new Date().toISOString(),
    }))
    await supabase
      .from('cro_opportunities' as any)
      .upsert(rows, { onConflict: 'opportunity_key' })
  } catch (e) {
    console.warn('[Revenue OS] persistOpportunities failed:', e)
  }
}

// ── Update trackRevenueEvent to carry intervention_id ─────────────────────────
// (patch applied inline — callers pass interventionId to attach the chain)

export async function auditCroDecision(input: {
  userId?: string | null
  surface: string
  selected: RankedProduct | null
  candidates: RankedProduct[]
  metadata?: Record<string, unknown>
  assignment?: CroAssignment | null
}) {
  try {
    const path = typeof window === 'undefined' ? null : safeRevenuePath(window.location.pathname)
    const metadata = input.metadata || {}
    const internalTraffic = isInternalRevenueTraffic(path)
    if (internalTraffic && metadata.forceTrack !== true) return
    const safeMetadata = sanitizeRevenueMetadata(metadata)
    const referrer = typeof document === 'undefined' ? null : document.referrer || null
    const userAgent = typeof navigator === 'undefined' ? null : navigator.userAgent
    const attribution = deriveRevenueAttribution({ path, referrer, userAgent, internal: internalTraffic })

    await supabase.from('cro_decision_audit' as any).insert({
      decision_id: `cro-${Date.now()}-${crypto.randomUUID()}`,
      visitor_id: getRevenueVisitorId(),
      session_id: getRevenueSessionId(),
      user_id: input.userId || null,
      surface: input.surface,
      selected_action: String(safeMetadata.nextBestAction || input.selected?.action || 'DO_NOTHING'),
      selected_product_group_id: input.selected?.product.id || null,
      score: input.selected?.score || 0,
      confidence: toNumber(safeMetadata.actionConfidence, input.selected?.confidence || 0),
      candidates: input.candidates.slice(0, 12).map((candidate) => ({
        product_group_id: candidate.product.id,
        action: candidate.action,
        score: candidate.score,
        confidence: candidate.confidence,
        reasons: candidate.reasons,
        eligibility: candidate.eligibility,
      })),
      guardrails: {
        no_invented_products: true,
        no_invented_prices: true,
        sellable_only: true,
        global_holdout: input.assignment?.isHoldout === true,
        assignment_mode: input.assignment?.mode || 'unknown',
        server_authoritative: false,
      },
      metadata: {
        ...safeMetadata,
        client_observed: true,
        authoritative: false,
        decision_source: 'browser_ranking_observation',
        assignment: input.assignment || null,
        attribution,
        traffic_quality: attribution.trafficQuality,
      },
    })
  } catch (error) {
    console.warn('CRO decision audit not recorded:', error)
  }
}
