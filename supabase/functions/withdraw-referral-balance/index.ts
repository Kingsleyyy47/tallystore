import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Moves a user's referral_balance into their wallet_balance, server-side
// with the service role key.
//
// Why this exists: the client-side version of this (withdrawReferralBalance
// in src/lib/supabase.ts) ran the UPDATE on profiles directly from the
// browser with the user's own session. That update reported success
// ("Moved to wallet") because Supabase only returns an error for things like
// a bad query - it does NOT error just because RLS filtered the row out of
// the UPDATE's WHERE clause. profiles RLS doesn't allow authenticated users
// to write their own wallet_balance/referral_balance columns directly (every
// other balance-changing flow in this app - purchases, top-ups, referral
// signup - already goes through a service-role edge function for exactly
// this reason), so the update silently touched 0 rows and nothing moved,
// even though the client got back no error.
//
// Verify JWT should be ON for this function - it changes the caller's own
// money, so it must only run for an authenticated request.

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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('referral_balance, wallet_balance')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return json({ success: false, error: 'Could not load profile' }, 400)
    }

    const amount = profile.referral_balance || 0
    if (amount <= 0) {
      return json({ success: false, error: 'No referral balance to withdraw' }, 400)
    }

    const newWalletBalance = (profile.wallet_balance || 0) + amount

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ referral_balance: 0, wallet_balance: newWalletBalance })
      .eq('id', user.id)
      .select('id')
      .single()

    if (updateError || !updated) {
      return json({ success: false, error: updateError?.message || 'Failed to update balance' }, 500)
    }

    await supabaseAdmin
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'referral_withdrawal',
        amount: amount,
        balance_after: newWalletBalance,
        description: 'Referral earnings moved to wallet balance',
        reference: `REF-${Date.now()}`,
      }])

    return json({ success: true, amount })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to withdraw referral balance'
    console.error('withdraw-referral-balance error:', message)
    return json({ success: false, error: message }, 500)
  }
})
