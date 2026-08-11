// pages/api/webhook/ercas.ts
// Vercel serverless function for handling Ercas Pay webhooks
// Ercas sends POST to this endpoint when payment status changes

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    console.log('🔔 Ercas webhook received:', {
      transaction_reference: payload.transaction_reference,
      amount: payload.amount,
      status: payload.status,
      type: payload.type,
      user_id: payload.metadata?.user_id
    });

    // Validate payload
    if (!payload.transaction_reference || !payload.amount) {
      return res.status(400).json({ error: 'Invalid payload: missing required fields' });
    }

    // Only process successful credit transactions (top-ups)
    if (payload.type !== 'CREDIT' || payload.status !== 'SUCCESSFUL') {
      console.log('⏭️ Ignoring non-successful or non-credit transaction');
      return res.status(200).json({ message: 'Transaction ignored' });
    }

    // Extract user ID from metadata
    const userId = payload.metadata?.user_id;
    if (!userId) {
      console.error('❌ No user_id in metadata:', JSON.stringify(payload.metadata));
      return res.status(400).json({ error: 'No user ID found in payload metadata' });
    }

    // Initialize Supabase (server-side with service role to bypass RLS)
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Missing Supabase env vars');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if transaction already processed (idempotency)
    const { data: existingTransaction } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', payload.transaction_reference)
      .eq('user_id', userId)
      .single();

    if (existingTransaction) {
      console.log('✅ Transaction already processed:', payload.transaction_reference);
      return res.status(200).json({ message: 'Transaction already processed' });
    }

    // Get current wallet balance
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error('❌ User not found:', userId, profileError);
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = parseFloat(profile.wallet_balance) || 0;
    const amount = parseFloat(payload.amount);
    const newBalance = currentBalance + amount;

    // Atomic balance update with optimistic lock
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single();

    if (updateError || !updatedProfile) {
      // Optimistic lock failed (concurrent update) — retry with fresh balance
      console.log('⚠️ Balance conflict on webhook, retrying with fresh balance...');
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (freshProfile) {
        const freshBalance = parseFloat(freshProfile.wallet_balance) || 0;
        const retryBalance = freshBalance + amount;
        const { error: retryError } = await supabase
          .from('profiles')
          .update({
            wallet_balance: retryBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (retryError) {
          console.error('❌ Retry balance update failed:', retryError);
          return res.status(500).json({ error: 'Failed to update wallet balance' });
        }

        // Record transaction with retry balance
        await supabase.from('transactions').insert([{
          user_id: userId,
          type: 'topup',
          amount: amount,
          status: 'completed',
          balance_after: retryBalance,
          description: 'Wallet top-up via Ercas Pay (Webhook)',
          reference: payload.transaction_reference,
          ercas_reference: payload.payment_reference || null
        }]);

        console.log(`✅ Webhook: Credited ₦${amount} to user ${userId} (retry). New balance: ₦${retryBalance}`);
        return res.status(200).json({ success: true, amount, new_balance: retryBalance });
      }

      return res.status(500).json({ error: 'Failed to update wallet' });
    }

    // Record transaction
    const { error: transactionError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'topup',
        amount: amount,
        status: 'completed',
        balance_after: newBalance,
        description: 'Wallet top-up via Ercas Pay (Webhook)',
        reference: payload.transaction_reference,
        ercas_reference: payload.payment_reference || null
      }]);

    if (transactionError) {
      console.error('⚠️ Transaction record failed (wallet was updated):', transactionError);
      // Don't fail — wallet was updated, transaction record is secondary
    }

    // Also update pending_payments table if a record exists
    await supabase
      .from('pending_payments')
      .update({ status: 'credited' })
      .eq('transaction_reference', payload.transaction_reference)
      .eq('status', 'pending');

    console.log(`✅ Webhook: Credited ₦${amount} to user ${userId}. New balance: ₦${newBalance}`);

    return res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        user_id: userId,
        amount: amount,
        new_balance: newBalance,
        reference: payload.transaction_reference
      }
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
