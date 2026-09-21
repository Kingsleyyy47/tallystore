import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Referral-to-wallet conversion is hard-paused during the wallet incident
// review. Referral balances are not a trusted principal source until their
// funding model is rebuilt around the wallet engine.

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

    return json({
      success: false,
      code: 'REFERRAL_WITHDRAWALS_PAUSED',
      error: 'Referral withdrawals are temporarily disabled during wallet security review.',
    }, 503)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to withdraw referral balance'
    console.error('withdraw-referral-balance error:', message)
    return json({ success: false, error: message }, 500)
  }
})
