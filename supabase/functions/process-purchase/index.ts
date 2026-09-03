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

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize user client (to get authenticated user)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Verify the user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Initialize admin client (bypasses RLS)
    supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    await assertPurchasingCustomer(supabaseAdmin, user.id);
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
    const expectedAmountNgn = Number(expected_amount_ngn);
    if (!Number.isFinite(expectedAmountNgn) || expectedAmountNgn <= 0) {
      throw new Error('Current displayed price is required. Please refresh and try again.');
    }

    const preferredAccountId = typeof preferred_account_id === 'string' && preferred_account_id.trim()
      ? preferred_account_id.trim()
      : null;

    // Check idempotency - prevent duplicate purchases
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id, amount, status, created_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      console.log('Purchase idempotency hit: returning existing order.');
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
    const unitPrice = Number(productGroup.price);
    if (productGroup.is_active === false) {
      throw new Error('Product is no longer available for purchase');
    }
    const availabilityStatus = String(productGroup.availability_status || '').toUpperCase();
    if (productGroup.is_sellable === false || ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus)) {
      throw new Error('Product is currently out of stock');
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error('Product has an invalid customer price');
    }
    const productHasLiveProvider = Boolean(
      productGroup.auto_fulfill_enabled &&
        (productGroup.muabanvia_product_id ||
          productGroup.shopclone_product_id ||
          productGroup.shopviaclone_product_id),
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
    const originalTotal = unitPrice * quantity;
    const applicableTier = tiers
      .filter((t) => Number(t.min_qty) >= 2 && quantity >= Number(t.min_qty))
      .sort((a, b) => b.discount_pct - a.discount_pct)[0];
    const discountPct = applicableTier ? Math.min(Math.max(applicableTier.discount_pct, 0), 100) : 0;
    let totalPrice = discountPct > 0 ? Math.round(originalTotal * (1 - discountPct / 100)) : originalTotal;

    let appliedDiscountCode: { id: string; code: string } | null = null;
    if (DISCOUNTS_ENABLED && discount_code && typeof discount_code === 'string' && discount_code.trim()) {
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
      totalPrice = Math.round(totalPrice * (1 - codePct / 100));
      appliedDiscountCode = { id: codeRow.id, code: codeRow.code };
    }
    if (Math.abs(expectedAmountNgn - totalPrice) > 1) {
      throw new Error(`Price changed from ₦${expectedAmountNgn.toLocaleString()} to ₦${totalPrice.toLocaleString()}. Please refresh and try again.`);
    }

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

    // 2. Get available accounts (SERVER-SIDE ONLY - never exposed to client)
    let preferredAccount: any = null;
    if (preferredAccountId && quantity === 1) {
      const { data: selectedAccount, error: selectedAccountError } = await supabaseAdmin
        .from('individual_accounts')
        .select('*')
        .eq('id', preferredAccountId)
        .eq('product_group_id', product_group_id)
        .eq('status', 'available')
        .maybeSingle();

      if (selectedAccountError) {
        console.error('Error fetching selected account:', selectedAccountError);
        throw new Error('Failed to check selected account availability');
      }

      if (!selectedAccount) {
        throw new Error('Selected account is no longer available');
      }

      preferredAccount = selectedAccount;
    }

    const { data: availableAccounts, error: accountsError } = preferredAccount
      ? { data: [preferredAccount], error: null }
      : await supabaseAdmin
        .from('individual_accounts')
        .select('*')
        .eq('product_group_id', product_group_id)
        .eq('status', 'available')
        .limit(quantity);

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError);
      throw new Error('Failed to check availability');
    }

    console.log(`Found ${availableAccounts?.length || 0} available account(s) for purchase.`);

    let workingAccounts = availableAccounts || [];

    if (workingAccounts.length < quantity) {
      const shortfall = quantity - workingAccounts.length;
      const available = workingAccounts.length;

      // Auto-fulfillment fallback chain: try each configured live-purchase provider in
      // order until the shortfall is covered or every provider has been tried. The
      // product-level auto_fulfill_enabled switch is the master kill switch; provider
      // IDs only matter when that switch is on.
      //
      // All three providers share the same API shape (their own docs):
      // POST multipart/form-data: action=buyProduct, id, amount, api_key
      // Response: { status: "success", msg, trans_id, data: ["user|pass", ...] }
      const providers = [
        {
          name: 'muabanvia',
          enabled: !!(productGroup.auto_fulfill_enabled && productGroup.muabanvia_product_id),
          productId: productGroup.muabanvia_product_id,
          apiKeyEnv: 'MUABANVIA_API_KEY',
          baseUrlEnv: 'MUABANVIA_BASE_URL',
          defaultBaseUrl: 'https://muabanvia.org/api/buy_product',
          // MuaBanVia's own examples send the product id as both ID and id.
          idFieldNames: ['ID', 'id'],
        },
        {
          name: 'shopclone',
          enabled: !!(productGroup.auto_fulfill_enabled && productGroup.shopclone_product_id),
          productId: productGroup.shopclone_product_id,
          apiKeyEnv: 'SHOPCLONE_API_KEY',
          baseUrlEnv: 'SHOPCLONE_BASE_URL',
          defaultBaseUrl: 'https://shopclone.vn/api/buy_product',
          idFieldNames: ['id'],
        },
        {
          name: 'shopviaclone',
          enabled: !!(productGroup.auto_fulfill_enabled && productGroup.shopviaclone_product_id),
          productId: productGroup.shopviaclone_product_id,
          apiKeyEnv: 'SHOPVIACLONE_API_KEY',
          baseUrlEnv: 'SHOPVIACLONE_BASE_URL',
          defaultBaseUrl: 'https://shopviaclone22.com/api/buy_product',
          idFieldNames: ['id'],
        },
      ];

      // Parses the shared response shape all three providers use:
      // { status: "success", msg, trans_id, data: ["user|pass", ...] }
      const parseFulfilledAccounts = (rawAccounts: any, limit: number) => {
        const fulfilledRaw: any[] = Array.isArray(rawAccounts) ? rawAccounts : [];
        return fulfilledRaw.slice(0, limit).map((item: any) => {
          if (typeof item === 'string') {
            const parts = item.split('|').map((p: string) => p.trim());
            return {
              username: parts[0] || '',
              password: parts[1] || '',
              email: parts[2] || null,
              email_password: parts[3] || null,
              two_fa_code: parts[4] || null,
            };
          }
          return {
            username: item.username || item.user || item.login || '',
            password: item.password || item.pass || '',
            email: item.email || null,
            email_password: item.email_password || item.emailPass || null,
            two_fa_code: item.two_fa_code || item.twofa || item['2fa'] || null,
            additional_info: item,
          };
        });
      };

      let remainingShortfall = shortfall;

      for (const provider of providers) {
        if (remainingShortfall <= 0) break;
        if (!provider.enabled) continue;

        console.log(`Stock shortfall (${remainingShortfall}); attempting ${provider.name} auto-fulfillment.`);

        try {
          const apiKey = Deno.env.get(provider.apiKeyEnv);
          if (!apiKey) {
            throw new Error(`${provider.apiKeyEnv} not configured`);
          }

          const baseUrl = Deno.env.get(provider.baseUrlEnv) || provider.defaultBaseUrl;

          const form = new FormData();
          form.set('action', 'buyProduct');
          for (const fieldName of provider.idFieldNames) {
            form.set(fieldName, String(provider.productId));
          }
          form.set('amount', String(remainingShortfall));
          form.set('api_key', apiKey);

          const fulfillResponse = await fetch(baseUrl, {
            method: 'POST',
            body: form,
          });

          const fulfillResult = await fulfillResponse.json().catch(() => null) as any;

          if (!fulfillResponse.ok || fulfillResult?.status !== 'success') {
            throw new Error(fulfillResult?.msg || fulfillResult?.message || fulfillResult?.error || `${provider.name} could not fulfill the shortfall`);
          }

          const fulfilledAccounts = parseFulfilledAccounts(fulfillResult?.data ?? [], remainingShortfall);

          if (fulfilledAccounts.length === 0) {
            throw new Error(`${provider.name} returned no accounts`);
          }

          // Insert the live-fulfilled accounts as available stock, tagged with their source,
          // so the rest of the purchase flow (reserve -> sell) treats them identically to
          // pre-stocked accounts.
          const { data: insertedAccounts, error: insertError } = await supabaseAdmin
            .from('individual_accounts')
            .insert(
              fulfilledAccounts.map((acc) => ({
                product_group_id: product_group_id,
                username: acc.username,
                password: acc.password,
                email: acc.email,
                email_password: acc.email_password,
                two_fa_code: acc.two_fa_code,
                additional_info: acc.additional_info || null,
                status: 'available',
                fulfillment_source: provider.name,
              }))
            )
            .select('*');

          if (insertError || !insertedAccounts) {
            throw new Error(insertError?.message || 'Failed to record auto-fulfilled accounts');
          }

          console.log(`${provider.name} auto-fulfillment succeeded for ${insertedAccounts.length} account(s).`);
          workingAccounts = [...workingAccounts, ...insertedAccounts];
          remainingShortfall -= insertedAccounts.length;
        } catch (fulfillErr) {
          console.error(`❌ ${provider.name} auto-fulfillment failed:`, fulfillErr);
          // Fall through to the next provider in the chain, or to the standard
          // out-of-stock error below if this was the last one.
        }
      }

      if (workingAccounts.length < quantity) {
        const stillAvailable = workingAccounts.length;
        console.error(`Stock mismatch: found=${stillAvailable}, requested=${quantity}`);

        if (stillAvailable === 0) {
          await supabaseAdmin
            .from('product_groups')
            .update({
              stock_count: 0,
              availability_status: 'UNAVAILABLE',
              is_sellable: false,
            })
            .eq('id', product_group_id);
          throw new Error(`OUT_OF_STOCK: ${productGroup.name} is currently out of stock. Please check back later or contact support.`);
        } else {
          throw new Error(`INSUFFICIENT_STOCK: Only ${stillAvailable} account(s) available for ${productGroup.name}. You requested ${quantity}.`);
        }
      }
    }

    // 3. Check wallet balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch wallet balance');
    }

    const walletBalance = profile.wallet_balance || 0;
    if (walletBalance < totalPrice) {
      throw new Error(`Insufficient balance. Required: ₦${totalPrice.toLocaleString()}, Available: ₦${walletBalance.toLocaleString()}`);
    }

    // 4. Reserve accounts atomically (workingAccounts includes any MuaBanVia auto-fulfilled
    // accounts inserted above, already in 'available' status alongside the pre-stocked ones)
    const accountIds = workingAccounts.slice(0, quantity).map((acc: any) => acc.id);
    const purchasedAccounts = workingAccounts.slice(0, quantity);

    const { data: reservedAccounts, error: reserveError } = await supabaseAdmin
      .from('individual_accounts')
      .update({ status: 'reserved' })
      .in('id', accountIds)
      .eq('status', 'available')
      .select('id');

    if (reserveError || !reservedAccounts || reservedAccounts.length < quantity) {
      throw new Error('Failed to reserve accounts - some may have been sold');
    }

    // 5. Deduct wallet balance with optimistic locking
    const newBalance = walletBalance - totalPrice;

    const { data: updatedProfile, error: balanceError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('wallet_balance', walletBalance) // Optimistic lock
      .select()
      .single();

    if (balanceError || !updatedProfile) {
      // Rollback: unreserve accounts
      await supabaseAdmin
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds);

      throw new Error('Balance changed during purchase. Please try again.');
    }

    // 6. Create order with credentials (stored in account_details JSON)
    const orderData = {
      user_id: user.id,
      product_group_id: product_group_id,
      amount: totalPrice,
      status: 'completed',
      idempotency_key: idempotency_key,
      discount_code_id: appliedDiscountCode?.id || null,
      account_details: {
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
        quantity: quantity,
        price_per_unit: unitPrice,
        expected_amount_ngn: expectedAmountNgn,
        original_amount_ngn: originalTotal,
        charged_amount_ngn: totalPrice,
        discount_pct: discountPct,
        discount_code: appliedDiscountCode?.code || null,
      },
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (orderError) {
      console.error('❌ Order creation failed:', orderError);

      // Rollback: restore balance and unreserve accounts
      await supabaseAdmin
        .from('profiles')
        .update({ wallet_balance: walletBalance })
        .eq('id', user.id);

      await supabaseAdmin
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds);

      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // 6b. Bump the discount code's used_count now that the order is locked in.
    // Done after order creation (not before) so a failed/rolled-back purchase
    // never consumes a use.
    if (appliedDiscountCode) {
      const { data: codeNow } = await supabaseAdmin
        .from('discount_codes')
        .select('used_count')
        .eq('id', appliedDiscountCode.id)
        .single();
      await supabaseAdmin
        .from('discount_codes')
        .update({ used_count: (codeNow?.used_count || 0) + 1 })
        .eq('id', appliedDiscountCode.id);
    }

    // 6c. Auto-reward: purchases with an original value of ₦100,000+ earn a
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

    // 7. Mark accounts as sold
    await supabaseAdmin
      .from('individual_accounts')
      .update({
        status: 'sold',
        sold_at: new Date().toISOString(),
      })
      .in('id', accountIds);

    // 8. Update product group stock
    const { count: remainingStock } = await supabaseAdmin
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('product_group_id', product_group_id)
      .eq('status', 'available');

    const nextStock = remainingStock || 0;
    await supabaseAdmin
      .from('product_groups')
      .update({
        stock_count: nextStock,
        availability_status: nextStock > 0 ? nextStock <= 3 ? 'LOW_STOCK' : 'AVAILABLE' : productHasLiveProvider ? 'UNLIMITED' : 'UNAVAILABLE',
        is_sellable: nextStock > 0 || productHasLiveProvider,
      })
      .eq('id', product_group_id);

    // 9. Record transaction
    await supabaseAdmin
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'purchase',
        amount: -totalPrice,
        status: 'completed',
        balance_after: newBalance,
        description: `Purchase: ${quantity}x ${productGroup.name}`,
        reference: `ORD-${order.id.substring(0, 8).toUpperCase()}`,
      }]);

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
        message: `Successfully purchased ${quantity} account(s)`,
        ...(rewardCode ? { reward_code: rewardCode } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Purchase error:', error instanceof Error ? error.message : 'Unknown error');

    const message = error instanceof Error ? error.message : 'Purchase failed';

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
    const status = message === 'Unauthorized' ? 401 : 200;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
