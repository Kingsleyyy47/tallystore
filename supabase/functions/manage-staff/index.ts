import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── smtp-client.ts ──
/**
 * SMTP Client for TallyStore Email Service
 * Uses denomailer for Deno-native SMTP via Namecheap Private Email
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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


const SMTP_HOST = "mail.privateemail.com";
const SMTP_PORT = 465;

function getCredentials() {
  const email = Deno.env.get("SMTP_EMAIL");
  const password = Deno.env.get("SMTP_PASSWORD");
  if (!email || !password) {
    throw new Error("SMTP_EMAIL and SMTP_PASSWORD must be set in Edge Function secrets");
  }
  return { email, password };
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const { email: fromEmail, password } = getCredentials();

  try {
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: fromEmail, password },
      },
    });

    await client.send({
      from: `TallyStore <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      content: "auto",
      html: options.html,
    });

    // Close connection, ignoring errors
    try { await client.close() } catch { /* ignore */ }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SMTP send failed for ${options.to}: ${msg}`);
    return { success: false, error: msg };
  }
}

export async function sendEmailBulk(options: {
  recipients: string[];
  subject: string;
  html: string;
}): Promise<{ success: boolean; sent: number; failed: number; failedEmails: string[] }> {
  const { recipients, subject, html } = options;
  let sent = 0;
  let failed = 0;
  const failedEmails: string[] = [];

  // Process in chunks of 10 concurrent connections
  const CONCURRENCY = 10;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const chunk = recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((to) => sendEmail({ to, subject, html }))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value.success) {
        sent++;
      } else {
        failed++;
        failedEmails.push(chunk[j]);
      }
    }
  }

  return { success: true, sent, failed, failedEmails };
}

export function buildBroadcastHtml(message: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#7c3aed,#3b82f6);padding:24px;border-radius:12px;color:white;text-align:center;margin-bottom:24px">
      <h1 style="margin:0;font-size:24px">TallyStore</h1>
    </div>
    <div style="padding:16px;line-height:1.6;color:#333">
      ${message.replace(/\n/g, "<br/>")}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://tallystore.org/dashboard"
         style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
        Go to Dashboard
      </a>
    </div>
    <div style="text-align:center;margin-top:32px;color:#999;font-size:12px">
      <p>TallyStore — Your trusted digital marketplace</p>
    </div>
  </div>`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = 'wisdomthedev@gmail.com'
const DEFAULT_DAISY_BASE = 'https://daisysms.io/stubs/handler_api.php'
const SMS_TERMINAL_STATUSES = ['completed', 'cancelled', 'failed', 'expired', 'refunded']

type SupabaseAdmin = ReturnType<typeof createClient>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

class HttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function optionalNaira(value: unknown) {
  if (value === null || value === '') return null
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : null
}

async function recordRevenueEvent(
  admin: SupabaseAdmin,
  input: {
    eventType: RevenueEventType
    eventId: string
    userId?: string | null
    surface?: string
    revenueContext?: RevenueRequestContext | null
    metadata?: Record<string, unknown>
  },
) {
  const eventType = sanitizeRevenueEventType('manage-staff', input.eventType)
  if (!eventType) return

  const { error } = await admin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('manage-staff', input.eventId),
    event_type: eventType,
    user_id: input.userId || null,
    surface: input.surface || 'staff_admin',
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
      source: 'staff_approved_action',
    }),
  }, { onConflict: 'event_id', ignoreDuplicates: true })

  if (error) {
    console.error(`Failed to record staff revenue event ${eventType}:`, error.message)
  }
}

async function recordSmsRefundRevenueEvents(
  admin: SupabaseAdmin,
  order: any,
  amount: number,
  refundRef: string,
  reason: string,
  alreadyRefunded = false,
) {
  const metadata = {
    order_id: order.id,
    reference: order.reference || order.id,
    refund_reference: refundRef,
    amount_ngn: amount,
    service_code: order.service_id || null,
    reason,
    already_refunded: alreadyRefunded,
  }

  await recordRevenueEvent(admin, {
    eventType: 'SMS_ORDER_REFUNDED',
    eventId: `staff:sms:SMS_ORDER_REFUNDED:${order.id}:${refundRef}`,
    userId: order.user_id,
    surface: 'sms',
    metadata,
  })
  await recordRevenueEvent(admin, {
    eventType: 'PRODUCT_PURCHASE_REVERSED',
    eventId: `staff:sms:PRODUCT_PURCHASE_REVERSED:${order.id}:${refundRef}`,
    userId: order.user_id,
    surface: 'sms',
    metadata,
  })
}

function buildEmailHtml(message: string) {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#7c3aed,#3b82f6);padding:24px;border-radius:12px;color:white;text-align:center;margin-bottom:24px">
      <h1 style="margin:0;font-size:24px">TallyStore</h1>
    </div>
    <div style="padding:16px;line-height:1.6;color:#333">
      ${message.replace(/\n/g, '<br/>')}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://tallystore.org/dashboard" style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Go to Wallet</a>
    </div>
    <div style="text-align:center;margin-top:32px;color:#999;font-size:12px"><p>TallyStore - Your trusted digital marketplace</p></div>
  </div>`
}

function normalizeEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

async function countPromotionConsentedCustomers(admin: ReturnType<typeof createClient>) {
  const batchSize = 1000
  let offset = 0
  let total = 0

  while (true) {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id,email,is_admin,is_staff,created_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1)
    if (profilesError) throw new Error(profilesError.message)
    if (!profiles || profiles.length === 0) break

    const profileIds = profiles.map((profile: any) => profile.id).filter(Boolean)
    const { data: prefs, error: prefsError } = await admin
      .from('customer_communication_preferences')
      .select('user_id,email_promotions_opt_in')
      .in('user_id', profileIds)
    if (prefsError) throw new Error(prefsError.message)

    const optedIn = new Set((prefs || [])
      .filter((pref: any) => pref.email_promotions_opt_in === true)
      .map((pref: any) => String(pref.user_id)))

    for (const profile of profiles as any[]) {
      if (profile.is_admin || profile.is_staff) continue
      if (!optedIn.has(String(profile.id))) continue
      if (!normalizeEmail(profile.email)) continue
      total += 1
    }

    if (profiles.length < batchSize) break
    offset += batchSize
  }

  return total
}

function isCompletedStatus(value: unknown) {
  return ['complete', 'completed', 'success', 'successful', 'paid', 'finished', 'confirmed', 'delivered'].includes(String(value || '').toLowerCase())
}

function isDepositTransaction(row: any) {
  const amount = Number(row?.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) return false

  const fields = [
    row?.type,
    row?.transaction_type,
    row?.kind,
    row?.category,
    row?.description,
    row?.reference,
  ].map((value) => String(value || '').toLowerCase())

  return fields.some((value) => [
    'topup',
    'top_up',
    'top-up',
    'wallet_topup',
    'deposit',
    'wallet_deposit',
  ].some((token) => value === token || value.includes(token)))
}

async function requireStaffReadPermission(admin: ReturnType<typeof createClient>, user: any, permissionKey: string) {
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, is_admin, is_staff')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) throw new HttpError('Profile not found', 404)

  const isSuperAdmin = user.email?.toLowerCase() === ADMIN_EMAIL
  if (isSuperAdmin || profile.is_admin === true) return profile
  if (profile.is_staff !== true) throw new HttpError('Forbidden - staff only', 403)

  const { data: permission, error: permissionError } = await admin
    .from('staff_permissions')
    .select('is_enabled')
    .eq('user_id', user.id)
    .eq('permission_key', permissionKey)
    .maybeSingle()
  if (permissionError) throw new Error(permissionError.message)
  if (!permission?.is_enabled) throw new HttpError('Permission is not enabled', 403)
  return profile
}

async function getCustomerProfileMap(admin: ReturnType<typeof createClient>, rows: any[]) {
  const userIds = [...new Set(rows.map((row) => row?.user_id).filter(Boolean))]
  const map = new Map<string, any>()
  for (let i = 0; i < userIds.length; i += 500) {
    const slice = userIds.slice(i, i + 500)
    const { data, error } = await admin
      .from('profiles')
      .select('id, email, full_name, is_staff, is_admin')
      .in('id', slice)
    if (error) throw new Error(error.message)
    for (const profile of data || []) {
      if (!profile.is_staff && !profile.is_admin) map.set(profile.id, profile)
    }
  }
  return map
}

function staffHistoryRow(source: string, row: any, profile: any, amount: number, title: string, subtitle?: string) {
  return {
    id: `${source.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${row.id}`,
    source,
    date: row.created_at,
    user_id: row.user_id,
    customer: profile?.full_name || profile?.email || row.user_id || 'Customer',
    customer_email: profile?.email || '',
    title,
    subtitle: subtitle || '',
    amount,
    status: row.status,
    reference: row.reference || row.id,
  }
}

async function readPagedRows(admin: ReturnType<typeof createClient>, table: string, maxRows = 50000) {
  const pageSize = 1000
  const rows: any[] = []

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  return { rows, capped: rows.length >= maxRows, maxRows }
}

async function handleStaffDepositHistory(admin: ReturnType<typeof createClient>, user: any) {
  await requireStaffReadPermission(admin, user, 'tab_transactions')
  const { rows: data, capped, maxRows } = await readPagedRows(admin, 'transactions')

  const rows = (data || []).filter((row) => isCompletedStatus(row.status) && isDepositTransaction(row))
  const profiles = await getCustomerProfileMap(admin, rows)
  const deposits = rows
    .filter((row) => profiles.has(row.user_id))
    .map((row) => staffHistoryRow(
      'Deposits',
      row,
      profiles.get(row.user_id),
      Number(row.amount || 0),
      row.description || row.type || 'Wallet deposit',
      row.balance_after == null ? '' : `Balance after NGN ${Number(row.balance_after || 0).toLocaleString()}`,
    ))

  return json({
    success: true,
    data: deposits,
    warning: capped ? `Loaded the newest ${maxRows.toLocaleString()} transaction rows. Older records may require a narrower export.` : null,
  })
}

async function handleStaffSalesHistory(admin: ReturnType<typeof createClient>, user: any) {
  await requireStaffReadPermission(admin, user, 'tab_sales')
  const cappedSources: string[] = []
  let cappedMaxRows = 0

  const read = async (table: string) => {
    const { rows, capped, maxRows } = await readPagedRows(admin, table)
    if (capped) {
      cappedSources.push(table)
      cappedMaxRows = Math.max(cappedMaxRows, maxRows)
    }
    return rows
  }
  const readSmmServices = async () => {
    const { data, error } = await admin
      .from('smm_services')
      .select('id,name,platform')
    if (error) {
      console.warn('Failed to load SMM service names:', error.message)
      return []
    }
    return data || []
  }

  const [orders, smsOrders, cryptoRows, cryptoWithdrawalRows, billsRows, giftRows, socialRows, smmServices] = await Promise.all([
    read('orders'),
    read('sms_orders'),
    read('crypto_transactions'),
    read('crypto_withdrawals'),
    read('bills_transactions'),
    read('bitrefill_orders'),
    read('smm_orders'),
    readSmmServices(),
  ])

  const allRows = [...orders, ...smsOrders, ...cryptoRows, ...cryptoWithdrawalRows, ...billsRows, ...giftRows, ...socialRows]
  const profiles = await getCustomerProfileMap(admin, allRows)
  const smmServiceById = new Map((smmServices || []).map((service: any) => [String(service.id), service]))
  const rows = [
    ...orders.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) => {
      const details = row.account_details || {}
      const quantity = Number(details.quantity || 1)
      return staffHistoryRow('Products', row, profiles.get(row.user_id), Number(row.amount || 0), details.product_name || 'Product order', `${quantity} item${quantity === 1 ? '' : 's'}`)
    }),
    ...smsOrders.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) =>
      staffHistoryRow('SMS', row, profiles.get(row.user_id), Number(row.price_ngn || row.amount_ngn || row.total_cost || 0), row.service_name || 'SMS order', row.order_type || 'otp'),
    ),
    ...cryptoRows.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) =>
      staffHistoryRow('Crypto', row, profiles.get(row.user_id), Number(row.naira_amount || row.amount || 0), `${row.crypto_type || 'Crypto'} ${row.transaction_type || 'sale'}`, row.crypto_amount ? `${row.crypto_amount} ${row.crypto_type || ''}` : ''),
    ),
    ...cryptoWithdrawalRows.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) =>
      staffHistoryRow('Crypto', row, profiles.get(row.user_id), Number(row.amount || 0), `Withdrawal to ${row.bank_name || 'bank'}`, [row.account_name, row.account_number].filter(Boolean).join(' • ')),
    ),
    ...billsRows.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) =>
      staffHistoryRow('Bills', row, profiles.get(row.user_id), Number(row.amount || 0), row.transaction_type || 'Bill payment', row.service_provider || row.phone || ''),
    ),
    ...giftRows.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) =>
      staffHistoryRow('Gift Cards', row, profiles.get(row.user_id), Number(row.amount_ngn || row.amount || 0), row.product_name || row.product_id || 'Gift card', row.quantity ? `${row.quantity} item(s)` : ''),
    ),
    ...socialRows.filter((row) => isCompletedStatus(row.status) && profiles.has(row.user_id)).map((row) => {
      const service = smmServiceById.get(String(row.service_id))
      return staffHistoryRow('Social Boost', row, profiles.get(row.user_id), Number(row.amount_ngn || row.amount || 0), service?.name || row.service_name || 'Social boost order', [service?.platform, row.quantity ? `${row.quantity} units` : ''].filter(Boolean).join(' • '))
    }),
  ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())

  return json({
    success: true,
    data: rows,
    warning: cappedSources.length > 0
      ? `Loaded the newest ${cappedMaxRows.toLocaleString()} rows from ${cappedSources.join(', ')}. Older records may require a narrower export.`
      : null,
  })
}

async function readLimitedRows(admin: ReturnType<typeof createClient>, table: string, limit = 8) {
  const { data, error } = await admin
    .from(table)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    return { rows: [], error: error.message }
  }
  return { rows: data || [], error: '' }
}

async function handleStaffRevenueOsSnapshot(admin: ReturnType<typeof createClient>, user: any) {
  await requireStaffReadPermission(admin, user, 'tab_revenue_os')

  const settingKeys = [
    'cro_global_enabled',
    'cro_autonomy_level',
    'cro_shadow_mode_enabled',
    'cro_global_holdout_pct',
    'cro_holdout_percentage',
    'cro_experimentation_enabled',
    'cro_promotion_max_discount_pct',
    'cro_promotion_monthly_budget_ngn',
    'cro_maintenance_enabled',
    'cro_maintenance_freeze_reason',
    'cro_maintenance_last_status',
    'cro_maintenance_last_run_at',
    'cro_maintenance_last_summary',
  ]
  const { data: settingsRows, error: settingsError } = await admin
    .from('app_settings')
    .select('key,value,updated_at')
    .in('key', settingKeys)
  if (settingsError) throw new Error(settingsError.message)

  const [
    quality,
    opportunities,
    actionPlans,
    experiments,
    decisions,
  ] = await Promise.all([
    readLimitedRows(admin, 'revenue_data_quality_checks', 8),
    readLimitedRows(admin, 'cro_opportunities', 8),
    readLimitedRows(admin, 'cro_action_plans', 8),
    readLimitedRows(admin, 'cro_experiments', 6),
    readLimitedRows(admin, 'cro_decision_audit', 8),
  ])

  const warnings = [quality, opportunities, actionPlans, experiments, decisions]
    .filter((result) => result.error)
    .map((result) => result.error)

  return json({
    success: true,
    data: {
      settings: Object.fromEntries((settingsRows || []).map((row: any) => [row.key, row.value])),
      settings_updated_at: Object.fromEntries((settingsRows || []).map((row: any) => [row.key, row.updated_at])),
      quality: quality.rows,
      opportunities: opportunities.rows,
      action_plans: actionPlans.rows,
      experiments: experiments.rows,
      decisions: decisions.rows,
      warning: warnings.length ? `Some Revenue OS tables could not be read: ${warnings.join('; ')}` : '',
    },
  })
}

async function daisyCancelNumber(activationId: string) {
  const apiKey = Deno.env.get('DAISYSMS_API_KEY') || ''
  if (!apiKey || !activationId) return
  const url = new URL(Deno.env.get('DAISYSMS_BASE_URL') || DEFAULT_DAISY_BASE)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('action', 'setStatus')
  url.searchParams.set('id', activationId)
  url.searchParams.set('status', '8')
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`DaisySMS cancel failed with HTTP ${res.status}`)
}

async function updateProductGroupStock(admin: ReturnType<typeof createClient>, productGroupId: string) {
  const { count, error } = await admin
    .from('individual_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('product_group_id', productGroupId)
    .eq('status', 'available')

  if (error) throw new Error(error.message)

  const { error: updateError } = await admin
    .from('product_groups')
    .update({ stock_count: count || 0 })
    .eq('id', productGroupId)

  if (updateError) throw new Error(updateError.message)
}

async function applyAccountPendingAction(admin: ReturnType<typeof createClient>, pendingAction: any) {
  const action = pendingAction.action_type
  const d = pendingAction.action_data || {}
  const now = new Date().toISOString()

  if (action === 'add_single_account') {
    const productGroupId = String(d.product_group_id || '').trim()
    const username = String(d.username || '').trim()
    const password = String(d.password || '').trim()
    const email = typeof d.email === 'string' && d.email.trim() ? d.email.trim() : null

    if (!productGroupId || !username || !password) throw new Error('Missing required account fields')

    const { data, error } = await admin
      .from('individual_accounts')
      .insert([{
        product_group_id: productGroupId,
        username,
        password,
        email,
        status: 'available',
        created_at: now,
      }])
      .select()
      .single()

    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error('Failed to create account')

    await updateProductGroupStock(admin, productGroupId)
    return { accountsCreated: 1 }
  }

  if (action === 'bulk_upload_accounts') {
    const productGroupId = String(d.product_group_id || '').trim()
    const parsedRows = Array.isArray(d.parsed_rows) ? d.parsed_rows : []

    if (!productGroupId) throw new Error('Missing product group for bulk upload')
    if (!parsedRows.length) throw new Error('No valid CSV rows')

    const hasAnyUsernameOrEmail = parsedRows.some((r: any) => (r.username && String(r.username).trim()) || (r.email && String(r.email).trim()))
    const hasPasswordAtAnyRow = parsedRows.some((r: any) => r && String(r.password || '').trim())
    if (!hasPasswordAtAnyRow) throw new Error('CSV must contain a password column/value')
    if (!hasAnyUsernameOrEmail) throw new Error('CSV must contain email or username values')

    const accounts = parsedRows
      .map((row: any) => {
        const password = row?.password ? String(row.password).trim() : ''
        const username = row?.username ? String(row.username).trim() : (row?.email ? String(row.email).trim() : '')
        const email = row?.email ? String(row.email).trim() : null
        const emailPassword = row?.email_password ? String(row.email_password).trim() : null
        const twoFaCode = row?.two_fa ? String(row.two_fa).trim() : row?.two_fa_code ? String(row.two_fa_code).trim() : null
        const recoveryEmail = row?.recovery_email ? String(row.recovery_email).trim() : null
        const recoveryEmailPassword = row?.recovery_email_password ? String(row.recovery_email_password).trim() : null

        if (!password || !username) return null
        return {
          product_group_id: productGroupId,
          username,
          password,
          email,
          email_password: emailPassword,
          two_fa_code: twoFaCode,
          recovery_email: recoveryEmail,
          recovery_email_password: recoveryEmailPassword,
          status: 'available',
          created_at: now,
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>

    if (!accounts.length) throw new Error('No valid accounts found in CSV')

    const { error } = await admin.from('individual_accounts').insert(accounts)
    if (error) throw new Error(error.message)

    await updateProductGroupStock(admin, productGroupId)
    return { accountsCreated: accounts.length }
  }

  throw new Error('Unsupported account action type')
}

async function refundSmsOrderWallet(admin: ReturnType<typeof createClient>, order: any, reason: string) {
  const amount = Number(order?.price_ngn || 0)
  if (!order?.id || !order?.user_id || amount <= 0) return { refunded: true, amount: 0 }

  const refundRef = `REFUND-${order.reference || order.id}`
  const { data: currentOrder } = await admin
    .from('sms_orders')
    .select('refunded_at, refund_reference')
    .eq('id', order.id)
    .maybeSingle()
  if (currentOrder?.refunded_at) {
    await recordSmsRefundRevenueEvents(admin, order, amount, currentOrder.refund_reference || refundRef, reason, true)
    return { refunded: true, amount, reference: currentOrder.refund_reference, alreadyRefunded: true }
  }

  const { data: existingTx } = await admin
    .from('transactions')
    .select('id, status')
    .eq('reference', refundRef)
    .maybeSingle()

  if (existingTx?.status === 'completed') {
    await admin
      .from('sms_orders')
      .update({ refunded_at: new Date().toISOString(), refund_amount_ngn: amount, refund_reference: refundRef })
      .eq('id', order.id)
      .is('refunded_at', null)
    await recordSmsRefundRevenueEvents(admin, order, amount, refundRef, reason, true)
    return { refunded: true, amount, reference: refundRef, alreadyRefunded: true }
  }

  const tx = existingTx || (await admin.from('transactions').insert({
    user_id: order.user_id,
    type: 'refund',
    amount,
    balance_after: 0,
    description: reason,
    reference: refundRef,
    status: 'pending',
  }).select('id, status').single()).data
  if (!tx) throw new Error('Refund transaction could not be created')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: profile } = await admin.from('profiles').select('wallet_balance').eq('id', order.user_id).single()
    if (!profile) break
    const currentBalance = Number(profile.wallet_balance || 0)
    const nextBalance = currentBalance + amount
    const { data: updated } = await admin
      .from('profiles')
      .update({ wallet_balance: nextBalance, updated_at: new Date().toISOString() })
      .eq('id', order.user_id)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single()

    if (updated) {
      await admin.from('transactions').update({ status: 'completed', balance_after: nextBalance }).eq('id', tx.id)
      await admin
        .from('sms_orders')
        .update({ refunded_at: new Date().toISOString(), refund_amount_ngn: amount, refund_reference: refundRef })
        .eq('id', order.id)
        .is('refunded_at', null)
      await recordSmsRefundRevenueEvents(admin, order, amount, refundRef, reason)
      return { refunded: true, amount, reference: refundRef }
    }
  }

  throw new Error('Refund could not be credited')
}

async function applySmsPendingAction(admin: ReturnType<typeof createClient>, pendingAction: any) {
  const d = pendingAction.action_data || {}
  const now = new Date().toISOString()

  if (pendingAction.action_type === 'sms_update_product') {
    const serviceCode = String(d.service_code || '').trim()
    if (!serviceCode) throw new Error('SMS service_code missing')
    const updates: Record<string, unknown> = { service_code: serviceCode, updated_at: now }
    if (typeof d.service_name === 'string') updates.service_name = d.service_name.trim()
    if (typeof d.is_enabled === 'boolean') updates.is_enabled = d.is_enabled
    if (typeof d.is_favorite === 'boolean') updates.is_favorite = d.is_favorite
    if (typeof d.auto_markup_enabled === 'boolean') updates.auto_markup_enabled = d.auto_markup_enabled
    if (Object.prototype.hasOwnProperty.call(d, 'price_override_ngn')) updates.price_override_ngn = optionalNaira(d.price_override_ngn)
    if (Object.prototype.hasOwnProperty.call(d, 'margin_ngn')) updates.margin_ngn = optionalNaira(d.margin_ngn)

    const { error } = await admin.from('sms_product_settings').upsert(updates, { onConflict: 'service_code' })
    if (error) throw new Error(error.message)
    return
  }

  if (pendingAction.action_type === 'sms_bulk_products') {
    if (typeof d.is_enabled !== 'boolean') throw new Error('SMS is_enabled missing')
    const { data: rows, error: loadError } = await admin.from('sms_product_settings').select('service_code, service_name')
    if (loadError) throw new Error(loadError.message)
    const updates = (rows || []).map((row: any) => ({
      service_code: row.service_code,
      service_name: row.service_name,
      is_enabled: d.is_enabled,
      updated_at: now,
    }))
    if (updates.length > 0) {
      const { error } = await admin.from('sms_product_settings').upsert(updates, { onConflict: 'service_code' })
      if (error) throw new Error(error.message)
    }
    return
  }

  if (pendingAction.action_type === 'sms_apply_markup') {
    const marginNgn = optionalNaira(d.margin_ngn)
    if (marginNgn === null) throw new Error('SMS markup missing')
    const keepAutoApplying = d.keep_auto_applying !== false

    const { error: settingError } = await admin
      .from('app_settings')
      .upsert({ key: 'sms_default_margin_ngn', value: String(marginNgn), updated_at: now }, { onConflict: 'key' })
    if (settingError) throw new Error(settingError.message)

    const { error } = await admin
      .from('sms_product_settings')
      .update({ margin_ngn: marginNgn, auto_markup_enabled: keepAutoApplying, updated_at: now })
      .neq('service_code', '')
    if (error) throw new Error(error.message)
    return
  }

  if (pendingAction.action_type === 'sms_set_rounding') {
    if (typeof d.round_to_nearest_10 !== 'boolean') throw new Error('SMS rounding value missing')
    const { error } = await admin
      .from('app_settings')
      .upsert({
        key: 'sms_round_markup_to_nearest_10',
        value: d.round_to_nearest_10 ? 'true' : 'false',
        updated_at: now,
      }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    return
  }

  if (pendingAction.action_type === 'sms_cancel_order') {
    const orderId = String(d.order_id || '').trim()
    if (!orderId) throw new Error('SMS order_id missing')

    const { data: order, error } = await admin.from('sms_orders').select('*').eq('id', orderId).single()
    if (error || !order) throw new Error(error?.message || 'SMS order not found')

    if (!SMS_TERMINAL_STATUSES.includes(String(order.status || '').toLowerCase())) {
      if (order.provider_request_id) {
        try { await daisyCancelNumber(String(order.provider_request_id)) } catch { /* keep local cancellation moving */ }
      }
      const { error: updateError } = await admin
        .from('sms_orders')
        .update({ status: 'cancelled', cancelled_at: now })
        .eq('id', order.id)
      if (updateError) throw new Error(updateError.message)
    }

    await refundSmsOrderWallet(admin, order, `Approved staff refund for cancelled SMS order: ${order.reference || order.id}`)
    return
  }

  if (pendingAction.action_type === 'sms_auto_cancel_stale') {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: staleOrders, error } = await admin
      .from('sms_orders')
      .select('*')
      .not('status', 'in', `(${SMS_TERMINAL_STATUSES.map((status) => `"${status}"`).join(',')})`)
      .lt('created_at', cutoff)
    if (error) throw new Error(error.message)

    let cancelled = 0
    for (const order of staleOrders || []) {
      if (order.messages && Array.isArray(order.messages) && order.messages.length > 0) continue
      try {
        if (order.provider_request_id) {
          try { await daisyCancelNumber(String(order.provider_request_id)) } catch { /* keep local cancellation moving */ }
        }
        await admin.from('sms_orders').update({ status: 'cancelled', cancelled_at: now }).eq('id', order.id)
        await refundSmsOrderWallet(admin, order, `Approved staff auto-refund for stale SMS order: ${order.reference || order.id}`)
        cancelled += 1
      } catch {
        // Skip individual failures so one stale order does not block the batch.
      }
    }
    return { cancelled_count: cancelled }
  }

  throw new Error('Unsupported SMS action type')
}

const STAFF_ACTIONS_BY_PERMISSION: Record<string, string[]> = {
  tab_add_product: ['add_single_account'],
  tab_bulk_upload: ['bulk_upload_accounts'],
  tab_products: ['update_product_group'],
  tab_discount_codes: ['create_discount_code', 'toggle_discount_code'],
  tab_sms_products: ['sms_update_product', 'sms_bulk_products', 'sms_apply_markup', 'sms_set_rounding'],
  tab_sms_orders: ['sms_cancel_order', 'sms_auto_cancel_stale'],
  tab_revenue_os: ['cro_update_controls'],
  tab_categories: ['create_category'],
  tab_email: ['send_email_list', 'broadcast_email'],
  tab_templates: ['update_product_group'],
  setting_rate: ['upsert_setting'],
  setting_referral_pct: ['upsert_setting'],
  setting_ercas: ['upsert_setting'],
  setting_support_links: ['upsert_settings'],
  action_adjust_balance: ['adjust_balance'],
}

const STAFF_SETTING_KEYS_BY_PERMISSION: Record<string, string[]> = {
  setting_rate: ['ngn_usd_rate'],
  setting_referral_pct: ['referral_commission_pct'],
  setting_ercas: ['ercas_enabled'],
  setting_support_links: [
    'support_whatsapp_url',
    'support_telegram_url',
    'support_channel_url',
    'support_popup_message',
  ],
}

function requireAllowedStaffAction(pendingAction: any) {
  const permissionKey = String(pendingAction.permission_key || '').trim()
  const action = String(pendingAction.action_type || '').trim()
  const d = pendingAction.action_data || {}
  const allowedActions = STAFF_ACTIONS_BY_PERMISSION[permissionKey] || []

  if (!permissionKey || !action || !allowedActions.includes(action)) {
    throw new Error('Action is not allowed for this staff permission')
  }

  if (action === 'upsert_setting') {
    const key = String(d.setting_key || '').trim()
    const allowedKeys = STAFF_SETTING_KEYS_BY_PERMISSION[permissionKey] || []
    if (!allowedKeys.includes(key)) throw new Error('Setting is not allowed for this staff permission')
  }

  if (action === 'upsert_settings') {
    const settings = d.settings && typeof d.settings === 'object' ? d.settings : {}
    const allowedKeys = STAFF_SETTING_KEYS_BY_PERMISSION[permissionKey] || []
    const keys = Object.keys(settings)
    if (!keys.length) throw new Error('No settings provided')
    const blocked = keys.filter((key) => !allowedKeys.includes(key))
    if (blocked.length) throw new Error('One or more settings are not allowed for this staff permission')
  }
}

function sanitizeAllowedStaffSettingValue(permissionKey: string, key: string, rawValue: unknown) {
  const value = String(rawValue ?? '').trim()

  if (permissionKey === 'setting_rate' && key === 'ngn_usd_rate') {
    const rate = Number(value)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100000) {
      throw new Error('NGN/USD rate must be a positive number')
    }
    return String(rate)
  }

  if (permissionKey === 'setting_referral_pct' && key === 'referral_commission_pct') {
    const percent = Number(value)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('Referral commission must be between 0 and 100')
    }
    return String(percent)
  }

  if (permissionKey === 'setting_ercas' && key === 'ercas_enabled') {
    return value === 'true' ? 'true' : 'false'
  }

  if (permissionKey === 'setting_support_links') {
    if (key === 'support_popup_message') return value.slice(0, 500)
    if (value && !/^https?:\/\//i.test(value)) {
      throw new Error('Support links must start with http:// or https://')
    }
    return value.slice(0, 500)
  }

  return value
}

async function applyStaffAction(admin: ReturnType<typeof createClient>, pendingAction: any) {
  requireAllowedStaffAction(pendingAction)
  const permissionKey = String(pendingAction.permission_key || '').trim()
  const action = String(pendingAction.action_type || '')
  const d = pendingAction.action_data || {}
  const now = new Date().toISOString()

  if (action === 'upsert_setting') {
    const key = String(d.setting_key || '').trim()
    if (!key) throw new Error('setting_key required')
    const value = sanitizeAllowedStaffSettingValue(permissionKey, key, d.value)
    const { error } = await admin
      .from('app_settings')
      .upsert({ key, value, updated_at: now }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'upsert_settings') {
    const settings = d.settings || {}
    const rows = Object.entries(settings).map(([key, value]) => ({
      key,
      value: sanitizeAllowedStaffSettingValue(permissionKey, key, value),
      updated_at: now,
    }))
    if (!rows.length) throw new Error('No settings provided')
    const { error } = await admin.from('app_settings').upsert(rows, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'cro_update_controls') {
    const settings = d.settings && typeof d.settings === 'object' ? d.settings : {}
    const allowedKeys = new Set([
      'cro_global_enabled',
      'cro_autonomy_level',
      'cro_shadow_mode_enabled',
      'cro_global_holdout_pct',
      'cro_holdout_percentage',
      'cro_experimentation_enabled',
      'cro_promotion_max_discount_pct',
      'cro_promotion_monthly_budget_ngn',
      'cro_maintenance_enabled',
    ])
    const rowsByKey = new Map<string, { key: string; value: string; updated_at: string }>()
    Object.entries(settings)
      .filter(([key]) => allowedKeys.has(key))
      .forEach(([rawKey, rawValue]) => {
        const key = rawKey === 'cro_holdout_percentage' ? 'cro_global_holdout_pct' : rawKey
        let value = String(rawValue ?? '').trim()
        if (['cro_global_enabled', 'cro_shadow_mode_enabled', 'cro_maintenance_enabled', 'cro_experimentation_enabled'].includes(key)) {
          value = value === 'true' ? 'true' : 'false'
        }
        if (key === 'cro_autonomy_level') {
          const level = Math.max(0, Math.min(8, Math.round(Number(value))))
          if (!Number.isFinite(level)) throw new Error('Autonomy level must be between 0 and 8')
          value = String(level)
        }
        if (key === 'cro_global_holdout_pct') {
          const holdout = Math.max(0, Math.min(50, Number(value)))
          if (!Number.isFinite(holdout)) throw new Error('Holdout percentage must be between 0 and 50')
          value = String(holdout)
        }
        if (key === 'cro_promotion_max_discount_pct') {
          const maxDiscount = Math.max(0, Math.min(90, Number(value)))
          if (!Number.isFinite(maxDiscount)) throw new Error('Promotion max discount must be between 0 and 90')
          value = String(maxDiscount)
        }
        if (key === 'cro_promotion_monthly_budget_ngn') {
          const budget = Math.max(0, Math.round(Number(value)))
          if (!Number.isFinite(budget)) throw new Error('Promotion monthly budget must be 0 or higher')
          value = String(budget)
        }
        rowsByKey.set(key, { key, value, updated_at: now })
      })
    const rows = Array.from(rowsByKey.values())

    if (!rows.length) throw new Error('No permitted Revenue OS control changes provided')
    if (rows.some((row) => row.key === 'cro_global_enabled' && row.value === 'true')) {
      const { data: freezeSetting } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'cro_maintenance_freeze_reason')
        .maybeSingle()
      const freezeReason = String(freezeSetting?.value || '').trim()
      if (freezeReason) {
        throw new Error(`Revenue OS is frozen by guardrail: ${freezeReason}`)
      }
    }
    const { error } = await admin.from('app_settings').upsert(rows, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    return { updated: rows.length }
  }

  if (action === 'send_email_list') {
    const subject = String(d.subject || '').trim()
    const message = String(d.message || '').trim()
    const recipients = Array.isArray(d.recipients)
      ? Array.from(new Set(d.recipients.map(normalizeEmail).filter(Boolean)))
      : []
    if (!subject || !message || recipients.length === 0) throw new Error('Subject, message, and recipients are required')

    const html = buildEmailHtml(message)
    let sent = 0
    const failedEmails: string[] = []
    for (const to of recipients) {
      const result = await sendEmail({ to, subject, html })
      if (result.success) sent += 1
      else failedEmails.push(to)
    }
    if (sent === 0) throw new Error('No emails were sent')
    return { sent, failed: failedEmails.length, failedEmails }
  }

  if (action === 'broadcast_email') {
    const subject = String(d.subject || '').trim()
    const message = String(d.message || '').trim()
    if (!subject || !message) throw new Error('Subject and message are required')

    const totalRecipients = await countPromotionConsentedCustomers(admin)
    if (totalRecipients <= 0) throw new Error('No customers have opted in to promotional email broadcasts.')

    const { data: job, error } = await admin
      .from('broadcast_jobs')
      .insert({
        subject,
        html_body: buildEmailHtml(message),
        status: 'queued',
        total_recipients: totalRecipients,
        created_by: pendingAction.staff_id || null,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return { job_id: job?.id, total_recipients: totalRecipients, audience: 'promotion_opted_in_customers' }
  }

  if (['add_single_account', 'bulk_upload_accounts'].includes(action)) {
    return await applyAccountPendingAction(admin, pendingAction)
  }

  if (action.startsWith('sms_')) {
    return await applySmsPendingAction(admin, pendingAction) || {}
  }

  if (action === 'create_category') {
    const name = String(d.name || '').trim()
    if (!name) throw new Error('Category name required')
    const { error } = await admin.from('categories').insert({
      name,
      description: typeof d.description === 'string' && d.description.trim() ? d.description.trim() : null,
      is_active: true,
    })
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'create_discount_code') {
    const code = String(d.code || '').trim().toUpperCase()
    const percentOff = Number(d.percent_off)
    const maxUses = d.max_uses ? Number(d.max_uses) : null
    const expiresAt = d.expires_at || null
    if (!code) throw new Error('Discount code required')
    if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) throw new Error('Discount percentage must be between 1 and 100')
    const { data: maxDiscountSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'cro_promotion_max_discount_pct')
      .maybeSingle()
    const maxDiscount = Math.max(0, Math.min(90, Number(maxDiscountSetting?.value ?? 20)))
    if (percentOff > maxDiscount) {
      throw new Error(`Discount exceeds Revenue OS guardrail max of ${maxDiscount}%.`)
    }
    if (!d.category_id && !d.product_group_id && !d.user_id && !maxUses) {
      throw new Error('Store-wide discount codes must have a usage limit.')
    }
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      throw new Error('Discount expiry cannot be in the past.')
    }
    if (d.product_group_id) {
      const { data: product, error: productError } = await admin
        .from('product_groups')
        .select('id,is_active,price,stock_count,auto_fulfill_enabled,muabanvia_product_id,shopclone_product_id,shopviaclone_product_id')
        .eq('id', d.product_group_id)
        .maybeSingle()
      if (productError) throw new Error(productError.message)
      const active = product?.is_active !== false
      const validPrice = Number(product?.price || 0) > 0
      const available = Number(product?.stock_count || 0) > 0 || Boolean(
        product?.auto_fulfill_enabled &&
        (product?.muabanvia_product_id ||
          product?.shopclone_product_id ||
          product?.shopviaclone_product_id),
      )
      if (!product || !active || !validPrice || !available) {
        throw new Error('Discount product scope must point to a currently sellable product.')
      }
    }
    const { error } = await admin.from('discount_codes').insert({
      code,
      percent_off: Math.round(percentOff),
      category_id: d.category_id || null,
      product_group_id: d.product_group_id || null,
      max_uses: maxUses,
      expires_at: expiresAt,
    })
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'toggle_discount_code') {
    const id = String(d.id || '').trim()
    if (!id || typeof d.is_active !== 'boolean') throw new Error('Discount id and status required')
    const { error } = await admin.from('discount_codes').update({ is_active: d.is_active }).eq('id', id)
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'update_product_group') {
    const id = String(d.id || '').trim()
    const updates = d.updates || {}
    if (!id) throw new Error('Product id required')
    const allowed: Record<string, unknown> = {}
    if (Object.prototype.hasOwnProperty.call(updates, 'price')) {
      const price = Number(updates.price)
      if (!Number.isFinite(price) || price <= 0) throw new Error('Product price must be greater than zero')
      allowed.price = price
    }
    for (const key of ['muabanvia_product_id', 'shopclone_product_id', 'shopviaclone_product_id']) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        const value = updates[key]
        allowed[key] = typeof value === 'string' && value.trim() ? value.trim() : null
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'auto_fulfill_enabled')) {
      allowed.auto_fulfill_enabled = updates.auto_fulfill_enabled === true
    }
    if (!Object.keys(allowed).length) throw new Error('No permitted product updates provided')
    const { error } = await admin.from('product_groups').update(allowed).eq('id', id)
    if (error) throw new Error(error.message)
    return {}
  }

  if (action === 'adjust_balance') {
    const userId = String(d.user_id || '').trim()
    const amount = Number(d.amount)
    if (!userId || !Number.isFinite(amount) || amount === 0) throw new Error('Valid user and amount required')
    const { data: profile, error: loadError } = await admin
      .from('profiles')
      .select('wallet_balance,is_staff,is_admin')
      .eq('id', userId)
      .single()
    if (loadError || !profile) throw new Error(loadError?.message || 'User not found')
    if (profile.is_staff || profile.is_admin) throw new Error('Balance adjustments are only allowed for customer accounts')
    const newBal = (Number(profile.wallet_balance) || 0) + amount
    if (newBal < 0) throw new Error('Balance cannot go below zero')
    const { error: updateError } = await admin.from('profiles').update({ wallet_balance: newBal }).eq('id', userId)
    if (updateError) throw new Error(updateError.message)
    const { error: txError } = await admin.from('transactions').insert({
      user_id: userId,
      type: 'adjustment',
      amount,
      status: 'completed',
      balance_after: newBal,
      description: d.reason || 'Approved staff balance adjustment',
      reference: `STAFF-ADJ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    })
    if (txError) throw new Error(txError.message)
    return { balance_after: newBal }
  }

  throw new Error('Unsupported action type')
}

async function submitStaffAction(admin: ReturnType<typeof createClient>, user: any, body: Record<string, any>) {
  const permissionKey = String(body.permission_key || '').trim()
  const actionType = String(body.action_type || '').trim()
  const actionLabel = String(body.action_label || actionType).trim()
  const actionData = body.action_data && typeof body.action_data === 'object' ? body.action_data : {}

  if (!permissionKey || !actionType) return json({ error: 'permission_key and action_type required' }, 400)
  requireAllowedStaffAction({
    permission_key: permissionKey,
    action_type: actionType,
    action_data: actionData,
  })

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, is_admin, is_staff')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) return json({ error: 'Profile not found' }, 403)

  const isSuperAdmin = user.email?.toLowerCase() === ADMIN_EMAIL
  const isAdmin = isSuperAdmin || profile.is_admin === true
  if (!isAdmin && profile.is_staff !== true) return json({ error: 'Forbidden — staff only' }, 403)

  let autoApprove = true
  if (!isAdmin) {
    const { data: permission, error: permissionError } = await admin
      .from('staff_permissions')
      .select('is_enabled, auto_approve')
      .eq('user_id', user.id)
      .eq('permission_key', permissionKey)
      .maybeSingle()
    if (permissionError) return json({ error: permissionError.message }, 500)
    if (!permission?.is_enabled) return json({ error: 'Permission is not enabled' }, 403)
    autoApprove = permission.auto_approve !== false
  }

  const pendingRow = {
    staff_id: user.id,
    staff_email: user.email,
    permission_key: permissionKey,
    action_type: actionType,
    action_label: actionLabel,
    action_data: actionData,
  }

  if (!autoApprove) {
    const { error } = await admin.from('staff_pending_actions').insert(pendingRow)
    if (error) return json({ error: error.message }, 500)
    return json({ success: true, queued: true, applied: false })
  }

  const result = await applyStaffAction(admin, pendingRow)
  const { error: auditError } = await admin.from('staff_pending_actions').insert({
    ...pendingRow,
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
  })
  if (auditError) console.error('staff action audit insert failed:', auditError.message)

  return json({ success: true, queued: false, applied: true, ...result })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const { action } = body

    if (action === 'submit_staff_action') {
      return await submitStaffAction(admin, user, body)
    }

    if (action === 'staff_deposit_history') {
      return await handleStaffDepositHistory(admin, user)
    }

    if (action === 'staff_sales_history') {
      return await handleStaffSalesHistory(admin, user)
    }

    if (action === 'staff_revenue_os_snapshot') {
      return await handleStaffRevenueOsSnapshot(admin, user)
    }

    // Remaining staff-management operations are super-admin only.
    if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
      return json({ error: 'Forbidden — admin only' }, 403)
    }

    // ── List all staff users ─────────────────────────────────────────────
    if (action === 'list_staff') {
      const { data, error } = await admin
        .from('profiles')
        .select('id, email, is_staff, wallet_balance')
        .eq('is_staff', true)
        .order('email')
      if (error) return json({ error: error.message }, 500)
      return json({ users: data || [] })
    }

    // ── Grant / revoke staff role ────────────────────────────────────────
    if (action === 'grant_staff' || action === 'revoke_staff') {
      const { user_id } = body
      if (!user_id) return json({ error: 'user_id required' }, 400)
      const { error } = await admin
        .from('profiles')
        .update({ is_staff: action === 'grant_staff' })
        .eq('id', user_id)
      if (error) return json({ error: error.message }, 500)
      return json({ success: true })
    }

    // ── List permissions for one staff user ─────────────────────────────
    if (action === 'list_permissions') {
      const { user_id } = body
      if (!user_id) return json({ error: 'user_id required' }, 400)
      const { data, error } = await admin
        .from('staff_permissions')
        .select('permission_key, is_enabled, auto_approve')
        .eq('user_id', user_id)
      if (error) return json({ error: error.message }, 500)
      return json({ permissions: data || [] })
    }

    // ── Set a single permission ──────────────────────────────────────────
    if (action === 'set_permission') {
      const { user_id, permission_key, is_enabled, auto_approve } = body
      if (!user_id || !permission_key) return json({ error: 'user_id and permission_key required' }, 400)
      const { error } = await admin
        .from('staff_permissions')
        .upsert(
          { user_id, permission_key, is_enabled: !!is_enabled, auto_approve: auto_approve !== false },
          { onConflict: 'user_id,permission_key' }
        )
      if (error) return json({ error: error.message }, 500)
      return json({ success: true })
    }

    // ── List all pending actions ─────────────────────────────────────────
    if (action === 'list_pending') {
      const { data, error } = await admin
        .from('staff_pending_actions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      return json({ actions: data || [] })
    }

  // ── Approve / reject a pending action ───────────────────────────────
  if (action === 'approve_action' || action === 'reject_action') {
      const { action_id } = body
      if (!action_id) return json({ error: 'action_id required' }, 400)

      if (action === 'approve_action') {
        const { data: pendingAction, error: claimError } = await admin
          .from('staff_pending_actions')
          .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
          .eq('id', action_id)
          .eq('status', 'pending')
          .select('*')
          .maybeSingle()

        if (claimError) return json({ error: claimError.message }, 500)
        if (!pendingAction?.id) return json({ error: 'Pending action not found or already reviewed' }, 409)

        try {
          await applyStaffAction(admin, pendingAction)
        } catch (err) {
          await admin
            .from('staff_pending_actions')
            .update({ status: 'failed' })
            .eq('id', action_id)
          throw err
        }
      } else {
        const { data: reviewed, error: reviewError } = await admin
          .from('staff_pending_actions')
          .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
          .eq('id', action_id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle()

        if (reviewError) return json({ error: reviewError.message }, 500)
        if (!reviewed?.id) return json({ error: 'Pending action not found or already reviewed' }, 409)
      }

      return json({ success: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    const status = err instanceof HttpError ? err.status : 500
    console.error('manage-staff error:', msg)
    return json({ error: msg }, status)
  }
})
