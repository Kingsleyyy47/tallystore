// api/webhook-ercas.ts
// Vercel serverless function for handling Ercas Pay webhooks

export default async function handler(req: any, res: any) {
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
      return res.status(400).json({ error: 'No user ID found in payload metadata' });
    }

    // Initialize Supabase (server-side with service role to bypass RLS)
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!  // Service role bypasses RLS for webhook operations
    );

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
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newBalance = profile.wallet_balance + payload.amount;

    // Update wallet balance
    const { error: balanceError } = await supabase
      .from('profiles')
      .update({ 
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (balanceError) {
      throw new Error(`Failed to update wallet: ${balanceError.message}`);
    }

    // Record transaction
    const { error: transactionError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'topup',
        amount: payload.amount,
        status: 'completed',
        balance_after: newBalance,
        description: 'Wallet top-up via Ercas Pay (Webhook)',
        reference: payload.transaction_reference,
        ercas_reference: payload.payment_reference
      }]);

    if (transactionError) {
      throw new Error(`Failed to record transaction: ${transactionError.message}`);
    }

    console.log('✅ Webhook payment processed successfully for user:', userId);
    
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        user_id: userId,
        amount: payload.amount,
        new_balance: newBalance,
        reference: payload.transaction_reference
      }
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
