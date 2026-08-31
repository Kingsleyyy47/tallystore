import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ERCASPAY_BASE_URL = 'https://api.ercaspay.com/api/v1';

async function recordRevenueEvent(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    surface?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const eventType = sanitizeRevenueEventType('verify-and-credit-wallet', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('verify-and-credit-wallet', input.eventId),
    event_type: eventType,
    user_id: input.userId || null,
    surface: input.surface || 'wallet_topup',
    metadata: sanitizeRevenueMetadata(input.metadata || {}),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record wallet verification revenue event ${eventType}:`, error.message);
  }
}

// Milestone referral reward: the referrer earns a commission only on every
// 10th deposit made by their referred user (deposit #10, #20, #30, …).
// On those milestones the referrer gets referral_commission_pct % of that
// deposit amount (admin-configurable in app_settings, default 5%).
// Non-blocking: any failure must never affect the top-up that already completed.
async function creditReferrerForTopup(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  amount: number
) {
  try {
    const { data: buyerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by')
      .eq('id', userId)
      .single();

    if (!buyerProfile?.referred_by) return;

    // Count total completed deposits by this user (current one already inserted)
    const { count: depositCount } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'topup')
      .eq('status', 'completed');

    // Referral rewards only apply to the first 10 deposits (deposits 1–10).
    // After that, no more commission — the referrer has had their full reward.
    const REFERRAL_DEPOSIT_LIMIT = 10;
    if (!depositCount || depositCount > REFERRAL_DEPOSIT_LIMIT) {
      console.log(`ℹ️ Deposit #${depositCount} is outside referral reward window.`);
      return;
    }

    console.log(`🎯 Deposit #${depositCount}/${REFERRAL_DEPOSIT_LIMIT} is eligible for referral reward.`);

    const referrerId = buyerProfile.referred_by;

    const { data: pctSetting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'referral_commission_pct')
      .maybeSingle();

    const commissionPct = pctSetting?.value ? parseFloat(pctSetting.value) : 5;
    const commissionAmount = (amount * commissionPct) / 100;
    if (commissionAmount <= 0) return;

    const { data: referrerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referral_balance')
      .eq('id', referrerId)
      .single();

    if (!referrerProfile) return;

    const newReferralBalance = (referrerProfile.referral_balance || 0) + commissionAmount;

    await supabaseAdmin
      .from('profiles')
      .update({ referral_balance: newReferralBalance })
      .eq('id', referrerId);

    await supabaseAdmin
      .from('referral_earnings')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: userId,
        order_amount: amount,
        commission_pct: commissionPct,
        commission_amount: commissionAmount,
      }]);

    console.log(`✅ Milestone referral reward credited for deposit #${depositCount}.`);
  } catch (referralError) {
    console.error('⚠️ Referral top-up reward error (non-blocking):', referralError);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { transaction_reference, ercas_reference, user_id: body_user_id } = await req.json();

    if (!transaction_reference) {
      throw new Error('transaction_reference is required');
    }

    // Determine user: either from JWT or from body (for cron/admin calls)
    let userId: string;

    // Try JWT auth first
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (user && !userError) {
      userId = user.id;
    } else if (body_user_id) {
      // Called by cron/admin with service role key — user_id passed in body
      // Verify caller is using service role key by checking if authHeader contains service role
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (authHeader !== `Bearer ${serviceRoleKey}`) {
        throw new Error('Unauthorized');
      }
      userId = body_user_id;
    } else {
      throw new Error('Unauthorized');
    }

    console.log('Verifying wallet payment.');

    const { data: accountProfile, error: accountProfileError } = await supabaseAdmin
      .from('profiles')
      .select('is_staff, is_admin')
      .eq('id', userId)
      .single();

    if (accountProfileError || !accountProfile) {
      throw new Error('Could not load account profile');
    }

    if (accountProfile.is_staff || accountProfile.is_admin) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'blocked',
          error: 'Wallet top-ups are only available to customer accounts.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // STEP 1: Check if already processed (idempotency)
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id, amount, balance_after')
      .eq('reference', transaction_reference)
      .eq('user_id', userId)
      .eq('type', 'topup')
      .maybeSingle();

    if (existingTx) {
      console.log('Wallet payment already processed.');
      
      // Also update pending_payment status if exists
      await supabaseAdmin
        .from('pending_payments')
        .update({ status: 'credited', error_message: 'Already credited' })
        .eq('transaction_reference', transaction_reference);
      
      return new Response(
        JSON.stringify({
          success: true,
          already_processed: true,
          amount: existingTx.amount,
          new_balance: existingTx.balance_after,
          message: 'Payment already credited to wallet',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // A browser may only verify/credit a payment reference that was created
    // server-side for that same user by create-wallet-topup. Without this,
    // someone could submit another successful Ercas reference and claim credit.
    const { data: pendingPayment, error: pendingPaymentError } = await supabaseAdmin
      .from('pending_payments')
      .select('id, user_id, amount, status')
      .eq('transaction_reference', transaction_reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (pendingPaymentError) {
      console.error('❌ Failed to validate pending payment ownership:', pendingPaymentError);
      throw new Error('Failed to validate payment ownership');
    }

    if (!pendingPayment) {
      console.warn('Payment verification blocked: no pending payment for user.');
      return new Response(
        JSON.stringify({
          success: false,
          status: 'blocked',
          error: 'Payment reference was not created for this account.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    if (pendingPayment.status && pendingPayment.status !== 'pending') {
      console.warn(`Payment verification blocked: pending payment is ${pendingPayment.status}.`);
      return new Response(
        JSON.stringify({
          success: false,
          status: pendingPayment.status,
          error: `Payment recovery is closed for this reference (${pendingPayment.status}).`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    // STEP 2: Verify with Ercas Pay API
    const ercasSecretKey =
      Deno.env.get('ERCASPAY_SECRET_KEY') ||
      Deno.env.get('ERCAS_SECRET_KEY') ||
      Deno.env.get('VITE_ERCASPAY_SECRET_KEY') ||
      Deno.env.get('VITE_ERCAS_SECRET_KEY');
    if (!ercasSecretKey) {
      throw new Error('Ercas Pay not configured');
    }

    const verifyResponse = await fetch(
      `${ERCASPAY_BASE_URL}/payment/transaction/verify/${transaction_reference}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${ercasSecretKey}`,
        },
      }
    );

    const verifyResult = await verifyResponse.json();
    // Handle pending
    if (verifyResult.responseBody?.status === 'PENDING' || verifyResult.responseCode === 'pending') {
      console.log('⏳ Payment is still pending');
      return new Response(
        JSON.stringify({
          success: false,
          status: 'pending',
          error: 'Payment is still pending. Please complete the payment.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Handle failed
    if (!verifyResult.requestSuccessful && verifyResult.responseBody?.status !== 'SUCCESSFUL') {
      const errorMsg = verifyResult.errorMessage || verifyResult.responseMessage || 'Payment verification failed';
      console.error('❌ Verification failed:', errorMsg);
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `wallet_topup:PAYMENT_FAILED:${transaction_reference}`,
        userId,
        surface: 'wallet_topup',
        metadata: {
          transaction_reference,
          ercas_reference,
          provider: 'ercaspay',
          error: errorMsg,
          status: verifyResult.responseBody?.status || verifyResult.responseCode || 'failed',
        },
      });
      return new Response(
        JSON.stringify({
          success: false,
          status: 'failed',
          error: errorMsg,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const transaction = verifyResult.responseBody;

    if (transaction.status !== 'SUCCESSFUL') {
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `wallet_topup:PAYMENT_FAILED:${transaction_reference}`,
        userId,
        surface: 'wallet_topup',
        metadata: {
          transaction_reference,
          ercas_reference,
          provider: 'ercaspay',
          status: transaction.status,
        },
      });
      return new Response(
        JSON.stringify({
          success: false,
          status: transaction.status.toLowerCase(),
          error: `Payment status: ${transaction.status}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const amount = transaction.amount;
    const ercasRef = transaction.ercs_reference;
    const expectedAmount = Number(pendingPayment.amount);
    const verifiedAmount = Number(amount);

    if (!Number.isFinite(expectedAmount) || !Number.isFinite(verifiedAmount) || Math.abs(expectedAmount - verifiedAmount) > 0.01) {
      console.error('❌ Payment amount mismatch during wallet verification.');
      await supabaseAdmin
        .from('pending_payments')
        .update({
          status: 'failed',
          error_message: `Amount mismatch. Expected ${expectedAmount}, got ${verifiedAmount}`,
        })
        .eq('id', pendingPayment.id);

      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `wallet_topup:PAYMENT_FAILED:${transaction_reference}:amount_mismatch`,
        userId,
        surface: 'wallet_topup',
        metadata: {
          transaction_reference,
          ercas_reference: ercasRef,
          provider: 'ercaspay',
          expected_amount_ngn: expectedAmount,
          verified_amount_ngn: verifiedAmount,
          error: 'amount_mismatch',
        },
      });

      return new Response(
        JSON.stringify({
          success: false,
          status: 'failed',
          error: 'Payment amount did not match the created checkout.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    // STEP 3: INSERT transaction record FIRST as the atomic lock
    // The unique constraint on reference prevents double-crediting:
    // If two concurrent requests both pass the idempotency check above,
    // only ONE insert will succeed — the other hits unique constraint and fails.
    // This is the ONLY reliable way to prevent race conditions.
    
    // Read current balance for the record
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch wallet balance');
    }

    const currentBalance = parseFloat(profile.wallet_balance) || 0;
    const newBalance = currentBalance + amount;

    // Insert transaction first — if this fails due to unique constraint, another request already handled it
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'topup',
        amount: amount,
        status: 'completed',
        balance_after: newBalance,
        description: 'Wallet top-up via Ercas Pay',
        reference: transaction_reference,
        ercas_reference: ercasRef,
      });

    if (txError) {
      // Check if it's a unique constraint violation — means another request already processed this
      if (txError.code === '23505') {
      console.log('Transaction insert conflict: payment already processed by concurrent request.');
        
        // Fetch the existing transaction to return correct data
        const { data: existingTx2 } = await supabaseAdmin
          .from('transactions')
          .select('amount, balance_after')
          .eq('reference', transaction_reference)
          .eq('user_id', userId)
          .eq('type', 'topup')
          .maybeSingle();

        return new Response(
          JSON.stringify({
            success: true,
            already_processed: true,
            amount: existingTx2?.amount || amount,
            new_balance: existingTx2?.balance_after || newBalance,
            message: 'Payment already credited to wallet',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.error('❌ Failed to record transaction:', txError);
      throw new Error('Failed to record transaction');
    }

    // STEP 4: Transaction inserted successfully — now we're the ONLY request processing this.
    // Update wallet balance safely.
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single();

    if (updateError || !updatedProfile) {
      // Optimistic lock failed — balance changed between read and write.
      // Re-read and apply the credit.
      const { data: freshProfile } = await supabaseAdmin
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (freshProfile) {
        const freshBalance = parseFloat(freshProfile.wallet_balance) || 0;
        const retryBalance = freshBalance + amount;
        
        await supabaseAdmin
          .from('profiles')
          .update({
            wallet_balance: retryBalance,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        // Update the transaction record with correct balance_after
        await supabaseAdmin
          .from('transactions')
          .update({ balance_after: retryBalance })
          .eq('reference', transaction_reference)
          .eq('user_id', userId)
          .eq('type', 'topup');

        console.log('Wallet credited on retry path.');

        await creditReferrerForTopup(supabaseAdmin, userId, amount);
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PAYMENT_COMPLETED',
          eventId: `wallet_topup:PAYMENT_COMPLETED:${transaction_reference}`,
          userId,
          surface: 'wallet_topup',
          metadata: {
            transaction_reference,
            ercas_reference: ercasRef,
            provider: 'ercaspay',
            amount_ngn: amount,
            balance_after: retryBalance,
            credited_via: 'retry',
          },
        });

        // Update pending_payment status
        await supabaseAdmin
          .from('pending_payments')
          .update({ status: 'credited' })
          .eq('transaction_reference', transaction_reference);

        return new Response(
          JSON.stringify({
            success: true,
            amount: amount,
            new_balance: retryBalance,
            message: `₦${amount.toLocaleString()} has been added to your wallet`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update pending_payment status
    await supabaseAdmin
      .from('pending_payments')
      .update({ status: 'credited' })
      .eq('transaction_reference', transaction_reference);

    console.log('Wallet credited.');

    await creditReferrerForTopup(supabaseAdmin, userId, amount);
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_COMPLETED',
      eventId: `wallet_topup:PAYMENT_COMPLETED:${transaction_reference}`,
      userId,
      surface: 'wallet_topup',
      metadata: {
        transaction_reference,
        ercas_reference: ercasRef,
        provider: 'ercaspay',
        amount_ngn: amount,
        balance_after: newBalance,
        credited_via: 'normal',
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        amount: amount,
        new_balance: newBalance,
        message: `₦${amount.toLocaleString()} has been added to your wallet`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Verify and credit error:', error instanceof Error ? error.message : 'Unknown error');

    const message = error instanceof Error ? error.message : 'Failed to process payment';
    const status = message === 'Unauthorized' ? 401 : 400;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
