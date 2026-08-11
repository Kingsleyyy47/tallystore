// Edge Function: update-crypto-rates (RENAMED: get-crypto-estimate)
// Gets real-time crypto price estimates from NowPayments API
// Converts crypto amount to NGN with live market rates

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createNowPaymentsClient } from '../_shared/nowpayments-client.ts';
import { getUsdToNgnRate } from '../_shared/forex-rates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { crypto_amount, crypto_currency } = await req.json();

    // Validation
    if (!crypto_amount || !crypto_currency) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: crypto_amount, crypto_currency' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (crypto_amount <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'crypto_amount must be greater than 0' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`🔄 Fetching live rate for ${crypto_amount} ${crypto_currency.toUpperCase()}...`);

    // Initialize NowPayments client
    const nowpaymentsApiKey = Deno.env.get('NOWPAYMENTS_API_KEY');
    if (!nowpaymentsApiKey) {
      throw new Error('NOWPAYMENTS_API_KEY not configured');
    }

    const nowpayments = createNowPaymentsClient({
      apiKey: nowpaymentsApiKey,
    });

    // Get estimated price from NowPayments
    // currency_from = crypto (e.g., btc, eth, usdt)
    // currency_to = usd (we'll convert USD to NGN)
    const estimate = await nowpayments.getEstimatedPrice(
      crypto_amount,
      crypto_currency.toLowerCase(),
      'usd'
    );

    console.log(`✅ NowPayments estimate: ${estimate.amount_from} ${estimate.currency_from.toUpperCase()} = $${estimate.estimated_amount}`);

    // Convert USD to NGN using live forex rate
    const usdToNgn = await getUsdToNgnRate();
    const ngnAmount = estimate.estimated_amount * usdToNgn;

    // Apply 5% markup for service fee
    const markup = 1.05;
    const finalNgnAmount = ngnAmount * markup;

    console.log(`💰 Final amount: ₦${finalNgnAmount.toLocaleString()} (with 5% markup)`);

    return new Response(
      JSON.stringify({
        success: true,
        crypto_amount: crypto_amount,
        crypto_currency: crypto_currency.toLowerCase(),
        usd_amount: estimate.estimated_amount,
        ngn_amount: Math.round(finalNgnAmount * 100) / 100, // Round to 2 decimal places
        usd_to_ngn_rate: usdToNgn,
        markup_percentage: 5,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('❌ Error getting crypto estimate:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to get estimate',
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
