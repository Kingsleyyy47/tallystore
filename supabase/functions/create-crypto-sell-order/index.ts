import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createNowPaymentsClient } from '../_shared/nowpayments-client.ts';
import { getUsdToNgnRate } from '../_shared/forex-rates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('🚀 create-crypto-sell-order invoked');

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    console.log('🔍 Auth header present:', !!authHeader);
    console.log('🔍 Auth header value:', authHeader ? `${authHeader.substring(0, 20)}...` : 'null');
    
    if (!authHeader) {
      console.error('❌ Missing authorization header');
      console.error('❌ All headers:', Array.from(req.headers.entries()));
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing authorization header',
          error_details: 'Authorization header is required. Please ensure you are logged in.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('❌ Missing Supabase environment variables');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Server configuration error',
          error_details: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Get authenticated user - explicitly passing token
    // Use case-insensitive regex to remove 'Bearer ' prefix
    const token = authHeader.replace(/^Bearer /i, '');
    
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('❌ User authentication failed:', userError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          error_details: userError?.message || 'User authentication failed',
          debug_info: {
            token_length: token.length,
            auth_header_prefix: authHeader.substring(0, 10),
            has_user: !!user,
            error_code: userError?.status,
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    console.log('✅ User authenticated:', user.id);

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError: any) {
      console.error('❌ Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request body',
          error_details: parseError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const { crypto_type, crypto_amount, naira_amount, network } = requestBody;
    console.log('📥 Request params:', { crypto_type, crypto_amount, naira_amount, network });

    // Validate required fields
    if (!crypto_type || !crypto_amount || !naira_amount) {
      console.error('❌ Missing required fields');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: crypto_type, crypto_amount, naira_amount',
          error_details: `Received: crypto_type=${crypto_type}, crypto_amount=${crypto_amount}, naira_amount=${naira_amount}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Initialize NowPayments client
    console.log('🔧 Initializing NowPayments client...');
    const nowPaymentsClient = createNowPaymentsClient({
      apiKey: Deno.env.get('NOWPAYMENTS_API_KEY') ?? '',
      email: Deno.env.get('NOWPAYMENTS_EMAIL'),
      password: Deno.env.get('NOWPAYMENTS_PASSWORD'),
    });

    // ============================================================
    // MINIMUM AMOUNT VALIDATION
    // ============================================================
    // Business decision: $20 USD minimum for ALL crypto transactions
    // This ensures NowPayments can process with rate-locking enabled
    // Review monthly - if volume is low, consider floating rate approach
    // ============================================================
    
    const MINIMUM_USD = 20;
    
    console.log(`📊 Validating minimum amount for ${crypto_type}...`);
    
    // Get crypto-to-USD rate to calculate minimum in crypto terms
    let minCryptoAmount: number;
    let cryptoToUsdRate: number;
    
    try {
      const minAmountResponse = await nowPaymentsClient.getMinimumPaymentAmount(
        crypto_type.toLowerCase(),
        undefined,
        'usd'
      );
      
      // Calculate rate: how much USD is 1 unit of this crypto worth?
      cryptoToUsdRate = minAmountResponse.fiat_equivalent / minAmountResponse.min_amount;
      
      // Calculate how much crypto equals $20 USD
      minCryptoAmount = MINIMUM_USD / cryptoToUsdRate;
      
      console.log(`✅ ${crypto_type.toUpperCase()}: 1 = $${cryptoToUsdRate.toFixed(4)} USD | Minimum: ${minCryptoAmount.toFixed(4)} ${crypto_type.toUpperCase()} (≈$${MINIMUM_USD} USD)`);
      
    } catch (error: any) {
      console.warn('⚠️ Could not fetch rate, using 1:1 assumption:', error.message);
      // Fallback for stablecoins or API errors - assume 1:1 with USD
      cryptoToUsdRate = 1;
      minCryptoAmount = MINIMUM_USD;
    }
    
    // Validate user input against minimum
    const userAmount = parseFloat(crypto_amount);
    const userAmountUsd = userAmount * cryptoToUsdRate;
    
    if (userAmountUsd < MINIMUM_USD) {
      console.log(`❌ Amount too small: ${userAmount} ${crypto_type.toUpperCase()} = $${userAmountUsd.toFixed(2)} USD (min: $${MINIMUM_USD})`);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `Minimum transaction is $${MINIMUM_USD} USD`,
          error_details: `You entered ${userAmount} ${crypto_type.toUpperCase()} (≈$${userAmountUsd.toFixed(2)} USD). Minimum is ${minCryptoAmount.toFixed(2)} ${crypto_type.toUpperCase()} (≈$${MINIMUM_USD} USD)`,
          min_amount: minCryptoAmount,
          min_usd: MINIMUM_USD,
          your_amount_usd: userAmountUsd,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    
    console.log(`✅ Amount validated: ${userAmount} ${crypto_type.toUpperCase()} = $${userAmountUsd.toFixed(2)} USD (min: $${MINIMUM_USD})`)

    // Generate unique order reference
    const orderReference = `TALLY-${Date.now()}-${user.id.substring(0, 8)}`;

    // Convert NGN to USD for NowPayments using live forex rate
    console.log('💱 Fetching live USD/NGN exchange rate...');
    let usdToNgn: number;
    try {
      usdToNgn = await getUsdToNgnRate();
      console.log(`✅ Live USD/NGN rate: 1 USD = ₦${usdToNgn.toFixed(2)}`);
    } catch (forexError: any) {
      console.error('❌ Failed to fetch forex rate:', forexError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to fetch exchange rate',
          error_details: forexError.message,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const usdAmount = naira_amount / usdToNgn / 1.05; // Remove the 5% markup to get base USD
    
    console.log(`💰 Creating payment: ${crypto_amount} ${crypto_type} = ₦${naira_amount} = $${usdAmount.toFixed(2)}`);

    // Create payment with NowPayments
    let payment;
    try {
      payment = await nowPaymentsClient.createPayment({
        price_amount: parseFloat(usdAmount.toFixed(2)),
        price_currency: 'usd',
        pay_currency: crypto_type.toLowerCase(),
        order_id: orderReference,
        order_description: `Crypto sell order - ${crypto_amount} ${crypto_type}`,
        ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/nowpayments-webhook`,
        is_fixed_rate: true, // Lock rate for 20 minutes
        is_fee_paid_by_user: true, // User pays the NowPayments processing fee (prevents "partially_paid" status)
      });
      console.log('✅ NowPayments payment created:', payment.payment_id);
    } catch (nowpaymentsError: any) {
      console.error('❌ NowPayments API error:', nowpaymentsError);
      console.error('❌ NowPayments error details:', {
        message: nowpaymentsError?.message,
        response: nowpaymentsError?.response,
        stack: nowpaymentsError?.stack,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to create payment with NowPayments',
          error_details: nowpaymentsError?.message || nowpaymentsError?.toString(),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    // Save transaction to database
    const { data: transaction, error: dbError } = await supabaseClient
      .from('crypto_transactions')
      .insert({
        user_id: user.id,
        crypto_type: crypto_type.toUpperCase(),
        crypto_amount: parseFloat(crypto_amount),
        naira_amount: parseFloat(naira_amount),
        exchange_rate: parseFloat(naira_amount) / parseFloat(crypto_amount), // Required field
        deposit_address: payment.pay_address, // Required field
        expires_at: payment.expiration_estimate_date, // Required field
        rate: parseFloat(naira_amount) / parseFloat(crypto_amount),
        status: 'pending',
        transaction_type: 'sell',
        payment_provider: 'nowpayments',
        
        // NowPayments fields
        nowpayments_payment_id: payment.payment_id,
        nowpayments_purchase_id: payment.purchase_id,
        nowpayments_pay_address: payment.pay_address,
        nowpayments_payin_extra_id: payment.payin_extra_id,
        nowpayments_network: network || payment.network,
        nowpayments_smart_contract: payment.smart_contract,
        nowpayments_amount_received: payment.amount_received,
        actually_paid: 0,
        outcome_amount: payment.pay_amount,
        outcome_currency: payment.pay_currency,
        payment_type: payment.type || 'crypto2crypto',
        burning_percent: payment.burning_percent,
        expiration_date: payment.expiration_estimate_date,
        fixed_rate_valid_until: payment.valid_until,
        
        payment_reference: orderReference,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to save transaction: ${dbError.message}`);
    }

    // Return payment details to frontend
    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        payment_details: {
          payment_id: payment.payment_id,
          pay_address: payment.pay_address,
          pay_amount: payment.pay_amount,
          pay_currency: payment.pay_currency,
          payin_extra_id: payment.payin_extra_id, // Memo/Tag for XRP, XLM, EOS
          network: payment.network,
          smart_contract: payment.smart_contract,
          expiration_date: payment.expiration_estimate_date,
          payment_status: payment.payment_status,
          qr_code_data: `${payment.pay_currency}:${payment.pay_address}${payment.payin_extra_id ? `?dt=${payment.payin_extra_id}` : ''}`,
        },
        message: 'Payment created successfully. Send crypto to the provided address.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Error in create-crypto-sell-order:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred',
        error_details: error?.toString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
