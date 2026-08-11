import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Proactive auto-restock job. Meant to be triggered on a schedule (e.g. every
// few hours via Supabase's Edge Function Cron, or pg_cron + pg_net), NOT by a
// customer request. Unlike process-purchase (which only reacts once your own
// stock has already run out at checkout time), this runs ahead of that:
//
// 1. For every active product with auto_restock_enabled, work out how many
//    units it typically sells per day (trailing 7-day average from `orders`).
// 2. Multiply that by the product's buffer (restock_buffer_days, default 3)
//    plus a small safety margin -> that's the target stock level.
// 3. If current stock is below target, buy the gap from whichever configured
//    provider can supply it - MuaBanVia first, then ShopClone, then
//    ShopViaClone22 - same provider order as the checkout-time fallback.
// 4. Update product_groups.stock_count and write a row to auto_restock_logs
//    for every attempt (success or failure) so this is auditable after the
//    fact, since nobody is watching it run in real time.
//
// IMPORTANT GAPS, by design, not oversight:
// - MuaBanVia: no confirmed "check stock" or "check balance" endpoint was
//   available when this was built, so for MuaBanVia this just attempts the
//   buy directly and relies on the provider's own error message to detect
//   insufficient stock/balance (same as the reactive checkout fallback).
// - ShopClone / ShopViaClone22: both expose a product-details endpoint
//   (product.php) and an account/profile endpoint (profile.php). This job
//   calls both before buying, but the exact field names for "stock" and
//   "balance" in their responses were not confirmed in writing - the parser
//   below tries several common field names defensively and logs the raw
//   response if none match, so it's easy to fix the field name later without
//   guessing blind.
//
// SECURITY: this function spends real money with no human approval step per
// run, so it is NOT protected by Supabase JWT verification (cron callers have
// no user session) - instead it requires a shared secret header. Set
// AUTO_RESTOCK_SECRET as an edge function env var, and configure whatever
// calls this (Supabase Cron / pg_cron) to send it as `x-cron-secret`.
// Verify JWT should be OFF for this function in the Supabase dashboard.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Pulls a numeric setting out of app_settings, falling back to a default if
// it's missing or not a valid number. Lets these be tuned without redeploying.
async function getNumericSetting(
  supabaseAdmin: ReturnType<typeof createClient>,
  key: string,
  fallback: number,
): Promise<number> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const parsed = data?.value ? parseFloat(data.value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

// Tries a list of possible field names/paths on a parsed JSON response and
// returns the first one that resolves to a finite number. Used because the
// exact response shape for ShopClone/ShopViaClone22's profile.php and
// product.php endpoints wasn't confirmed - this avoids hard failing if the
// real field name differs slightly from the guess.
function firstNumericField(obj: any, paths: string[]): number | null {
  if (!obj) return null
  for (const path of paths) {
    const value = path.split('.').reduce((acc: any, key) => (acc == null ? acc : acc[key]), obj)
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (typeof num === 'number' && Number.isFinite(num)) return num
  }
  return null
}

// Shared response parser for the buy_product endpoint, identical to the one
// in process-purchase - all three providers return the same shape:
// { status: "success", msg, trans_id, data: ["user|pass", ...] }
function parseFulfilledAccounts(rawAccounts: any, limit: number) {
  const fulfilledRaw: any[] = Array.isArray(rawAccounts) ? rawAccounts : []
  return fulfilledRaw.slice(0, limit).map((item: any) => {
    if (typeof item === 'string') {
      const parts = item.split('|').map((p: string) => p.trim())
      return {
        username: parts[0] || '',
        password: parts[1] || '',
        email: parts[2] || null,
        email_password: parts[3] || null,
        two_fa_code: parts[4] || null,
      }
    }
    return {
      username: item.username || item.user || item.login || '',
      password: item.password || item.pass || '',
      email: item.email || null,
      email_password: item.email_password || item.emailPass || null,
      two_fa_code: item.two_fa_code || item.twofa || item['2fa'] || null,
      additional_info: item,
    }
  })
}

interface ProviderConfig {
  name: string
  productId: string | null
  apiKeyEnv: string
  baseUrlEnv: string
  defaultBaseUrl: string
  idFieldNames: string[]
  // null = "no check endpoint available, buy blind" (currently MuaBanVia)
  profileEndpoint: string | null
  productEndpoint: string | null
}

async function checkProviderStock(provider: ProviderConfig, apiKey: string, baseUrl: string): Promise<number | null> {
  if (!provider.productEndpoint) return null
  try {
    const url = `${provider.productEndpoint}?api_key=${encodeURIComponent(apiKey)}&product=${encodeURIComponent(provider.productId || '')}`
    const res = await fetch(url)
    const data = await res.json().catch(() => null)
    const stock = firstNumericField(data, ['stock', 'quantity', 'available', 'qty', 'data.stock', 'data.quantity', 'data.available'])
    if (stock === null) {
      console.warn(`⚠️ ${provider.name}: could not find a stock field in product.php response, proceeding without a stock check. Raw response:`, JSON.stringify(data))
    }
    return stock
  } catch (err) {
    console.warn(`⚠️ ${provider.name}: stock check request failed, proceeding without it:`, err)
    return null
  }
}

async function checkProviderBalance(provider: ProviderConfig, apiKey: string): Promise<number | null> {
  if (!provider.profileEndpoint) return null
  try {
    const url = `${provider.profileEndpoint}?api_key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url)
    const data = await res.json().catch(() => null)
    const balance = firstNumericField(data, ['balance', 'money', 'credit', 'wallet', 'data.balance', 'data.money', 'data.credit'])
    if (balance === null) {
      console.warn(`⚠️ ${provider.name}: could not find a balance field in profile.php response. Raw response:`, JSON.stringify(data))
    }
    return balance
  } catch (err) {
    console.warn(`⚠️ ${provider.name}: balance check request failed, proceeding without it:`, err)
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const expectedSecret = Deno.env.get('AUTO_RESTOCK_SECRET')
  const providedSecret = req.headers.get('x-cron-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ success: false, error: 'Unauthorized' }, 401)
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const runSummary: any[] = []

  try {
    const maxPerProduct = await getNumericSetting(supabaseAdmin, 'auto_restock_max_per_product', 30)
    const maxTotalPerRun = await getNumericSetting(supabaseAdmin, 'auto_restock_max_total_per_run', 150)
    const safetyMultiplier = await getNumericSetting(supabaseAdmin, 'auto_restock_safety_multiplier', 1.15)

    let totalBoughtThisRun = 0

    const { data: products, error: productsError } = await supabaseAdmin
      .from('product_groups')
      .select('*')
      .eq('is_active', true)
      .eq('auto_restock_enabled', true)
      .or('muabanvia_product_id.not.is.null,shopclone_product_id.not.is.null,shopviaclone_product_id.not.is.null')

    if (productsError) {
      throw new Error(`Failed to load products: ${productsError.message}`)
    }

    console.log(`🔄 Auto-restock run starting: ${products?.length || 0} eligible product(s)`)

    for (const pg of products || []) {
      if (totalBoughtThisRun >= maxTotalPerRun) {
        console.log(`⏸️ Run-wide cap (${maxTotalPerRun}) reached - stopping for this run.`)
        break
      }

      // 1. Current stock
      const { count: currentStock } = await supabaseAdmin
        .from('individual_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('product_group_id', pg.id)
        .eq('status', 'available')

      const stockBefore = currentStock || 0

      // 2. Trailing 7-day sales velocity, read off orders.account_details.quantity
      // (quantity isn't a top-level orders column - it lives inside the JSON
      // snapshot recorded at purchase time).
      const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentOrders } = await supabaseAdmin
        .from('orders')
        .select('account_details')
        .eq('product_group_id', pg.id)
        .eq('status', 'completed')
        .gte('created_at', sinceDate)

      const totalSold = (recentOrders || []).reduce(
        (sum: number, o: any) => sum + (Number(o.account_details?.quantity) || 0),
        0,
      )
      const dailyVelocity = totalSold / 7
      const bufferDays = pg.restock_buffer_days || 3
      const targetStock = Math.ceil(dailyVelocity * bufferDays * safetyMultiplier)

      let shortfall = Math.max(0, targetStock - stockBefore)
      shortfall = Math.min(shortfall, maxPerProduct, maxTotalPerRun - totalBoughtThisRun)

      if (shortfall <= 0) {
        continue
      }

      console.log(`📊 ${pg.name}: stock=${stockBefore}, velocity=${dailyVelocity.toFixed(2)}/day, target=${targetStock}, buying up to ${shortfall}`)

      const providers: ProviderConfig[] = [
        {
          name: 'muabanvia',
          productId: pg.muabanvia_product_id,
          apiKeyEnv: 'MUABANVIA_API_KEY',
          baseUrlEnv: 'MUABANVIA_BASE_URL',
          defaultBaseUrl: 'https://muabanvia.org/api/buy_product',
          idFieldNames: ['ID', 'id'],
          profileEndpoint: null, // no confirmed endpoint - buys blind, relies on error messages
          productEndpoint: null,
        },
        {
          name: 'shopclone',
          productId: pg.shopclone_product_id,
          apiKeyEnv: 'SHOPCLONE_API_KEY',
          baseUrlEnv: 'SHOPCLONE_BASE_URL',
          defaultBaseUrl: 'https://shopclone.vn/api/buy_product',
          idFieldNames: ['id'],
          profileEndpoint: 'https://shopclone.vn/api/profile.php',
          productEndpoint: 'https://shopclone.vn/api/product.php',
        },
        {
          name: 'shopviaclone',
          productId: pg.shopviaclone_product_id,
          apiKeyEnv: 'SHOPVIACLONE_API_KEY',
          baseUrlEnv: 'SHOPVIACLONE_BASE_URL',
          defaultBaseUrl: 'https://shopviaclone22.com/api/buy_product',
          idFieldNames: ['id'],
          profileEndpoint: 'https://shopviaclone22.com/api/profile.php',
          productEndpoint: 'https://shopviaclone22.com/api/product.php',
        },
      ]

      for (const provider of providers) {
        if (shortfall <= 0) break
        if (!provider.productId) continue

        const apiKey = Deno.env.get(provider.apiKeyEnv)
        if (!apiKey) {
          console.warn(`⚠️ ${provider.apiKeyEnv} not configured, skipping ${provider.name} for ${pg.name}`)
          continue
        }

        const baseUrl = Deno.env.get(provider.baseUrlEnv) || provider.defaultBaseUrl

        // Best-effort pre-checks. Neither one hard-blocks the buy attempt -
        // they exist to avoid an obviously-doomed request and to surface
        // low-stock/low-balance signals in the logs, since we don't know the
        // provider's per-unit cost and can't precisely compute "balance covers
        // N units" - only the provider's own buy response can tell us that
        // for certain.
        const [providerStock, providerBalance] = await Promise.all([
          checkProviderStock(provider, apiKey, baseUrl),
          checkProviderBalance(provider, apiKey),
        ])

        if (providerStock !== null && providerStock <= 0) {
          console.log(`⏭️ ${provider.name} reports 0 stock for ${pg.name}, skipping to next provider.`)
          await supabaseAdmin.from('auto_restock_logs').insert([{
            product_group_id: pg.id,
            provider: provider.name,
            daily_velocity: dailyVelocity,
            target_stock: targetStock,
            stock_before: stockBefore,
            requested_qty: shortfall,
            fulfilled_qty: 0,
            success: false,
            message: 'Provider reports 0 stock',
          }])
          continue
        }

        if (providerBalance !== null && providerBalance <= 0) {
          console.log(`⏭️ ${provider.name} reports 0 balance, skipping to next provider.`)
          await supabaseAdmin.from('auto_restock_logs').insert([{
            product_group_id: pg.id,
            provider: provider.name,
            daily_velocity: dailyVelocity,
            target_stock: targetStock,
            stock_before: stockBefore,
            requested_qty: shortfall,
            fulfilled_qty: 0,
            success: false,
            message: 'Provider reports 0 balance - top up needed',
          }])
          continue
        }

        const buyQty = providerStock !== null ? Math.min(shortfall, providerStock) : shortfall

        try {
          const form = new FormData()
          form.set('action', 'buyProduct')
          for (const fieldName of provider.idFieldNames) {
            form.set(fieldName, String(provider.productId))
          }
          form.set('amount', String(buyQty))
          form.set('api_key', apiKey)

          const fulfillResponse = await fetch(baseUrl, { method: 'POST', body: form })
          const fulfillResult = await fulfillResponse.json().catch(() => null) as any

          if (!fulfillResponse.ok || fulfillResult?.status !== 'success') {
            throw new Error(fulfillResult?.msg || fulfillResult?.message || fulfillResult?.error || `${provider.name} could not fulfill the request`)
          }

          const fulfilledAccounts = parseFulfilledAccounts(fulfillResult?.data ?? [], buyQty)
          if (fulfilledAccounts.length === 0) {
            throw new Error(`${provider.name} returned no accounts`)
          }

          const { data: insertedAccounts, error: insertError } = await supabaseAdmin
            .from('individual_accounts')
            .insert(
              fulfilledAccounts.map((acc) => ({
                product_group_id: pg.id,
                username: acc.username,
                password: acc.password,
                email: acc.email,
                email_password: acc.email_password,
                two_fa_code: acc.two_fa_code,
                additional_info: (acc as any).additional_info || null,
                status: 'available',
                fulfillment_source: provider.name,
              })),
            )
            .select('id')

          if (insertError || !insertedAccounts) {
            throw new Error(insertError?.message || 'Failed to record auto-restocked accounts')
          }

          shortfall -= insertedAccounts.length
          totalBoughtThisRun += insertedAccounts.length

          console.log(`✅ ${provider.name} auto-restocked ${insertedAccounts.length} unit(s) for ${pg.name}`)

          await supabaseAdmin.from('auto_restock_logs').insert([{
            product_group_id: pg.id,
            provider: provider.name,
            daily_velocity: dailyVelocity,
            target_stock: targetStock,
            stock_before: stockBefore,
            requested_qty: buyQty,
            fulfilled_qty: insertedAccounts.length,
            success: true,
            message: 'OK',
          }])
        } catch (buyErr) {
          const message = buyErr instanceof Error ? buyErr.message : 'Unknown error'
          console.error(`❌ ${provider.name} auto-restock failed for ${pg.name}:`, message)
          await supabaseAdmin.from('auto_restock_logs').insert([{
            product_group_id: pg.id,
            provider: provider.name,
            daily_velocity: dailyVelocity,
            target_stock: targetStock,
            stock_before: stockBefore,
            requested_qty: buyQty,
            fulfilled_qty: 0,
            success: false,
            message,
          }])
        }
      }

      // Recompute this product's stock_count after attempting all providers
      const { count: newStock } = await supabaseAdmin
        .from('individual_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('product_group_id', pg.id)
        .eq('status', 'available')

      await supabaseAdmin
        .from('product_groups')
        .update({ stock_count: newStock || 0 })
        .eq('id', pg.id)

      runSummary.push({
        product_group_id: pg.id,
        name: pg.name,
        stock_before: stockBefore,
        stock_after: newStock || 0,
        target_stock: targetStock,
        daily_velocity: dailyVelocity,
      })
    }

    console.log(`✅ Auto-restock run complete. Bought ${totalBoughtThisRun} unit(s) total across ${runSummary.length} product(s).`)

    return json({ success: true, total_bought: totalBoughtThisRun, products: runSummary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Auto-restock run failed'
    console.error('❌ Auto-restock run error:', message)
    return json({ success: false, error: message, partial: runSummary }, 500)
  }
})
