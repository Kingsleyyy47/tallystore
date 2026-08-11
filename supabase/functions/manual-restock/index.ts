import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Admin-triggered, one-off "buy N units now" action - used for the "Test
// Stock" button on a freshly-accepted product suggestion (see
// product_suggestions / acceptSuggestion in src/lib/supabase.ts), but works
// for any product with at least one provider ID configured.
//
// This is intentionally a SEPARATE action from accepting a suggestion:
// accepting just creates a draft product with no spend. Buying real stock is
// a distinct, explicit click here, consistent with every other money-moving
// action in this app requiring its own confirmation.
//
// Verify JWT should be ON for this function - it's only ever called by an
// authenticated admin from the dashboard, never on a schedule.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Same response parser used by process-purchase / auto-restock - all three
// providers return { status: "success", msg, trans_id, data: ["user|pass"] }
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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ success: false, error: 'Missing authorization header' }, 401)
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    )

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )

    if (userError || !user) {
      return json({ success: false, error: 'Unauthorized' }, 401)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!adminProfile?.is_admin) {
      return json({ success: false, error: 'Admin access required' }, 403)
    }

    const { product_group_id, quantity } = await req.json()
    if (!product_group_id || !quantity || quantity <= 0) {
      return json({ success: false, error: 'product_group_id and a positive quantity are required' }, 400)
    }
    if (quantity > 100) {
      return json({ success: false, error: 'Refuse to buy more than 100 units in one manual test - run it again if you need more.' }, 400)
    }

    const { data: pg, error: pgError } = await supabaseAdmin
      .from('product_groups')
      .select('*')
      .eq('id', product_group_id)
      .single()

    if (pgError || !pg) {
      return json({ success: false, error: 'Product not found' }, 404)
    }

    const providers: ProviderConfig[] = [
      {
        name: 'muabanvia',
        productId: pg.muabanvia_product_id,
        apiKeyEnv: 'MUABANVIA_API_KEY',
        baseUrlEnv: 'MUABANVIA_BASE_URL',
        defaultBaseUrl: 'https://muabanvia.org/api/buy_product',
        idFieldNames: ['ID', 'id'],
      },
      {
        name: 'shopclone',
        productId: pg.shopclone_product_id,
        apiKeyEnv: 'SHOPCLONE_API_KEY',
        baseUrlEnv: 'SHOPCLONE_BASE_URL',
        defaultBaseUrl: 'https://shopclone.vn/api/buy_product',
        idFieldNames: ['id'],
      },
      {
        name: 'shopviaclone',
        productId: pg.shopviaclone_product_id,
        apiKeyEnv: 'SHOPVIACLONE_API_KEY',
        baseUrlEnv: 'SHOPVIACLONE_BASE_URL',
        defaultBaseUrl: 'https://shopviaclone22.com/api/buy_product',
        idFieldNames: ['id'],
      },
    ]

    let remaining = quantity
    let totalBought = 0
    const attempts: any[] = []

    for (const provider of providers) {
      if (remaining <= 0) break
      if (!provider.productId) continue

      const apiKey = Deno.env.get(provider.apiKeyEnv)
      if (!apiKey) {
        attempts.push({ provider: provider.name, success: false, message: `${provider.apiKeyEnv} not configured` })
        continue
      }

      const baseUrl = Deno.env.get(provider.baseUrlEnv) || provider.defaultBaseUrl

      try {
        const form = new FormData()
        form.set('action', 'buyProduct')
        for (const fieldName of provider.idFieldNames) {
          form.set(fieldName, String(provider.productId))
        }
        form.set('amount', String(remaining))
        form.set('api_key', apiKey)

        const fulfillResponse = await fetch(baseUrl, { method: 'POST', body: form })
        const fulfillResult = await fulfillResponse.json().catch(() => null) as any

        if (!fulfillResponse.ok || fulfillResult?.status !== 'success') {
          throw new Error(fulfillResult?.msg || fulfillResult?.message || fulfillResult?.error || `${provider.name} could not fulfill the request`)
        }

        const fulfilledAccounts = parseFulfilledAccounts(fulfillResult?.data ?? [], remaining)
        if (fulfilledAccounts.length === 0) {
          throw new Error(`${provider.name} returned no accounts`)
        }

        const { data: insertedAccounts, error: insertError } = await supabaseAdmin
          .from('individual_accounts')
          .insert(
            fulfilledAccounts.map((acc) => ({
              product_group_id,
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
          throw new Error(insertError?.message || 'Failed to record purchased accounts')
        }

        remaining -= insertedAccounts.length
        totalBought += insertedAccounts.length
        attempts.push({ provider: provider.name, success: true, fulfilled: insertedAccounts.length })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        attempts.push({ provider: provider.name, success: false, message })
      }
    }

    // Keep stock_count in sync with however many units actually landed.
    const { count: newStock } = await supabaseAdmin
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('product_group_id', product_group_id)
      .eq('status', 'available')

    await supabaseAdmin
      .from('product_groups')
      .update({ stock_count: newStock || 0 })
      .eq('id', product_group_id)

    if (totalBought === 0) {
      return json({ success: false, error: 'No provider could fulfill this - check provider IDs and API keys.', attempts }, 502)
    }

    return json({ success: true, bought: totalBought, requested: quantity, attempts })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual restock failed'
    console.error('manual-restock error:', message)
    return json({ success: false, error: message }, 500)
  }
})
