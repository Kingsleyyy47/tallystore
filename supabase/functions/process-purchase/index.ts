import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { ngnMinorUnits } from '../_shared/ngn-amount.mjs';
import { authenticateCustomerRequest } from '../_shared/customer-api-delegation.ts';
import { configuredSuppliers, fulfillSupplierShortfall } from '../_shared/supplier-purchase.mjs';

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

async function recordRevenueEvent(
  supabaseAdmin: any,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    productGroupId?: string | null;
    categoryId?: string | null;
    surface?: string;
    experimentId?: string | null;
    variantId?: string | null;
    revenueContext?: RevenueRequestContext | null;
    metadata?: Record<string, unknown>;
  }
) {
  if (!supabaseAdmin) return;

  const validEventType = sanitizeRevenueEventType('process-purchase', input.eventType)
  if (!validEventType) return;

  const { error } = await supabaseAdmin
    .from('revenue_events')
    .upsert({
      event_id: await sanitizeRevenueEventId('process-purchase', input.eventId),
    event_type: validEventType,
    ...revenueContextEventColumns(input.revenueContext),
    user_id: input.userId || null,
      product_group_id: input.productGroupId || null,
      category_id: input.categoryId || null,
      surface: input.surface || 'server_purchase',
      experiment_id: input.experimentId || null,
      variant_id: input.variantId || null,
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
    }),
    }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`⚠️ Failed to record revenue event ${input.eventType}:`, error);
  }
}

function cleanOptionalText(value: unknown, maxLength = 120) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

const customerPurchaseErrors = new Set([
  'Missing authorization header',
  'Unauthorized',
  'This device or network has been blocked from purchasing. Please contact support.',
  'Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.',
  'Purchasing is paused while this wallet is under security review. Please contact support.',
  'Insufficient verified funds for purchase',
  'Invalid request: product_group_id and whole-number quantity (>= 1) required',
  'Maximum purchase quantity is 500 accounts per checkout.',
  'Valid idempotency_key required',
  'Current displayed price is required. Please refresh and try again.',
  'Product not found',
  'Product is no longer available for purchase',
  'Product is currently out of stock',
  'Product has an invalid customer price',
  "Discount codes can't be combined with the bulk quantity discount already applied to this order.",
  'Invalid or expired discount code',
  'Discount codes are temporarily unavailable',
  'This discount code has expired',
  'This discount code has reached its usage limit',
  'This discount code is not valid for this product',
  'This discount code is not valid for this category',
  'This discount code is not valid for your account',
  'Selected account is no longer available',
  'Referral pricing could not be verified. Please retry.',
  'Supplier stock is unavailable. Your wallet has not been charged.',
  'Your order is awaiting supplier confirmation. Do not place it again; contact support with your order ID.',
])

function publicPurchaseError(message: string) {
  if (customerPurchaseErrors.has(message)) return message
  if (message.startsWith('INSUFFICIENT_STOCK:')) {
    return 'INSUFFICIENT_STOCK: Not enough accounts are available. Please try a smaller quantity.'
  }
  if (message.startsWith('Price changed from ₦')) return 'Price changed. Please refresh and try again.'
  if (message.startsWith('Insufficient verified funds. Required: ₦')) return 'Insufficient verified funds for purchase'
  if (message.startsWith('This code is only valid for orders up to ₦')) {
    return 'This discount code does not apply to this order.'
  }
  if (message.includes('discount_code_unavailable') || message.includes('discount_code_capacity_exhausted')) {
    return 'Invalid or expired discount code'
  }
  if (message.includes('discount_order_amount_invalid')) {
    return 'Price changed. Please refresh and try again.'
  }
  if (message.includes('WALLET_UNBACKED_FUNDS') || message.includes('WALLET_REVIEW_REQUIRED') ||
      message.includes('wallet_review_required') || message.includes('product_purchase_wallet_not_active')) {
    return 'Purchasing is paused while this wallet is under security review. Please contact support.'
  }
  if (message.includes('insufficient_trusted_available_funds')) {
    return 'Insufficient verified funds for purchase'
  }
  if (message.includes('financial_state_unavailable') || message.includes('Could not verify wallet funds for purchase')) {
    return 'Wallet verification is temporarily unavailable. Please try again later.'
  }
  return 'Purchase is temporarily unavailable. Please try again or contact support.'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabaseAdmin: any = null;
  const revenueContext: {
    userId?: string | null;
    productGroupId?: string | null;
    categoryId?: string | null;
    idempotencyKey?: string | null;
    requestContext?: RevenueRequestContext | null;
  } = {};
  let authorizedOrderContext: {
    orderId: string;
    reservationId: string;
    productGroupId: string;
    userId: string;
    supplier: boolean;
  } | null = null;

  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const user = await authenticateCustomerRequest(req, supabaseAdmin, 'products', 'process-purchase');
    await assertPurchasingCustomer(supabaseAdmin, user.id, req);
    revenueContext.userId = user.id;

    // Parse request body
    const {
      product_group_id,
      quantity: requested_quantity,
      idempotency_key,
      discount_code,
      cro_context,
      revenue_context,
      preferred_account_id,
      expected_amount_ngn,
    } = await req.json();
    const revenueRequestContext = sanitizeRevenueRequestContext(revenue_context);
    const walletRequestForensics = await getWalletRequestForensics(req, 'process-purchase');
    revenueContext.requestContext = revenueRequestContext;
    revenueContext.productGroupId = product_group_id;
    revenueContext.idempotencyKey = idempotency_key;
    const croContext = cro_context && typeof cro_context === 'object'
      ? {
          experimentId: cleanOptionalText(cro_context.experimentId),
      variantId: cleanOptionalText(cro_context.variantId),
      assignmentMode: cleanOptionalText(cro_context.assignmentMode, 40),
    }
      : { experimentId: null, variantId: null, assignmentMode: null }

    // Validate inputs
    const quantity = Number(requested_quantity);
    if (!product_group_id || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Invalid request: product_group_id and whole-number quantity (>= 1) required');
    }
    if (quantity > 500) {
      throw new Error('Maximum purchase quantity is 500 accounts per checkout.');
    }

    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key required');
    }
    const expectedAmountMinor = ngnMinorUnits(expected_amount_ngn);
    if (expectedAmountMinor === null) {
      throw new Error('Current displayed price is required. Please refresh and try again.');
    }
    const expectedAmountNgn = expectedAmountMinor / 100;

    const preferredAccountId = typeof preferred_account_id === 'string' && preferred_account_id.trim()
      ? preferred_account_id.trim()
      : null;

    // Check idempotency - prevent duplicate purchases
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id, amount, status, created_at, product_group_id, account_details, wallet_reservation_id, financial_authorization_status, financial_security_version')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      const existingDetails = existingOrder.account_details && typeof existingOrder.account_details === 'object'
        ? existingOrder.account_details as Record<string, unknown>
        : {};
      const existingQuantity = Number(existingDetails.quantity || 0);
      const existingAmountMinor = ngnMinorUnits(existingOrder.amount);
      const sameRequest =
        String(existingOrder.product_group_id || '') === product_group_id &&
        existingQuantity === quantity &&
        existingAmountMinor === expectedAmountMinor;

      if (!sameRequest) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This idempotency key was already used for a different purchase request.',
            code: 'IDEMPOTENCY_REQUEST_CONFLICT',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }

      if (String(existingOrder.status || '').toLowerCase() === 'completed') {
        console.log('Purchase idempotency hit: returning completed order.');
        return new Response(
          JSON.stringify({
            success: true,
            order_id: existingOrder.id,
            amount: existingOrder.amount,
            status: existingOrder.status,
            message: 'Order already processed',
            idempotency_hit: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (['cancelled', 'canceled', 'failed'].includes(String(existingOrder.status || '').toLowerCase())) {
        return new Response(JSON.stringify({ success: false, order_id: existingOrder.id, code: 'PURCHASE_CLOSED', error: 'This purchase attempt is closed. Please refresh before placing another order.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (existingOrder.financial_authorization_status === 'outcome_unknown') {
        return new Response(JSON.stringify({ success: false, order_id: existingOrder.id, code: 'SUPPLIER_CONFIRMATION_PENDING', error: 'Your order is awaiting supplier confirmation. Do not place it again; contact support with your order ID.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!existingOrder.wallet_reservation_id) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This purchase attempt needs admin review before it can be retried.',
            code: 'PURCHASE_AUTHORIZATION_INCOMPLETE',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }

      console.log('Purchase idempotency hit: resuming reserve-first authorization.');
    }

    // If a previous attempt debited the wallet but failed before creating the
    // order, do not let a retry replay that old debit into a fresh credential
    // delivery. Those cases need manual repair because a rollback refund may
    // already have been issued.
    const { data: orphanedPurchaseTx, error: orphanedPurchaseError } = await supabaseAdmin
      .from('transactions')
      .select('id, amount, status, balance_after, created_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', `purchase:${idempotency_key}`)
      .maybeSingle();

    if (orphanedPurchaseError) {
      throw new Error('Could not verify purchase idempotency state');
    }

    if (orphanedPurchaseTx) {
      console.error('Blocked orphaned purchase ledger retry without matching order.', {
        transaction_id: orphanedPurchaseTx.id,
        idempotency_key,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'This purchase attempt needs admin review before it can be retried.',
          code: 'PURCHASE_LEDGER_ORPHANED',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    console.log(`Processing purchase for ${quantity} item(s).`);

    // 1. Get product group details
    const { data: productGroup, error: productError } = await supabaseAdmin
      .from('product_groups')
      .select('*, categories(name)')
      .eq('id', product_group_id)
      .single();

    if (productError || !productGroup) {
      throw new Error('Product not found');
    }
    const unitPriceMinor = ngnMinorUnits(productGroup.price);
    const unitPrice = unitPriceMinor === null ? 0 : unitPriceMinor / 100;
    if (productGroup.is_active === false) {
      throw new Error('Product is no longer available for purchase');
    }
    const availabilityStatus = String(productGroup.availability_status || '').toUpperCase();
    if (!existingOrder && (productGroup.is_sellable === false || ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus))) {
      throw new Error('Product is currently out of stock');
    }
    if (unitPriceMinor === null || !Number.isSafeInteger(unitPriceMinor * quantity)) {
      throw new Error('Product has an invalid customer price');
    }
    const liveAccountFulfillmentEnabled = Deno.env.get('LIVE_ACCOUNT_FULFILLMENT_ENABLED') === 'true';
    const suppliers = configuredSuppliers(productGroup, (name: string) => Deno.env.get(name));
    const productHasLiveProvider = Boolean(
      liveAccountFulfillmentEnabled && productGroup.supplier_fallback_ready === true && !productGroup.supplier_fallback_blocked && suppliers.length > 0,
    );
    revenueContext.categoryId = productGroup.category_id;

    // Discount codes are enabled. Quantity-tier bulk discounts remain off for now.
    // Mirrors DISCOUNTS_ENABLED in src/lib/supabase.ts — keep both in sync.
    const DISCOUNTS_ENABLED = true;

    // Calculate the authoritative charge before any provider auto-fulfillment.
    // This prevents a stale checkout page from triggering live stock purchases
    // before we know the customer accepted the current server-side price.
    const tiers: Array<{ min_qty: number; discount_pct: number }> = DISCOUNTS_ENABLED && Array.isArray(productGroup.quantity_discount_tiers)
      ? productGroup.quantity_discount_tiers
      : [];
    const originalTotalMinor = unitPriceMinor * quantity;
    const originalTotal = originalTotalMinor / 100;
    const applicableTier = tiers
      .filter((t) => Number(t.min_qty) >= 2 && quantity >= Number(t.min_qty))
      .sort((a, b) => b.discount_pct - a.discount_pct)[0];
    const discountPct = applicableTier ? Math.min(Math.max(applicableTier.discount_pct, 0), 100) : 0;
    let totalPriceMinor = discountPct > 0
      ? Math.round(originalTotal * (1 - discountPct / 100)) * 100
      : originalTotalMinor;
    let totalPrice = totalPriceMinor / 100;

    let appliedDiscountCode: { id: string; code: string } | null = null;
    if (DISCOUNTS_ENABLED && discount_code && typeof discount_code === 'string' && discount_code.trim()) {
      const { data: discountCapacityVersion, error: discountCapacityError } =
        await supabaseAdmin.rpc('discount_code_capacity_version');
      if (discountCapacityError || discountCapacityVersion !== 1) {
        throw new Error('Discount codes are temporarily unavailable');
      }
      if (discountPct > 0) {
        throw new Error('Discount codes can\'t be combined with the bulk quantity discount already applied to this order.');
      }
      const { data: codeRow } = await supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', discount_code.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (!codeRow) {
        throw new Error('Invalid or expired discount code');
      }
      if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
        throw new Error('This discount code has expired');
      }
      if (codeRow.max_uses && codeRow.used_count >= codeRow.max_uses) {
        throw new Error('This discount code has reached its usage limit');
      }
      if (codeRow.product_group_id && codeRow.product_group_id !== product_group_id) {
        throw new Error('This discount code is not valid for this product');
      }
      if (codeRow.category_id && !codeRow.product_group_id && codeRow.category_id !== productGroup.category_id) {
        throw new Error('This discount code is not valid for this category');
      }
      if (codeRow.user_id && codeRow.user_id !== user.id) {
        throw new Error('This discount code is not valid for your account');
      }
      if (codeRow.max_order_amount && totalPrice > codeRow.max_order_amount) {
        throw new Error(`This code is only valid for orders up to ₦${codeRow.max_order_amount.toLocaleString()}`);
      }

      const codePct = Math.min(Math.max(codeRow.percent_off, 0), 100);
      totalPriceMinor = Math.round(totalPrice * (1 - codePct / 100)) * 100;
      totalPrice = totalPriceMinor / 100;
      appliedDiscountCode = { id: codeRow.id, code: codeRow.code };
    }
    const { data: qualifiedReferrals, error: circleStatusError } = await supabaseAdmin.rpc(
      'tally_circle_qualified_count',
      { p_user_id: user.id },
    );
    if (circleStatusError || !Number.isInteger(qualifiedReferrals) || qualifiedReferrals < 0) {
      throw new Error('Referral pricing could not be verified. Please retry.');
    }
    const circleDiscountPercent = qualifiedReferrals >= 5 ? 3 : 0;
    const beforeCircleDiscountMinor = totalPriceMinor;
    if (circleDiscountPercent > 0) {
      totalPriceMinor = Math.round(totalPriceMinor * 97 / 100);
      totalPrice = totalPriceMinor / 100;
    }
    const circleDiscountAmount = (beforeCircleDiscountMinor - totalPriceMinor) / 100;
    if (!Number.isSafeInteger(totalPriceMinor) || totalPriceMinor <= 0) {
      throw new Error('Product has an invalid customer price');
    }
    if (expectedAmountMinor !== totalPriceMinor) {
      throw new Error(`Price changed from ₦${expectedAmountNgn.toLocaleString()} to ₦${totalPrice.toLocaleString()}. Please refresh and try again.`);
    }

    await assertPurchasingCustomer(supabaseAdmin, user.id, req, totalPrice);

    const purchaseEventMetadata = {
      product_group_id,
      category_id: productGroup.category_id,
      product_name: productGroup.name,
      quantity,
      price_per_unit: unitPrice,
      amount_ngn: totalPrice,
      original_amount_ngn: originalTotal,
      discount_code: discount_code || null,
      idempotency_key,
      preferred_account_id: preferredAccountId,
      expected_amount_ngn: expectedAmountNgn,
      experiment_id: croContext.experimentId,
      variant_id: croContext.variantId,
      assignment_mode: croContext.assignmentMode,
    };
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_STARTED',
      eventId: `server:PAYMENT_STARTED:${idempotency_key}`,
      userId: user.id,
      productGroupId: product_group_id,
      categoryId: productGroup.category_id,
      surface: 'checkout',
      experimentId: croContext.experimentId,
      variantId: croContext.variantId,
      revenueContext: revenueRequestContext,
      metadata: purchaseEventMetadata,
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_ATTEMPTED',
      eventId: `server:PAYMENT_ATTEMPTED:${idempotency_key}`,
      userId: user.id,
      productGroupId: product_group_id,
      categoryId: productGroup.category_id,
      surface: 'checkout',
      experimentId: croContext.experimentId,
      variantId: croContext.variantId,
      revenueContext: revenueRequestContext,
      metadata: purchaseEventMetadata,
    });

    // Reserve trusted funds and inventory atomically. This database boundary
    // never trusts profiles.wallet_balance as purchase authority and creates
    // no credential-bearing response before the hold is committed.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('financial_security_version')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch financial authorization state');
    }

    const requestedSecurityVersion = Math.max(
      1,
      Number(profile.financial_security_version || 1),
    );
    const authorizationMetadata = {
      source: 'process-purchase',
      request_forensics: walletRequestForensics,
      product_group_id,
      product_name: productGroup.name,
      quantity,
      unit_price: unitPrice,
      original_amount_ngn: originalTotal,
      charged_amount_ngn: totalPrice,
      discount_code_id: appliedDiscountCode?.id || null,
      tally_circle_discount_percent: circleDiscountPercent,
      tally_circle_discount_amount_ngn: circleDiscountAmount,
      expected_amount_ngn: expectedAmountNgn,
      category_id: productGroup.category_id,
      supplier_configured_providers: suppliers.map((supplier: any) => supplier.name),
    };

    const authorizationArgs = {
        p_user_id: user.id,
        p_product_group_id: product_group_id,
        p_quantity: quantity,
        p_amount: totalPrice,
        p_idempotency_key: idempotency_key,
        p_order_metadata: authorizationMetadata,
        p_preferred_account_id: preferredAccountId,
        p_financial_security_version: requestedSecurityVersion,
    };
    const existingSupplierOrder = (existingOrder?.account_details as any)?.financial_authorization === 'supplier_reserve_first';
    let { data: authorization, error: authorizationError } = await supabaseAdmin.rpc(
      existingSupplierOrder ? 'authorize_supplier_product_purchase' : 'authorize_product_purchase',
      existingSupplierOrder ? Object.fromEntries(Object.entries(authorizationArgs).filter(([key]) => key !== 'p_preferred_account_id')) : authorizationArgs,
    );
    if (!authorizationError && authorization?.code === 'INSUFFICIENT_STOCK' && productHasLiveProvider && !preferredAccountId) {
      if (quantity > 100) throw new Error('INSUFFICIENT_STOCK: Supplier orders support at most 100 accounts.');
      ({ data: authorization, error: authorizationError } = await supabaseAdmin.rpc('authorize_supplier_product_purchase', Object.fromEntries(Object.entries(authorizationArgs).filter(([key]) => key !== 'p_preferred_account_id'))));
      // Local stock may have been replenished between the two authorizations.
      if (!authorizationError && authorization?.code === 'LOCAL_STOCK_AVAILABLE') {
        ({ data: authorization, error: authorizationError } = await supabaseAdmin.rpc('authorize_product_purchase', authorizationArgs));
      }
    }

    if (authorizationError) {
      throw new Error(authorizationError.message || 'Product financial authorization failed');
    }

    const authorizationResult = authorization as any;
    if (!authorizationResult?.success) {
      const code = String(authorizationResult?.code || '');
      if (code === 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS') {
        throw new Error(`Insufficient verified funds. Required: ₦${totalPrice.toLocaleString()}`);
      }
      if (code === 'INSUFFICIENT_STOCK') {
        throw new Error(`INSUFFICIENT_STOCK: Only ${authorizationResult.available || 0} account(s) available for ${productGroup.name}. You requested ${quantity}.`);
      }
      if (code === 'PREFERRED_ACCOUNT_UNAVAILABLE') {
        throw new Error('Selected account is no longer available');
      }
      throw new Error(authorizationResult.error || 'Product financial authorization failed');
    }

    const orderId = String(authorizationResult.order_id || '');
    const reservationId = String(authorizationResult.reservation_id || '');
    let accountIds = Array.isArray(authorizationResult.account_ids)
      ? authorizationResult.account_ids.map((id: unknown) => String(id)).filter(Boolean)
      : [];

    if (!orderId || !reservationId) {
      throw new Error('Product authorization returned incomplete reservation evidence');
    }
    const supplierQuantity = Number(authorizationResult.supplier_quantity || 0);
    authorizedOrderContext = {
      orderId,
      reservationId,
      productGroupId: product_group_id,
      userId: user.id,
      supplier: supplierQuantity > 0 || existingSupplierOrder,
    };
    if (supplierQuantity > 0 && accountIds.length < quantity) {
      if (!liveAccountFulfillmentEnabled || suppliers.length === 0) throw new Error('Supplier fulfillment is currently paused');
      const fulfillment = await fulfillSupplierShortfall(supabaseAdmin, { orderId, reservationId, quantity: supplierQuantity, product: productGroup, suppliers, idempotencyKey: idempotency_key, allowPaidSend: Deno.env.get('LIVE_ACCOUNT_FULFILLMENT_ENABLED') === 'true' });
      if (fulfillment.outcome === 'exhausted') {
        const { data: cancellation, error: cancelError } = await supabaseAdmin.rpc('cancel_exhausted_supplier_purchase', { p_order_id: orderId, p_reservation_id: reservationId });
        if (cancelError || !cancellation?.success) throw new Error('Supplier rejection requires reconciliation');
        authorizedOrderContext = null;
        throw new Error('Supplier stock is unavailable. Your wallet has not been charged.');
      }
      if (fulfillment.outcome !== 'succeeded') {
        await supabaseAdmin.rpc('block_supplier_product_fallback', { p_product_group_id: product_group_id });
        return new Response(JSON.stringify({ success: false, order_id: orderId, code: 'SUPPLIER_CONFIRMATION_PENDING', error: 'Your order is awaiting supplier confirmation. Do not place it again; contact support with your order ID.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      accountIds = fulfillment.accountIds;
    }
    if (!Array.isArray(accountIds) || accountIds.length !== quantity) throw new Error('Product authorization returned incomplete inventory evidence');

    const { data: purchasedAccounts, error: purchasedAccountsError } = await supabaseAdmin
      .from('individual_accounts')
      .select('*')
      .in('id', accountIds)
      .eq('status', 'reserved');

    if (purchasedAccountsError || !purchasedAccounts || purchasedAccounts.length !== quantity) {
      throw new Error('Reserved product inventory could not be loaded for completion');
    }

    // Credentials are assembled only after the database has committed the
    // reservation. The completion RPC then captures the hold, writes these
    // credentials, and marks the reserved inventory sold atomically.
    const accountDetails = {
      accounts: purchasedAccounts.map((acc: any) => ({
        username: acc.username,
        password: acc.password,
        email: acc.email,
        email_password: acc.email_password,
        two_fa_code: acc.two_fa_code,
        recovery_email: acc.recovery_email,
        recovery_email_password: acc.recovery_email_password,
        additional_info: acc.additional_info,
      })),
      product_name: productGroup.name,
      category: productGroup.categories?.name,
      quantity,
      price_per_unit: unitPrice,
      expected_amount_ngn: expectedAmountNgn,
      original_amount_ngn: originalTotal,
      charged_amount_ngn: totalPrice,
      discount_pct: discountPct,
      discount_code: appliedDiscountCode?.code || null,
      tally_circle_discount_percent: circleDiscountPercent,
      tally_circle_discount_amount_ngn: circleDiscountAmount,
    };

    const { data: completion, error: completionError } = await supabaseAdmin.rpc(
      'complete_product_purchase',
      {
        p_user_id: user.id,
        p_order_id: orderId,
        p_reservation_id: reservationId,
        p_account_ids: accountIds,
        p_account_details: accountDetails,
        p_capture_idempotency_key: `purchase:${idempotency_key}`,
        p_reference: `PUR-${idempotency_key.substring(0, 24)}`,
        p_description: `Purchase: ${quantity}x ${productGroup.name}`,
        p_created_by: null,
      },
    );

    if (completionError) {
      throw new Error(completionError.message || 'Product completion failed');
    }

    const completionResult = completion as any;
    if (!completionResult?.success) {
      throw new Error(completionResult?.error || 'Product completion failed');
    }

    const newBalance = Number(completionResult.balance_after ?? 0);
    const order = {
      id: orderId,
      amount: totalPrice,
      status: 'completed',
      account_details: completionResult.account_details || accountDetails,
    };

    // Discount capacity is reserved by the order insert and consumed by the
    // completed-order update in the same database transactions.

    // 6b. Auto-reward: purchases with an original value of ₦100,000+ earn a
    //     personalised 20%-off code valid on any next order up to ₦12,000.
    //     Generated AFTER the order is committed so a rollback never issues one.
    //     Failures are non-fatal — the purchase is already complete.
    const REWARD_THRESHOLD = 100_000;
    const REWARD_PERCENT_OFF = 20;
    const REWARD_MAX_ORDER = 12_000;
    let rewardCode: string | null = null;
    if (originalTotal >= REWARD_THRESHOLD) {
      try {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0 or I/1 confusion
        const rand = Array.from({ length: 8 }, () =>
          chars[Math.floor(Math.random() * chars.length)]
        ).join('');
        const code = `REWARD-${rand}`;
        const { error: rewardError } = await supabaseAdmin
          .from('discount_codes')
          .insert({
            code,
            percent_off: REWARD_PERCENT_OFF,
            max_uses: 1,
            user_id: user.id,
            max_order_amount: REWARD_MAX_ORDER,
            is_reward: true,
            is_active: true,
          });
        if (!rewardError) {
          rewardCode = code;
          console.log('Reward code issued for qualifying purchase.');
        } else {
          console.error('⚠️ Failed to issue reward code:', rewardError);
        }
      } catch (rewardErr) {
        console.error('⚠️ Reward code generation error:', rewardErr);
      }
    }

    // The completion RPC already marked the reserved accounts sold atomically.
    // Refresh the catalogue projection after the financial transaction.
    await supabaseAdmin.rpc('refresh_supplier_product_availability', { p_product_group_id: product_group_id, p_fallback_enabled: productHasLiveProvider });

    await Promise.all([
      recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_COMPLETED',
        eventId: `server:PAYMENT_COMPLETED:${idempotency_key}`,
        userId: user.id,
        productGroupId: product_group_id,
        categoryId: productGroup.category_id,
        surface: 'server_purchase',
        experimentId: croContext.experimentId,
        variantId: croContext.variantId,
        revenueContext: revenueRequestContext,
        metadata: {
          order_id: order.id,
          amount: totalPrice,
          amount_ngn: totalPrice,
          currency: 'NGN',
          quantity,
          balance_after: newBalance,
          assignment_mode: croContext.assignmentMode,
        },
      }),
      recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASED',
        eventId: `server:PRODUCT_PURCHASED:${idempotency_key}`,
        userId: user.id,
        productGroupId: product_group_id,
        categoryId: productGroup.category_id,
        surface: 'server_purchase',
        experimentId: croContext.experimentId,
        variantId: croContext.variantId,
        revenueContext: revenueRequestContext,
        metadata: {
          order_id: order.id,
          amount: totalPrice,
          amount_ngn: totalPrice,
          currency: 'NGN',
          quantity,
          price_per_unit: unitPrice,
          assignment_mode: croContext.assignmentMode,
        },
      }),
    ]);

    console.log('Purchase completed.');

    // Return success - credentials are in order.account_details, user views via orders page
    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        amount: totalPrice,
        quantity: quantity,
        product_name: productGroup.name,
        new_balance: newBalance,
        account_details: order.account_details,
        accounts: (order.account_details as any)?.accounts || [],
        message: `Successfully purchased ${quantity} account(s)`,
        ...(rewardCode ? { reward_code: rewardCode } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'Unknown error';
    const message = publicPurchaseError(internalMessage);
    console.error('Purchase failed:', message);

    // An RPC response can fail after its transaction committed. Find the order
    // by the authenticated user and request key before deciding whether this
    // was an ordinary pre-authorization error or an unresolved paid attempt.
    let pendingOrder: any = null;
    if (supabaseAdmin && revenueContext.userId && revenueContext.idempotencyKey) {
      try {
        const { data, error: lookupError } = await supabaseAdmin.from('orders')
          .select('id,user_id,product_group_id,status,financial_authorization_status,wallet_reservation_id,account_details')
          .eq('user_id', revenueContext.userId)
          .eq('idempotency_key', revenueContext.idempotencyKey)
          .maybeSingle();
        if (lookupError) throw lookupError;
        pendingOrder = data;
      } catch (lookupError) {
        console.error('Could not verify purchase state after error:', lookupError);
      }
    }
    const knownOrderId = pendingOrder?.id || authorizedOrderContext?.orderId;
    const knownReservationId = pendingOrder?.wallet_reservation_id || authorizedOrderContext?.reservationId;
    if (pendingOrder?.user_id === revenueContext.userId
      && pendingOrder.status === 'completed'
      && pendingOrder.financial_authorization_status === 'captured'
      && knownReservationId) {
      return new Response(JSON.stringify({
        success: true,
        order_id: pendingOrder.id,
        status: 'completed',
        idempotency_hit: true,
        message: 'Purchase completed. Open Order History for delivery details.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const orderConfirmedClosed = pendingOrder
      && ['cancelled', 'canceled', 'failed'].includes(String(pendingOrder.status || '').toLowerCase())
      && pendingOrder.financial_authorization_status === 'released';
    if (knownOrderId && !orderConfirmedClosed) {
      const supplierOrder = authorizedOrderContext?.supplier
        || pendingOrder?.account_details?.financial_authorization === 'supplier_reserve_first';
      if (supplierOrder && supabaseAdmin) {
        try {
          const { error: blockError } = await supabaseAdmin.rpc('block_supplier_product_fallback', {
            p_product_group_id: pendingOrder?.product_group_id || authorizedOrderContext?.productGroupId,
          });
          if (blockError) console.error('Could not block supplier fallback after unresolved order:', blockError);
        } catch (blockError) {
          console.error('Could not block supplier fallback after unresolved order:', blockError);
        }
      }
      const pendingMessage = supplierOrder
        ? 'Your order is awaiting supplier confirmation. Do not place it again; contact support with your order ID.'
        : 'Your order is awaiting purchase confirmation. Do not place it again; contact support with your order ID.';
      return new Response(JSON.stringify({
        success: false,
        order_id: knownOrderId,
        code: supplierOrder ? 'SUPPLIER_CONFIRMATION_PENDING' : 'PURCHASE_CONFIRMATION_PENDING',
        error: pendingMessage,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (revenueContext.userId && supabaseAdmin) {
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `server:PAYMENT_FAILED:${revenueContext.idempotencyKey || crypto.randomUUID()}`,
        userId: revenueContext.userId,
        productGroupId: revenueContext.productGroupId || null,
        categoryId: revenueContext.categoryId || null,
        surface: 'server_purchase',
        revenueContext: revenueContext.requestContext || null,
        metadata: {
          error: message,
        },
      });
    }
    
    // Return 200 with success: false for business errors so the client can read the message
    // Only return 401 for auth errors
    const status = message === 'Unauthorized' || message === 'Missing authorization header' ? 401 : 200;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
