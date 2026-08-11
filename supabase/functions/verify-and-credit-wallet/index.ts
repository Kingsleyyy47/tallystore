import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ERCASPAY_BASE_URL = 'https://api.ercaspay.com/api/v1';

// Milestone referral reward: the referrer earns a commission only on every
// 10th deposit made by their referred user (deposit #10, #20, #30, …).
// On those milestones the referrer gets referral_commission_pct % of that
// deposit amount (admin-configurable in app_settings, default 5%).
// Non-blocking: any failure must never affect the top-up that already completed.
async function creditReferrerForTopup(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  amount: number
) {
  try {
    const { data: buyerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by')
      .eq('id', userId)
      .single();

    if (!buyerProfile?.referred_by) return;

    // Count total completed deposits by this user (current one already inserted)
    const { count: depositCount } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'topup')
      .eq('status', 'completed');

    // Referral rewards only apply to the first 10 deposits (deposits 1–10).
    // After that, no more commission — the referrer has had their full reward.
    const REFERRAL_DEPOSIT_LIMIT = 10;
    if (!depositCount || depositCount > REFERRAL_DEPOSIT_LIMIT) {
      console.log(`ℹ️ Deposit #${depositCount} for user ${userId} — outside referral window (1–${REFERRAL_DEPOSIT_LIMIT}), no reward`);
      return;
    }

    console.log(`🎯 Deposit #${depositCount}/${REFERRAL_DEPOSIT_LIMIT} for user ${userId} — within referral window, crediting referrer`);

    const referrerId = buyerProfile.referred_by;

    const { data: pctSetting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'referral_commission_pct')
      .maybeSingle();

    const commissionPct = pctSetting?.value ? parseFloat(pctSetting.value) : 5;
    const commissionAmount = (amount * commissionPct) / 100;
    if (commissionAmount <= 0) return;

    const { data: referrerProfile } = await supabaseAdmin
      .from('profiles')
      .select('referral_balance')
      .eq('id', referrerId)
      .single();

    if (!referrerProfile) return;

    const newReferralBalance = (referrerProfile.referral_balance || 0) + commissionAmount;

    await supabaseAdmin
      .from('profiles')
      .update({ referral_balance: newReferralBalance })
      .eq('id', referrerId);

    await supabaseAdmin
      .from('referral_earnings')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: userId,
        order_amount: amount,
        commission_pct: commissionPct,
        commission_amount: commissionAmount,
      }]);

    console.log(`✅ Milestone referral reward (deposit #${depositCount}): ₦${commissionAmount} credited to referrer ${referrerId}`);
  } catch (referralError) {
    console.error('⚠️ Referral top-up reward error (non-blocking):', referralError);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { transaction_reference, ercas_reference, user_id: body_user_id } = await req.json();

    if (!transaction_reference) {
      throw new Error('transaction_reference is required');
    }

    // Determine user: either from JWT or from body (for cron/admin calls)
    let userId: string;

    // Try JWT auth first
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (user && !userError) {
      userId = user.id;
    } else if (body_user_id) {
      // Called by cron/admin with service role key — user_id passed in body
      // Verify caller is using service role key by checking if authHeader contains service role
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (authHeader !== `Bearer ${serviceRoleKey}`) {
        throw new Error('Unauthorized');
      }
      userId = body_user_id;
    } else {
      throw new Error('Unauthorized');
    }

    console.log(`🔍 Verifying payment: ${transaction_reference} for user ${userId}`);

    // STEP 1: Check if already processed (idempotency)
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id, amount, balance_after')
      .eq('reference', transaction_reference)
      .eq('user_id', userId)
      .eq('type', 'topup')
      .maybeSingle();

    if (existingTx) {
      console.log(`⚠️ Transaction already processed: ${transaction_reference}`);
      
      // Also update pending_payment status if exists
      await supabaseAdmin
        .from('pending_payments')
        .update({ status: 'credited', error_message: 'Already credited' })
        .eq('transaction_reference', transaction_reference);
      
      return new Response(
        JSON.stringify({
          success: true,
          already_processed: true,
          amount: existingTx.amount,
          new_balance: existingTx.balance_after,
          message: 'Payment already credited to wallet',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 2: Verify with Ercas Pay API
    const ercasSecretKey = Deno.env.get('ERCASPAY_SECRET_KEY');
    if (!ercasSecretKey) {
      throw new Error('Ercas Pay not configured');
    }

    const verifyResponse = await fetch(
      `${ERCASPAY_BASE_URL}/payment/transaction/verify/${transaction_reference}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${ercasSecretKey}`,
        },
      }
    );

    const verifyResult = await verifyResponse.json();
    console.log('📥 Ercas verification result:', JSON.stringify(verifyResult));

    // Handle pending
    if (verifyResult.responseBody?.status === 'PENDING' || verifyResult.responseCode === 'pending') {
      console.log('⏳ Payment is still pending');
      return new Response(
        JSON.stringify({
          success: false,
          status: 'pending',
          error: 'Payment is still pending. Please complete the payment.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Handle failed
    if (!verifyResult.requestSuccessful && verifyResult.responseBody?.status !== 'SUCCESSFUL') {
      const errorMsg = verifyResult.errorMessage || verifyResult.responseMessage || 'Payment verification failed';
      console.error('❌ Verification failed:', errorMsg);
      return new Response(
        JSON.stringify({
          success: false,
          status: 'failed',
          error: errorMsg,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const transaction = verifyResult.responseBody;

    if (transaction.status !== 'SUCCESSFUL') {
      return new Response(
        JSON.stringify({
          success: false,
          status: transaction.status.toLowerCase(),
          error: `Payment status: ${transaction.status}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const amount = transaction.amount;
    const ercasRef = transaction.ercs_reference;

    // STEP 3: INSERT transaction record FIRST as the atomic lock
    // The unique constraint on reference prevents double-crediting:
    // If two concurrent requests both pass the idempotency check above,
    // only ONE insert will succeed — the other hits unique constraint and fails.
    // This is the ONLY reliable way to prevent race conditions.
    
    // Read current balance for the record
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch wallet balance');
    }

    const currentBalance = parseFloat(profile.wallet_balance) || 0;
    const newBalance = currentBalance + amount;

    // Insert transaction first — if this fails due to unique constraint, another request already handled it
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'topup',
        amount: amount,
        status: 'completed',
        balance_after: newBalance,
        description: 'Wallet top-up via Ercas Pay',
        reference: transaction_reference,
        ercas_reference: ercasRef,
      });

    if (txError) {
      // Check if it's a unique constraint violation — means another request already processed this
      if (txError.code === '23505') {
        console.log(`⚠️ Transaction insert conflict (already processed by concurrent request): ${transaction_reference}`);
        
        // Fetch the existing transaction to return correct data
        const { data: existingTx2 } = await supabaseAdmin
          .from('transactions')
          .select('amount, balance_after')
          .eq('reference', transaction_reference)
          .eq('user_id', userId)
          .eq('type', 'topup')
          .maybeSingle();

        return new Response(
          JSON.stringify({
            success: true,
            already_processed: true,
            amount: existingTx2?.amount || amount,
            new_balance: existingTx2?.balance_after || newBalance,
            message: 'Payment already credited to wallet',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.error('❌ Failed to record transaction:', txError);
      throw new Error('Failed to record transaction');
    }

    // STEP 4: Transaction inserted successfully — now we're the ONLY request processing this.
    // Update wallet balance safely.
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single();

    if (updateError || !updatedProfile) {
      // Optimistic lock failed — balance changed between read and write.
      // Re-read and apply the credit.
      const { data: freshProfile } = await supabaseAdmin
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (freshProfile) {
        const freshBalance = parseFloat(freshProfile.wallet_balance) || 0;
        const retryBalance = freshBalance + amount;
        
        await supabaseAdmin
          .from('profiles')
          .update({
            wallet_balance: retryBalance,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        // Update the transaction record with correct balance_after
        await supabaseAdmin
          .from('transactions')
          .update({ balance_after: retryBalance })
          .eq('reference', transaction_reference)
          .eq('user_id', userId)
          .eq('type', 'topup');

        console.log(`✅ Wallet credited (retry): +₦${amount} for user ${userId}, new balance: ₦${retryBalance}`);

        await creditReferrerForTopup(supabaseAdmin, userId, amount);

        // Update pending_payment status
        await supabaseAdmin
          .from('pending_payments')
          .update({ status: 'credited' })
          .eq('transaction_reference', transaction_reference);

        return new Response(
          JSON.stringify({
            success: true,
            amount: amount,
            new_balance: retryBalance,
            message: `₦${amount.toLocaleString()} has been added to your wallet`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update pending_payment status
    await supabaseAdmin
      .from('pending_payments')
      .update({ status: 'credited' })
      .eq('transaction_reference', transaction_reference);

    console.log(`✅ Wallet credited: +₦${amount} for user ${userId}, new balance: ₦${newBalance}`);

    await creditReferrerForTopup(supabaseAdmin, userId, amount);

    return new Response(
      JSON.stringify({
        success: true,
        amount: amount,
        new_balance: newBalance,
        message: `₦${amount.toLocaleString()} has been added to your wallet`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Verify and credit error:', error);

    const message = error instanceof Error ? error.message : 'Failed to process payment';
    const status = message === 'Unauthorized' ? 401 : 400;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
