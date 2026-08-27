import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

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


// Supabase Edge Function version of the PocketFi inward-transfer webhook.
// Runs entirely inside Supabase -- no Vercel env vars needed, since
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase
// for every edge function.
//
// IMPORTANT WHEN DEPLOYING: in the Supabase dashboard, when you create this
// function, there will be a "Verify JWT" / "Enforce JWT verification" toggle.
// You MUST turn that OFF for this function. PocketFi calls this URL directly
// with no Supabase auth token, so if JWT verification is on, every webhook
// call gets rejected with 401 before your code even runs.
//
// Because JWT verification is off, POCKETFI_WEBHOOK_SECRET is required. If you
// already stored PocketFi's "Secret API Key" as POCKETFI_SECRET_API_KEY, this
// function accepts that as the fallback webhook secret. Configure
// PocketFi to send it as one of:
//   Authorization: Bearer <secret>
//   x-pocketfi-webhook-secret: <secret>
//   x-webhook-secret: <secret>
//   ?token=<secret>
// If PocketFi supports signed payloads, x-pocketfi-signature / x-webhook-signature
// may contain an HMAC-SHA256 hex digest of the raw request body using this secret.
//
// Confirmed real PocketFi webhook payload shape (from a live transfer):
// {
//   order: { amount, settlement_amount, fee, description },
//   transaction: { reference },
//   account_number,
//   customer: { id, first_name, last_name, phone, email, businessId, ... }
// }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pocketfi-webhook-secret, x-webhook-secret, x-pocketfi-signature, x-webhook-signature',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function constantTimeEquals(a: string, b: string) {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false

  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}

async function hmacSha512Hex(secret: string, message: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyPocketFiWebhook(req: Request, rawBody: string) {
  const secret = Deno.env.get('POCKETFI_WEBHOOK_SECRET') || Deno.env.get('POCKETFI_SECRET_API_KEY') || ''
  if (!secret) {
    console.error('POCKETFI_WEBHOOK_SECRET/POCKETFI_SECRET_API_KEY is not configured. Refusing unsigned webhook.')
    return false
  }

  const url = new URL(req.url)
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  const sharedSecret = (
    req.headers.get('x-pocketfi-webhook-secret') ||
    req.headers.get('x-webhook-secret') ||
    url.searchParams.get('token') ||
    bearer ||
    ''
  ).trim()

  if (sharedSecret && constantTimeEquals(sharedSecret, secret)) return true

  // PocketFi sends HMAC-SHA512 in the 'HTTP_POCKETFI_SIGNATURE' header.
  // In HTTP this arrives as 'pocketfi-signature' (lowercase, no HTTP_ prefix).
  const signature = (
    req.headers.get('pocketfi-signature') ||
    req.headers.get('http_pocketfi_signature') ||
    req.headers.get('x-pocketfi-signature') ||
    req.headers.get('x-webhook-signature') ||
    ''
  ).trim().toLowerCase()

  if (!signature) return false

  const expectedSignature = await hmacSha512Hex(secret, rawBody)
  return constantTimeEquals(signature, expectedSignature)
}

async function recordRevenueEvent(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: {
    eventType: RevenueEventType
    eventId: string
    userId?: string | null
    surface?: string
    metadata?: Record<string, unknown>
  },
) {
  const eventType = sanitizeRevenueEventType('webhook-pocketfi', input.eventType)
  if (!eventType) return

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('webhook-pocketfi', input.eventId),
    event_type: eventType,
    user_id: input.userId || null,
    surface: input.surface || 'wallet_topup',
    metadata: sanitizeRevenueMetadata(input.metadata || {}),
  }, { onConflict: 'event_id', ignoreDuplicates: true })

  if (error) {
    console.error(`Failed to record PocketFi revenue event ${eventType}:`, error.message)
  }
}

function firstDefined(...values: any[]) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function extractAccountNumber(payload: any): string | undefined {
  const value = firstDefined(
    payload.account_number,
    payload.accountNumber,
    payload.virtualAccountNumber,
    payload.data?.account_number,
    payload.data?.accountNumber,
    payload.account?.accountNumber,
    payload.account?.number,
  )
  return value ? String(value) : undefined
}

function extractAmount(payload: any): number {
  const value = firstDefined(
    payload.order?.amount,
    payload.order?.settlement_amount,
    payload.data?.order?.amount,
    payload.data?.order?.settlement_amount,
    payload.amount,
    payload.data?.amount,
    payload.transaction?.amount,
  )
  return Number(value || 0)
}

function extractReference(payload: any): string | undefined {
  const value = firstDefined(
    payload.transaction?.reference,
    payload.transaction?.id,
    payload.data?.transaction?.reference,
    payload.data?.transaction?.id,
    payload.reference,
    payload.transaction_reference,
    payload.transactionReference,
    payload.data?.reference,
    payload.data?.transaction_reference,
    payload.sessionId,
    payload.id,
  )
  return value ? String(value) : undefined
}

function extractStatus(payload: any): string {
  return String(
    firstDefined(payload.status, payload.data?.status, payload.event, '') || '',
  ).toLowerCase()
}

// Milestone referral reward: the referrer earns a commission only on every
// 10th deposit made by their referred user (deposit #10, #20, #30, …).
// On those milestones the referrer gets referral_commission_pct % of that
// deposit amount (admin-configurable in app_settings, default 5%).
// Non-blocking: any failure must never affect the top-up that already completed.
async function creditReferrerForTopup(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
) {
  try {
    const { data: buyerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by')
      .eq('id', userId)
      .single()

    if (!buyerProfile?.referred_by) return

    // Count total completed deposits by this user (current one already inserted)
    const { count: depositCount } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'topup')
      .eq('status', 'completed')

    // Referral rewards only apply to the first 10 deposits (deposits 1–10).
    // After that, no more commission — the referrer has had their full reward.
    const REFERRAL_DEPOSIT_LIMIT = 10
    if (!depositCount || depositCount > REFERRAL_DEPOSIT_LIMIT) {
      console.log(`ℹ️ Deposit #${depositCount} is outside referral reward window.`)
      return
    }

    console.log(`🎯 Deposit #${depositCount}/${REFERRAL_DEPOSIT_LIMIT} is eligible for referral reward.`)

    const referrerId = buyerProfile.referred_by

    const { data: pctSetting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'referral_commission_pct')
      .maybeSingle()

    const commissionPct = pctSetting?.value ? parseFloat(pctSetting.value) : 5
    const commissionAmount = (amount * commissionPct) / 100
    if (commissionAmount <= 0) return

    const { data: referrerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referral_balance')
      .eq('id', referrerId)
      .single()

    if (!referrerProfile) return

    const newReferralBalance = (referrerProfile.referral_balance || 0) + commissionAmount

    await supabaseAdmin
      .from('profiles')
      .update({ referral_balance: newReferralBalance })
      .eq('id', referrerId)

    await supabaseAdmin
      .from('referral_earnings')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: userId,
        order_amount: amount,
        commission_pct: commissionPct,
        commission_amount: commissionAmount,
      }])

    console.log(`✅ Milestone referral reward credited for deposit #${depositCount}.`)
  } catch (referralError) {
    console.error('⚠️ Referral top-up reward error (non-blocking):', referralError)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // Auto-injected by Supabase -- no manual secret setup needed.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  try {
    const rawBody = await req.text()
    const verified = await verifyPocketFiWebhook(req, rawBody)
    if (!verified) {
      return json({ error: 'Unauthorized webhook' }, 401)
    }

    const payload = rawBody ? JSON.parse(rawBody) as Record<string, any> : {}
    const accountNumber = extractAccountNumber(payload)
    const amount = extractAmount(payload)
    const reference = extractReference(payload) || `PKF-INWARD-${Date.now()}`
    const status = extractStatus(payload)

    console.log('PocketFi webhook received.')

    const { data: logRow } = await supabase
      .from('pocketfi_webhook_logs')
      .insert({
        raw_payload: payload,
        matched_account_number: accountNumber || null,
      })
      .select('id')
      .single()

    if (!accountNumber || !amount) {
      const message = 'Missing account number or amount in PocketFi webhook payload'
      console.error(message)
      if (logRow) {
        await supabase.from('pocketfi_webhook_logs').update({ error_message: message }).eq('id', logRow.id)
      }
      return json({ message: 'Payload could not be parsed, logged for review' })
    }

    const isSuccess = status === '' || status.includes('success') || status === 'completed' || status === 'paid' || status === 'credit'
    if (!isSuccess) {
      console.log('Ignoring non-successful PocketFi event:', status)
      return json({ message: 'Event ignored' })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, wallet_balance, is_staff, is_admin')
      .eq('pocketfi_account_number', accountNumber)
      .maybeSingle()

    if (!profile) {
      const message = 'No user found for PocketFi account number'
      console.error(message)
      if (logRow) {
        await supabase.from('pocketfi_webhook_logs').update({ error_message: message }).eq('id', logRow.id)
      }
      return json({ message: 'No matching account on file' })
    }

    if (profile.is_staff || profile.is_admin) {
      const message = 'PocketFi wallet credit blocked for non-customer account'
      console.error(message)
      if (logRow) {
        await supabase.from('pocketfi_webhook_logs').update({ error_message: message }).eq('id', logRow.id)
      }
      return json({ message: 'Account is not eligible for wallet top-up' }, 403)
    }

    const userId = profile.id

    const { data: existingTransaction } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingTransaction) {
      console.log('PocketFi transaction already processed.')
      return json({ message: 'Transaction already processed' })
    }

    const currentBalance = Number(profile.wallet_balance || 0)
    const newBalance = currentBalance + amount

    const { error: transactionError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'topup',
        amount,
        status: 'completed',
        balance_after: newBalance,
        description: `Wallet top-up via PocketFi bank transfer (${accountNumber})`,
        reference,
      }])

    if (transactionError) {
      if (transactionError.code === '23505') {
        console.log('PocketFi transaction insert conflict, already processed.')
        return json({ message: 'Transaction already processed' })
      }
      throw new Error(`Failed to record transaction: ${transactionError.message}`)
    }

    const { data: updatedProfile, error: balanceError } = await supabase
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single()

    let finalBalance = newBalance
    if (balanceError || !updatedProfile) {
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single()

      if (!freshProfile) throw new Error(`Failed to update wallet: ${balanceError?.message || 'profile not found'}`)
      finalBalance = Number(freshProfile.wallet_balance || 0) + amount
      const { error: retryError } = await supabase
        .from('profiles')
        .update({
          wallet_balance: finalBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
      if (retryError) throw new Error(`Failed to update wallet: ${retryError.message}`)

      await supabase
        .from('transactions')
        .update({ balance_after: finalBalance })
        .eq('reference', reference)
        .eq('user_id', userId)
    }

    if (logRow) {
      await supabase
        .from('pocketfi_webhook_logs')
        .update({ processed: true, matched_user_id: userId })
        .eq('id', logRow.id)
    }

    console.log('PocketFi webhook payment processed successfully.')

    await creditReferrerForTopup(supabase, userId, amount)
    await recordRevenueEvent(supabase, {
      eventType: 'PAYMENT_COMPLETED',
      eventId: `wallet_topup:PAYMENT_COMPLETED:pocketfi:${reference}`,
      userId,
      surface: 'wallet_topup',
      metadata: {
        reference,
        provider: 'pocketfi',
        account_number: accountNumber,
        amount_ngn: amount,
        balance_after: finalBalance,
        webhook_log_id: logRow?.id || null,
      },
    })

    return json({
      success: true,
      message: 'Payment processed successfully',
      data: { user_id: userId, amount, new_balance: finalBalance, reference },
    })
  } catch (error) {
    console.error('PocketFi webhook processing error:', error instanceof Error ? error.message : 'Unknown error')
    return json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500)
  }
})
