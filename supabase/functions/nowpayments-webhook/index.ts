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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nowpayments-sig',
};

async function recordRevenueEvent(
  supabaseAdmin: any,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    surface?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const eventType = sanitizeRevenueEventType('nowpayments-webhook', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('nowpayments-webhook', input.eventId),
    event_type: eventType,
    user_id: input.userId || null,
    surface: input.surface || 'crypto',
    metadata: sanitizeRevenueMetadata(input.metadata || {}),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record NOWPayments revenue event ${eventType}:`, error.message);
  }
}

// Verify IPN signature as per NowPayments docs
// https://documenter.getpostman.com/view/7907941/S1a32n38#ipn-callbacks
async function verifyIPNSignature(payload: any, receivedSignature: string, secret: string): Promise<boolean> {
  try {
    // Sort all parameters alphabetically (top-level only)
    const sortedPayload: Record<string, any> = {};
    Object.keys(payload).sort().forEach(key => {
      sortedPayload[key] = payload[key];
    });
    
    // Convert to string
    const payloadString = JSON.stringify(sortedPayload);
    
    // Sign with HMAC SHA-512
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadString));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return computedSignature === receivedSignature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get raw body and signature for verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-nowpayments-sig');
    const payload = JSON.parse(rawBody);
    
    // This webhook has JWT verification disabled because NOWPayments calls it
    // directly, so the provider IPN signature is required before any balance
    // or transaction update can happen.
    const ipnSecret = Deno.env.get('NOWPAYMENTS_IPN_SECRET');
    if (!ipnSecret) {
      console.error('❌ NOWPAYMENTS_IPN_SECRET is not configured - rejecting webhook');
      return new Response(
        JSON.stringify({ error: 'Webhook secret not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!signature) {
      console.error('❌ Missing NowPayments IPN signature - rejecting request');
      return new Response(
        JSON.stringify({ error: 'Missing signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const isValid = await verifyIPNSignature(payload, signature, ipnSecret);
    if (!isValid) {
      console.error('❌ Invalid IPN signature - rejecting request');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }
    
    // Initialize Supabase admin client (no user auth required for webhooks)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role for admin access
    );

    // Extract payment details from webhook
    const {
      payment_id,
      payment_status,
      pay_address,
      price_amount,
      price_currency,
      pay_amount,
      actually_paid,
      pay_currency,
      order_id,
      order_description,
      purchase_id,
      outcome_amount,
      outcome_currency,
      payin_hash,
      payout_hash,
      payin_extra_id,
      smart_contract,
      network,
      network_precision,
      time_limit,
      burning_percent,
      expiration_estimate_date,
      payment_extra_ids,
      parent_payment_id,
      origin_type,
      type,
    } = payload;

    // Find transaction by payment_id or order_id
    const { data: existingTransaction, error: findError } = await supabaseAdmin
      .from('crypto_transactions')
      .select('*')
      .or(`nowpayments_payment_id.eq.${payment_id},payment_reference.eq.${order_id}`)
      .single();

    if (findError || !existingTransaction) {
      console.error('NowPayments webhook transaction not found.');
      // Still return 200 to acknowledge webhook (prevent retries)
      return new Response(
        JSON.stringify({ success: true, message: 'Transaction not found, webhook acknowledged' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Map NowPayments status to our status
    let transactionStatus = existingTransaction.status;
    let shouldCreditUser = false;

    switch (payment_status) {
      case 'waiting':
        transactionStatus = 'pending';
        break;
      case 'confirming':
        transactionStatus = 'processing';
        break;
      case 'confirmed':
      case 'sending':
        transactionStatus = 'processing';
        break;
      case 'finished':
        transactionStatus = 'completed';
        shouldCreditUser = true;
        break;
      case 'partially_paid':
        transactionStatus = 'partially_paid';
        shouldCreditUser = true; // Credit the partial amount
        break;
      case 'failed':
        transactionStatus = 'failed';
        break;
      case 'refunded':
        transactionStatus = 'refunded';
        break;
      case 'expired':
        transactionStatus = 'expired';
        break;
      default:
        transactionStatus = payment_status;
    }

    // Update transaction with webhook data
    const { error: updateError } = await supabaseAdmin
      .from('crypto_transactions')
      .update({
        status: transactionStatus,
        nowpayments_amount_received: actually_paid || pay_amount,
        actually_paid: actually_paid || 0,
        outcome_amount: outcome_amount,
        outcome_currency: outcome_currency,
        payout_hash: payout_hash,
        payment_extra_ids: payment_extra_ids ? payment_extra_ids : null,
        parent_payment_id: parent_payment_id,
        origin_type: origin_type,
      })
      .eq('id', existingTransaction.id);

    if (updateError) {
      console.error('Failed to update transaction:', updateError);
      throw updateError;
    }

    // Credit user's crypto balance if payment is finished or partially paid
    if (shouldCreditUser) {
      const amountToCredit = actually_paid || pay_amount || 0;
      
      if (amountToCredit > 0) {
        const eventKey = existingTransaction.payment_reference || existingTransaction.id;
        const completedMetadata = (balanceAfter?: number) => ({
          transaction_id: existingTransaction.id,
          payment_reference: existingTransaction.payment_reference,
          nowpayments_payment_id: payment_id,
          nowpayments_purchase_id: purchase_id,
          payment_status,
          transaction_status: transactionStatus,
          amount_ngn: parseFloat(existingTransaction.naira_amount || '0'),
          ...(balanceAfter == null ? {} : { balance_after: balanceAfter }),
          crypto_type: existingTransaction.crypto_type,
          crypto_amount: existingTransaction.crypto_amount,
          actually_paid: actually_paid || 0,
          pay_amount,
          pay_currency,
          payout_hash,
          payin_hash,
          provider: 'nowpayments',
        });

        // BULLETPROOF IDEMPOTENCY: Check credited_at field
        // If credited_at is set, this transaction was ALREADY credited - NEVER credit again
        if (existingTransaction.credited_at) {
          console.log('Crypto webhook credit blocked because transaction was already credited.');
          await recordRevenueEvent(supabaseAdmin, {
            eventType: 'PAYMENT_COMPLETED',
            eventId: `crypto:PAYMENT_COMPLETED:${eventKey}`,
            userId: existingTransaction.user_id,
            surface: 'crypto',
            metadata: completedMetadata(),
          });
          await recordRevenueEvent(supabaseAdmin, {
            eventType: 'PRODUCT_PURCHASED',
            eventId: `crypto:PRODUCT_PURCHASED:${eventKey}`,
            userId: existingTransaction.user_id,
            surface: 'crypto',
            metadata: {
              ...completedMetadata(),
              product_name: `${existingTransaction.crypto_type || 'Crypto'} sell deposit`,
              quantity: 1,
              price_per_unit: parseFloat(existingTransaction.naira_amount || '0'),
              commerce_source: 'crypto',
            },
          });
          shouldCreditUser = false;
        } else {
          // Double-check by re-fetching (race condition protection)
          const { data: freshTx } = await supabaseAdmin
            .from('crypto_transactions')
            .select('credited_at')
            .eq('id', existingTransaction.id)
            .single();
          
          if (freshTx?.credited_at) {
            console.log('Crypto webhook credit blocked by concurrent credit check.');
            shouldCreditUser = false;
          } else {
            // ATOMIC: Set credited_at FIRST, then credit balance
            // This ensures we mark it as credited before touching the balance
            const creditTimestamp = new Date().toISOString();
            
            const { error: markCreditedError } = await supabaseAdmin
              .from('crypto_transactions')
              .update({ credited_at: creditTimestamp })
              .eq('id', existingTransaction.id)
              .is('credited_at', null); // Only update if NOT already credited
            
            if (markCreditedError) {
              console.error(`❌ Failed to mark transaction as credited:`, markCreditedError);
              shouldCreditUser = false;
            } else {
              // Verify we actually set credited_at (another process might have beat us)
              const { data: verifyTx } = await supabaseAdmin
                .from('crypto_transactions')
                .select('credited_at')
                .eq('id', existingTransaction.id)
                .single();
              
              // Compare timestamps properly (handle format differences between JS ISO and Postgres)
              const ourTime = new Date(creditTimestamp).getTime();
              const dbTime = verifyTx?.credited_at ? new Date(verifyTx.credited_at).getTime() : 0;
              const timeDiff = Math.abs(ourTime - dbTime);
              
              // If timestamps differ by more than 1 second, another process beat us
              if (timeDiff > 1000) {
                console.log('Crypto webhook credit blocked because another process won the credit lock.');
                shouldCreditUser = false;
              } else {
                // NOW it's safe to credit the balance
                const creditAmount = parseFloat(existingTransaction.naira_amount);
                
                const { data: userData, error: userError } = await supabaseAdmin
                  .from('profiles')
                  .select('crypto_balance')
                  .eq('id', existingTransaction.user_id)
                  .single();

                if (userError) {
                  console.error('Failed to fetch user:', userError);
                } else {
                  const currentBalance = parseFloat(userData.crypto_balance || '0');
                  const newBalance = currentBalance + creditAmount;

                  const { error: balanceError } = await supabaseAdmin
                    .from('profiles')
                    .update({ crypto_balance: newBalance })
                    .eq('id', existingTransaction.user_id);

                  if (balanceError) {
                    console.error(`❌ Balance update failed:`, balanceError);
                    // Rollback credited_at since we couldn't credit
                    await supabaseAdmin
                      .from('crypto_transactions')
                      .update({ credited_at: null })
                      .eq('id', existingTransaction.id);
                  } else {
                    await recordRevenueEvent(supabaseAdmin, {
                      eventType: 'PAYMENT_COMPLETED',
                      eventId: `crypto:PAYMENT_COMPLETED:${eventKey}`,
                      userId: existingTransaction.user_id,
                      surface: 'crypto',
                      metadata: completedMetadata(newBalance),
                    });
                    await recordRevenueEvent(supabaseAdmin, {
                      eventType: 'PRODUCT_PURCHASED',
                      eventId: `crypto:PRODUCT_PURCHASED:${eventKey}`,
                      userId: existingTransaction.user_id,
                      surface: 'crypto',
                      metadata: {
                        ...completedMetadata(newBalance),
                        product_name: `${existingTransaction.crypto_type || 'Crypto'} sell deposit`,
                        quantity: 1,
                        price_per_unit: creditAmount,
                        commerce_source: 'crypto',
                      },
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!shouldCreditUser && ['failed', 'refunded', 'expired'].includes(transactionStatus)) {
      const wasPreviouslyCredited = Boolean(existingTransaction.credited_at) || ['completed', 'partially_paid'].includes(String(existingTransaction.status || '').toLowerCase());
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `crypto:PAYMENT_FAILED:${existingTransaction.payment_reference || existingTransaction.id}:${transactionStatus}`,
        userId: existingTransaction.user_id,
        surface: 'crypto',
        metadata: {
          transaction_id: existingTransaction.id,
          payment_reference: existingTransaction.payment_reference,
          nowpayments_payment_id: payment_id,
          nowpayments_purchase_id: purchase_id,
          payment_status,
          transaction_status: transactionStatus,
          crypto_type: existingTransaction.crypto_type,
          crypto_amount: existingTransaction.crypto_amount,
          naira_amount: existingTransaction.naira_amount,
          actually_paid: actually_paid || 0,
          pay_amount,
          pay_currency,
          provider: 'nowpayments',
        },
      });

      if (wasPreviouslyCredited) {
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PRODUCT_PURCHASE_REVERSED',
          eventId: `crypto:PRODUCT_PURCHASE_REVERSED:${existingTransaction.payment_reference || existingTransaction.id}:${transactionStatus}`,
          userId: existingTransaction.user_id,
          surface: 'crypto',
          metadata: {
            transaction_id: existingTransaction.id,
            payment_reference: existingTransaction.payment_reference,
            nowpayments_payment_id: payment_id,
            nowpayments_purchase_id: purchase_id,
            previous_status: existingTransaction.status,
            payment_status,
            transaction_status: transactionStatus,
            crypto_type: existingTransaction.crypto_type,
            crypto_amount: existingTransaction.crypto_amount,
            naira_amount: existingTransaction.naira_amount,
            actually_paid: actually_paid || 0,
            pay_amount,
            pay_currency,
            provider: 'nowpayments',
            reason: `provider_${transactionStatus}_after_credit`,
          },
        });
      }
    }
    console.log(`NowPayments webhook processed with status ${payment_status} -> ${transactionStatus}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook processed successfully',
        transaction_id: existingTransaction.id,
        status: transactionStatus,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error('Error in nowpayments-webhook:', error instanceof Error ? error.message : 'Unknown error');
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    // Still return 200 to prevent webhook retries
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
});
