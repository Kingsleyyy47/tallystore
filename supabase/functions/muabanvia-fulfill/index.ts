import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// MuaBanVia auto-fulfillment edge function.
// Called from processBulkPurchase (src/lib/supabase.ts) when the pre-stocked
// individual_accounts inventory for a product group runs out but that product group
// has auto_fulfill_enabled + a muabanvia_product_id configured. Buys the shortfall
// live from MuaBanVia and returns account credentials in the same shape as a
// pre-stocked IndividualAccount row, so the caller can insert them and complete
// the order exactly as if they'd been in stock all along.
//
// CONFIRMED real MuaBanVia API (from their own docs, https://muabanvia.org/api/buy_product):
//   POST https://muabanvia.org/api/buy_product
//   Content-Type: multipart/form-data (NOT JSON), fields:
//     action=buyProduct
//     ID=<muabanvia product id>
//     amount=<quantity>
//     coupon=<optional discount code>
//     api_key=<api key>           <- auth goes in the form body, NOT an Authorization header
//   Response (200):
//     {
//       "status": "success",
//       "msg": "...",
//       "trans_id": "...",
//       "data": ["1000040304952|GUTJXYIFPWLHCNDOMBRKVAQESZ", ...]   <- pipe-delimited strings directly under data
//     }
//   On failure, "status" is not "success" and "msg" carries the error text.

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

// MuaBanVia commonly returns purchased accounts as pipe-delimited strings,
// e.g. "username|password|email|email_password|2fa_code". Parse defensively.
function parseAccountString(raw: string) {
  const parts = String(raw).split('|').map((p) => p.trim())
  return {
    username: parts[0] || '',
    password: parts[1] || '',
    email: parts[2] || undefined,
    email_password: parts[3] || undefined,
    two_fa_code: parts[4] || undefined,
  }
}

function normalizeAccounts(raw: any): Array<Record<string, any>> {
  if (!raw) return []
  // Already an array of objects
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
    return raw.map((item) => ({
      username: item.username || item.user || item.login || '',
      password: item.password || item.pass || '',
      email: item.email,
      email_password: item.email_password || item.emailPass,
      two_fa_code: item.two_fa_code || item.twofa || item['2fa'],
      additional_info: item,
    }))
  }
  // Array of pipe-delimited strings
  if (Array.isArray(raw)) {
    return raw.map((item) => parseAccountString(item))
  }
  // Single string (could be newline-separated for multi-quantity)
  if (typeof raw === 'string') {
    return raw.split('\n').filter(Boolean).map((line) => parseAccountString(line))
  }
  return []
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Missing authorization header')

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    },
  )

  const { data: { user }, error } = await supabaseUser.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) throw new Error('Unauthorized')
  return user
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405)
    }

    await getAuthenticatedUser(req)

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const muabanviaProductId = String(body.muabanviaProductId || '')
    const quantity = Math.trunc(Number(body.quantity || 0))

    if (!muabanviaProductId) {
      throw new Error('Missing muabanviaProductId')
    }
    if (!quantity || quantity < 1) {
      throw new Error('Invalid quantity')
    }

    const apiKey = Deno.env.get('MUABANVIA_API_KEY')
    if (!apiKey) {
      throw new Error('Auto-fulfillment is temporarily unavailable.')
    }

    const baseUrl = Deno.env.get('MUABANVIA_BASE_URL') || 'https://muabanvia.org/api/buy_product'
    const coupon = body.coupon ? String(body.coupon) : undefined

    const form = new FormData()
    form.set('action', 'buyProduct')
    // MuaBanVia's own docs are inconsistent about casing ("ID" in one example, "id" in
    // another) -- send both so this works regardless of which one their backend reads.
    form.set('ID', muabanviaProductId)
    form.set('id', muabanviaProductId)
    form.set('amount', String(quantity))
    if (coupon) form.set('coupon', coupon)
    form.set('api_key', apiKey)

    const response = await fetch(baseUrl, {
      method: 'POST',
      body: form,
    })

    const result = await response.json().catch(() => null) as Record<string, any> | null
    if (!response.ok || result?.status !== 'success') {
      const message = result?.msg || result?.message || result?.error || 'MuaBanVia could not fulfill this order.'
      return json({ success: false, message, error: message }, 400)
    }

    const rawAccounts = result?.data ?? null
    const accounts = normalizeAccounts(rawAccounts)

    if (accounts.length < quantity) {
      return json({
        success: false,
        message: `MuaBanVia only returned ${accounts.length} of ${quantity} requested accounts.`,
        error: 'Insufficient accounts returned',
      }, 502)
    }

    return json({
      success: true,
      message: 'Accounts fulfilled successfully',
      data: { accounts: accounts.slice(0, quantity) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fulfill order via MuaBanVia'
    const status = message === 'Unauthorized' || message === 'Missing authorization header' ? 401 : 400
    console.error('MuaBanVia fulfillment error:', message)
    return json({ success: false, message, error: message }, status)
  }
})
