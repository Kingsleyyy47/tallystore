import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Applies a referral at signup time, server-side with the service role key.
//
// Why this exists: the client-side version of this logic (applyReferralOnSignup
// in src/lib/supabase.ts) ran immediately after supabase.auth.signUp(), but
// when email confirmation is required, signUp() returns a user object with
// NO active session - auth.uid() is null until the confirmation link is
// clicked. The referrer lookup (a SELECT) happened to still work because it
// was granted to the anon role, but the UPDATE on profiles to actually set
// referral_code / referred_by requires RLS's `auth.uid() = id` check, which
// fails with no session - so the write silently touched zero rows. Running
// this with the service role bypasses RLS entirely and isn't affected by
// whether the new user has confirmed their email yet.
//
// Verify JWT should be OFF for this function in the Supabase dashboard,
// since it's invoked right after signup before any session may exist.

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

function generateReferralCode(userId: string): string {
  return userId.replace(/-/g, '').substring(0, 8).toUpperCase()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405)
    }

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const userId = String(body.userId || '')
    const referralCodeInput = body.referralCode ? String(body.referralCode).trim() : ''

    if (!userId) {
      return json({ success: false, error: 'Missing userId' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const ownCode = generateReferralCode(userId)
    const update: Record<string, any> = { referral_code: ownCode }

    if (referralCodeInput) {
      const cleanCode = referralCodeInput.toUpperCase()

      // Don't let someone refer themselves
      if (cleanCode !== ownCode) {
        // Only set referred_by if this profile doesn't already have one -
        // this function could in theory be called more than once for the
        // same user, and we don't want a second call to overwrite a
        // legitimate earlier referral attribution.
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('referred_by')
          .eq('id', userId)
          .maybeSingle()

        if (!existingProfile?.referred_by) {
          const { data: referrer } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('referral_code', cleanCode)
            .maybeSingle()

          if (referrer) {
            update.referred_by = referrer.id
          }
        }
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(update)
      .eq('id', userId)

    if (updateError) {
      console.error('apply-referral update error:', updateError)
      return json({ success: false, error: updateError.message }, 500)
    }

    return json({ success: true, referralCode: ownCode, referredBy: update.referred_by ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply referral'
    console.error('apply-referral error:', message)
    return json({ success: false, error: message }, 500)
  }
})
