import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { authenticateCustomerRequest } from '../_shared/customer-api-delegation.ts';
import { smmPanelRequest } from '../_shared/smm-panel-transport.ts';
import { quoteSmmOrder, validateSmmOrderFields, SMM_QUANTITY_TYPES, SMM_UNAVAILABLE } from '../_shared/smm-order-contract.ts';

async function applyWalletTransaction(
  supabaseAdmin: any,
  params: {
    userId: string
    type: string
    amount: number
    reference: string
    description: string
    idempotencyKey: string
    metadata?: Record<string, unknown>
  },
) {
  const { data, error } = await supabaseAdmin.rpc('apply_wallet_transaction', {
    p_user_id: params.userId,
    p_type: params.type,
    p_amount: params.amount,
    p_reference: params.reference,
    p_description: params.description,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata || {},
    p_currency: 'NGN',
    p_balance_type: 'wallet',
    p_external_payment_id: null,
    p_created_by: null,
  })

  if (error) throw new Error(error.message || 'Wallet transaction failed')

  const result = data as any
  if (!result?.success) throw new Error(result?.error || 'Wallet transaction failed')

  return result
}

// ── revenue-events.ts (inlined) ──
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


// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── smm-panel-client.ts ──
/**
 * SMM Panel API Client
 * API: https://thelordofthepanels.com/api/v2
 * 
 * All requests are POST with key + action parameters
 */

const SMM_API_URL = 'https://thelordofthepanels.com/api/v2';

export interface SmmService {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: string;
  min: string;
  max: string;
  refill: boolean;
  cancel: boolean;
}

export interface SmmOrderResponse {
  order?: number;
  error?: string;
}

export interface SmmStatusResponse {
  charge?: string;
  start_count?: string;
  status?: string;
  remains?: string;
  currency?: string;
  error?: string;
}

export interface SmmBalanceResponse {
  balance?: string;
  currency?: string;
  error?: string;
}

export interface SmmRefillResponse {
  refill?: string | number;
  error?: string;
}

export class SmmPanelClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('SMM Panel API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Make a POST request to the SMM Panel API
   */
  private async request<T>(params: Record<string, string | number>): Promise<T> {
    return smmPanelRequest<T>(SMM_API_URL, this.apiKey, params);
  }

  /**
   * Get all available services
   */
  async getServices(): Promise<SmmService[]> {
    return this.request<SmmService[]>({ action: 'services' });
  }

  /**
   * Create a new order
   * Different service types require different parameters
   */
  async createOrder(params: {
    service: number;
    link?: string;
    quantity?: number;
    runs?: number;
    interval?: number;
    // For Custom Comments type
    comments?: string;
    // For Mentions types
    usernames?: string;
    username?: string;
    // For Hashtag types
    hashtags?: string;
    hashtag?: string;
    // For SEO type
    keywords?: string;
    // For Poll type
    answer_number?: number;
    // For Invites from Groups
    groups?: string;
  }): Promise<SmmOrderResponse> {
    const requestParams: Record<string, string | number> = {
      action: 'add',
      service: params.service,
    };

    // Add optional params only if provided
    if (params.link) requestParams.link = params.link;
    if (params.quantity) requestParams.quantity = params.quantity;
    if (params.runs) requestParams.runs = params.runs;
    if (params.interval) requestParams.interval = params.interval;
    if (params.comments) requestParams.comments = params.comments;
    if (params.usernames) requestParams.usernames = params.usernames;
    if (params.username) requestParams.username = params.username;
    if (params.hashtags) requestParams.hashtags = params.hashtags;
    if (params.hashtag) requestParams.hashtag = params.hashtag;
    if (params.keywords) requestParams.keywords = params.keywords;
    if (params.answer_number) requestParams.answer_number = params.answer_number;
    if (params.groups) requestParams.groups = params.groups;

    return this.request<SmmOrderResponse>(requestParams);
  }

  /**
   * Check order status
   */
  async getOrderStatus(orderId: number): Promise<SmmStatusResponse> {
    return this.request<SmmStatusResponse>({
      action: 'status',
      order: orderId,
    });
  }

  /**
   * Check multiple orders status
   */
  async getMultipleOrderStatus(orderIds: number[]): Promise<Record<string, SmmStatusResponse>> {
    return this.request<Record<string, SmmStatusResponse>>({
      action: 'status',
      orders: orderIds.join(','),
    });
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<SmmBalanceResponse> {
    return this.request<SmmBalanceResponse>({ action: 'balance' });
  }

  /**
   * Request refill for an order
   */
  async createRefill(orderId: number): Promise<SmmRefillResponse> {
    return this.request<SmmRefillResponse>({
      action: 'refill',
      order: orderId,
    });
  }

  /**
   * Cancel orders
   */
  async cancelOrders(orderIds: number[]): Promise<Array<{ order: number; cancel: number | { error: string } }>> {
    return this.request({
      action: 'cancel',
      orders: orderIds.join(','),
    });
  }
}

/**
 * Create SMM Panel client using environment variable
 */
export function createSmmPanelClient(): SmmPanelClient {
  const apiKey = Deno.env.get('SMM_PANEL_API_KEY');
  if (!apiKey) {
    throw new Error('SMM_PANEL_API_KEY environment variable is not set');
  }
  return new SmmPanelClient(apiKey);
}

/**
 * Normalize platform name from category
 * e.g., "Instagram Followers" -> "instagram"
 */
export function normalizePlatform(category: string): string {
  const lowerCategory = category.toLowerCase();
  
  const platforms = [
    'instagram',
    'tiktok',
    'youtube',
    'twitter',
    'facebook',
    'telegram',
    'spotify',
    'soundcloud',
    'twitch',
    'discord',
    'linkedin',
    'pinterest',
    'snapchat',
    'reddit',
    'threads',
  ];

  for (const platform of platforms) {
    if (lowerCategory.includes(platform)) {
      return platform;
    }
  }

  return 'other';
}

// ── staff-purchase-guard.ts ──
async function purchaseGuardSha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanPurchaseGuardIp(value: string | null) {
  if (!value) return null
  const first = value.split(',')[0]?.trim() || ''
  const withoutPort = first.includes('.') ? first.replace(/:\d+$/, '') : first
  const cleaned = withoutPort.replace(/[^a-fA-F0-9:.[\]]/g, '').replace(/^\[|\]$/g, '')
  if (!cleaned || cleaned.length > 80) return null
  return cleaned
}

function getPurchaseGuardIp(req?: Request | null) {
  if (!req) return null
  return cleanPurchaseGuardIp(
    req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for') ||
      req.headers.get('forwarded')?.match(/for="?([^";,]+)"?/i)?.[1] ||
      null,
  )
}

function getPurchaseGuardUserAgent(req?: Request | null) {
  return Array.from(String(req?.headers.get('user-agent') || '')).filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, 500)
}

async function getWalletRequestForensics(req: Request, route: string) {
  const userAgent = getPurchaseGuardUserAgent(req)
  return {
    request_id: req.headers.get('x-request-id') || req.headers.get('x-correlation-id') || crypto.randomUUID(),
    route,
    ip_address: getPurchaseGuardIp(req),
    user_agent: userAgent || null,
    user_agent_hash: userAgent ? await purchaseGuardSha256Hex(userAgent) : null,
    device_fingerprint: req.headers.get('x-device-fingerprint') || req.headers.get('x-client-device-id') || null,
    forwarded_for: req.headers.get('x-forwarded-for') || null,
    cf_ray: req.headers.get('cf-ray') || null,
    vercel_id: req.headers.get('x-vercel-id') || null,
  }
}


export async function assertPurchasingCustomer(admin: any, userId: string, req?: Request | null, amountNgn?: number) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin, account_suspended')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error('Could not verify purchase permission')
  }

  if (profile?.is_staff || profile?.is_admin) {
    throw new Error('Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.')
  }

  if (profile?.account_suspended) {
    throw new Error('Purchasing is paused while this wallet is under security review. Please contact support.')
  }

  const { data: truth, error: truthError } = await admin.rpc('wallet_financial_truth_internal', { p_user_id: userId })
  const spendable = Number(truth?.confirmed_spendable)
  if (truthError || !truth || typeof truth.spending_blocked !== 'boolean' ||
      truth.confirmed_spendable == null || !Number.isFinite(spendable) || spendable < 0) {
    throw new Error('Could not verify wallet funds for purchase')
  }
  if (truth.spending_blocked) {
    throw new Error('Purchasing is paused while this wallet is under security review. Please contact support.')
  }
  if (amountNgn !== undefined && (!Number.isFinite(amountNgn) || amountNgn <= 0 || spendable < amountNgn)) {
    throw new Error('Insufficient verified funds for purchase')
  }

}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function smmOrdersEnabled() {
  return String(Deno.env.get('SMM_ORDERS_ENABLED') || '').trim().toLowerCase() === 'true'
}

/**
 * Generate unique order reference
 */
function generateReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SMM-${timestamp}-${random}`;
}

function buildPanelOrderParams(service: any, input: Record<string, any>): Record<string, string | number> & { service: number } {
  const params: Record<string, string | number> & { service: number } = { service: Number(service.external_id) };
  const serviceType = service.service_type;
  if (serviceType !== 'Subscriptions' && input.link) params.link = input.link;
  const typesWithQuantity = SMM_QUANTITY_TYPES;
  if (typesWithQuantity.includes(serviceType) && input.actualQuantity) params.quantity = input.actualQuantity;
  for (const field of ['comments','usernames','username','hashtags','hashtag','keywords','answer_number','groups']) {
    if (input[field]) params[field] = input[field];
  }
  return params;
}

async function panelPayloadHash(params: Record<string, string | number>): Promise<string> {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a],[b]) => a.localeCompare(b))));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function recordRevenueEvent(
  supabaseAdmin: any,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    surface?: string;
    revenueContext?: RevenueRequestContext | null;
    metadata?: Record<string, unknown>;
  }
) {
  const eventType = sanitizeRevenueEventType('smm-create-order', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('smm-create-order', input.eventId),
    event_type: eventType,
    ...revenueContextEventColumns(input.revenueContext),
    user_id: input.userId || null,
    surface: input.surface || 'social_boost',
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
    }),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record SMM revenue event ${eventType}:`, error.message);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!smmOrdersEnabled()) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Social Boost ordering is temporarily paused for wallet security review.',
        code: 'SMM_ORDERS_PAUSED',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 503,
      }
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const user = await authenticateCustomerRequest(req, supabaseAdmin, 'social_boost', 'smm-create-order');

    // Parse request body - accept all possible fields for different service types
    const { 
      service_id, 
      link, 
      quantity,
      comments,      // For Custom Comments type
      usernames,     // For Mentions type
      username,      // For Comment Likes, Subscriptions
      hashtags,      // For Mentions with Hashtags
      hashtag,       // For Mentions Hashtag
      keywords,      // For SEO
      answer_number, // For Poll
      groups,        // For Invites from Groups
      expected_price_ngn,
      idempotency_key,
      revenue_context,
    } = await req.json();
    const revenueContext = sanitizeRevenueRequestContext(revenue_context);
    const walletRequestForensics = await getWalletRequestForensics(req, 'smm-create-order');

    // Validate required fields
    if (!service_id) {
      throw new Error('service_id is required');
    }
    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }

    await assertPurchasingCustomer(supabaseAdmin, user.id, req);

    // Check for duplicate order (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from('smm_orders')
      .select('id, reference, status, service_id, quantity, amount_ngn, link, dispatch_payload_sha256')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    // If a previous attempt debited the wallet but failed before creating the
    // SMM order row, a retry must not replay that old debit into a fresh panel
    // order. The prior failed attempt may already have been refunded.
    const { data: orphanedPurchaseTx, error: orphanedPurchaseError } = await supabaseAdmin
      .from('transactions')
      .select('id, amount, status, balance_after, created_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', `smm:purchase:${idempotency_key}`)
      .maybeSingle();

    if (orphanedPurchaseError) {
      throw new Error('Could not verify SMM purchase idempotency state');
    }

    if (orphanedPurchaseTx && !existingOrder) {
      console.error('Blocked orphaned SMM purchase ledger retry without matching order.', {
        transaction_id: orphanedPurchaseTx.id,
        idempotency_key,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'This SMM purchase attempt needs admin review before it can be retried.',
          code: 'SMM_PURCHASE_LEDGER_ORPHANED',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        }
      );
    }

    // Get service details
    const { data: service, error: serviceError } = await supabaseAdmin
      .from('smm_services')
      .select('*')
      .eq('id', service_id)
      .eq('is_active', true)
      .single();

    if (serviceError || !service) {
      throw new Error('Service not found or inactive');
    }
    if (!Number.isFinite(Number(service.price_ngn)) || Number(service.price_ngn) <= 0) {
      throw new Error('Service has an invalid customer price');
    }
    if (!Number.isFinite(Number(service.rate_usd)) || Number(service.rate_usd) < 0) {
      throw new Error('Service cost is unavailable. Please try again after services sync.');
    }

    const rawFields = { quantity, link, comments, usernames, username, hashtags, hashtag, keywords, answer_number, groups };
    const normalizedFields = validateSmmOrderFields(service.service_type, rawFields);
    const quote = quoteSmmOrder(service, { ...normalizedFields, quantity });
    const actualQuantity = quote.quantity;
    const totalAmount = quote.amountNgn;
    const totalCost = Number(service.rate_usd) * (quote.package ? 1 : actualQuantity / 1000);
    const expectedPriceNgn = Math.round(Number(expected_price_ngn));
    if (!Number.isFinite(expectedPriceNgn) || expectedPriceNgn <= 0) {
      throw new Error('Current displayed price is required. Please refresh and try again.');
    }
    if (expectedPriceNgn !== totalAmount) {
      throw new Error(`Price changed from ₦${expectedPriceNgn.toLocaleString()} to ₦${totalAmount.toLocaleString()}. Please refresh and try again.`);
    }

    await assertPurchasingCustomer(supabaseAdmin, user.id, req, totalAmount);
    const orderParams = buildPanelOrderParams(service, { ...normalizedFields, actualQuantity });
    // This is the exact public, credential-free paid action sent by createOrder.
    const payloadHash = await panelPayloadHash({ action: 'add', ...orderParams });

    if (existingOrder) {
      const sameRequest =
        String(existingOrder.service_id || '') === String(service.id) &&
        Number(existingOrder.quantity || 0) === actualQuantity &&
        Number(existingOrder.amount_ngn || 0) === totalAmount &&
        String(existingOrder.link || '') === String(link || '') &&
        (existingOrder.dispatch_payload_sha256 == null || existingOrder.dispatch_payload_sha256 === payloadHash);

      if (!sameRequest) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This idempotency key was already used for a different SMM order request.',
            code: 'IDEMPOTENCY_REQUEST_CONFLICT',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 409,
          }
        );
      }

      console.log('Duplicate SMM order detected for idempotency key.');
      if (existingOrder.status === 'outcome_unknown') {
        return new Response(
          JSON.stringify({
            success: false,
            code: 'SMM_SUPPLIER_OUTCOME_UNKNOWN',
            error: 'Order outcome is under review. Do not place it again; funds remain committed until resolved.',
            data: { order_id: existingOrder.id, reference: existingOrder.reference, status: 'outcome_unknown' },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 },
        );
      }
      if (existingOrder.status === 'failed') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This order failed previously. Check its refund status before placing another order.',
            data: { order_id: existingOrder.id, reference: existingOrder.reference, status: 'failed' },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 },
        );
      }
      if (existingOrder.status === 'pending') {
        return new Response(
          JSON.stringify({
            success: false,
            code: 'SMM_DISPATCH_STATUS_UNCONFIRMED',
            error: 'This order is awaiting provider confirmation. Do not place it again; check order history or contact support.',
            data: { order_id: existingOrder.id, reference: existingOrder.reference, status: 'pending' },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Order already exists',
          data: existingOrder,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const { data: unresolvedOrders, error: unresolvedOrdersError } = await supabaseAdmin
      .from('smm_orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'outcome_unknown')
      .limit(1);
    if (unresolvedOrdersError) {
      throw new Error('Could not verify unresolved SMM orders');
    }
    if (unresolvedOrders && unresolvedOrders.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'SMM_SUPPLIER_OUTCOME_UNKNOWN',
          error: 'A previous order outcome is under review. New Social Boost orders are paused for this wallet.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 },
      );
    }

    // Check for duplicate active order with same link (prevent "active order" panel errors)
    if (link) {
      const { data: activeOrders } = await supabaseAdmin
        .from('smm_orders')
        .select('id, reference, status')
        .eq('user_id', user.id)
        .eq('service_id', service.id)
        .eq('link', link)
        .in('status', ['pending', 'processing', 'in_progress', 'outcome_unknown'])
        .limit(1);

      if (activeOrders && activeOrders.length > 0) {
        throw new Error(
          `You already have an active order for this link (${activeOrders[0].reference}). ` +
          `Please wait for it to complete before placing a new one.`
        );
      }
    }

    const { data: securityProfile, error: securityProfileError } = await supabaseAdmin
      .from('profiles')
      .select('financial_security_version')
      .eq('id', user.id)
      .single();
    const securityVersion = Number(securityProfile?.financial_security_version);
    if (securityProfileError || !Number.isInteger(securityVersion) || securityVersion < 1) {
      throw new Error('Could not verify wallet authorization version');
    }

    // Generate order reference
    let reference = generateReference();
    const eventKey = idempotency_key;

    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_STARTED',
      eventId: `smm:PAYMENT_STARTED:${eventKey}`,
      userId: user.id,
      surface: 'social_boost',
      revenueContext,
      metadata: {
        service_id: service.id,
        service_external_id: service.external_id,
        service_name: service.name,
        platform: service.platform,
        quantity: actualQuantity,
        amount_ngn: totalAmount,
        expected_price_ngn: expectedPriceNgn,
        reference,
        idempotency_key,
      },
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_ATTEMPTED',
      eventId: `smm:PAYMENT_ATTEMPTED:${eventKey}`,
      userId: user.id,
      surface: 'social_boost',
      revenueContext,
      metadata: {
        service_id: service.id,
        service_external_id: service.external_id,
        service_name: service.name,
        platform: service.platform,
        quantity: actualQuantity,
        amount_ngn: totalAmount,
        expected_price_ngn: expectedPriceNgn,
        reference,
        idempotency_key,
      },
    });

    const debitResult = await applyWalletTransaction(supabaseAdmin, {
      userId: user.id,
      type: 'purchase',
      amount: totalAmount,
      reference,
      description: `SMM Order: ${service.name} (${actualQuantity} units)`,
      idempotencyKey: `smm:purchase:${idempotency_key}`,
      metadata: {
        source: 'smm-create-order',
        request_forensics: walletRequestForensics,
        service_id: service.id,
        service_external_id: service.external_id,
        service_name: service.name,
        platform: service.platform,
        quantity: actualQuantity,
        dispatch_payload_sha256: payloadHash,
      },
    });

    // The wallet engine returns the authoritative committed transaction on a
    // replay. Bind the local order to its exact reference and full panel
    // request. A different payload must not borrow an existing debit.
    const committedDebit = debitResult?.transaction;
    if (!committedDebit?.id || committedDebit.reference !== reference ||
        committedDebit.idempotency_key !== `smm:purchase:${idempotency_key}` ||
        committedDebit.metadata?.dispatch_payload_sha256 !== payloadHash) {
      return new Response(JSON.stringify({
        success: false,
        code: 'SMM_DEBIT_PROOF_UNCONFIRMED',
        error: 'This order needs review. Do not place the same request again.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
    }
    reference = committedDebit.reference;

    const newBalance = Number(debitResult.balance_after ?? 0);

    // Create order record (pending) - service_name not in table, only service_id FK
    const orderData = {
      user_id: user.id,
      reference: reference,
      service_id: service.id,
      link: link || '',
      quantity: actualQuantity,
      amount_ngn: totalAmount,
      cost_usd: totalCost,
      status: 'pending',
      idempotency_key,
      dispatch_payload_sha256: payloadHash,
      financial_security_version: securityVersion,
      financial_authorization_status: 'legacy_debit',
      financial_authorization_reference: reference,
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('smm_orders')
      .insert(orderData)
      .select()
      .single();

    if (orderError) {
      // A same-key concurrent request may have won the unique order insert
      // after this request's idempotent debit. Refunding here would release
      // funds for the other handler while its paid panel send is in flight.
      const { data: competingOrder, error: competingReadError } = await supabaseAdmin
        .from('smm_orders')
        .select('id, reference, status, service_id, quantity, amount_ngn, link, dispatch_payload_sha256')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();
      if (competingReadError) {
        return new Response(JSON.stringify({ success: false, code: 'SMM_DISPATCH_STATUS_UNCONFIRMED', error: 'Order state needs review. Do not place this request again.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
      }
      if (competingOrder) {
        const sameIntent = String(competingOrder.service_id) === String(service.id)
          && Number(competingOrder.quantity) === actualQuantity
          && Number(competingOrder.amount_ngn) === totalAmount
          && String(competingOrder.link || '') === String(link || '')
          && competingOrder.dispatch_payload_sha256 === payloadHash;
        return new Response(JSON.stringify({
          success: false,
          code: sameIntent ? 'SMM_DISPATCH_STATUS_UNCONFIRMED' : 'IDEMPOTENCY_REQUEST_CONFLICT',
          error: sameIntent ? 'Order state needs provider confirmation. Do not place it again.' : 'This idempotency key belongs to a different order request.',
          data: { order_id: competingOrder.id, reference: competingOrder.reference, status: competingOrder.status },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: sameIntent ? 202 : 409 });
      }
      // A lost INSERT acknowledgement can commit after this read. There is no
      // safe proof that another executor has not taken the same debit, so
      // retain the debit for exact order/ledger review and never send.
      return new Response(JSON.stringify({
        success: false,
        code: 'SMM_LOCAL_ORDER_UNCONFIRMED',
        error: 'Your order needs review. Do not place this request again; no panel request will be sent.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
    }

    // This committed one-use claim must precede the paid panel POST. A lost
    // acknowledgement burns permission and never triggers an automatic retry.
    const debitTransactionId = String(debitResult?.transaction?.id || '');
    const claim = debitTransactionId
      ? await supabaseAdmin.rpc('claim_smm_dispatch', {
          p_user_id: user.id,
          p_order_id: order.id,
          p_debit_transaction_id: debitTransactionId,
          p_idempotency_key: idempotency_key,
          p_payload_sha256: payloadHash,
        })
      : { data: null, error: new Error('DEBIT_TRANSACTION_ID_UNAVAILABLE') };
    if (claim.error || claim.data?.success !== true || claim.data?.send_allowed !== true) {
      const { error: holdError } = await supabaseAdmin.from('smm_orders')
        .update({ status: 'outcome_unknown', updated_at: new Date().toISOString() })
        .eq('id', order.id).eq('user_id', user.id).eq('status', 'pending');
      if (holdError) console.error('Could not persist SMM no-send review state.');
      return new Response(JSON.stringify({
        success: false,
        code: 'SMM_DISPATCH_STATUS_UNCONFIRMED',
        error: 'Your order is under review. Do not place it again; no new panel request will be sent.',
        data: { order_id: order.id, reference, status: 'outcome_unknown' },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
    }

    // Place order with SMM Panel. No response outcome permits a second add.
    let panelOrderId: number | null = null;
    let panelError: string | null = null;

    try {
      const smmClient = createSmmPanelClient();
      
      const panelResponse = await smmClient.createOrder(orderParams);

      if (typeof panelResponse.order === 'number' && Number.isSafeInteger(panelResponse.order) && panelResponse.order > 0) {
        panelOrderId = panelResponse.order;

        // Update order with panel order ID
        const { error: panelOrderSaveError } = await supabaseAdmin
          .from('smm_orders')
          .update({
            external_order_id: panelOrderId,
            status: 'processing',
            panel_response: panelResponse,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
        if (panelOrderSaveError) {
          throw new Error('SMM_PANEL_ORDER_RECORD_UNAVAILABLE');
        }
      } else if (panelResponse.error) {
        panelError = panelResponse.error;
      } else {
        panelError = 'SMM_PANEL_RESPONSE_UNRECOGNIZED';
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Panel API error while creating SMM order.');
      panelError = errorMessage || 'Failed to place order with panel';
    }

    // A missing order ID or provider error does not prove non-delivery. Keep
    // the debit until panel lookup or manual review establishes the outcome.
    if (panelError) {
      const { error: unknownSaveError } = await supabaseAdmin
        .from('smm_orders')
        .update({
          status: 'outcome_unknown',
          external_order_id: panelOrderId,
          panel_response: { outcome: 'unknown' },
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);
      if (unknownSaveError) {
        console.error('Could not persist uncertain SMM supplier outcome:', unknownSaveError);
      }
      console.error('SMM supplier outcome requires review:', {
        order_id: order.id,
        reference,
        panel_order_id: panelOrderId,
        reason: panelError,
      });
      return new Response(
        JSON.stringify({
          success: false,
          code: 'SMM_SUPPLIER_OUTCOME_UNKNOWN',
          error: 'Order outcome is under review. Do not place it again; funds remain committed until resolved.',
          data: { order_id: order.id, reference, status: 'outcome_unknown' },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 },
      );
    }

    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_COMPLETED',
      eventId: `smm:PAYMENT_COMPLETED:${eventKey}`,
      userId: user.id,
      surface: 'social_boost',
      revenueContext,
      metadata: {
        order_id: order.id,
        reference,
        external_order_id: panelOrderId,
        service_id: service.id,
        service_external_id: service.external_id,
        service_name: service.name,
        platform: service.platform,
        quantity: actualQuantity,
        amount_ngn: totalAmount,
        balance_after: newBalance,
      },
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PRODUCT_PURCHASED',
      eventId: `smm:PRODUCT_PURCHASED:${eventKey}`,
      userId: user.id,
      surface: 'social_boost',
      revenueContext,
      metadata: {
        order_id: order.id,
        reference,
        external_order_id: panelOrderId,
        service_id: service.id,
        service_external_id: service.external_id,
        service_name: service.name,
        platform: service.platform,
        quantity: actualQuantity,
        amount_ngn: totalAmount,
        cost_usd: totalCost,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Order placed successfully',
        data: {
          order_id: order.id,
          reference: reference,
          external_order_id: panelOrderId,
          service: service.name,
          quantity: quantity,
          amount: totalAmount,
          status: 'processing',
          new_balance: newBalance,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('SMM Create Order Error:', error);
    const knownCustomerErrors = new Set([
      'service_id is required',
      'Valid idempotency_key is required',
      'Service not found or inactive',
      'Quantity must be a whole number',
      SMM_UNAVAILABLE,
      'Please check the order details.',
      'Please enter a valid web link.',
      'Current displayed price is required. Please refresh and try again.',
      'Insufficient verified funds for purchase',
      'Purchasing is paused while this wallet is under security review. Please contact support.',
      'Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.',
      'This device or network has been blocked from purchasing. Please contact support.',
    ]);
    const publicError = errorMessage === 'Unauthorized' || errorMessage === 'Missing authorization header'
      ? 'Unauthorized'
      : knownCustomerErrors.has(errorMessage) ? errorMessage
      : /^Minimum quantity is \d+$/.test(errorMessage) || /^Maximum quantity is \d+$/.test(errorMessage)
        ? errorMessage
        : errorMessage.startsWith('Price changed from ')
          ? 'Price changed. Please refresh and try again.'
          : errorMessage.startsWith('You already have an active order for this link')
            ? 'You already have an active order for this link. Check its status before placing another.'
            : 'Could not place this order. Check its status before trying again.';
    return new Response(
      JSON.stringify({
        success: false,
        error: publicError,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: publicError === 'Unauthorized' ? 401 : 400,
      }
    );
  }
});
