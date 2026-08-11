import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'wisdomthedev@gmail.com';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize user client (to get authenticated user)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Verify the user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
      console.error(`Admin access denied for ${user.email}`);
      throw new Error('Admin access required');
    }

    // Initialize admin client (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify admin status in database
    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!adminProfile?.is_admin) {
      console.error(`❌ User ${user.email} is not marked as admin in database`);
      throw new Error('Admin access required');
    }

    // Parse request body
    const { 
      target_user_id, 
      adjustment_amount, 
      balance_type, 
      reason,
      idempotency_key 
    } = await req.json();

    // Validate inputs
    if (!target_user_id || typeof target_user_id !== 'string') {
      throw new Error('target_user_id is required');
    }

    if (typeof adjustment_amount !== 'number' || adjustment_amount === 0) {
      throw new Error('Valid adjustment_amount is required (positive to add, negative to subtract)');
    }

    if (!['wallet', 'crypto'].includes(balance_type)) {
      throw new Error('balance_type must be "wallet" or "crypto"');
    }

    if (!reason || typeof reason !== 'string' || reason.length < 5) {
      throw new Error('A reason with at least 5 characters is required');
    }

    console.log(`🔧 Admin ${user.email} adjusting balance for user ${target_user_id}`);
    console.log(`   Amount: ${adjustment_amount > 0 ? '+' : ''}₦${adjustment_amount}, Type: ${balance_type}`);
    console.log(`   Reason: ${reason}`);

    // Check idempotency (prevent duplicate adjustments)
    if (idempotency_key) {
      const { data: existingTx } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('idempotency_key', idempotency_key)
        .single();

      if (existingTx) {
        console.log(`⚠️ Duplicate adjustment prevented: ${idempotency_key}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This adjustment has already been processed',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }
    }

    // Get target user's current balance
    const balanceColumn = balance_type === 'wallet' ? 'wallet_balance' : 'crypto_balance';
    
    const { data: targetProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select(`id, email, ${balanceColumn}`)
      .eq('id', target_user_id)
      .single();

    if (profileError || !targetProfile) {
      throw new Error('Target user not found');
    }

    const currentBalance = targetProfile[balanceColumn] || 0;
    const newBalance = currentBalance + adjustment_amount;

    // Prevent negative balance
    if (newBalance < 0) {
      throw new Error(`Cannot reduce ${balance_type} balance below zero. Current: ₦${currentBalance}, Adjustment: ₦${adjustment_amount}`);
    }

    // Update balance with optimistic locking
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        [balanceColumn]: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', target_user_id)
      .eq(balanceColumn, currentBalance) // Optimistic lock
      .select()
      .single();

    if (updateError || !updatedProfile) {
      throw new Error('Balance update failed - concurrent modification detected. Please try again.');
    }

    // Record transaction for audit trail
    const transactionType = adjustment_amount > 0 ? 'admin_credit' : 'admin_debit';
    
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: target_user_id,
        type: transactionType,
        amount: Math.abs(adjustment_amount),
        status: 'completed',
        balance_after: newBalance,
        description: `Admin adjustment by ${user.email}: ${reason}`,
        reference: `ADMIN-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        idempotency_key: idempotency_key || null,
      });

    if (txError) {
      console.error('❌ Failed to record transaction:', txError);
      // Don't fail - balance was already updated
    }

    console.log(`✅ Balance adjusted: ${balance_type} ${adjustment_amount > 0 ? '+' : ''}₦${adjustment_amount}`);
    console.log(`   User: ${targetProfile.email}, New balance: ₦${newBalance}`);

    return new Response(
      JSON.stringify({
        success: true,
        target_user_id,
        target_email: targetProfile.email,
        balance_type,
        previous_balance: currentBalance,
        adjustment: adjustment_amount,
        new_balance: newBalance,
        reason,
        adjusted_by: user.email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Admin adjust balance error:', error);

    const message = error instanceof Error ? error.message : 'Failed to adjust balance';
    const status = message.includes('Unauthorized') || message.includes('Admin access') ? 403 : 400;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
