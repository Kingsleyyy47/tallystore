import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createSageCloudClient } from '../_shared/sagecloud-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Thresholds for balance alerts (in NGN)
const LOW_BALANCE_THRESHOLD = 50000;
const CRITICAL_BALANCE_THRESHOLD = 10000;

interface BalanceCheckResult {
  hasBalance: boolean;
  currentBalance: number;
  requestedAmount: number;
  shortfall: number;
  isLowBalance: boolean;
  isCriticalBalance: boolean;
}

/**
 * Log admin alert for low SageCloud balance
 */
async function logAdminAlert(
  supabaseAdmin: any,
  alertType: 'low_balance' | 'critical_balance' | 'insufficient_balance',
  balanceInfo: BalanceCheckResult,
  context: { transaction_type: string; user_id: string; reference?: string }
) {
  const alertMessage = alertType === 'critical_balance'
    ? `🚨 CRITICAL: SageCloud balance (₦${balanceInfo.currentBalance.toLocaleString()}) is below critical threshold (₦${CRITICAL_BALANCE_THRESHOLD.toLocaleString()})`
    : alertType === 'low_balance'
    ? `⚠️ WARNING: SageCloud balance (₦${balanceInfo.currentBalance.toLocaleString()}) is below warning threshold (₦${LOW_BALANCE_THRESHOLD.toLocaleString()})`
    : `❌ FAILED: Insufficient SageCloud balance. Needed: ₦${balanceInfo.requestedAmount.toLocaleString()}, Available: ₦${balanceInfo.currentBalance.toLocaleString()}, Shortfall: ₦${balanceInfo.shortfall.toLocaleString()}`;

  console.error(`[ADMIN ALERT] ${alertMessage}`);
  console.error(`[ADMIN ALERT] Context: ${JSON.stringify(context)}`);

  // Log to admin_alerts table for dashboard visibility
  try {
    await supabaseAdmin
      .from('admin_alerts')
      .insert({
        alert_type: alertType,
        severity: alertType === 'critical_balance' ? 'critical' : alertType === 'low_balance' ? 'warning' : 'error',
        message: alertMessage,
        context: {
          ...context,
          balance_info: balanceInfo,
        },
        acknowledged: false,
      });
  } catch (dbError) {
    // Don't fail the transaction if alert logging fails
    console.error('[ADMIN ALERT] Failed to log to database:', dbError);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Kill switch - can disable all bill purchases instantly via env var
    if (Deno.env.get('BILLS_ENABLED') === 'false') {
      throw new Error('Bills payment is temporarily disabled for maintenance. Please try again later.');
    }

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Get authenticated user - pass token directly like get-data-plans
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse request body - includes payment_source and idempotency_key
    const { transaction_type, amount, service_provider, phone, data_plan_code, payment_source = 'wallet', idempotency_key } = await req.json();

    // Normalize provider to uppercase
    const normalizedProvider = service_provider?.toUpperCase();

    // Validate required fields
    if (!transaction_type || !amount || !normalizedProvider || !phone) {
      throw new Error('Missing required fields: transaction_type, amount, service_provider, phone');
    }

    // Validate idempotency key (required to prevent double-charges)
    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }

    // Validate transaction type
    if (!['airtime', 'data'].includes(transaction_type)) {
      throw new Error('Invalid transaction_type. Must be "airtime" or "data"');
    }

    // Validate payment source
    if (!['wallet', 'crypto'].includes(payment_source)) {
      throw new Error('Invalid payment_source. Must be "wallet" or "crypto"');
    }

    // Validate service provider
    const validProviders = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'];
    if (!validProviders.includes(normalizedProvider)) {
      throw new Error(`Invalid service_provider. Must be one of: ${validProviders.join(', ')}`);
    }

    // Idempotency check - prevent double-charges
    const { data: existingTransaction } = await supabaseClient
      .from('bills_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingTransaction) {
      console.log(`⚠️ Idempotency hit: returning existing transaction ${existingTransaction.id}`);
      return new Response(
        JSON.stringify({
          success: true,
          transaction_id: existingTransaction.id,
          reference: existingTransaction.reference,
          status: existingTransaction.status,
          transaction_type: existingTransaction.transaction_type,
          amount: existingTransaction.amount,
          service_provider: existingTransaction.service_provider,
          beneficiary_phone: existingTransaction.beneficiary_phone,
          payment_source: existingTransaction.payment_source,
          message: 'Transaction already processed',
          idempotency_hit: true,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Validate amount
    const purchaseAmount = parseFloat(amount);
    if (isNaN(purchaseAmount) || purchaseAmount <= 0) {
      throw new Error('Invalid amount');
    }

    // For data purchase, validate plan code
    if (transaction_type === 'data' && !data_plan_code) {
      throw new Error('data_plan_code is required for data purchases');
    }

    // Determine which balance column to use
    const balanceColumn = payment_source === 'wallet' ? 'wallet_balance' : 'crypto_balance';
    const balanceDisplayName = payment_source === 'wallet' ? 'TallyStore' : 'Crypto';

    // Check user's balance (dynamic column)
    const { data: userData, error: userFetchError } = await supabaseClient
      .from('profiles')
      .select(balanceColumn)
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      throw new Error('Failed to fetch user balance');
    }

    const currentBalance = parseFloat(userData?.[balanceColumn] || '0');
    if (currentBalance < purchaseAmount) {
      throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${currentBalance.toLocaleString()}, Required: ₦${purchaseAmount.toLocaleString()}`);
    }

    // Initialize SageCloud client
    const sageCloudClient = createSageCloudClient({
      publicKey: Deno.env.get('SAGECLOUD_PUBLIC_KEY') ?? '',
      secretKey: Deno.env.get('SAGECLOUD_SECRET_KEY') ?? '',
    });

    // Initialize admin client for alerts (uses service role key)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Check SageCloud balance
    console.log('Checking SageCloud balance...');
    const sageCloudBalance = await sageCloudClient.getBalanceAmount();
    const balanceCheck: BalanceCheckResult = {
      hasBalance: sageCloudBalance >= purchaseAmount,
      currentBalance: sageCloudBalance,
      requestedAmount: purchaseAmount,
      shortfall: Math.max(0, purchaseAmount - sageCloudBalance),
      isLowBalance: sageCloudBalance < LOW_BALANCE_THRESHOLD,
      isCriticalBalance: sageCloudBalance < CRITICAL_BALANCE_THRESHOLD,
    };
    
    // Log balance status for monitoring
    console.log(`SageCloud balance check: Current=₦${balanceCheck.currentBalance.toLocaleString()}, Required=₦${balanceCheck.requestedAmount.toLocaleString()}, HasBalance=${balanceCheck.hasBalance}`);
    
    // Trigger admin alerts based on balance thresholds
    if (balanceCheck.isCriticalBalance) {
      await logAdminAlert(supabaseAdmin, 'critical_balance', balanceCheck, {
        transaction_type,
        user_id: user.id,
      });
    } else if (balanceCheck.isLowBalance) {
      await logAdminAlert(supabaseAdmin, 'low_balance', balanceCheck, {
        transaction_type,
        user_id: user.id,
      });
    }
    
    // If insufficient balance, log alert and return user-friendly error
    if (!balanceCheck.hasBalance) {
      await logAdminAlert(supabaseAdmin, 'insufficient_balance', balanceCheck, {
        transaction_type,
        user_id: user.id,
      });
      throw new Error('Insufficient SageCloud balance. Please contact support.');
    }

    // Generate unique reference
    const reference = `TALLY-${transaction_type.toUpperCase()}-${Date.now()}-${user.id.substring(0, 8)}`;

    // Create bills transaction record (pending status) - includes payment_source and idempotency_key
    const { data: billRecord, error: dbError } = await supabaseClient
      .from('bills_transactions')
      .insert({
        user_id: user.id,
        reference,
        transaction_type,
        amount: purchaseAmount,
        status: 'pending',
        service_provider: normalizedProvider,
        service_code: data_plan_code || null,
        beneficiary_phone: phone,
        payment_source: payment_source,
        idempotency_key: idempotency_key,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to create transaction record: ${dbError.message}`);
    }

    // Deduct from user's balance with optimistic locking (dynamic column)
    let balanceDeducted = false;
    let actualCurrentBalance = currentBalance;
    
    for (let attempt = 0; attempt < 5 && !balanceDeducted; attempt++) {
      // Re-fetch balance to ensure we have latest value (use admin client)
      const { data: freshUserData } = await supabaseAdmin
        .from('profiles')
        .select(balanceColumn)
        .eq('id', user.id)
        .single();
      
      actualCurrentBalance = parseFloat(freshUserData?.[balanceColumn] || '0');
      
      // Re-check balance is sufficient
      if (actualCurrentBalance < purchaseAmount) {
        // Rollback transaction record
        await supabaseAdmin
          .from('bills_transactions')
          .delete()
          .eq('id', billRecord.id);
        throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${actualCurrentBalance.toLocaleString()}, Required: ₦${purchaseAmount.toLocaleString()}`);
      }
      
      // Optimistic lock: only update if balance matches what we read (use admin client)
      const { data: updateData, error: balanceError } = await supabaseAdmin
        .from('profiles')
        .update({ [balanceColumn]: actualCurrentBalance - purchaseAmount })
        .eq('id', user.id)
        .eq(balanceColumn, actualCurrentBalance)
        .select()
        .single();

      if (balanceError) {
        console.warn(`⚠️ Balance deduction conflict on attempt ${attempt + 1}, retrying...`);
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }

      if (updateData) {
        balanceDeducted = true;
        console.log(`✅ Deducted ₦${purchaseAmount} from user ${user.id} ${balanceColumn}, new balance: ₦${updateData[balanceColumn]}`);
      } else {
        console.warn(`🔁 No rows updated on attempt ${attempt + 1}, retrying...`);
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    
    if (!balanceDeducted) {
      // Rollback transaction record
      await supabaseAdmin
        .from('bills_transactions')
        .delete()
        .eq('id', billRecord.id);
      throw new Error('Failed to deduct balance after multiple attempts. Please try again.');
    }

    // Process purchase via SageCloud
    let purchaseResponse;
    let finalStatus = 'pending';
    
    try {
      if (transaction_type === 'airtime') {
        // Purchase airtime
        console.log('Processing airtime purchase...');
        const service = `${normalizedProvider}VTU`; // e.g., MTNVTU, GLOVTU
        
        purchaseResponse = await sageCloudClient.purchaseAirtime({
          reference,
          network: normalizedProvider as 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE',
          service,
          phone,
          amount: purchaseAmount.toString(),
        });

      } else {
        // Purchase data
        console.log('Processing data purchase...');
        const dataType = `${normalizedProvider}DATA`; // e.g., MTNDATA, GLODATA
        
        purchaseResponse = await sageCloudClient.purchaseData({
          reference,
          type: dataType,
          code: data_plan_code!,
          network: normalizedProvider as 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE',
          phone,
          provider: normalizedProvider,
        });
      }

      console.log('SageCloud response:', JSON.stringify(purchaseResponse, null, 2));

      // Check if purchase was successful
      if (purchaseResponse.success && purchaseResponse.status === 'success') {
        finalStatus = 'successful';
      } else {
        finalStatus = 'failed';
      }

      // Update transaction with response
      await supabaseClient
        .from('bills_transactions')
        .update({
          status: finalStatus,
          sagecloud_reference: purchaseResponse.reference || reference,
          sagecloud_response: JSON.stringify(purchaseResponse),
          completed_at: finalStatus === 'successful' ? new Date().toISOString() : null,
        })
        .eq('id', billRecord.id);

    } catch (purchaseError: unknown) {
      console.error('SageCloud purchase failed:', purchaseError);
      const errorMessage = purchaseError instanceof Error ? purchaseError.message : 'Unknown purchase error';

      // Update transaction as failed
      await supabaseClient
        .from('bills_transactions')
        .update({
          status: 'failed',
          sagecloud_response: JSON.stringify({ error: errorMessage }),
        })
        .eq('id', billRecord.id);

      // Refund user's balance with optimistic locking (same column that was deducted)
      let refunded = false;
      for (let attempt = 0; attempt < 5 && !refunded; attempt++) {
        const { data: currentUserData } = await supabaseAdmin
          .from('profiles')
          .select(balanceColumn)
          .eq('id', user.id)
          .single();
        
        const currentBal = parseFloat(currentUserData?.[balanceColumn] || '0');
        const refundedBalance = currentBal + purchaseAmount;
        
        const { data: refundData } = await supabaseAdmin
          .from('profiles')
          .update({ [balanceColumn]: refundedBalance })
          .eq('id', user.id)
          .eq(balanceColumn, currentBal)
          .select()
          .single();
        
        if (refundData) {
          refunded = true;
          console.log(`✅ Refunded ₦${purchaseAmount} to user ${user.id} ${balanceColumn}`);
        } else {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }

      throw new Error(`Purchase failed: ${errorMessage}`);
    }

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: billRecord.id,
        reference,
        status: finalStatus,
        transaction_type,
        amount: purchaseAmount,
        service_provider: normalizedProvider,
        beneficiary_phone: phone,
        payment_source: payment_source,
        message: finalStatus === 'successful' 
          ? `${transaction_type === 'airtime' ? 'Airtime' : 'Data'} purchase successful` 
          : `${transaction_type === 'airtime' ? 'Airtime' : 'Data'} purchase is being processed`,
        purchase_response: purchaseResponse,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in purchase-bills:', error);
    
    // Return 200 status with success: false so client can read the error message
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
});
