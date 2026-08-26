import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
};

function isAuthorizedCron(req: Request) {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('authorization') || '';
  if (serviceRole && auth === `Bearer ${serviceRole}`) return true;

  const cronSecret = Deno.env.get('SMM_CRON_SECRET') || Deno.env.get('REVENUE_OS_CRON_SECRET') || '';
  const providedSecret = req.headers.get('x-cron-secret') || '';
  return Boolean(cronSecret && providedSecret === cronSecret);
}

/**
 * SMM Order Status Checker (Cron Job)
 * 
 * Automatically polls the SMM panel for status updates on all active orders.
 * Handles auto-refunds for cancelled and partial orders.
 * 
 * Designed to run every 15 minutes via pg_cron.
 */

/**
 * Map panel status to our internal status
 */
function mapPanelStatus(panelStatus: string): string {
  const statusMap: Record<string, string> = {
    'Pending': 'pending',
    'In progress': 'in_progress',
    'Processing': 'processing',
    'Completed': 'completed',
    'Partial': 'partial',
    'Canceled': 'cancelled',
    'Cancelled': 'cancelled',
    'Refunded': 'cancelled',
    'Failed': 'failed',
  };

  return statusMap[panelStatus] || panelStatus.toLowerCase().replace(' ', '_');
}

async function recordRevenueEvent(
  supabaseAdmin: any,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    surface?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const eventType = sanitizeRevenueEventType('smm-check-all-orders', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('smm-check-all-orders', input.eventId),
    event_type: eventType,
    user_id: input.userId || null,
    surface: input.surface || 'social_boost',
    metadata: sanitizeRevenueMetadata(input.metadata || {}),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record SMM batch revenue event ${eventType}:`, error.message);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isAuthorizedCron(req)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // This function can be called by cron (with service role key) or by admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all active orders (pending, processing, in_progress) that have external_order_ids
    const { data: activeOrders, error: fetchError } = await supabaseAdmin
      .from('smm_orders')
      .select('id, user_id, reference, external_order_id, status, quantity, amount_ngn, link, service_id, created_at')
      .in('status', ['pending', 'processing', 'in_progress'])
      .not('external_order_id', 'is', null)
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch active orders: ${fetchError.message}`);
    }

    if (!activeOrders || activeOrders.length === 0) {
      console.log('No active SMM orders to check.');
      return new Response(
        JSON.stringify({ success: true, message: 'No active orders to check', checked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Checking ${activeOrders.length} active SMM orders...`);

    const smmClient = createSmmPanelClient();

    // Process orders in batches of 100 (panel API limit for multi-status)
    const BATCH_SIZE = 100;
    let totalChecked = 0;
    let totalUpdated = 0;
    let totalRefunded = 0;
    let totalRefundAmount = 0;
    const errors: string[] = [];

    for (let i = 0; i < activeOrders.length; i += BATCH_SIZE) {
      const batch = activeOrders.slice(i, i + BATCH_SIZE);
      const orderIds = batch.map(o => o.external_order_id).filter(Boolean);

      if (orderIds.length === 0) continue;

      try {
        // Use multi-status API for efficiency
        let statusResults: Record<string, any>;
        
        if (orderIds.length === 1) {
          // Single order — use single status endpoint
          const singleResult = await smmClient.getOrderStatus(orderIds[0]);
          statusResults = { [String(orderIds[0])]: singleResult };
        } else {
          // Multiple orders — use batch status endpoint
          statusResults = await smmClient.getMultipleOrderStatus(orderIds);
        }

        // Process each order's status
        for (const order of batch) {
          const externalId = String(order.external_order_id);
          const panelData = statusResults[externalId];

          if (!panelData || panelData.error) {
            console.warn(`No status data for SMM order: ${panelData?.error || 'missing'}`);
            continue;
          }

          totalChecked++;

          const newStatus = mapPanelStatus(panelData.status || 'pending');

          // Skip if status hasn't changed
          if (newStatus === order.status) continue;

          const isTerminal = newStatus === 'completed' || newStatus === 'partial' || newStatus === 'cancelled' || newStatus === 'failed';

          // Update order in database
          const updateData: Record<string, any> = {
            status: newStatus,
            start_count: panelData.start_count ? parseInt(panelData.start_count) : undefined,
            remains: panelData.remains ? parseInt(panelData.remains) : undefined,
            panel_response: panelData,
            updated_at: new Date().toISOString(),
          };

          // Remove undefined fields
          Object.keys(updateData).forEach(key => {
            if (updateData[key] === undefined) delete updateData[key];
          });

          if (isTerminal) {
            updateData.completed_at = new Date().toISOString();
          }

          await supabaseAdmin
            .from('smm_orders')
            .update(updateData)
            .eq('id', order.id);

          totalUpdated++;
          console.log(`SMM order status changed: ${order.status} -> ${newStatus}`);

          // Handle auto-refund for cancelled/partial/failed orders
          let refundAmount = 0;
          let refundMessage = '';

          if (newStatus === 'cancelled') {
            const panelCharge = parseFloat(panelData.charge || '0');
            if (panelCharge === 0) {
              // Full refund — panel charged nothing
              refundAmount = parseFloat(order.amount_ngn) || 0;
              refundMessage = `Auto-refund for cancelled SMM order (panel charge: $0)`;
            }
          } else if (newStatus === 'partial') {
            // Partial refund based on undelivered quantity
            const totalRemains = parseInt(panelData.remains || '0');
            if (totalRemains > 0 && order.quantity > 0) {
              const undeliveredRatio = totalRemains / order.quantity;
              refundAmount = Math.floor(parseFloat(order.amount_ngn) * undeliveredRatio);
              refundMessage = `Auto-refund for partial SMM order (${totalRemains}/${order.quantity} undelivered)`;
            }
          } else if (newStatus === 'failed') {
            // Full refund for failed orders
            refundAmount = parseFloat(order.amount_ngn) || 0;
            refundMessage = `Auto-refund for failed SMM order`;
          }

          if (refundAmount > 0) {
            // Check if refund was already issued (idempotency)
            const { data: existingRefund } = await supabaseAdmin
              .from('transactions')
              .select('id')
              .eq('reference', `REFUND-${order.reference}`)
              .eq('type', 'refund')
              .limit(1);

            if (!existingRefund || existingRefund.length === 0) {
              // Get current wallet balance
              const { data: userProfile } = await supabaseAdmin
                .from('profiles')
                .select('wallet_balance')
                .eq('id', order.user_id)
                .single();

              if (userProfile) {
                const currentWallet = parseFloat(userProfile.wallet_balance) || 0;
                const refundedBalance = currentWallet + refundAmount;

                // Credit wallet
                await supabaseAdmin
                  .from('profiles')
                  .update({
                    wallet_balance: refundedBalance,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', order.user_id);

                // Record refund transaction
                await supabaseAdmin.from('transactions').insert({
                  user_id: order.user_id,
                  type: 'refund',
                  amount: refundAmount,
                  balance_after: refundedBalance,
                  description: `${refundMessage}: ${order.reference}`,
                  reference: `REFUND-${order.reference}`,
                  status: 'completed',
                });

                totalRefunded++;
                totalRefundAmount += refundAmount;
                console.log(`Auto-refunded SMM order after ${newStatus} status.`);
              }
            }
          }

          if (['cancelled', 'failed', 'partial'].includes(newStatus)) {
            await recordRevenueEvent(supabaseAdmin, {
              eventType: 'PRODUCT_PURCHASE_REVERSED',
              eventId: `smm-check-all:PRODUCT_PURCHASE_REVERSED:${order.id}:${newStatus}`,
              userId: order.user_id,
              surface: 'social_boost',
              metadata: {
                order_id: order.id,
                reference: order.reference,
                external_order_id: order.external_order_id,
                previous_status: order.status,
                new_status: newStatus,
                refund_amount_ngn: refundAmount,
                reason: `panel_status_${newStatus}`,
              },
            });
          }
        }
      } catch (batchError) {
        const errorMsg = `Batch error (orders ${i}-${i + batch.length}): ${batchError.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < activeOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const summary = {
      success: true,
      message: `Checked ${totalChecked} orders, updated ${totalUpdated}, refunded ${totalRefunded}`,
      details: {
        total_active: activeOrders.length,
        checked: totalChecked,
        updated: totalUpdated,
        refunded: totalRefunded,
        refund_amount_ngn: totalRefundAmount,
        errors: errors.length > 0 ? errors : undefined,
      },
    };

    console.log('SMM Check All Orders Summary:', JSON.stringify(summary));

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('SMM Check All Orders Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
