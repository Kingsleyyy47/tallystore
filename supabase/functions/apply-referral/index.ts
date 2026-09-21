import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Applies referral attribution server-side after Supabase has an authenticated
// user. The function intentionally ignores any caller-provided user id.
//
// Verify JWT should be ON for this function in the Supabase dashboard.

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
    if (!authHeader) return json({ success: false, error: 'Unauthorized' }, 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    )
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) return json({ success: false, error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const userId = user.id
    const referralCodeInput = body.referralCode
      ? String(body.referralCode).trim()
      : typeof user.user_metadata?.referral_code_input === 'string'
        ? String(user.user_metadata.referral_code_input).trim()
        : ''

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: result, error: updateError } = await supabaseAdmin.rpc('apply_profile_referral_attribution', {
      p_user_id: userId,
      p_referral_code_input: referralCodeInput || null,
    })

    if (updateError) {
      console.error('apply-referral update error:', updateError)
      return json({ success: false, error: updateError.message }, 500)
    }

    return json(result || { success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply referral'
    console.error('apply-referral error:', message)
    return json({ success: false, error: message }, 500)
  }
})
