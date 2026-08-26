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

// ── bitrefill-client.ts ──
/**
 * Bitrefill REST API Client (Personal API tier)
 * Docs: https://api.bitrefill.com/docs
 *
 * Auth: single Bearer token only (Personal API key). This client intentionally
 * does NOT support the Business API's Basic auth (API_ID + API_SECRET) flow —
 * TallyStore only uses a single Personal API key.
 */

const BITREFILL_API_URL = 'https://api.bitrefill.com/v2';

interface BitrefillConfig {
  apiKey: string;
}

export interface BitrefillProductPackage {
  package_id: string;
  value: number;
}

export interface BitrefillProductRange {
  min: number;
  max: number;
  step: number;
}

export interface BitrefillProduct {
  product_id: string;
  name: string;
  countries?: string[];
  currency?: string;
  recipient_type?: string;
  packages?: BitrefillProductPackage[];
  range?: BitrefillProductRange;
  [key: string]: any;
}

export interface BitrefillProductsResponse {
  data: BitrefillProduct[];
  meta?: { _next?: string | null };
}

export interface BitrefillInvoiceItem {
  product_id: string;
  package_id?: string;
  value?: number;
  quantity?: number;
  phone_number?: string;
}

export interface BitrefillCreateInvoiceParams {
  products: BitrefillInvoiceItem[];
  payment_method?: string; // 'balance' | 'bitcoin' | etc.
  refund_address?: string;
  webhook_url?: string;
  auto_pay?: boolean;
  email?: string;
}

export interface BitrefillInvoice {
  id: string;
  status: string; // unpaid | payment_detected | payment_confirmed | pending | complete | blocked | denied | payment_error
  orders?: Array<{ id: string; product_id: string }>;
  [key: string]: any;
}

export interface BitrefillOrder {
  id: string;
  status?: string;
  redemption_info?: {
    code?: string;
    link?: string;
    pin?: string;
    instructions?: string;
    expiration_date?: string;
  };
  [key: string]: any;
}

export interface BitrefillBalance {
  balance: number;
  currency: string;
}

export class BitrefillClient {
  private config: BitrefillConfig;

  constructor(config: BitrefillConfig) {
    this.config = config;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(`${BITREFILL_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bitrefill API error: ${response.status} - ${errorText}`);
    }

    // Some endpoints (e.g. /ping) may return empty bodies
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  /** Connectivity check -> { message: 'pong' } */
  async ping(): Promise<{ message: string }> {
    return this.makeRequest('/ping');
  }

  /** TallyStore's own Bitrefill merchant balance (used to pay invoices) */
  async getBalance(): Promise<BitrefillBalance> {
    return this.makeRequest('/accounts/balance');
  }

  /** Browse catalog, paginated */
  async listProducts(limit = 50, cursor?: string): Promise<BitrefillProductsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.makeRequest(`/products?${params.toString()}`);
  }

  /** Search catalog by query string */
  async searchProducts(query: string, limit = 50): Promise<BitrefillProductsResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.makeRequest(`/products/search?${params.toString()}`);
  }

  /** Fetch a single product's detail (denominations etc.) */
  async getProductDetails(productId: string): Promise<BitrefillProduct> {
    return this.makeRequest(`/products/${encodeURIComponent(productId)}`);
  }

  /** Create an invoice for one or more items (max 20 per invoice) */
  async createInvoice(params: BitrefillCreateInvoiceParams): Promise<BitrefillInvoice> {
    if (!params.products || params.products.length === 0) {
      throw new Error('At least one product is required to create an invoice');
    }
    if (params.products.length > 20) {
      throw new Error('A maximum of 20 items is allowed per invoice');
    }
    return this.makeRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        payment_method: 'balance',
        ...params,
      }),
    });
  }

  /** Pay an invoice that was not auto-paid */
  async payInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    return this.makeRequest(`/invoices/${encodeURIComponent(invoiceId)}/pay`, {
      method: 'POST',
    });
  }

  /** Get current invoice status */
  async getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    return this.makeRequest(`/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** List recent invoices */
  async listInvoices(limit = 20): Promise<{ data: BitrefillInvoice[] }> {
    return this.makeRequest(`/invoices?limit=${limit}`);
  }

  /** Get order detail, including redemption info once complete */
  async getOrder(orderId: string): Promise<BitrefillOrder> {
    return this.makeRequest(`/orders/${encodeURIComponent(orderId)}`);
  }
}

export function createBitrefillClient(config: BitrefillConfig): BitrefillClient {
  return new BitrefillClient(config);
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
  const eventType = sanitizeRevenueEventType('purchase-bitrefill', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('purchase-bitrefill', input.eventId),
    event_type: eventType,
    ...revenueContextEventColumns(input.revenueContext),
    user_id: input.userId || null,
    surface: input.surface || 'giftcards',
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
    }),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record Bitrefill revenue event ${eventType}:`, error.message);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Kill switch
    if (Deno.env.get('BITREFILL_ENABLED') === 'false') {
      throw new Error('Gift cards are temporarily disabled for maintenance. Please try again later.');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const {
      product_id,
      product_name,
      package_id,
      value, // for flexible-denomination products
      quantity = 1,
      recipient_phone,
      payment_source = 'wallet',
      idempotency_key,
      expected_amount_ngn,
      revenue_context,
    } = await req.json();
    const revenueContext = sanitizeRevenueRequestContext(revenue_context);

    if (!product_id || !product_name) {
      throw new Error('Missing required fields: product_id, product_name');
    }
    if (!package_id && !value) {
      throw new Error('Either package_id or value is required to select a denomination');
    }
    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }
    if (!['wallet', 'crypto'].includes(payment_source)) {
      throw new Error('Invalid payment_source. Must be "wallet" or "crypto"');
    }
    const expectedAmountNgn = parseFloat(expected_amount_ngn);
    if (!Number.isFinite(expectedAmountNgn) || expectedAmountNgn <= 0) {
      throw new Error('Current displayed price is required. Please refresh and try again.');
    }

    const qty = parseInt(quantity, 10) || 1;
    if (qty < 1 || qty > 20) {
      throw new Error('quantity must be between 1 and 20');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await assertPurchasingCustomer(supabaseAdmin, user.id);

    // Idempotency check
    const { data: existingOrder } = await supabaseClient
      .from('bitrefill_orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      console.log(`Idempotency hit: returning existing order ${existingOrder.id}`);
      return new Response(
        JSON.stringify({
          success: true,
          order: existingOrder,
          message: 'Order already processed',
          idempotency_hit: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Reject any product an admin has blocked via the catalog curation list
    // in AdminPage, even if the client has a stale/cached product_id from
    // before it was blocked.
    try {
      const { data: blockSetting } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', 'bitrefill_blocked_products')
        .single();
      if (blockSetting?.value) {
        const parsed = JSON.parse(blockSetting.value);
        if (Array.isArray(parsed) && parsed.some((p: { product_id: string }) => p.product_id === product_id)) {
          throw new Error('This product is no longer available.');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'This product is no longer available.') throw err;
      // no blocklist configured — nothing to check
    }

    const bitrefill = createBitrefillClient({ apiKey: Deno.env.get('BITREFILL_API_KEY') ?? '' });

    // Re-fetch the product to confirm the denomination/price server-side
    // (never trust a client-supplied price).
    const product = await bitrefill.getProductDetails(product_id);
    const currency = product.currency || 'USD';

    let unitPrice: number;
    const resolvedPackageId: string | undefined = package_id;

    if (package_id) {
      const pkg = product.packages?.find((p) => p.package_id === package_id);
      if (!pkg) throw new Error('Selected denomination is no longer available');
      unitPrice = pkg.value;
    } else {
      const numericValue = parseFloat(value);
      if (!product.range || numericValue < product.range.min || numericValue > product.range.max) {
        throw new Error('Selected amount is outside the allowed range for this product');
      }
      unitPrice = numericValue;
    }

    const totalOriginal = unitPrice * qty;

    // Apply optional admin markup (app_settings.bitrefill_markup_pct), defaults to 0
    let markupPct = 0;
    try {
      const { data: markupSetting } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', 'bitrefill_markup_pct')
        .single();
      if (markupSetting?.value) {
        const parsed = parseFloat(markupSetting.value);
        if (!isNaN(parsed) && parsed >= 0) markupPct = parsed;
      }
    } catch (_err) {
      // no markup configured, default to 0
    }

    const baseNgn = await convertToNgn(totalOriginal, currency, supabaseAdmin);
    const chargeNgn = Math.ceil(baseNgn * (1 + markupPct / 100));
    if (Math.abs(expectedAmountNgn - chargeNgn) > 1) {
      throw new Error(`Price changed from ₦${expectedAmountNgn.toLocaleString()} to ₦${chargeNgn.toLocaleString()}. Please refresh and try again.`);
    }

    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_STARTED',
      eventId: `bitrefill:PAYMENT_STARTED:${idempotency_key}`,
      userId: user.id,
      surface: 'giftcards',
      revenueContext,
      metadata: {
        product_id,
        product_name,
        package_id: resolvedPackageId || null,
        quantity: qty,
        amount_ngn: chargeNgn,
        expected_amount_ngn: expectedAmountNgn,
        amount_original: totalOriginal,
        currency,
        payment_source,
        idempotency_key,
      },
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_ATTEMPTED',
      eventId: `bitrefill:PAYMENT_ATTEMPTED:${idempotency_key}`,
      userId: user.id,
      surface: 'giftcards',
      revenueContext,
      metadata: {
        product_id,
        product_name,
        package_id: resolvedPackageId || null,
        quantity: qty,
        amount_ngn: chargeNgn,
        expected_amount_ngn: expectedAmountNgn,
        amount_original: totalOriginal,
        currency,
        payment_source,
        idempotency_key,
      },
    });

    // Determine balance column
    const balanceColumn = payment_source === 'wallet' ? 'wallet_balance' : 'crypto_balance';
    const balanceDisplayName = payment_source === 'wallet' ? 'TallyStore' : 'Crypto';

    const { data: userData, error: userFetchError } = await supabaseClient
      .from('profiles')
      .select(balanceColumn)
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      throw new Error('Failed to fetch user balance');
    }

    const currentBalance = parseFloat(userData?.[balanceColumn] || '0');
    if (currentBalance < chargeNgn) {
      throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${currentBalance.toLocaleString()}, Required: ₦${chargeNgn.toLocaleString()}`);
    }

    // Check TallyStore's own Bitrefill account balance can cover this purchase
    const bitrefillBalance = await bitrefill.getBalance();
    if (bitrefillBalance.balance < totalOriginal) {
      console.error(`[ADMIN ALERT] Bitrefill account balance too low. Have ${bitrefillBalance.balance} ${bitrefillBalance.currency}, need ${totalOriginal} ${currency}`);
      throw new Error('Gift cards are temporarily unavailable. Please try again later or contact support.');
    }

    const reference = `TALLY-GIFT-${Date.now()}-${user.id.substring(0, 8)}`;

    // Create pending order record
    const { data: orderRecord, error: dbError } = await supabaseClient
      .from('bitrefill_orders')
      .insert({
        user_id: user.id,
        reference,
        idempotency_key,
        product_id,
        product_name,
        package_id: resolvedPackageId || null,
        quantity: qty,
        recipient_phone: recipient_phone || null,
        amount_ngn: chargeNgn,
        amount_original: totalOriginal,
        currency,
        payment_source,
        status: 'pending',
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to create order record: ${dbError.message}`);
    }

    // Deduct from user's balance with optimistic locking
    let balanceDeducted = false;
    for (let attempt = 0; attempt < 5 && !balanceDeducted; attempt++) {
      const { data: freshUserData } = await supabaseAdmin
        .from('profiles')
        .select(balanceColumn)
        .eq('id', user.id)
        .single();

      const actualCurrentBalance = parseFloat(freshUserData?.[balanceColumn] || '0');

      if (actualCurrentBalance < chargeNgn) {
        await supabaseAdmin.from('bitrefill_orders').delete().eq('id', orderRecord.id);
        throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${actualCurrentBalance.toLocaleString()}, Required: ₦${chargeNgn.toLocaleString()}`);
      }

      const { data: updateData, error: balanceError } = await supabaseAdmin
        .from('profiles')
        .update({ [balanceColumn]: actualCurrentBalance - chargeNgn })
        .eq('id', user.id)
        .eq(balanceColumn, actualCurrentBalance)
        .select()
        .single();

      if (balanceError) {
        console.warn(`Balance deduction conflict on attempt ${attempt + 1}, retrying...`);
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }

      if (updateData) {
        balanceDeducted = true;
      } else {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }

    if (!balanceDeducted) {
      await supabaseAdmin.from('bitrefill_orders').delete().eq('id', orderRecord.id);
      throw new Error('Failed to deduct balance after multiple attempts. Please try again.');
    }

    // Buy from Bitrefill using TallyStore's own Bitrefill account balance
    try {
      const invoice = await bitrefill.createInvoice({
        products: [
          {
            product_id,
            package_id: resolvedPackageId,
            value: resolvedPackageId ? undefined : unitPrice,
            quantity: qty,
            phone_number: recipient_phone || undefined,
          },
        ],
        payment_method: 'balance',
        auto_pay: true,
      });

      let finalStatus = 'pending';
      let redemption: any = null;
      const orderId = invoice.orders?.[0]?.id;

      if (invoice.status === 'complete' && orderId) {
        const orderDetail = await bitrefill.getOrder(orderId);
        redemption = orderDetail.redemption_info || null;
        finalStatus = 'successful';
      } else if (['blocked', 'denied', 'payment_error'].includes(invoice.status)) {
        finalStatus = 'failed';
      }
      // otherwise leave as 'pending' — a webhook/poll can resolve this later

      await supabaseClient
        .from('bitrefill_orders')
        .update({
          status: finalStatus,
          bitrefill_invoice_id: invoice.id,
          bitrefill_order_id: orderId || null,
          bitrefill_response: invoice,
          redemption_code: redemption?.code || null,
          redemption_link: redemption?.link || null,
          redemption_pin: redemption?.pin || null,
          redemption_instructions: redemption?.instructions || null,
          redemption_expiration: redemption?.expiration_date || null,
          completed_at: finalStatus === 'successful' ? new Date().toISOString() : null,
        })
        .eq('id', orderRecord.id);

      if (finalStatus === 'failed') {
        // Refund — Bitrefill rejected the purchase
        const refundedBalance = await refundBalance(supabaseAdmin, user.id, balanceColumn, chargeNgn);
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PAYMENT_FAILED',
          eventId: `bitrefill:PAYMENT_FAILED:${idempotency_key}`,
          userId: user.id,
          surface: 'giftcards',
          revenueContext,
          metadata: {
            order_id: orderRecord.id,
            reference,
            product_id,
            product_name,
            package_id: resolvedPackageId || null,
            amount_ngn: chargeNgn,
            amount_original: totalOriginal,
            currency,
            payment_source,
            provider_status: invoice.status,
          },
        });
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PRODUCT_PURCHASE_REVERSED',
          eventId: `bitrefill:PRODUCT_PURCHASE_REVERSED:${idempotency_key}`,
          userId: user.id,
          surface: 'giftcards',
          revenueContext,
          metadata: {
            order_id: orderRecord.id,
            reference,
            product_id,
            product_name,
            amount_ngn: chargeNgn,
            balance_after: refundedBalance,
            reason: 'provider_declined',
          },
        });
        return new Response(
          JSON.stringify({
            success: false,
            order_id: orderRecord.id,
            reference,
            status: finalStatus,
            error: 'Purchase was declined by the provider. Your balance has been refunded.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_COMPLETED',
        eventId: `bitrefill:PAYMENT_COMPLETED:${idempotency_key}`,
        userId: user.id,
        surface: 'giftcards',
        revenueContext,
        metadata: {
          order_id: orderRecord.id,
          reference,
          product_id,
          product_name,
          package_id: resolvedPackageId || null,
          bitrefill_invoice_id: invoice.id,
          bitrefill_order_id: orderId || null,
          amount_ngn: chargeNgn,
          amount_original: totalOriginal,
          currency,
          payment_source,
          status: finalStatus,
        },
      });
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASED',
        eventId: `bitrefill:PRODUCT_PURCHASED:${idempotency_key}`,
        userId: user.id,
        surface: 'giftcards',
        revenueContext,
        metadata: {
          order_id: orderRecord.id,
          reference,
          product_id,
          product_name,
          package_id: resolvedPackageId || null,
          bitrefill_invoice_id: invoice.id,
          bitrefill_order_id: orderId || null,
          amount_ngn: chargeNgn,
          amount_original: totalOriginal,
          currency,
          payment_source,
          status: finalStatus,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          order_id: orderRecord.id,
          reference,
          status: finalStatus,
          product_name,
          amount_ngn: chargeNgn,
          payment_source,
          redemption,
          message: finalStatus === 'successful' ? 'Purchase successful' : 'Purchase is being processed',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );

    } catch (purchaseError: unknown) {
      const errorMessage = purchaseError instanceof Error ? purchaseError.message : 'Unknown purchase error';
      console.error('Bitrefill purchase failed:', errorMessage);

      await supabaseClient
        .from('bitrefill_orders')
        .update({
          status: 'failed',
          bitrefill_response: { error: errorMessage },
        })
        .eq('id', orderRecord.id);

      const refundedBalance = await refundBalance(supabaseAdmin, user.id, balanceColumn, chargeNgn);
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `bitrefill:PAYMENT_FAILED:${idempotency_key}`,
        userId: user.id,
        surface: 'giftcards',
        revenueContext,
        metadata: {
          order_id: orderRecord.id,
          reference,
          product_id,
          product_name,
          package_id: resolvedPackageId || null,
          amount_ngn: chargeNgn,
          amount_original: totalOriginal,
          currency,
          payment_source,
          error: errorMessage,
        },
      });
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASE_REVERSED',
        eventId: `bitrefill:PRODUCT_PURCHASE_REVERSED:${idempotency_key}`,
        userId: user.id,
        surface: 'giftcards',
        revenueContext,
        metadata: {
          order_id: orderRecord.id,
          reference,
          product_id,
          product_name,
          amount_ngn: chargeNgn,
          balance_after: refundedBalance,
          reason: 'provider_purchase_error',
        },
      });

      throw new Error(`Purchase failed: ${errorMessage}`);
    }

  } catch (error) {
    console.error('Error in purchase-bitrefill:', error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'An unexpected error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});

async function refundBalance(supabaseAdmin: any, userId: string, balanceColumn: string, amount: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: currentUserData } = await supabaseAdmin
      .from('profiles')
      .select(balanceColumn)
      .eq('id', userId)
      .single();

    const currentBal = parseFloat(currentUserData?.[balanceColumn] || '0');
    const refundedBalance = currentBal + amount;

    const { data: refundData } = await supabaseAdmin
      .from('profiles')
      .update({ [balanceColumn]: refundedBalance })
      .eq('id', userId)
      .eq(balanceColumn, currentBal)
      .select()
      .single();

    if (refundData) {
      console.log('Bitrefill purchase refunded after provider failure.');
      return refundedBalance;
    }
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
  console.error('[ADMIN ALERT] Failed to refund Bitrefill purchase after multiple attempts');
  throw new Error('Refund could not be credited. Please contact support.');
}
