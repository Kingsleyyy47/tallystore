import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('[CHECK-PENDING] Starting automatic payment verification...');

    // Get pending payments that need checking
    // Check payments that are:
    // 1. Status = 'pending'
    // 2. Created within last 48 hours (older = expired)
    // 3. Either never checked OR last checked > 10 minutes ago
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: pendingPayments, error: fetchError } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('status', 'pending')
      .gte('created_at', fortyEightHoursAgo)
      .or(`last_check_at.is.null,last_check_at.lt.${tenMinutesAgo}`)
      .order('created_at', { ascending: true })
      .limit(50); // Process max 50 at a time

    if (fetchError) {
      console.error('[CHECK-PENDING] Error fetching pending payments:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pending payments' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      console.log('[CHECK-PENDING] No pending payments to process');
      return new Response(
        JSON.stringify({ message: 'No pending payments to process', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[CHECK-PENDING] Found ${pendingPayments.length} pending payments to check`);

    const results = {
      processed: 0,
      credited: 0,
      failed: 0,
      expired: 0,
      errors: [] as any[]
    };

    // Process each pending payment
    for (const payment of pendingPayments) {
      try {
        console.log(`[CHECK-PENDING] Checking payment ${payment.id} (ref: ${payment.transaction_reference})`);

        // Update last_check_at and increment check_count
        await supabase
          .from('pending_payments')
          .update({
            last_check_at: new Date().toISOString(),
            check_count: (payment.check_count || 0) + 1
          })
          .eq('id', payment.id);

        // Check if payment is too old (>48 hours) - mark as expired
        const paymentAge = Date.now() - new Date(payment.created_at).getTime();
        if (paymentAge > 48 * 60 * 60 * 1000) {
          console.log(`[CHECK-PENDING] Payment ${payment.id} expired (age: ${paymentAge}ms)`);
          await supabase
            .from('pending_payments')
            .update({
              status: 'expired',
              error_message: 'Payment verification expired after 48 hours'
            })
            .eq('id', payment.id);
          results.expired++;
          continue;
        }

        // Call verify-and-credit-wallet Edge Function
        // Pass user_id so cron (service-role) calls can identify the user
        const verifyResponse = await supabase.functions.invoke('verify-and-credit-wallet', {
          body: {
            transaction_reference: payment.transaction_reference,
            ercas_reference: payment.ercas_reference,
            user_id: payment.user_id
          }
        });

        if (verifyResponse.error) {
          console.error(`[CHECK-PENDING] Error calling verify function for ${payment.id}:`, verifyResponse.error);
          await supabase
            .from('pending_payments')
            .update({
              error_message: verifyResponse.error.message || 'Unknown error'
            })
            .eq('id', payment.id);
          results.errors.push({
            payment_id: payment.id,
            reference: payment.transaction_reference,
            error: verifyResponse.error.message
          });
          continue;
        }

        const verifyData = verifyResponse.data;
        console.log(`[CHECK-PENDING] Verify response for ${payment.id}:`, verifyData);

        if (verifyData.success && !verifyData.already_processed) {
          // Payment was successfully credited
          console.log(`[CHECK-PENDING] ✅ Payment ${payment.id} successfully credited: +₦${verifyData.amount}`);
          await supabase
            .from('pending_payments')
            .update({
              status: 'credited',
              error_message: null
            })
            .eq('id', payment.id);
          results.credited++;
        } else if (verifyData.success && verifyData.already_processed) {
          // Payment was already credited before
          console.log(`[CHECK-PENDING] Payment ${payment.id} already credited`);
          await supabase
            .from('pending_payments')
            .update({
              status: 'credited',
              error_message: 'Already credited'
            })
            .eq('id', payment.id);
          results.credited++;
        } else if (verifyData.status === 'PENDING' || verifyData.status === 'pending') {
          // Payment still pending at Ercas - keep checking
          console.log(`[CHECK-PENDING] Payment ${payment.id} still pending at Ercas`);
          // Don't update status, will check again next run
        } else if (verifyData.status === 'FAILED' || verifyData.status === 'failed') {
          // Payment failed at Ercas
          console.log(`[CHECK-PENDING] Payment ${payment.id} failed at Ercas`);
          await supabase
            .from('pending_payments')
            .update({
              status: 'failed',
              error_message: verifyData.message || 'Payment failed'
            })
            .eq('id', payment.id);
          results.failed++;
        } else {
          console.log(`[CHECK-PENDING] Payment ${payment.id} has unknown status:`, verifyData);
        }

        results.processed++;

      } catch (error: any) {
        console.error(`[CHECK-PENDING] Error processing payment ${payment.id}:`, error);
        results.errors.push({
          payment_id: payment.id,
          reference: payment.transaction_reference,
          error: error.message
        });
      }
    }

    console.log('[CHECK-PENDING] Processing complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Pending payments processed',
        ...results
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[CHECK-PENDING] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
