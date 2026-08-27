import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// PocketFi does NOT have a hosted-checkout / "amount in, payment link out" endpoint.
// Its real model (per PocketFi's own API docs) is PERMANENT VIRTUAL ACCOUNTS:
// we ask PocketFi once for a dedicated bank account number tied to this user, cache
// it on their profile, and show it to them. The user then bank-transfers money into
// that account from their own banking app (any amount, any time). PocketFi notifies
// us via webhook (api/webhook-pocketfi.ts) when a transfer lands, and that webhook
// credits the wallet. This function ONLY creates/returns the account — it never
// returns a checkoutUrl, because PocketFi has none for this flow.
//
// IMPORTANT: when calling /virtual-accounts/create, do NOT send "amount" or
// "type": "dynamic" — including either of those creates a TEMPORARY one-time-use
// account instead of a permanent one.

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
  if (error || !user?.email) throw new Error('Unauthorized')
  return user
}

function splitName(value: unknown): { first: string; last: string } {
  const cleaned = String(value || '').replace(/[^a-zA-Z\s]/g, '').trim()
  if (!cleaned) return { first: 'Tally', last: 'Customer' }
  const parts = cleaned.split(/\s+/)
  return {
    first: parts[0] || 'Tally',
    last: parts.slice(1).join(' ') || 'Customer',
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405)
    }

    const user = await getAuthenticatedUser(req)

    // NOTE: PocketFi's naming is the reverse of what you'd expect. The "Secret API Key"
    // is a plain hex string used only to verify inbound webhook signatures (HMAC) -- it
    // is NOT a valid bearer token. The "Public API Key" is the Laravel Sanctum-style
    // `id|token` credential that actually authenticates outbound API calls, so that's
    // what goes in the Authorization header below.
    const pocketfiToken = Deno.env.get('POCKETFI_PUBLIC_KEY')
    const pocketfiBusinessId = Deno.env.get('POCKETFI_BUSINESS_ID')
    if (!pocketfiToken || !pocketfiBusinessId) {
      throw new Error('Bank transfer top-up is temporarily unavailable.')
    }

    // NOTE: PocketFi's real base path is /api/v1, not /v1 — the previous version of
    // this function had the wrong default, which was part of why every call failed.
    const pocketfiBaseUrl = Deno.env.get('POCKETFI_BASE_URL') || 'https://api.pocketfi.ng/api/v1'

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    // 1. Return the cached account if we already created one for this user.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('full_name, pocketfi_account_number, pocketfi_account_name, pocketfi_bank, is_staff, is_admin')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Failed to load profile:', JSON.stringify(profileError))
      throw new Error(`Failed to load profile: ${profileError.message || profileError.code || 'unknown error'}`)
    }

    // Staff-only accounts (not admins) cannot use the bank transfer top-up.
    // Admins can top up their own wallets like any customer.
    if (profile.is_staff && !profile.is_admin) {
      throw new Error('Bank transfer top-ups are only available to customer accounts.')
    }

    if (profile?.pocketfi_account_number) {
      return json({
        success: true,
        message: 'Account already exists',
        data: {
          accountNumber: profile.pocketfi_account_number,
          accountName: profile.pocketfi_account_name,
          bankName: profile.pocketfi_bank,
        },
      })
    }

    // 2. No cached account yet — create a new PERMANENT virtual account via PocketFi.
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const { first, last } = splitName(profile?.full_name || body.customerName)

    // PocketFi valid virtual account banks (from docs):
    //   saveheaven, paga, kuda, 9psb, palmpay
    // palmpay REQUIRES NIN/BVN — skip it since we don't collect that.
    // Read admin-preferred bank from app_settings; fallback to full list.
    const VALID_BANKS = ['kuda', '9psb', 'paga', 'saveheaven']
    const { data: bankSetting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'pocketfi_bank')
      .maybeSingle()
    const preferredBank = bankSetting?.value && VALID_BANKS.includes(bankSetting.value) ? bankSetting.value : null
    // Put the preferred bank first, then the others as fallback
    const BANKS_TO_TRY = preferredBank
      ? [preferredBank, ...VALID_BANKS.filter((b) => b !== preferredBank)]
      : VALID_BANKS
    let response: Response | null = null
    let result: Record<string, any> | null = null
    let lastMessage = 'Unable to create your bank transfer account. Please try again.'

    for (const bank of BANKS_TO_TRY) {
      const createBody = {
        first_name: first,
        last_name: last,
        phone: String(body.customerPhoneNumber || '08000000000'),
        email: user.email,
        businessId: pocketfiBusinessId,
        bank,
      }
      response = await fetch(`${pocketfiBaseUrl}/virtual-accounts/create`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pocketfiToken}`,
        },
        body: JSON.stringify(createBody),
      })
      result = await response.json().catch(() => null) as Record<string, any> | null
      if (response.ok && result?.status !== false) {
        console.log(`PocketFi account created with bank=${bank}`)
        break
      }
      lastMessage = result?.message || result?.error || lastMessage
      console.error(`PocketFi create failed for bank=${bank}:`, JSON.stringify(result))
    }

    if (!response || !response.ok || result?.status === false) {
      return json({ success: false, message: lastMessage, error: lastMessage }, 400)
    }

    const bankEntry = result?.banks?.[0]
    if (!bankEntry?.accountNumber) {
      console.error('PocketFi returned no account:', JSON.stringify(result))
      throw new Error('PocketFi did not return an account number.')
    }

    const accountNumber = String(bankEntry.accountNumber)
    const accountName = String(bankEntry.accountName || `${first} ${last}`)
    const bankName = String(bankEntry.bankName || 'palmpay')

    await supabaseAdmin
      .from('profiles')
      .update({
        pocketfi_account_number: accountNumber,
        pocketfi_account_name: accountName,
        pocketfi_bank: bankName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    return json({
      success: true,
      message: 'Account created successfully',
      data: { accountNumber, accountName, bankName },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set up bank transfer account'
    const status = message === 'Unauthorized' || message === 'Missing authorization header' ? 401 : 400
    console.error('Create PocketFi account error:', message)
    return json({ success: false, message, error: message }, status)
  }
})
