import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nowpayments-sig',
};

// Verify IPN signature as per NowPayments docs
// https://documenter.getpostman.com/view/7907941/S1a32n38#ipn-callbacks
async function verifyIPNSignature(payload: any, receivedSignature: string, secret: string): Promise<boolean> {
  try {
    // Sort all parameters alphabetically (top-level only)
    const sortedPayload: Record<string, any> = {};
    Object.keys(payload).sort().forEach(key => {
      sortedPayload[key] = payload[key];
    });
    
    // Convert to string
    const payloadString = JSON.stringify(sortedPayload);
    
    // Sign with HMAC SHA-512
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadString));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return computedSignature === receivedSignature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get raw body and signature for verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-nowpayments-sig');
    const payload = JSON.parse(rawBody);
    
    console.log('NowPayments webhook received:', JSON.stringify(payload, null, 2));
    
    // Verify signature if IPN secret is configured
    const ipnSecret = Deno.env.get('NOWPAYMENTS_IPN_SECRET');
    if (ipnSecret && signature) {
      const isValid = await verifyIPNSignature(payload, signature, ipnSecret);
      if (!isValid) {
        console.error('❌ Invalid IPN signature - rejecting request');
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }
      console.log('✅ IPN signature verified');
    }
    
    // Initialize Supabase admin client (no user auth required for webhooks)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role for admin access
    );

    // Extract payment details from webhook
    const {
      payment_id,
      payment_status,
      pay_address,
      price_amount,
      price_currency,
      pay_amount,
      actually_paid,
      pay_currency,
      order_id,
      order_description,
      purchase_id,
      outcome_amount,
      outcome_currency,
      payin_hash,
      payout_hash,
      payin_extra_id,
      smart_contract,
      network,
      network_precision,
      time_limit,
      burning_percent,
      expiration_estimate_date,
      payment_extra_ids,
      parent_payment_id,
      origin_type,
      type,
    } = payload;

    // Find transaction by payment_id or order_id
    const { data: existingTransaction, error: findError } = await supabaseAdmin
      .from('crypto_transactions')
      .select('*')
      .or(`nowpayments_payment_id.eq.${payment_id},payment_reference.eq.${order_id}`)
      .single();

    if (findError || !existingTransaction) {
      console.error('Transaction not found:', payment_id, order_id);
      // Still return 200 to acknowledge webhook (prevent retries)
      return new Response(
        JSON.stringify({ success: true, message: 'Transaction not found, webhook acknowledged' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Map NowPayments status to our status
    let transactionStatus = existingTransaction.status;
    let shouldCreditUser = false;

    switch (payment_status) {
      case 'waiting':
        transactionStatus = 'pending';
        break;
      case 'confirming':
        transactionStatus = 'processing';
        break;
      case 'confirmed':
      case 'sending':
        transactionStatus = 'processing';
        break;
      case 'finished':
        transactionStatus = 'completed';
        shouldCreditUser = true;
        break;
      case 'partially_paid':
        transactionStatus = 'partially_paid';
        shouldCreditUser = true; // Credit the partial amount
        break;
      case 'failed':
        transactionStatus = 'failed';
        break;
      case 'refunded':
        transactionStatus = 'refunded';
        break;
      case 'expired':
        transactionStatus = 'expired';
        break;
      default:
        transactionStatus = payment_status;
    }

    // Update transaction with webhook data
    const { error: updateError } = await supabaseAdmin
      .from('crypto_transactions')
      .update({
        status: transactionStatus,
        nowpayments_amount_received: actually_paid || pay_amount,
        actually_paid: actually_paid || 0,
        outcome_amount: outcome_amount,
        outcome_currency: outcome_currency,
        payout_hash: payout_hash,
        payment_extra_ids: payment_extra_ids ? payment_extra_ids : null,
        parent_payment_id: parent_payment_id,
        origin_type: origin_type,
      })
      .eq('id', existingTransaction.id);

    if (updateError) {
      console.error('Failed to update transaction:', updateError);
      throw updateError;
    }

    // Credit user's crypto balance if payment is finished or partially paid
    if (shouldCreditUser) {
      const amountToCredit = actually_paid || pay_amount || 0;
      
      if (amountToCredit > 0) {
        // BULLETPROOF IDEMPOTENCY: Check credited_at field
        // If credited_at is set, this transaction was ALREADY credited - NEVER credit again
        if (existingTransaction.credited_at) {
          console.log(`🛑 BLOCKED: Transaction ${existingTransaction.id} was already credited at ${existingTransaction.credited_at}`);
          shouldCreditUser = false;
        } else {
          // Double-check by re-fetching (race condition protection)
          const { data: freshTx } = await supabaseAdmin
            .from('crypto_transactions')
            .select('credited_at')
            .eq('id', existingTransaction.id)
            .single();
          
          if (freshTx?.credited_at) {
            console.log(`🛑 BLOCKED: Transaction ${existingTransaction.id} was just credited by another process at ${freshTx.credited_at}`);
            shouldCreditUser = false;
          } else {
            // ATOMIC: Set credited_at FIRST, then credit balance
            // This ensures we mark it as credited before touching the balance
            const creditTimestamp = new Date().toISOString();
            
            const { error: markCreditedError } = await supabaseAdmin
              .from('crypto_transactions')
              .update({ credited_at: creditTimestamp })
              .eq('id', existingTransaction.id)
              .is('credited_at', null); // Only update if NOT already credited
            
            if (markCreditedError) {
              console.error(`❌ Failed to mark transaction as credited:`, markCreditedError);
              shouldCreditUser = false;
            } else {
              // Verify we actually set credited_at (another process might have beat us)
              const { data: verifyTx } = await supabaseAdmin
                .from('crypto_transactions')
                .select('credited_at')
                .eq('id', existingTransaction.id)
                .single();
              
              // Compare timestamps properly (handle format differences between JS ISO and Postgres)
              const ourTime = new Date(creditTimestamp).getTime();
              const dbTime = verifyTx?.credited_at ? new Date(verifyTx.credited_at).getTime() : 0;
              const timeDiff = Math.abs(ourTime - dbTime);
              
              // If timestamps differ by more than 1 second, another process beat us
              if (timeDiff > 1000) {
                console.log(`🛑 BLOCKED: Another process credited this transaction first (time diff: ${timeDiff}ms)`);
                shouldCreditUser = false;
              } else {
                console.log(`✅ We set credited_at successfully, proceeding to credit balance`);
                // NOW it's safe to credit the balance
                const creditAmount = parseFloat(existingTransaction.naira_amount);
                
                const { data: userData, error: userError } = await supabaseAdmin
                  .from('profiles')
                  .select('crypto_balance')
                  .eq('id', existingTransaction.user_id)
                  .single();

                if (userError) {
                  console.error('Failed to fetch user:', userError);
                } else {
                  const currentBalance = parseFloat(userData.crypto_balance || '0');
                  const newBalance = currentBalance + creditAmount;

                  const { error: balanceError } = await supabaseAdmin
                    .from('profiles')
                    .update({ crypto_balance: newBalance })
                    .eq('id', existingTransaction.user_id);

                  if (balanceError) {
                    console.error(`❌ Balance update failed:`, balanceError);
                    // Rollback credited_at since we couldn't credit
                    await supabaseAdmin
                      .from('crypto_transactions')
                      .update({ credited_at: null })
                      .eq('id', existingTransaction.id);
                  } else {
                    console.log(`✅ Credited ${creditAmount} NGN to user ${existingTransaction.user_id} (new balance: ${newBalance})`);
                  }
                }
              }
            }
          }
        }
      }
    }

    console.log(`Webhook processed: payment_id=${payment_id}, status=${payment_status} -> ${transactionStatus}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook processed successfully',
        transaction_id: existingTransaction.id,
        status: transactionStatus,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error('Error in nowpayments-webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    // Still return 200 to prevent webhook retries
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
});
