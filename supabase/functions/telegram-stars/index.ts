import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

type SupabaseAdmin = ReturnType<typeof createClient>

const ISTAR_BASE = Deno.env.get('ISTAR_BASE_URL') || 'https://v1.fragmentapi.com/api/v1/partner'
const ISTAR_API_KEY = Deno.env.get('ISTAR_API_KEY') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function istarHeaders() {
  return { 'API-Key': ISTAR_API_KEY, 'Content-Type': 'application/json' }
}

async function istarGet(path: string) {
  const res = await fetch(`${ISTAR_BASE}${path}`, { headers: istarHeaders() })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.error || `iStar error ${res.status}`)
  return data
}

async function istarPost(path: string, body: unknown, idempotencyKey: string) {
  const res = await fetch(`${ISTAR_BASE}${path}`, {
    method: 'POST',
    headers: { ...istarHeaders(), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.error || `iStar error ${res.status}`)
  return data
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
  const { data } = await admin.from('profiles').select('is_admin').eq('id', userId).single()
  if (!data?.is_admin) throw new Error('Admin access required')
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
  return Math.ceil(baseCost + markup)
}

// ── Premium pricing helpers ───────────────────────────────────────────────────
async function getPremiumPricingConfig(admin: SupabaseAdmin): Promise<{
  costs: Record<string, number>
  markup_ngn: number
  usdt_to_ngn: number
}> {
  const [markupRow, usdtNgn] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'telegram_premium_markup_ngn').maybeSingle(),
    getUsdtToNgn(admin),
  ])
  const markup_ngn = Number(markupRow.data?.value || 0)

  // Fetch live pricing from iStar
  try {
    const packages = await istarGet('/premium/packages')
    const costs: Record<string, number> = {}
    for (const pkg of Array.isArray(packages) ? packages : []) {
      if (pkg.months && pkg.usd_value) {
        costs[String(pkg.months)] = Number(pkg.usd_value)
      }
    }
    if (Object.keys(costs).length > 0) {
      return { costs, markup_ngn, usdt_to_ngn: usdtNgn }
    }
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
    markup_ngn,
    usdt_to_ngn: usdtNgn,
  }
}

function calcPremiumPriceNgn(months: number, cfg: { costs: Record<string, number>; markup_ngn: number; usdt_to_ngn: number }): number {
  const cost = cfg.costs[String(months)] || 0
  if (!cost) return 0 // not yet learned — admin must set a price manually
  return Math.ceil(cost * cfg.usdt_to_ngn + cfg.markup_ngn)
}

// ── Wallet helpers ────────────────────────────────────────────────────────────
async function deductWallet(admin: SupabaseAdmin, userId: string, amount: number, reference: string, description: string) {
  for (let i = 0; i < 3; i++) {
    const { data: p } = await admin.from('profiles').select('wallet_balance').eq('id', userId).single()
    if (!p) throw new Error('User not found')
    const balance = Number(p.wallet_balance || 0)
    if (balance < amount) throw new Error(`Insufficient balance. You need ₦${amount.toLocaleString()} but have ₦${balance.toLocaleString()}.`)
    const next = balance - amount
    const { data: updated } = await admin.from('profiles')
      .update({ wallet_balance: next, updated_at: new Date().toISOString() })
      .eq('id', userId).eq('wallet_balance', balance).select('wallet_balance').single()
    if (updated) {
      await admin.from('transactions').insert({
        user_id: userId, type: 'purchase', amount: -amount,
        balance_after: next, description, reference, status: 'completed',
      })
      return next
    }
  }
  throw new Error('Could not process payment. Please try again.')
}

async function refundWallet(admin: SupabaseAdmin, order: { id: string; user_id: string; reference: string; price_ngn: number }, reason: string) {
  const amount = Number(order.price_ngn || 0)
  if (amount <= 0) return
  const refundRef = `REFUND-${order.reference}`
  const { data: currentOrder } = await admin.from('telegram_orders').select('refunded_at').eq('id', order.id).maybeSingle()
  if (currentOrder?.refunded_at) return
  const { data: existing } = await admin.from('transactions').select('id, status').eq('reference', refundRef).maybeSingle()
  if (existing?.status === 'completed') return
  const tx = existing || (await admin.from('transactions').insert({
    user_id: order.user_id, type: 'refund', amount, balance_after: 0,
    description: reason, reference: refundRef, status: 'pending',
  }).select('id').single()).data
  if (!tx) throw new Error('Refund transaction could not be created')
  for (let i = 0; i < 3; i++) {
    const { data: p } = await admin.from('profiles').select('wallet_balance').eq('id', order.user_id).single()
    if (!p) break
    const next = Number(p.wallet_balance || 0) + amount
    const { data: updated } = await admin.from('profiles')
      .update({ wallet_balance: next, updated_at: new Date().toISOString() })
      .eq('id', order.user_id).eq('wallet_balance', p.wallet_balance).select('wallet_balance').single()
    if (updated) {
      await admin.from('transactions').update({ status: 'completed', balance_after: next }).eq('id', tx.id)
      await admin.from('telegram_orders').update({
        refunded_at: new Date().toISOString(), refund_amount_ngn: amount, refund_reference: refundRef,
      }).eq('id', order.id).is('refunded_at', null)
      return
    }
  }
  throw new Error('Refund could not be credited. Please try again.')
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// Returns star pricing config so the frontend can calculate prices live
async function handleGetStarPricing(admin: SupabaseAdmin) {
  const config = await getStarPricingConfig(admin)
  return json({ success: true, data: config })
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
    return { ...p, price_ngn: livePrice || p.price_ngn } // live price takes precedence; fallback to stored
  })
  return json({ success: true, data: products })
}

async function handleSearchRecipientStars(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const username = String(body.username || '').replace(/^@/, '').trim()
  const quantity = Number(body.quantity || 50)
  if (!username) throw new Error('username is required')
  if (quantity < 50) throw new Error('Minimum 50 stars')
  const data = await istarGet(`/star/recipient/search?username=${encodeURIComponent(username)}&quantity=${quantity}`)
  return json({ success: true, data })
}

async function handleSearchRecipientPremium(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const username = String(body.username || '').replace(/^@/, '').trim()
  const months = Number(body.months || 3)
  if (!username) throw new Error('username is required')
  if (![3, 6, 12].includes(months)) throw new Error('months must be 3, 6, or 12')
  const data = await istarGet(`/premium/recipient/search?username=${encodeURIComponent(username)}&months=${months}`)
  return json({ success: true, data })
}

async function handleCreateStarsOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const username = String(body.username || '').replace(/^@/, '').trim()
  const recipientHash = String(body.recipient_hash || '')
  const recipientName = String(body.recipient_name || '')
  const quantity = Math.round(Number(body.quantity || 0))
  if (!username || !recipientHash) throw new Error('username and recipient_hash are required')
  if (quantity < 50) throw new Error('Minimum 50 stars')
  if (quantity > 1_000_000) throw new Error('Maximum 1,000,000 stars per order')

  // Calculate price server-side from config
  const config = await getStarPricingConfig(admin)
  const priceNgn = calculateStarPriceNgn(quantity, config)
  if (priceNgn <= 0) throw new Error('Star pricing is not configured. Please contact support.')

  const reference = `TG-STARS-${userId.slice(0, 8)}-${Date.now()}`
  await deductWallet(admin, userId, priceNgn, reference, `${quantity.toLocaleString()} Telegram Stars → @${username}`)

  const { data: order, error: orderErr } = await admin.from('telegram_orders').insert({
    user_id: userId, reference, order_type: 'stars',
    username, recipient_hash: recipientHash, recipient_name: recipientName,
    quantity, price_ngn: priceNgn, wallet_type: config.wallet_type, status: 'pending',
  }).select().single()
  if (orderErr || !order) {
    await refundWallet(admin, { id: '00000000-0000-0000-0000-000000000000', user_id: userId, reference, price_ngn: priceNgn }, 'Refund: order could not be created')
    throw new Error('Failed to create order. You have been refunded.')
  }

  try {
    const istarOrder = await istarPost('/orders/star', {
      username, recipient_hash: recipientHash, quantity, wallet_type: config.wallet_type,
    }, reference)
    await admin.from('telegram_orders').update({
      istar_order_id: istarOrder.order_id, istar_amount: istarOrder.amount,
      status: 'processing', updated_at: new Date().toISOString(),
    }).eq('id', order.id)

    // Auto-learn: update cost_per_star_usdt from this real order
    if (istarOrder.amount && quantity > 0) {
      const learnedCost = Number((istarOrder.amount / quantity).toFixed(6))
      await admin.from('app_settings').upsert({
        key: 'telegram_star_cost_usdt', value: String(learnedCost), updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
    }

    return json({ success: true, data: { ...order, istar_order_id: istarOrder.order_id, status: 'processing' } })
  } catch (err: any) {
    await refundWallet(admin, order, `Refund: iStar order failed — ${err.message}`)
    await admin.from('telegram_orders').update({ status: 'failed', error_message: err.message, updated_at: new Date().toISOString() }).eq('id', order.id)
    throw new Error(`Order failed: ${err.message}. You have been refunded.`)
  }
}

async function handleCreatePremiumOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
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
  const walletType = String(walletSetting.data?.value || 'USDT').toUpperCase()
  const reference = `TG-PREMIUM-${userId.slice(0, 8)}-${Date.now()}`
  await deductWallet(admin, userId, chargeNgn, reference, `${product.months}-Month Telegram Premium → @${username}`)
  const { data: order, error: orderErr } = await admin.from('telegram_orders').insert({
    user_id: userId, reference, order_type: 'premium',
    username, recipient_hash: recipientHash, recipient_name: recipientName,
    months: product.months, price_ngn: chargeNgn, wallet_type: walletType, status: 'pending',
  }).select().single()
  if (orderErr || !order) {
    await refundWallet(admin, { id: '00000000-0000-0000-0000-000000000000', user_id: userId, reference, price_ngn: chargeNgn }, 'Refund: order could not be created')
    throw new Error('Failed to create order. You have been refunded.')
  }
  try {
    const istarOrder = await istarPost('/orders/premium', {
      username, recipient_hash: recipientHash, months: product.months, wallet_type: walletType,
    }, reference)
    await admin.from('telegram_orders').update({
      istar_order_id: istarOrder.order_id, istar_amount: istarOrder.amount,
      status: 'processing', updated_at: new Date().toISOString(),
    }).eq('id', order.id)

    // Auto-learn: save the TOTAL iStar USDT charge for this tier (not per-month)
    // Next customer's price = this_usdt_cost × live_ngn_rate + markup
    if (istarOrder.amount && product.months > 0) {
      const settingKey = `telegram_premium_cost_usdt_${product.months}m`
      const newNgnPrice = Math.ceil(istarOrder.amount * premCfg.usdt_to_ngn + premCfg.markup_ngn)
      await Promise.all([
        admin.from('app_settings').upsert({ key: settingKey, value: String(istarOrder.amount), updated_at: new Date().toISOString() }, { onConflict: 'key' }),
        // Also update the stored product price so admin can see what's being charged
        admin.from('telegram_products').update({ price_ngn: newNgnPrice, updated_at: new Date().toISOString() }).eq('product_type', 'premium').eq('months', product.months),
      ])
    }

    return json({ success: true, data: { ...order, istar_order_id: istarOrder.order_id, status: 'processing' } })
  } catch (err: any) {
    await refundWallet(admin, order, `Refund: iStar order failed — ${err.message}`)
    await admin.from('telegram_orders').update({ status: 'failed', error_message: err.message, updated_at: new Date().toISOString() }).eq('id', order.id)
    throw new Error(`Order failed: ${err.message}. You have been refunded.`)
  }
}

async function handleGetMyOrders(admin: SupabaseAdmin, userId: string) {
  const { data, error } = await admin.from('telegram_orders')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return json({ success: true, data: data || [] })
}

async function handlePollOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  const orderId = String(body.order_id || '')
  if (!orderId) throw new Error('order_id is required')
  const { data: order, error } = await admin.from('telegram_orders')
    .select('*').eq('id', orderId).eq('user_id', userId).single()
  if (error || !order) throw new Error('Order not found')
  if (order.status === 'processing' && order.istar_order_id) {
    try {
      const istarOrder = await istarGet(`/orders/${order.istar_order_id}`)
      if (istarOrder.status === 'completed' && order.status !== 'completed') {
        await admin.from('telegram_orders').update({ status: 'completed', completed_at: istarOrder.updated_at || new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', order.id)
        return json({ success: true, data: { ...order, status: 'completed' } })
      }
      if (istarOrder.status === 'failed' && order.status !== 'failed') {
        await admin.from('telegram_orders').update({ status: 'failed', error_message: istarOrder.payload?.reason || 'Order failed', updated_at: new Date().toISOString() }).eq('id', order.id)
        await refundWallet(admin, order, `Refund: Telegram order failed`)
        return json({ success: true, data: { ...order, status: 'failed' } })
      }
    } catch { /* return current status */ }
  }
  const { data: fresh } = await admin.from('telegram_orders').select('*').eq('id', orderId).single()
  return json({ success: true, data: fresh })
}

// ── Admin handlers ────────────────────────────────────────────────────────────

async function handleAdminGetOrders(admin: SupabaseAdmin, userId: string) {
  await requireAdmin(admin, userId)
  const { data: orders, error } = await admin.from('telegram_orders').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const rows = orders || []
  const userIds = [...new Set(rows.map((o: any) => o.user_id).filter(Boolean))]
  let profileMap: Record<string, { email?: string; full_name?: string }> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, email, full_name').in('id', userIds)
    for (const p of profiles || []) profileMap[p.id] = { email: p.email, full_name: p.full_name }
  }
  return json({ success: true, data: rows.map((o: any) => ({ ...o, profiles: profileMap[o.user_id] || null })) })
}

async function handleAdminGetPremiumProducts(admin: SupabaseAdmin, userId: string) {
  await requireAdmin(admin, userId)
  const { data, error } = await admin.from('telegram_products').select('*').eq('product_type', 'premium').order('sort_order')
  if (error) throw new Error(error.message)
  return json({ success: true, data: data || [] })
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
  const { cost_per_star_usdt, markup_tiers, premium_markup_ngn } = body as any
  const ops: Promise<any>[] = []
  if (cost_per_star_usdt !== undefined) {
    ops.push(admin.from('app_settings').upsert({ key: 'telegram_star_cost_usdt', value: String(Number(cost_per_star_usdt)), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
  }
  if (markup_tiers !== undefined) {
    ops.push(admin.from('app_settings').upsert({ key: 'telegram_star_markup_tiers', value: JSON.stringify(markup_tiers), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
  }
  if (premium_markup_ngn !== undefined) {
    ops.push(admin.from('app_settings').upsert({ key: 'telegram_premium_markup_ngn', value: String(Number(premium_markup_ngn)), updated_at: new Date().toISOString() }, { onConflict: 'key' }))
  }
  await Promise.all(ops)
  return json({ success: true })
}

async function handleAdminCancelOrder(admin: SupabaseAdmin, userId: string, body: Record<string, unknown>) {
  await requireAdmin(admin, userId)
  const orderId = String(body.order_id || '')
  if (!orderId) throw new Error('order_id is required')
  const { data: order, error } = await admin.from('telegram_orders').select('*').eq('id', orderId).single()
  if (error || !order) throw new Error('Order not found')
  if (['completed', 'failed'].includes(order.status)) throw new Error('Order is already in a terminal state')
  await admin.from('telegram_orders').update({ status: 'failed', error_message: 'Cancelled by admin', updated_at: new Date().toISOString() }).eq('id', orderId)
  if (!order.refunded_at) await refundWallet(admin, order, `Admin refund for cancelled Telegram order: ${order.reference}`)
  return json({ success: true })
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
    const body: Record<string, unknown> = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const action = String(body.action || '')
    const user = await getUser(req)
    switch (action) {
      case 'get_star_pricing':           return await handleGetStarPricing(admin)
      case 'get_premium_products':       return await handleGetPremiumProducts(admin)
      case 'search_recipient_stars':     return await handleSearchRecipientStars(admin, user.id, body)
      case 'search_recipient_premium':   return await handleSearchRecipientPremium(admin, user.id, body)
      case 'create_stars_order':         return await handleCreateStarsOrder(admin, user.id, body)
      case 'create_premium_order':       return await handleCreatePremiumOrder(admin, user.id, body)
      case 'get_my_orders':              return await handleGetMyOrders(admin, user.id)
      case 'poll_order':                 return await handlePollOrder(admin, user.id, body)
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
    console.error('telegram-stars error:', err)
    return json({ success: false, error: err.message || 'Internal error' }, err.message?.includes('Unauthorized') ? 401 : 400)
  }
})
