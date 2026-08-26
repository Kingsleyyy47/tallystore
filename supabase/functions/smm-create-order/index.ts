import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
    const formData = new URLSearchParams();
    formData.append('key', this.apiKey);
    
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, String(value));
    }

    const response = await fetch(SMM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`SMM API HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for API-level errors
    if (data.error) {
      throw new Error(`SMM API error: ${data.error}`);
    }

    return data as T;
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
export async function assertPurchasingCustomer(admin: any, userId: string) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error('Could not verify purchase permission')
  }

  if (profile?.is_staff || profile?.is_admin) {
    throw new Error('Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.')
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generate unique order reference
 */
function generateReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SMM-${timestamp}-${random}`;
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

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

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

    // Validate required fields
    if (!service_id) {
      throw new Error('service_id is required');
    }
    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }

    // Initialize admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    await assertPurchasingCustomer(supabaseAdmin, user.id);

    // Check for duplicate order (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from('smm_orders')
      .select('id, reference, status')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      console.log('Duplicate SMM order detected for idempotency key.');
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

    // Determine the actual quantity to use
    // Package services have fixed quantity (1 package)
    // Other services use the provided quantity
    const actualQuantity = service.service_type === 'Package' ? 1 : Number(quantity || service.min_quantity);

    // Validate quantity against min/max (skip for packages)
    if (service.service_type !== 'Package') {
      if (!Number.isInteger(actualQuantity) || actualQuantity < 1) {
        throw new Error('Quantity must be a whole number');
      }
      if (actualQuantity < service.min_quantity) {
        throw new Error(`Minimum quantity is ${service.min_quantity}`);
      }
      if (actualQuantity > service.max_quantity) {
        throw new Error(`Maximum quantity is ${service.max_quantity}`);
      }
    }

    // Calculate price
    // For packages: price_ngn is the total price
    // For others: price_ngn is per 1000, so calculate based on quantity
    let totalAmount: number;
    let totalCost: number;
    
    if (service.service_type === 'Package') {
      totalAmount = Math.ceil(service.price_ngn);
      totalCost = service.rate_usd;
    } else {
      const pricePerUnit = service.price_ngn / 1000;
      totalAmount = Math.ceil(pricePerUnit * actualQuantity);
      const costPerUnit = service.rate_usd / 1000;
      totalCost = costPerUnit * actualQuantity;
    }
    const expectedPriceNgn = Math.round(Number(expected_price_ngn));
    if (!Number.isFinite(expectedPriceNgn) || expectedPriceNgn <= 0) {
      throw new Error('Current displayed price is required. Please refresh and try again.');
    }
    if (expectedPriceNgn !== totalAmount) {
      throw new Error(`Price changed from ₦${expectedPriceNgn.toLocaleString()} to ₦${totalAmount.toLocaleString()}. Please refresh and try again.`);
    }

    // Check for duplicate active order with same link (prevent "active order" panel errors)
    if (link) {
      const { data: activeOrders } = await supabaseAdmin
        .from('smm_orders')
        .select('id, reference, status')
        .eq('user_id', user.id)
        .eq('service_id', service.id)
        .eq('link', link)
        .in('status', ['pending', 'processing', 'in_progress'])
        .limit(1);

      if (activeOrders && activeOrders.length > 0) {
        throw new Error(
          `You already have an active order for this link (${activeOrders[0].reference}). ` +
          `Please wait for it to complete before placing a new one.`
        );
      }
    }

    // Generate order reference
    const reference = generateReference();
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

    // Atomic wallet deduction with optimistic locking to prevent race conditions
    // Read balance → check sufficient → deduct with WHERE matching original balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch user profile');
    }

    const currentBalance = parseFloat(profile.wallet_balance) || 0;

    if (currentBalance < totalAmount) {
      throw new Error(`Insufficient balance. Required: ₦${totalAmount.toLocaleString()}, Available: ₦${currentBalance.toLocaleString()}`);
    }

    const newBalance = currentBalance - totalAmount;

    // Optimistic locking: only update if balance hasn't changed since we read it
    // This prevents race conditions from concurrent orders
    const { data: updateResult, error: balanceError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single();

    if (balanceError || !updateResult) {
      throw new Error('Balance changed during transaction. Please try again.');
    }

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
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('smm_orders')
      .insert(orderData)
      .select()
      .single();

    if (orderError) {
      // Rollback balance deduction
      await supabaseAdmin
        .from('profiles')
        .update({
          wallet_balance: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // Place order with SMM Panel
    let panelOrderId: number | null = null;
    let panelError: string | null = null;

    try {
      const smmClient = createSmmPanelClient();
      
      // Build order params based on service type
      // Each type has specific required parameters per API docs:
      // - Default: link, quantity
      // - Package: link (no quantity)
      // - Custom Comments: link, comments
      // - Custom Comments Package: link, comments
      // - Mentions: link, quantity, usernames
      // - Mentions with Hashtags: link, quantity, usernames, hashtags
      // - Mentions Custom List: link, usernames
      // - Mentions Hashtag: link, quantity, hashtag
      // - Mentions User Followers: link, quantity, username
      // - Mentions Media Likers: link, quantity, username
      // - Comment Likes: link, quantity, username
      // - Comment Replies: link, username, comments (NO quantity!)
      // - Poll: link, answer_number
      // - Invites from Groups: link, quantity, groups
      // - Subscriptions: username, quantity (NO link!)
      // - SEO: link, keywords
      // - Web Traffic: link, quantity
      
      const orderParams: Record<string, any> = {
        service: service.external_id,
      };
      
      const serviceType = service.service_type;
      
      // Add link for types that need it (all except Subscriptions)
      if (serviceType !== 'Subscriptions' && link) {
        orderParams.link = link;
      }
      
      // Add quantity for types that need it
      const typesWithQuantity = [
        'Default', 'Mentions', 'Mentions with Hashtags', 'Mentions Hashtag',
        'Mentions User Followers', 'Mentions Media Likers', 'Comment Likes',
        'Invites from Groups', 'Subscriptions', 'Web Traffic'
      ];
      if (typesWithQuantity.includes(serviceType) && actualQuantity) {
        orderParams.quantity = actualQuantity;
      }
      
      // Add type-specific fields
      if (comments) orderParams.comments = comments;
      if (usernames) orderParams.usernames = usernames;
      if (username) orderParams.username = username;
      if (hashtags) orderParams.hashtags = hashtags;
      if (hashtag) orderParams.hashtag = hashtag;
      if (keywords) orderParams.keywords = keywords;
      if (answer_number) orderParams.answer_number = answer_number;
      if (groups) orderParams.groups = groups;
      
      const panelResponse = await smmClient.createOrder(orderParams);

      if (panelResponse.order) {
        panelOrderId = panelResponse.order;

        // Update order with panel order ID
        await supabaseAdmin
          .from('smm_orders')
          .update({
            external_order_id: panelOrderId,
            status: 'processing',
            panel_response: panelResponse,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      } else if (panelResponse.error) {
        panelError = panelResponse.error;
      }
    } catch (err) {
      console.error('Panel API error while creating SMM order.');
      panelError = err.message || 'Failed to place order with panel';
    }

    // If panel order failed, auto-refund the user immediately
    if (panelError) {
      // Refund wallet balance
      const { data: currentProfile } = await supabaseAdmin
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();

      const refundedBalance = (parseFloat(currentProfile?.wallet_balance) || 0) + totalAmount;

      await supabaseAdmin
        .from('profiles')
        .update({
          wallet_balance: refundedBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      // Mark order as failed
      await supabaseAdmin
        .from('smm_orders')
        .update({
          status: 'failed',
          panel_response: { error: panelError },
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      // Log the failed purchase transaction
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        type: 'purchase',
        amount: -totalAmount,
        balance_after: newBalance,
        description: `SMM Order Failed: ${service.name} (${actualQuantity} units) - ${panelError}`,
        reference: reference,
        status: 'failed',
      });

      // Log the automatic refund transaction
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        type: 'refund',
        amount: totalAmount,
        balance_after: refundedBalance,
        description: `Auto-refund for failed SMM order: ${service.name} (${actualQuantity} units)`,
        reference: `REFUND-${reference}`,
        status: 'completed',
      });

      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `smm:PAYMENT_FAILED:${eventKey}`,
        userId: user.id,
        surface: 'social_boost',
        revenueContext,
        metadata: {
          order_id: order.id,
          reference,
          service_id: service.id,
          service_external_id: service.external_id,
          service_name: service.name,
          platform: service.platform,
          amount_ngn: totalAmount,
          quantity: actualQuantity,
          error: panelError,
        },
      });
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASE_REVERSED',
        eventId: `smm:PRODUCT_PURCHASE_REVERSED:${eventKey}`,
        userId: user.id,
        surface: 'social_boost',
        revenueContext,
        metadata: {
          order_id: order.id,
          reference,
          refund_reference: `REFUND-${reference}`,
          amount_ngn: totalAmount,
          reason: 'panel_order_failed',
        },
      });

      throw new Error(`Order failed: ${panelError}. Your balance of ₦${totalAmount.toLocaleString()} has been automatically refunded.`);
    }

    // Log successful transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: user.id,
      type: 'purchase',
      amount: -totalAmount,
      balance_after: newBalance,
      description: `SMM Order: ${service.name} (${actualQuantity} units)`,
      reference: reference,
      status: 'completed',
    });

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
    console.error('SMM Create Order Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 400,
      }
    );
  }
});
