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

// ── nowpayments-client.ts ──
/**
 * NowPayments API Client
 * Handles all interactions with NowPayments API for crypto payments
 * Documentation: https://documenter.getpostman.com/view/7907941/S1a32n38
 */

const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

interface NowPaymentsConfig {
  apiKey: string;
  email?: string;
  password?: string;
}

interface CreatePaymentParams {
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  pay_amount?: number; // Optional: specify exact crypto amount
  ipn_callback_url?: string;
  order_id?: string;
  order_description?: string;
  payout_address?: string; // Optional: custom payout address
  payout_currency?: string; // Required if payout_address is specified
  payout_extra_id?: string; // Optional: memo/tag for payout_address
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
}

interface CreatePaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string | null;
  order_description: string | null;
  ipn_callback_url: string | null;
  created_at: string;
  updated_at: string;
  purchase_id: string;
  amount_received: number | null;
  payin_extra_id: string | null; // Memo/Tag for currencies like XRP, XLM, EOS
  smart_contract: string;
  network: string;
  network_precision: number;
  time_limit: string | null;
  burning_percent: number | null;
  expiration_estimate_date: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
  valid_until?: string; // When fixed rate expires
  type?: string; // crypto2crypto or fiat2crypto
}

interface PaymentStatus {
  payment_id: number; // Note: ID is number in response, not string
  invoice_id: number | null;
  payment_status: string; // waiting, confirming, confirmed, sending, partially_paid, finished, failed, refunded, expired
  pay_address: string;
  payin_extra_id: string | null; // Memo/Tag for XRP, XLM, EOS, etc.
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number; // Actual amount received (may differ from pay_amount)
  pay_currency: string;
  order_id: string | null;
  order_description: string | null;
  purchase_id: number; // Note: ID is number in response, not string
  outcome_amount: number; // Amount to be received on your Outcome Wallet
  outcome_currency: string; // Currency for settlement
  payout_hash: string | null;
  payin_hash: string | null;
  created_at: string;
  updated_at: string;
  burning_percent?: string | null; // Can be "null" as string
  type: string; // crypto2crypto or fiat2crypto
  payment_extra_ids?: number[]; // Child payment IDs (for repeated deposits)
  parent_payment_id?: number; // Parent payment ID (only exists on child payments)
  origin_type?: string; // "REPEATED" for child payments
}

export class NowPaymentsClient {
  private config: NowPaymentsConfig;
  private authToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(config: NowPaymentsConfig) {
    this.config = config;
  }

  /**
   * Get authentication token (JWT)
   * Token expires in 5 minutes, we cache it for 4 minutes
   */
  private async getAuthToken(): Promise<string> {
    // Check if token is still valid (with 1 min buffer)
    if (this.authToken && this.tokenExpiry && this.tokenExpiry > Date.now() + 60000) {
      return this.authToken;
    }

    // Only get token if email/password provided
    if (!this.config.email || !this.config.password) {
      throw new Error('Email and password required for authentication');
    }

    const response = await fetch(`${NOWPAYMENTS_API_URL}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.authToken = data.token;
    this.tokenExpiry = Date.now() + (4 * 60 * 1000); // Cache for 4 minutes

    return this.authToken!; // Non-null assertion: we just set it above
  }

  /**
   * Make authenticated request to NowPayments API
   */
  private async makeRequest(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth: boolean = false
  ): Promise<any> {
    const headers: Record<string, string> = {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    // Add Bearer token if required
    if (requiresAuth) {
      const token = await this.getAuthToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NOWPAYMENTS_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NowPayments API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get API status
   */
  async getStatus(): Promise<{ message: string }> {
    return this.makeRequest('/status');
  }

  /**
   * Get available currencies
   */
  async getAvailableCurrencies(fixedRate?: boolean): Promise<{ currencies: string[] }> {
    const query = fixedRate ? '?fixed_rate=true' : '';
    return this.makeRequest(`/currencies${query}`);
  }

  /**
   * Create a payment
   */
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResponse> {
    return this.makeRequest('/payment', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    return this.makeRequest(`/payment/${paymentId}`);
  }

  /**
   * Get list of payments (requires authentication)
   */
  async getListOfPayments(params?: {
    limit?: number; // 1-500
    page?: number; // 0 to pagesCount-1
    sortBy?: string; // payment_id, payment_status, created_at, etc.
    orderBy?: 'asc' | 'desc';
    dateFrom?: string; // YYYY-MM-DD or ISO format
    dateTo?: string; // YYYY-MM-DD or ISO format
    invoiceId?: number; // Filter by invoice ID
  }): Promise<{ data: PaymentStatus[]; limit: number; page: number; pagesCount: number; total: number }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params?.orderBy) queryParams.set('orderBy', params.orderBy);
    if (params?.dateFrom) queryParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) queryParams.set('dateTo', params.dateTo);
    if (params?.invoiceId) queryParams.set('invoiceId', params.invoiceId.toString());

    const query = queryParams.toString();
    return this.makeRequest(`/payment/?${query}`, {}, true);
  }

  /**
   * Get minimum payment amount for a currency pair
   */
  async getMinimumPaymentAmount(
    currency_from: string,
    currency_to?: string,
    fiat_equivalent?: string,
    is_fixed_rate?: boolean,
    is_fee_paid_by_user?: boolean
  ): Promise<{ 
    currency_from: string; 
    currency_to: string; 
    min_amount: number;
    fiat_equivalent?: number;
  }> {
    const params = new URLSearchParams({ currency_from });
    if (currency_to) params.set('currency_to', currency_to);
    if (fiat_equivalent) params.set('fiat_equivalent', fiat_equivalent);
    if (is_fixed_rate !== undefined) params.set('is_fixed_rate', String(is_fixed_rate));
    if (is_fee_paid_by_user !== undefined) params.set('is_fee_paid_by_user', String(is_fee_paid_by_user));
    
    return this.makeRequest(`/min-amount?${params.toString()}`);
  }

  /**
   * Get estimated price
   */
  async getEstimatedPrice(
    amount: number,
    currency_from: string,
    currency_to: string
  ): Promise<{ currency_from: string; amount_from: number; currency_to: string; estimated_amount: number }> {
    return this.makeRequest(
      `/estimate?amount=${amount}&currency_from=${currency_from}&currency_to=${currency_to}`
    );
  }
}

// Export singleton instance
export function createNowPaymentsClient(config: NowPaymentsConfig): NowPaymentsClient {
  return new NowPaymentsClient(config);
}

// ── exchange-rate.ts ──
/**
 * Server-side NGN/USD exchange rate resolution for Edge Functions.
 * Mirrors the client-side logic in src/hooks/useExchangeRate.ts:
 * priority = admin override (app_settings.ngn_usd_rate) -> live API.
 *
 * Edge functions can't import from src/, so this is a small standalone copy.
 */

const LIVE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

export async function getNgnUsdRate(supabaseAdmin: any): Promise<{ rate: number; source: 'override' | 'live' }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'ngn_usd_rate')
      .single();

    if (!error && data?.value) {
      const parsed = parseFloat(data.value);
      if (!isNaN(parsed) && parsed > 0) {
        return { rate: parsed, source: 'override' };
      }
    }
  } catch (_err) {
    // fall through to live rate
  }

  try {
    const res = await fetch(LIVE_RATE_URL);
    const json = await res.json();
    const liveRate = json?.rates?.NGN;
    if (liveRate && typeof liveRate === 'number' && liveRate > 0) {
      return { rate: liveRate, source: 'live' };
    }
  } catch (_err) {
    // handled below
  }

  throw new Error('NGN/USD exchange rate is temporarily unavailable. Set ngn_usd_rate in app settings or try again when the live rate service is reachable.');
}

/** Convert an amount in `currency` (currently only USD is supported) to NGN. */
export async function convertToNgn(amount: number, currency: string, supabaseAdmin: any): Promise<number> {
  if (currency.toUpperCase() !== 'USD') {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }
  const { rate } = await getNgnUsdRate(supabaseAdmin);
  return amount * rate;
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
  const eventType = sanitizeRevenueEventType('create-crypto-sell-order', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('create-crypto-sell-order', input.eventId),
    event_type: eventType,
    ...revenueContextEventColumns(input.revenueContext),
    user_id: input.userId || null,
    surface: input.surface || 'crypto',
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
    }),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record crypto revenue event ${eventType}:`, error.message);
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
      console.error('❌ Missing authorization header');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing authorization header',
          error_details: 'Authorization header is required. Please ensure you are logged in.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('❌ Missing Supabase environment variables');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Server configuration error',
          error_details: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Get authenticated user - explicitly passing token
    // Use case-insensitive regex to remove 'Bearer ' prefix
    const token = authHeader.replace(/^Bearer /i, '');
    
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('❌ User authentication failed:', userError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          error_details: userError?.message || 'User authentication failed',
          debug_info: {
            token_length: token.length,
            auth_header_prefix: authHeader.substring(0, 10),
            has_user: !!user,
            error_code: userError?.status,
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    await assertPurchasingCustomer(supabaseAdmin, user.id);

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError: any) {
      console.error('❌ Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request body',
          error_details: parseError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const {
      crypto_type,
      crypto_amount,
      network,
      client_display_naira_amount,
      naira_amount: legacy_client_display_naira_amount,
      idempotency_key,
      revenue_context,
    } = requestBody;
    const revenueContext = sanitizeRevenueRequestContext(revenue_context);
    const displayNairaAmount = client_display_naira_amount ?? legacy_client_display_naira_amount;

    // Validate required fields
    if (!crypto_type || !crypto_amount) {
      console.error('❌ Missing required fields');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: crypto_type, crypto_amount',
          error_details: `Received: crypto_type=${crypto_type}, crypto_amount=${crypto_amount}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Initialize NowPayments client
    console.log('🔧 Initializing NowPayments client...');
    const nowPaymentsClient = createNowPaymentsClient({
      apiKey: Deno.env.get('NOWPAYMENTS_API_KEY') ?? '',
      email: Deno.env.get('NOWPAYMENTS_EMAIL'),
      password: Deno.env.get('NOWPAYMENTS_PASSWORD'),
    });

    // ============================================================
    // MINIMUM AMOUNT VALIDATION
    // ============================================================
    // Business decision: $20 USD minimum for ALL crypto transactions
    // This ensures NowPayments can process with rate-locking enabled
    // Review monthly - if volume is low, consider floating rate approach
    // ============================================================
    
    const MINIMUM_USD = 20;
    
    console.log(`📊 Validating minimum amount for ${crypto_type}...`);
    const userAmount = parseFloat(crypto_amount);
    if (!Number.isFinite(userAmount) || userAmount <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid crypto amount',
          error_details: 'crypto_amount must be greater than 0',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    const clientDisplayNairaAmount = Number(displayNairaAmount);
    if (!Number.isFinite(clientDisplayNairaAmount) || clientDisplayNairaAmount <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Current displayed Naira amount is required',
          error_details: 'Please refresh the price estimate and try again.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    
    // Get provider estimate to calculate minimum and the authoritative payout.
    let authoritativeUsdAmount: number;
    try {
      const estimate = await nowPaymentsClient.getEstimatedPrice(
        userAmount,
        crypto_type.toLowerCase(),
        'usd'
      );
      authoritativeUsdAmount = Number(estimate.estimated_amount);
      if (!Number.isFinite(authoritativeUsdAmount) || authoritativeUsdAmount <= 0) {
        throw new Error('Invalid provider estimate');
      }
    } catch (error: any) {
      console.error('❌ Could not verify provider crypto price.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Could not verify live crypto rate',
          error_details: error.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    // Validate user input against minimum
    if (authoritativeUsdAmount < MINIMUM_USD) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Minimum transaction is $${MINIMUM_USD} USD`,
          error_details: `You entered ${userAmount} ${crypto_type.toUpperCase()} (≈$${authoritativeUsdAmount.toFixed(2)} USD). Minimum is $${MINIMUM_USD} USD.`,
          min_usd: MINIMUM_USD,
          your_amount_usd: authoritativeUsdAmount,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    const clientIdempotencyKey = String(idempotency_key || '').trim();
    if (!clientIdempotencyKey || clientIdempotencyKey.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }
    const safeIdempotencyKey = clientIdempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
    if (safeIdempotencyKey.length < 10) throw new Error('Valid idempotency_key is required');

    // Deterministic reference prevents duplicate provider orders on frontend retry.
    const orderReference = `TALLY-${safeIdempotencyKey}`;

    const { data: existingTransaction, error: existingError } = await supabaseAdmin
      .from('crypto_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('payment_reference', orderReference)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existingTransaction) {
      return new Response(
        JSON.stringify({
          success: true,
          idempotency_hit: true,
          transaction_id: existingTransaction.id,
          naira_amount: Number(existingTransaction.naira_amount || 0),
          payment_details: {
            payment_id: existingTransaction.nowpayments_payment_id,
            pay_address: existingTransaction.nowpayments_pay_address || existingTransaction.deposit_address,
            pay_amount: existingTransaction.outcome_amount,
            pay_currency: existingTransaction.outcome_currency || crypto_type?.toLowerCase(),
            payin_extra_id: existingTransaction.nowpayments_payin_extra_id,
            network: existingTransaction.nowpayments_network,
            smart_contract: existingTransaction.nowpayments_smart_contract,
            expiration_date: existingTransaction.expiration_date || existingTransaction.expires_at,
            payment_status: existingTransaction.status,
            qr_code_data: `${existingTransaction.outcome_currency || crypto_type?.toLowerCase()}:${existingTransaction.nowpayments_pay_address || existingTransaction.deposit_address}${existingTransaction.nowpayments_payin_extra_id ? `?dt=${existingTransaction.nowpayments_payin_extra_id}` : ''}`,
          },
          message: 'Existing payment returned for this attempt.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Convert USD to NGN server-side. Client display values are never trusted.
    let usdToNgn: number;
    let usdToNgnSource: string;
    try {
      const resolvedRate = await getNgnUsdRate(supabaseAdmin);
      usdToNgn = resolvedRate.rate;
      usdToNgnSource = resolvedRate.source;
    } catch (forexError: any) {
      console.error('❌ Failed to fetch forex rate:', forexError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to fetch exchange rate',
          error_details: forexError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const markup = 1.05;
    const serverNairaAmount = Math.round(authoritativeUsdAmount * usdToNgn * markup * 100) / 100;
    const serverExchangeRate = serverNairaAmount / userAmount;
    const driftTolerance = Math.max(100, serverNairaAmount * 0.01);
    if (Math.abs(clientDisplayNairaAmount - serverNairaAmount) > driftTolerance) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Crypto rate changed',
          error_details: `Amount changed from ₦${clientDisplayNairaAmount.toLocaleString()} to ₦${serverNairaAmount.toLocaleString()}. Please refresh and try again.`,
          client_display_naira_amount: clientDisplayNairaAmount,
          server_naira_amount: serverNairaAmount,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        }
      );
    }
    // Create payment with NowPayments
    let payment;
    try {
      payment = await nowPaymentsClient.createPayment({
        price_amount: parseFloat(authoritativeUsdAmount.toFixed(2)),
        price_currency: 'usd',
        pay_currency: crypto_type.toLowerCase(),
        order_id: orderReference,
        order_description: `Crypto sell order - ${crypto_amount} ${crypto_type}`,
        ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/nowpayments-webhook`,
        is_fixed_rate: true, // Lock rate for 20 minutes
        is_fee_paid_by_user: true, // User pays the NowPayments processing fee (prevents "partially_paid" status)
      });
    } catch (nowpaymentsError: any) {
      console.error('❌ NowPayments API error while creating crypto sell payment.');
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `crypto:PAYMENT_FAILED:${orderReference}`,
        userId: user.id,
        surface: 'crypto',
        revenueContext,
        metadata: {
          payment_reference: orderReference,
          idempotency_key: safeIdempotencyKey,
          crypto_type: crypto_type.toUpperCase(),
          crypto_amount: parseFloat(crypto_amount),
          naira_amount: serverNairaAmount,
          client_display_naira_amount: displayNairaAmount ? Number(displayNairaAmount) : null,
          network: network || null,
          provider: 'nowpayments',
          error: nowpaymentsError?.message || nowpaymentsError?.toString(),
        },
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to create crypto payment. Please try again or contact support.',
          error_details: nowpaymentsError?.message || nowpaymentsError?.toString(),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    // Save transaction to database
    const { data: transaction, error: dbError } = await supabaseClient
      .from('crypto_transactions')
      .insert({
        user_id: user.id,
        crypto_type: crypto_type.toUpperCase(),
        crypto_amount: parseFloat(crypto_amount),
        naira_amount: serverNairaAmount,
        exchange_rate: serverExchangeRate, // Required field
        deposit_address: payment.pay_address, // Required field
        expires_at: payment.expiration_estimate_date, // Required field
        rate: serverExchangeRate,
        status: 'pending',
        transaction_type: 'sell',
        payment_provider: 'nowpayments',
        
        // NowPayments fields
        nowpayments_payment_id: payment.payment_id,
        nowpayments_purchase_id: payment.purchase_id,
        nowpayments_pay_address: payment.pay_address,
        nowpayments_payin_extra_id: payment.payin_extra_id,
        nowpayments_network: network || payment.network,
        nowpayments_smart_contract: payment.smart_contract,
        nowpayments_amount_received: payment.amount_received,
        actually_paid: 0,
        outcome_amount: payment.pay_amount,
        outcome_currency: payment.pay_currency,
        payment_type: payment.type || 'crypto2crypto',
        burning_percent: payment.burning_percent,
        expiration_date: payment.expiration_estimate_date,
        fixed_rate_valid_until: payment.valid_until,
        
        payment_reference: orderReference,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to save transaction: ${dbError.message}`);
    }

    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_STARTED',
      eventId: `crypto:PAYMENT_STARTED:${orderReference}`,
      userId: user.id,
      surface: 'crypto',
      revenueContext,
      metadata: {
        transaction_id: transaction.id,
        payment_reference: orderReference,
        idempotency_key: safeIdempotencyKey,
        nowpayments_payment_id: payment.payment_id,
        nowpayments_purchase_id: payment.purchase_id,
        crypto_type: crypto_type.toUpperCase(),
        crypto_amount: parseFloat(crypto_amount),
        naira_amount: serverNairaAmount,
        client_display_naira_amount: displayNairaAmount ? Number(displayNairaAmount) : null,
        usd_amount: parseFloat(authoritativeUsdAmount.toFixed(2)),
        usd_to_ngn_rate: usdToNgn,
        usd_to_ngn_rate_source: usdToNgnSource,
        markup_percentage: 5,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
        network: network || payment.network || null,
        provider: 'nowpayments',
      },
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_ATTEMPTED',
      eventId: `crypto:PAYMENT_ATTEMPTED:${orderReference}`,
      userId: user.id,
      surface: 'crypto',
      revenueContext,
      metadata: {
        transaction_id: transaction.id,
        payment_reference: orderReference,
        idempotency_key: safeIdempotencyKey,
        nowpayments_payment_id: payment.payment_id,
        nowpayments_purchase_id: payment.purchase_id,
        crypto_type: crypto_type.toUpperCase(),
        crypto_amount: parseFloat(crypto_amount),
        naira_amount: serverNairaAmount,
        client_display_naira_amount: displayNairaAmount ? Number(displayNairaAmount) : null,
        usd_amount: parseFloat(authoritativeUsdAmount.toFixed(2)),
        usd_to_ngn_rate: usdToNgn,
        usd_to_ngn_rate_source: usdToNgnSource,
        markup_percentage: 5,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
        network: network || payment.network || null,
        provider: 'nowpayments',
      },
    });

    // Return payment details to frontend
    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        naira_amount: serverNairaAmount,
        usd_amount: parseFloat(authoritativeUsdAmount.toFixed(2)),
        usd_to_ngn_rate: usdToNgn,
        usd_to_ngn_rate_source: usdToNgnSource,
        markup_percentage: 5,
        payment_details: {
          payment_id: payment.payment_id,
          pay_address: payment.pay_address,
          pay_amount: payment.pay_amount,
          pay_currency: payment.pay_currency,
          payin_extra_id: payment.payin_extra_id, // Memo/Tag for XRP, XLM, EOS
          network: payment.network,
          smart_contract: payment.smart_contract,
          expiration_date: payment.expiration_estimate_date,
          payment_status: payment.payment_status,
          qr_code_data: `${payment.pay_currency}:${payment.pay_address}${payment.payin_extra_id ? `?dt=${payment.payin_extra_id}` : ''}`,
        },
        message: 'Payment created successfully. Send crypto to the provided address.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Error in create-crypto-sell-order:', error?.message || 'Unknown error');
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred',
        error_details: error?.toString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
