import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { authenticateCustomerRequest } from '../_shared/customer-api-delegation.ts'
import { readTelegramApiBody, validTelegramApiInput, type TelegramApiAction } from '../_shared/telegram-api-contract.ts'
import { telegramProviderJson } from '../_shared/telegram-provider-transport.ts'
import { canonicalTelegramApiPurchase, telegramApiDebitProven } from '../_shared/telegram-api-replay.ts'

type SupabaseAdmin = any

const ISTAR_BASE = Deno.env.get('ISTAR_BASE_URL') || 'https://v1.fragmentapi.com/api/v1/partner'
const ISTAR_API_KEY = Deno.env.get('ISTAR_API_KEY') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tally-api-capability',
  'Cache-Control': 'no-store',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function publicTelegramOrder(order: any) {
  if (!order) return order
  return {
    id: order.id,
    reference: order.reference,
    order_type: order.order_type,
    username: order.username,
    quantity: order.quantity,
    months: order.months,
    price_ngn: order.price_ngn,
    status: order.status,
    error_message: order.status === 'failed' ? 'Order failed. Contact support for details.' : null,
    refunded_at: order.refunded_at,
    created_at: order.created_at,
    completed_at: order.completed_at,
  }
}

function publicTelegramRecipient(recipient: any) {
  return {
    recipient: recipient?.recipient,
    name: recipient?.name,
    photo: recipient?.photo,
    myself: recipient?.myself === true,
  }
}

function telegramOrdersEnabled() {
  return String(Deno.env.get('TELEGRAM_ORDERS_ENABLED') || '').trim().toLowerCase() === 'true'
}

function istarHeaders() {
  return { 'API-Key': ISTAR_API_KEY, 'Content-Type': 'application/json' }
}

async function istarGet(path: string) {
  return telegramProviderJson(`${ISTAR_BASE}${path}`, { headers: istarHeaders() }, { timeoutMs: 15_000 })
}

async function istarPost(path: string, body: unknown, idempotencyKey: string) {
  return telegramProviderJson(`${ISTAR_BASE}${path}`, {
    method: 'POST',
    headers: { ...istarHeaders(), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  }, { timeoutMs: 25_000 })
}

// ── Auth helpers ─────────────────────────────────────────────────────────────
async function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

async function getUser(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) throw new Error('Unauthorized')
  const jwt = auth.replace(/^Bearer\s+/i, '')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) throw new Error('Unauthorized')
  return user
}

async function requireAdmin(admin: SupabaseAdmin, userId: string) {
  const { data } = await admin.from('profiles').select('is_admin, account_suspended').eq('id', userId).single()
  if (!data?.is_admin || data.account_suspended === true) throw new Error('Admin access required')
}

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


async function assertPurchasingCustomer(admin: SupabaseAdmin, userId: string, req?: Request | null, amountNgn?: number) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin, account_suspended')
    .eq('id', userId)
    .single()

  if (error) throw new Error('Could not verify purchase permission')
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

// ── Exchange rate ─────────────────────────────────────────────────────────────
async function getUsdtToNgn(admin: SupabaseAdmin): Promise<number> {
  // Try admin override first
  const { data } = await admin.from('app_settings').select('value').eq('key', 'ngn_usd_rate').maybeSingle()
  const override = Number(data?.value)
  if (Number.isFinite(override) && override > 0) return override
  // Live rate
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
    const d = await res.json()
    const rate = Number(d.rates?.NGN)
    if (rate > 0) return rate
  } catch { /* fall through */ }
  throw new Error('Exchange rate unavailable. Set ngn_usd_rate in app settings.')
}

// ── Star pricing helpers ──────────────────────────────────────────────────────
type MarkupTier = { min_qty: number; max_qty: number | null; markup_ngn: number }

async function getStarPricingConfig(admin: SupabaseAdmin): Promise<{
  cost_per_star_usdt: number
  markup_tiers: MarkupTier[]
  wallet_type: string
  usdt_to_ngn: number
}> {
  const [costRow, tiersRow, walletRow, usdtToNgn] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_star_cost_usdt').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_star_markup_tiers').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_wallet_type').maybeSingle(),
    getUsdtToNgn(admin),
  ])
  const cost_per_star_usdt = Number(costRow.data?.value || 0.013)
  const wallet_type = String(walletRow.data?.value || 'USDT').toUpperCase()
  let markup_tiers: MarkupTier[] = []
  try { markup_tiers = JSON.parse(tiersRow.data?.value || '[]') } catch { markup_tiers = [] }
  return { cost_per_star_usdt, markup_tiers, wallet_type, usdt_to_ngn: usdtToNgn }
}

function calculateStarPriceNgn(quantity: number, config: { cost_per_star_usdt: number; markup_tiers: MarkupTier[]; usdt_to_ngn: number }): number {
  const baseCost = config.cost_per_star_usdt * quantity * config.usdt_to_ngn
  const tier = config.markup_tiers.find(t =>
    quantity >= t.min_qty && (t.max_qty === null || quantity <= t.max_qty)
  )
  const markup = tier ? Number(tier.markup_ngn) : 0
  return Math.ceil((baseCost + markup) / 10) * 10
}

// ── Premium pricing helpers ───────────────────────────────────────────────────
async function getPremiumPricingConfig(admin: SupabaseAdmin): Promise<{
  costs: Record<string, number>
  markups: Record<string, number>  // per-tier NGN markup keyed by months string
  usdt_to_ngn: number
}> {
  const [m3Row, m6Row, m12Row, usdtNgn] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_3m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_6m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn_12m').maybeSingle(),
    getUsdtToNgn(admin),
  ])
  const markups: Record<string, number> = {
    '3':  Number(m3Row.data?.value  || 0),
    '6':  Number(m6Row.data?.value  || 0),
    '12': Number(m12Row.data?.value || 0),
  }

  // Fetch live pricing from iStar
  try {
    const packages = await istarGet('/premium/packages')
    const costs: Record<string, number> = {}
    for (const pkg of Array.isArray(packages) ? packages : []) {
      if (pkg.months && pkg.usd_value) costs[String(pkg.months)] = Number(pkg.usd_value)
    }
    if (Object.keys(costs).length > 0) return { costs, markups, usdt_to_ngn: usdtNgn }
  } catch (err) {
    console.warn('Failed to fetch live premium packages from iStar, falling back to stored costs:', err)
  }

  // Fallback to stored app_settings costs
  const [c3, c6, c12] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_3m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_6m').maybeSingle(),
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_cost_usdt_12m').maybeSingle(),
  ])
  return {
    costs: {
      '3':  Number(c3.data?.value  || 0),
      '6':  Number(c6.data?.value  || 0),
      '12': Number(c12.data?.value || 0),
    },
    markups,
    usdt_to_ngn: usdtNgn,
  }
}

function calcPremiumPriceNgn(months: number, cfg: { costs: Record<string, number>; markups: Record<string, number>; usdt_to_ngn: number }): number {
  const cost = cfg.costs[String(months)] || 0
  if (!cost) return 0
  const markup = cfg.markups[String(months)] || 0
  return Math.ceil((cost * cfg.usdt_to_ngn + markup) / 10) * 10
}

function normalizeIdempotencyKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length < 10 || key.length > 160) {
    throw new Error('Valid idempotency_key is required')
  }
  return key
}

// ── Wallet helpers ────────────────────────────────────────────────────────────
async function applyWalletTransaction(
  admin: SupabaseAdmin,
  params: {
    userId: string
    type: string
    amount: number
    reference: string
    description: string
    idempotencyKey: string
    metadata?: Record<string, unknown>
  },
) {
  const { data, error } = await admin.rpc('apply_wallet_transaction', {
    p_user_id: params.userId,
    p_type: params.type,
    p_amount: params.amount,
    p_reference: params.reference,
    p_description: params.description,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata || {},
    p_currency: 'NGN',
    p_balance_type: 'wallet',
    p_external_payment_id: null,
    p_created_by: null,
  })

  if (error) throw new Error(error.message || 'Wallet transaction failed')
  const result = data as any
  if (!result?.success) throw new Error(result?.error || 'Wallet transaction failed')
  return result
}

async function deductWallet(admin: SupabaseAdmin, userId: string, amount: number, reference: string, description: string, metadata: Record<string, unknown> = {}) {
  try {
    const result = await applyWalletTransaction(admin, {
      userId,
      type: 'purchase',
      amount,
      reference,
      description,
      idempotencyKey: String(metadata.source_debit_idempotency_key || `telegram:purchase:${reference}`),
      metadata: { source: 'telegram-stars', ...metadata },
    })
    return Number(result.balance_after ?? 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not process payment'
    if (message.includes('insufficient_balance')) {
      throw new Error(`Insufficient balance. You need ₦${amount.toLocaleString()}.`)
    }
    throw error
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// Return retail quotes without disclosing supplier cost and markup settings.
async function handleGetStarPricing(admin: SupabaseAdmin) {
  const config = await getStarPricingConfig(admin)
  const presetPrices = Object.fromEntries(
    [50, 150, 250, 1000, 2500].map((quantity) =>
      [quantity, calculateStarPriceNgn(quantity, config)]),
  )
  return json({ success: true, data: { preset_prices: presetPrices } })
}

async function handleQuoteStars(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const quantity = Number(body.quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 50 || quantity > 1_000_000) {
    throw new Error('Quantity must be between 50 and 1,000,000 stars')
  }
  const price = calculateStarPriceNgn(quantity, await getStarPricingConfig(admin))
  if (!Number.isSafeInteger(price) || price <= 0) throw new Error('Star pricing is temporarily unavailable')
  return json({ success: true, data: { quantity, price_ngn: price } })
}

// Returns active premium products with live-calculated NGN prices
async function handleGetPremiumProducts(admin: SupabaseAdmin) {
  const [{ data, error }, premCfg] = await Promise.all([
    admin.from('telegram_products').select('*').eq('product_type', 'premium').eq('is_active', true).order('sort_order'),
    getPremiumPricingConfig(admin),
  ])
  if (error) throw new Error(error.message)
  const products = (data || []).map((p: any) => {
    const livePrice = calcPremiumPriceNgn(p.months, premCfg)
    return { id: p.id, label: p.label, months: p.months, price_ngn: livePrice || p.price_ngn }
  })
  return json({ success: true, data: products })
}

async function handleSearchRecipientStars(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const username = String(body.username || '').replace(/^@/, '').trim()
  const quantity = Number(body.quantity || 50)
  if (!username) throw new Error('username is required')
  if (!Number.isInteger(quantity) || quantity < 50) throw new Error('Minimum 50 stars')
  if (quantity > 1_000_000) throw new Error('Maximum 1,000,000 stars per order')
  const data = await istarGet(`/star/recipient/search?username=${encodeURIComponent(username)}&quantity=${quantity}`)
  return json({ success: true, data: publicTelegramRecipient(data) })
}

async function handleSearchRecipientPremium(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const username = String(body.username || '').replace(/^@/, '').trim()
  const months = Number(body.months || 3)
  if (!username) throw new Error('username is required')
  if (![3, 6, 12].includes(months)) throw new Error('months must be 3, 6, or 12')
  const data = await istarGet(`/premium/recipient/search?username=${encodeURIComponent(username)}&months=${months}`)
  return json({ success: true, data: publicTelegramRecipient(data) })
}

async function readTelegramApiReplay(admin: SupabaseAdmin, userId: string, idempotencyKey: string, hash: string): Promise<Response | null> {
  const { data: order, error } = await admin.from('telegram_orders').select('*')
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (error) throw new Error('ORDER_LOOKUP_UNAVAILABLE')
  if (!order) return null
  if (order.customer_api_request_hash !== hash) return json({ success: false,
    code: 'IDEMPOTENCY_REQUEST_CONFLICT', error: 'This request key is already bound to a different or historical order.' }, 409)
  // Pending, failed or uncertain dispatch must never be resent. A completed
  // status alone cannot prove that this owner's original charge was posted.
  if ((order.status === 'completed' || order.status === 'processing') && order.istar_order_id && !order.refunded_at) {
    const { data: tx, error: txError } = await admin.from('transactions')
      .select('id,user_id,type,amount,status,currency,balance_type,reference,idempotency_key,metadata,balance_before,balance_after,transaction_hash')
      .eq('user_id', userId).eq('idempotency_key', `telegram:purchase:${idempotencyKey}`).maybeSingle()
    if (!txError && telegramApiDebitProven(order, tx, userId, hash)) {
      return json({ success: true, data: publicTelegramOrder(order), idempotency_hit: true })
    }
  }
  return json({ success: false, code: 'ORDER_OUTCOME_UNRESOLVED', order_id: order.id,
    idempotency_hit: true, error: 'This existing order needs outcome review. It will not be submitted or charged again.' }, 202)
}

async function handleCreateStarsOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>, req: Request, apiRequestHash?: string) {
  if (apiRequestHash) {
    const replay = await readTelegramApiReplay(admin, userId, String(body.idempotency_key), apiRequestHash)
    if (replay) return replay
  }
  await assertPurchasingCustomer(admin, userId, req)
  const walletRequestForensics = await getWalletRequestForensics(req, 'telegram-stars:create-stars-order')
  const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key)

  const username = String(body.username || '').replace(/^@/, '').trim()
  const recipientHash = String(body.recipient_hash || '')
  const recipientName = String(body.recipient_name || '')
  const quantity = Number(body.quantity || 0)
  if (!username || !recipientHash) throw new Error('username and recipient_hash are required')
  if (!Number.isInteger(quantity) || quantity < 50) throw new Error('Minimum 50 stars')
  if (quantity > 1_000_000) throw new Error('Maximum 1,000,000 stars per order')

  // Calculate price server-side from config
  const config = await getStarPricingConfig(admin)
  const priceNgn = calculateStarPriceNgn(quantity, config)
  if (priceNgn <= 0) throw new Error('Star pricing is not configured. Please contact support.')
  if (body.expected_amount_ngn !== undefined && body.expected_amount_ngn !== priceNgn) throw new Error('PRICE_CHANGED')
  await assertPurchasingCustomer(admin, userId, req, priceNgn)

  const { data: existingOrder } = await admin.from('telegram_orders')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existingOrder) {
    if (apiRequestHash) return (await readTelegramApiReplay(admin, userId, idempotencyKey, apiRequestHash)) ||
      json({ success: false, code: 'ORDER_OUTCOME_UNRESOLVED', error: 'Order outcome needs review.' }, 202)
    const sameRequest =
      String(existingOrder.order_type || '') === 'stars' &&
      String(existingOrder.username || '') === username &&
      String(existingOrder.recipient_hash || '') === recipientHash &&
      Number(existingOrder.quantity || 0) === quantity &&
      Number(existingOrder.price_ngn || 0) === priceNgn

    if (!sameRequest) {
      return json({
        success: false,
        error: 'This idempotency key was already used for a different Telegram Stars order request.',
        code: 'IDEMPOTENCY_REQUEST_CONFLICT',
      }, 409)
    }

    if (existingOrder.status === 'pending' ||
        (existingOrder.status === 'processing' && !existingOrder.istar_order_id)) {
      return json({
        success: false,
        code: 'ORDER_OUTCOME_UNRESOLVED',
        order_id: existingOrder.id,
        error: 'This order is awaiting supplier outcome review. The wallet debit remains posted pending review.',
      }, 202)
    }
    return json({ success: existingOrder.status !== 'failed', data: publicTelegramOrder(existingOrder), idempotency_hit: true })
  }

  const { data: orphanedPurchaseTx, error: orphanedPurchaseError } = await admin
    .from('transactions')
    .select('id, amount, status, balance_after, created_at')
    .eq('user_id', userId)
    .eq('idempotency_key', `telegram:purchase:${idempotencyKey}`)
    .maybeSingle()

  if (orphanedPurchaseError) {
    throw new Error('Could not verify Telegram purchase idempotency state')
  }

  if (orphanedPurchaseTx) {
    return json({
      success: false,
      error: 'This Telegram purchase attempt needs admin review before it can be retried.',
      code: 'TELEGRAM_PURCHASE_LEDGER_ORPHANED',
    }, 409)
  }

  const reference = `TG-STARS-${userId.slice(0, 8)}-${Date.now()}`
  const { data: order, error: orderErr } = await admin.from('telegram_orders').insert({
    user_id: userId, reference, order_type: 'stars',
    username, recipient_hash: recipientHash, recipient_name: recipientName,
    quantity, price_ngn: priceNgn, wallet_type: config.wallet_type, status: 'pending',
    idempotency_key: idempotencyKey,
    ...(apiRequestHash ? { customer_api_request_hash: apiRequestHash } : {}),
  }).select().single()
  if (orderErr || !order) {
    if (apiRequestHash && orderErr?.code === '23505') {
      const replay = await readTelegramApiReplay(admin, userId, idempotencyKey, apiRequestHash)
      if (replay) return replay
    }
    throw new Error('Failed to create order. Your wallet was not charged.')
  }

  try {
    await deductWallet(admin, userId, priceNgn, reference, `${quantity.toLocaleString()} Telegram Stars -> @${username}`, {
      request_forensics: walletRequestForensics,
      order_type: 'stars',
      source_order_id: order.id,
      source_order_table: 'telegram_orders',
      source_debit_idempotency_key: `telegram:purchase:${idempotencyKey}`,
      idempotency_key: idempotencyKey,
      ...(apiRequestHash ? { customer_api_request_hash: apiRequestHash } : {}),
    })
  } catch (err: any) {
    await admin.from('telegram_orders').update({
      status: 'failed',
      error_message: 'Wallet debit failed before supplier dispatch',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id)
    throw err
  }

  try {
    const istarOrder = await istarPost('/orders/star', {
      username, recipient_hash: recipientHash, quantity, wallet_type: config.wallet_type,
    }, reference)
    if (!istarOrder?.order_id) throw new Error('Supplier order confirmation missing')
    const { data: trackedOrder, error: orderTrackingError } = await admin.from('telegram_orders').update({
      istar_order_id: istarOrder.order_id, istar_amount: istarOrder.amount,
      status: 'processing', updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'pending').is('refunded_at', null)
      .select('id').maybeSingle()
    if (orderTrackingError || !trackedOrder) throw new Error('Supplier order tracking unavailable')

    // Auto-learn: update cost_per_star_usdt from this real order
    if (istarOrder.amount && quantity > 0) {
      const learnedCost = Number((istarOrder.amount / quantity).toFixed(6))
      await admin.from('app_settings').upsert({
        key: 'telegram_star_cost_usdt', value: String(learnedCost), updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
    }

    return json({ success: true, data: publicTelegramOrder({ ...order, status: 'processing' }) })
  } catch (_err) {
    await admin.from('telegram_orders').update({
      status: 'processing',
      error_message: 'Supplier outcome unknown; manual review required',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'pending').is('refunded_at', null)
    return json({
      success: false,
      code: 'SUPPLIER_OUTCOME_UNKNOWN',
      order_id: order.id,
      error: 'Supplier outcome is being reviewed. The wallet debit remains posted pending review.',
    }, 202)
  }
}

async function handleCreatePremiumOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>, req: Request, apiRequestHash?: string) {
  if (apiRequestHash) {
    const replay = await readTelegramApiReplay(admin, userId, String(body.idempotency_key), apiRequestHash)
    if (replay) return replay
  }
  await assertPurchasingCustomer(admin, userId, req)
  const walletRequestForensics = await getWalletRequestForensics(req, 'telegram-stars:create-premium-order')
  const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key)

  const username = String(body.username || '').replace(/^@/, '').trim()
  const recipientHash = String(body.recipient_hash || '')
  const recipientName = String(body.recipient_name || '')
  const productId = String(body.product_id || '')
  if (!username || !recipientHash || !productId) throw new Error('username, recipient_hash, and product_id are required')
  const [{ data: product, error: productErr }, premCfg, walletSetting] = await Promise.all([
    admin.from('telegram_products').select('*').eq('id', productId).eq('product_type', 'premium').eq('is_active', true).single(),
    getPremiumPricingConfig(admin),
    admin.from('app_settings').select('value').eq('key', 'telegram_wallet_type').maybeSingle(),
  ])
  if (productErr || !product) throw new Error('Product not found or inactive')
  if (!product.months || ![3, 6, 12].includes(product.months)) throw new Error('Invalid product months')
  // Use live-computed price if cost has been learned; fall back to stored price
  const livePrice = calcPremiumPriceNgn(product.months, premCfg)
  const chargeNgn = livePrice || product.price_ngn
  if (!chargeNgn || chargeNgn <= 0) throw new Error('This product has no price set. Contact support.')
  if (body.expected_amount_ngn !== undefined && body.expected_amount_ngn !== Number(chargeNgn)) throw new Error('PRICE_CHANGED')
  await assertPurchasingCustomer(admin, userId, req, Number(chargeNgn))
  const walletType = String(walletSetting.data?.value || 'USDT').toUpperCase()

  const { data: existingOrder } = await admin.from('telegram_orders')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existingOrder) {
    if (apiRequestHash) return (await readTelegramApiReplay(admin, userId, idempotencyKey, apiRequestHash)) ||
      json({ success: false, code: 'ORDER_OUTCOME_UNRESOLVED', error: 'Order outcome needs review.' }, 202)
    const sameRequest =
      String(existingOrder.order_type || '') === 'premium' &&
      String(existingOrder.username || '') === username &&
      String(existingOrder.recipient_hash || '') === recipientHash &&
      Number(existingOrder.months || 0) === Number(product.months || 0) &&
      Number(existingOrder.price_ngn || 0) === Number(chargeNgn || 0)

    if (!sameRequest) {
      return json({
        success: false,
        error: 'This idempotency key was already used for a different Telegram Premium order request.',
        code: 'IDEMPOTENCY_REQUEST_CONFLICT',
      }, 409)
    }

    if (existingOrder.status === 'pending' ||
        (existingOrder.status === 'processing' && !existingOrder.istar_order_id)) {
      return json({
        success: false,
        code: 'ORDER_OUTCOME_UNRESOLVED',
        order_id: existingOrder.id,
        error: 'This order is awaiting supplier outcome review. The wallet debit remains posted pending review.',
      }, 202)
    }
    return json({ success: existingOrder.status !== 'failed', data: publicTelegramOrder(existingOrder), idempotency_hit: true })
  }

  const { data: orphanedPurchaseTx, error: orphanedPurchaseError } = await admin
    .from('transactions')
    .select('id, amount, status, balance_after, created_at')
    .eq('user_id', userId)
    .eq('idempotency_key', `telegram:purchase:${idempotencyKey}`)
    .maybeSingle()

  if (orphanedPurchaseError) {
    throw new Error('Could not verify Telegram purchase idempotency state')
  }

  if (orphanedPurchaseTx) {
    return json({
      success: false,
      error: 'This Telegram purchase attempt needs admin review before it can be retried.',
      code: 'TELEGRAM_PURCHASE_LEDGER_ORPHANED',
    }, 409)
  }

  const reference = `TG-PREMIUM-${userId.slice(0, 8)}-${Date.now()}`
  const { data: order, error: orderErr } = await admin.from('telegram_orders').insert({
    user_id: userId, reference, order_type: 'premium',
    username, recipient_hash: recipientHash, recipient_name: recipientName,
    months: product.months, price_ngn: chargeNgn, wallet_type: walletType, status: 'pending',
    idempotency_key: idempotencyKey,
    ...(apiRequestHash ? { customer_api_request_hash: apiRequestHash } : {}),
  }).select().single()
  if (orderErr || !order) {
    if (apiRequestHash && orderErr?.code === '23505') {
      const replay = await readTelegramApiReplay(admin, userId, idempotencyKey, apiRequestHash)
      if (replay) return replay
    }
    throw new Error('Failed to create order. Your wallet was not charged.')
  }

  try {
    await deductWallet(admin, userId, chargeNgn, reference, `${product.months}-Month Telegram Premium -> @${username}`, {
      request_forensics: walletRequestForensics,
      order_type: 'premium',
      product_id: productId,
      source_order_id: order.id,
      source_order_table: 'telegram_orders',
      source_debit_idempotency_key: `telegram:purchase:${idempotencyKey}`,
      idempotency_key: idempotencyKey,
      ...(apiRequestHash ? { customer_api_request_hash: apiRequestHash } : {}),
    })
  } catch (err: any) {
    await admin.from('telegram_orders').update({
      status: 'failed',
      error_message: 'Wallet debit failed before supplier dispatch',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id)
    throw err
  }

  try {
    const istarOrder = await istarPost('/orders/premium', {
      username, recipient_hash: recipientHash, months: product.months, wallet_type: walletType,
    }, reference)
    if (!istarOrder?.order_id) throw new Error('Supplier order confirmation missing')
    const { data: trackedOrder, error: orderTrackingError } = await admin.from('telegram_orders').update({
      istar_order_id: istarOrder.order_id, istar_amount: istarOrder.amount,
      status: 'processing', updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'pending').is('refunded_at', null)
      .select('id').maybeSingle()
    if (orderTrackingError || !trackedOrder) throw new Error('Supplier order tracking unavailable')

    // Auto-learn: save the TOTAL iStar USDT charge for this tier (not per-month)
    // Next customer's price = this_usdt_cost × live_ngn_rate + markup
    if (istarOrder.amount && product.months > 0) {
      const settingKey = `telegram_premium_cost_usdt_${product.months}m`
      const newNgnPrice = Math.ceil((istarOrder.amount * premCfg.usdt_to_ngn + (premCfg.markups[String(product.months)] || 0)) / 10) * 10
      await Promise.all([
        admin.from('app_settings').upsert({ key: settingKey, value: String(istarOrder.amount), updated_at: new Date().toISOString() }, { onConflict: 'key' }),
        // Also update the stored product price so admin can see what's being charged
        admin.from('telegram_products').update({ price_ngn: newNgnPrice, updated_at: new Date().toISOString() }).eq('product_type', 'premium').eq('months', product.months),
      ])
    }

    return json({ success: true, data: publicTelegramOrder({ ...order, status: 'processing' }) })
  } catch (_err) {
    await admin.from('telegram_orders').update({
      status: 'processing',
      error_message: 'Supplier outcome unknown; manual review required',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'pending').is('refunded_at', null)
    return json({
      success: false,
      code: 'SUPPLIER_OUTCOME_UNKNOWN',
      order_id: order.id,
      error: 'Supplier outcome is being reviewed. The wallet debit remains posted pending review.',
    }, 202)
  }
}

async function handleGetMyOrders(admin: SupabaseAdmin, userId: string) {
  const { data, error } = await admin.from('telegram_orders')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return json({ success: true, data: (data || []).map(publicTelegramOrder) })
}

async function handlePollOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const orderId = String(body.order_id || '')
  if (!orderId) throw new Error('order_id is required')
  const { data: order, error } = await admin.from('telegram_orders')
    .select('*').eq('id', orderId).eq('user_id', userId).single()
  if (error || !order) throw new Error('ORDER_NOT_FOUND')
  if (order.status === 'processing' && order.istar_order_id) {
    try {
      const istarOrder = await istarGet(`/orders/${encodeURIComponent(String(order.istar_order_id))}`)
      if (istarOrder.status === 'completed' && order.status !== 'completed') {
        const { data: updated, error: updateError } = await admin.from('telegram_orders')
          .update({ status: 'completed', completed_at: istarOrder.updated_at || new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', order.id).eq('status', 'processing').is('refunded_at', null)
          .select('id').maybeSingle()
        if (updateError) throw updateError
        if (updated) return json({ success: true, data: publicTelegramOrder({ ...order, status: 'completed' }) })
      }
      if (istarOrder.status === 'failed' && order.status !== 'failed') {
        return json({
          success: false,
          code: 'SUPPLIER_OUTCOME_REVIEW_REQUIRED',
          error: 'The supplier reported failure. A refund requires outcome review.',
        }, 202)
      }
    } catch { /* return current status */ }
  }
  const { data: fresh, error: freshError } = await admin.from('telegram_orders').select('*').eq('id', orderId).eq('user_id', userId).single()
  if (freshError || !fresh) throw new Error('ORDER_UNAVAILABLE')
  return json({ success: true, data: publicTelegramOrder(fresh) })
}

// The API delegates to the same retail pricing and wallet purchase handlers.
// Caller input never sets the wallet owner, supplier recipient hash or charge.
async function activePremium(admin: SupabaseAdmin, productId: unknown) {
  const { data: product, error } = await admin.from('telegram_products').select('id, months, price_ngn, label')
    .eq('id', productId).eq('product_type', 'premium').eq('is_active', true).single()
  if (error || !product || ![3, 6, 12].includes(product.months)) throw new Error('PRODUCT_UNAVAILABLE')
  return product
}

async function handleTelegramApi(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>, req: Request) {
  const action = String(body.action).slice(4) as TelegramApiAction
  if (!validTelegramApiInput(body, action, 'action')) throw new Error('INVALID_REQUEST')
  const apiRequestHash = action === 'purchase' ? await purchaseGuardSha256Hex(canonicalTelegramApiPurchase(userId, body)) : undefined
  if (apiRequestHash) {
    const replay = await readTelegramApiReplay(admin, userId, String(body.idempotency_key), apiRequestHash)
    if (replay) return replay
  }
  if (action === 'orders') return handleGetMyOrders(admin, userId)
  if (action === 'status') return handlePollOrder(admin, userId, body)
  if (action === 'catalogue') {
    const [starsResponse, premiumResponse] = await Promise.all([handleGetStarPricing(admin), handleGetPremiumProducts(admin)])
    const stars = await starsResponse.json(), premium = await premiumResponse.json()
    const presets = Object.entries(stars.data.preset_prices).filter(([, price]) =>
      Number.isSafeInteger(price) && Number(price) > 0).map(([quantity, price_ngn]) => ({ quantity: Number(quantity), price_ngn }))
    const products = premium.data.filter((product: any) => [3, 6, 12].includes(product.months) &&
      Number.isSafeInteger(Number(product.price_ngn)) && Number(product.price_ngn) > 0)
      .map((product: any) => ({ ...product, price_ngn: Number(product.price_ngn) }))
    return json({ success: true, data: { currency: 'NGN', purchases_enabled: telegramOrdersEnabled(),
      stars: { min_quantity: 50, max_quantity: 1_000_000, presets }, premium: products } })
  }
  if (action === 'quote') {
    if (body.product_type === 'stars') return handleQuoteStars(admin, body)
    const product = await activePremium(admin, body.product_id)
    const price = calcPremiumPriceNgn(product.months, await getPremiumPricingConfig(admin)) || Number(product.price_ngn)
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error('PRICE_UNAVAILABLE')
    return json({ success: true, data: { product_id: product.id, months: product.months, price_ngn: price } })
  }
  const username = String(body.username).replace(/^@/, '')
  const product = body.product_type === 'premium' ? await activePremium(admin, body.product_id) : null
  const path = product ? `/premium/recipient/search?username=${encodeURIComponent(username)}&months=${product.months}`
    : `/star/recipient/search?username=${encodeURIComponent(username)}&quantity=${body.quantity}`
  const recipient = await istarGet(path)
  if (typeof recipient?.recipient !== 'string' || !recipient.recipient || recipient.recipient.length > 2048 ||
    /[\x00-\x1f\x7f]/.test(recipient.recipient)) throw new Error('RECIPIENT_UNAVAILABLE')
  if (action === 'recipient') return json({ success: true, data: publicTelegramRecipient(recipient) })
  const purchaseBody = { ...body, username, recipient_hash: recipient.recipient,
    recipient_name: typeof recipient.name === 'string' ? recipient.name.slice(0, 200) : '' }
  return product ? handleCreatePremiumOrder(admin, userId, purchaseBody, req, apiRequestHash)
    : handleCreateStarsOrder(admin, userId, purchaseBody, req, apiRequestHash)
}

// ── Admin handlers ────────────────────────────────────────────────────────────

async function handleAdminGetOrders(admin: SupabaseAdmin, userId: string) {
  await requireAdmin(admin, userId)
  const { data: orders, error } = await admin.from('telegram_orders').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const rows = orders || []
  const userIds = [...new Set(rows.map((o: any) => o.user_id).filter(Boolean))]
  const profileMap: Record<string, { email?: string; full_name?: string }> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, email, full_name').in('id', userIds)
    for (const p of profiles || []) profileMap[p.id] = { email: p.email, full_name: p.full_name }
  }
  return json({ success: true, data: rows.map((o: any) => ({ ...o, profiles: profileMap[o.user_id] || null })) })
}

async function handleAdminGetPremiumProducts(admin: SupabaseAdmin, userId: string) {
  await requireAdmin(admin, userId)
  const [{ data, error }, premCfg] = await Promise.all([
    admin.from('telegram_products').select('*').eq('product_type', 'premium').order('sort_order'),
    getPremiumPricingConfig(admin),
  ])
  if (error) throw new Error(error.message)
  const products = (data || []).map((p: any) => {
    const livePrice = calcPremiumPriceNgn(p.months, premCfg)
    return { ...p, price_ngn: livePrice || p.price_ngn }
  })
  return json({ success: true, data: products })
}

async function handleAdminUpsertPremiumProduct(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const { id, label, months, price_ngn, is_active, sort_order } = body as any
  if (!label || !months) throw new Error('label and months are required')
  const row = { product_type: 'premium', label, months: Number(months), price_ngn: Number(price_ngn || 0), is_active: is_active !== false, sort_order: Number(sort_order || 0), updated_at: new Date().toISOString() }
  if (id) {
    const { data, error } = await admin.from('telegram_products').update(row).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return json({ success: true, data })
  } else {
    const { data, error } = await admin.from('telegram_products').insert(row).select().single()
    if (error) throw new Error(error.message)
    return json({ success: true, data })
  }
}

async function handleAdminSaveStarConfig(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const { cost_per_star_usdt, markup_tiers, premium_markup_per_tier } = body as any
  const ops: Promise<any>[] = []
  if (cost_per_star_usdt !== undefined) {
    ops.push(admin.from('app_settings').upsert({ key: 'telegram_star_cost_usdt', value: String(Number(cost_per_star_usdt)), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
  }
  if (markup_tiers !== undefined) {
    ops.push(admin.from('app_settings').upsert({ key: 'telegram_star_markup_tiers', value: JSON.stringify(markup_tiers), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
  }
  if (premium_markup_per_tier !== undefined) {
    const tiers = premium_markup_per_tier as Record<string, number>
    for (const [months, markup] of Object.entries(tiers)) {
      ops.push(admin.from('app_settings').upsert({ key: `telegram_premium_markup_ngn_${months}m`, value: String(Number(markup)), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
    }
  }
  await Promise.all(ops)
  return json({ success: true })
}

async function handleAdminCancelOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const orderId = String(body.order_id || '')
  if (!orderId) throw new Error('order_id is required')
  return json({
    success: false,
    code: 'TELEGRAM_CANCELLATION_REVIEW_REQUIRED',
    error: 'Cancellation is paused until the supplier outcome is confirmed.',
  }, 409)
}

async function handleAdminGetPremiumPricing(admin: SupabaseAdmin, userId: string) {
  await requireAdmin(admin, userId)
  const config = await getPremiumPricingConfig(admin)
  return json({ success: true, data: config })
}

async function handleAdminWalletBalance(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const walletType = String(body.wallet_type || 'USDT').toUpperCase()
  const data = await istarGet(`/wallet/balance?wallet_type=${walletType}`)
  return json({ success: true, data })
}

async function handleAdminSaveWalletType(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const type = String(body.wallet_type || 'USDT').toUpperCase()
  if (!['USDT', 'TON'].includes(type)) throw new Error('wallet_type must be USDT or TON')
  await admin.from('app_settings').upsert({ key: 'telegram_wallet_type', value: type, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return json({ success: true })
}

// ── Router ────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = await getAdminClient()
    const delegated = req.headers.has('x-tally-api-capability')
    if (delegated && Deno.env.get('CUSTOMER_API_ENABLED') !== 'true') return json({ success: false, code: 'coming_soon' }, 503)
    const delegatedRequest = delegated ? req.clone() : null
    let body: Record<string, unknown>
    try { body = delegated ? await readTelegramApiBody(req) : req.method === 'POST' ? await req.json().catch(() => ({})) : {} }
    catch (error) { if (delegatedRequest?.body) void delegatedRequest.body.cancel().catch(() => {}); throw error }
    const action = String(body.action || '')
    if ((action === 'create_stars_order' || action === 'create_premium_order' || action === 'api_purchase') && !telegramOrdersEnabled()) {
      return json({
        success: false,
        error: 'Telegram purchases are temporarily paused for wallet security review.',
        code: 'TELEGRAM_ORDERS_PAUSED',
      }, 503)
    }
    if (delegatedRequest) {
      const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      if (!service || req.headers.get('authorization') !== `Bearer ${service}` || req.method !== 'POST') throw new Error('Unauthorized')
      if (!validTelegramApiInput(body, action.slice(4) as TelegramApiAction, 'action')) throw new Error('INVALID_REQUEST')
      const user = await authenticateCustomerRequest(delegatedRequest, admin, 'telegram', 'telegram-stars')
      const { data: profile, error } = await admin.from('profiles').select('is_staff, is_admin, account_suspended').eq('id', user.id).single()
      if (error || !profile || profile.account_suspended === true) throw new Error('Unauthorized')
      if (profile.is_staff === true || profile.is_admin === true) throw new Error('CUSTOMER_ONLY')
      return await handleTelegramApi(admin, user.id, body, req)
    }
    if (action.startsWith('api_')) throw new Error('Unauthorized')
    const user = await getUser(req)
    switch (action) {
      case 'get_star_pricing':           return await handleGetStarPricing(admin)
      case 'quote_stars':                return await handleQuoteStars(admin, body)
      case 'get_premium_products':       return await handleGetPremiumProducts(admin)
      case 'search_recipient_stars':     return await handleSearchRecipientStars(admin, user.id, body)
      case 'search_recipient_premium':   return await handleSearchRecipientPremium(admin, user.id, body)
      case 'create_stars_order':         return await handleCreateStarsOrder(admin, user.id, body, req)
      case 'create_premium_order':       return await handleCreatePremiumOrder(admin, user.id, body, req)
      case 'get_my_orders':              return await handleGetMyOrders(admin, user.id)
      case 'poll_order':                 return await handlePollOrder(admin, user.id, body)
      case 'admin_get_premium_pricing':   return await handleAdminGetPremiumPricing(admin, user.id)
      case 'admin_get_orders':           return await handleAdminGetOrders(admin, user.id)
      case 'admin_get_premium_products': return await handleAdminGetPremiumProducts(admin, user.id)
      case 'admin_upsert_premium':       return await handleAdminUpsertPremiumProduct(admin, user.id, body)
      case 'admin_save_star_config':     return await handleAdminSaveStarConfig(admin, user.id, body)
      case 'admin_cancel_order':         return await handleAdminCancelOrder(admin, user.id, body)
      case 'admin_wallet_balance':       return await handleAdminWalletBalance(admin, user.id, body)
      case 'admin_save_wallet_type':     return await handleAdminSaveWalletType(admin, user.id, body)
      default:                           return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err: any) {
    console.error('Telegram request failed')
    const safe = new Set(['INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'REQUEST_TIMEOUT', 'CUSTOMER_ONLY',
      'PRICE_CHANGED', 'PRODUCT_UNAVAILABLE', 'PRICE_UNAVAILABLE', 'RECIPIENT_UNAVAILABLE', 'ORDER_NOT_FOUND', 'ORDER_UNAVAILABLE', 'ORDER_LOOKUP_UNAVAILABLE'])
    if (safe.has(err?.message)) return json({ success: false, code: err.message },
      err.message === 'REQUEST_TOO_LARGE' ? 413 : err.message === 'REQUEST_TIMEOUT' ? 408 :
      err.message === 'CUSTOMER_ONLY' ? 403 : err.message === 'PRICE_CHANGED' ? 409 :
      err.message === 'ORDER_NOT_FOUND' ? 404 : ['ORDER_UNAVAILABLE','ORDER_LOOKUP_UNAVAILABLE'].includes(err.message) ? 503 : 400)
    return json({ success: false, error: err?.message === 'Unauthorized' ? 'Unauthorized' : 'Telegram request could not be completed.' }, err?.message === 'Unauthorized' ? 401 : 400)
  }
})
