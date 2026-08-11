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
    // Kill switch - can disable all withdrawals instantly via env var
    if (Deno.env.get('WITHDRAWALS_ENABLED') === 'false') {
      throw new Error('Withdrawals are temporarily disabled for maintenance. Please try again later.');
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

    // Get authenticated user - explicitly pass token
    const token = authHeader.replace(/^Bearer /i, '');
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('Auth error:', userError);
      throw new Error('Unauthorized');
    }

    // Parse request body
    const { amount, bank_code, bank_name, account_number, account_name, narration, source } = await req.json();

    // Validate required fields
    if (!amount || !bank_code || !bank_name || !account_number || !account_name) {
      throw new Error('Missing required fields: amount, bank_code, bank_name, account_number, account_name');
    }

    // Validate amount
    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      throw new Error('Invalid amount');
    }

    // `source` selects which balance this withdrawal draws from. Defaults to 'crypto' to
    // preserve existing behavior exactly. 'referral' lets users cash out referral_balance
    // straight to their bank via the same SageCloud transfer flow below.
    const balanceSource: 'crypto' | 'referral' = source === 'referral' ? 'referral' : 'crypto';
    const balanceColumn = balanceSource === 'referral' ? 'referral_balance' : 'crypto_balance';

    // Check user's balance
    const { data: userData, error: userFetchError } = await supabaseClient
      .from('profiles')
      .select(balanceColumn)
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      throw new Error('Failed to fetch user balance');
    }

    const currentBalance = parseFloat((userData as any)[balanceColumn] || '0');
    if (currentBalance < withdrawalAmount) {
      throw new Error(`Insufficient balance. Available: ₦${currentBalance.toLocaleString()}, Requested: ₦${withdrawalAmount.toLocaleString()}`);
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

    // Step 1: Validate bank account (verify account name)
    console.log('Validating bank account...');
    let validatedAccountName = account_name;
    
    try {
      const validationResponse = await sageCloudClient.validateBankAccount({
        bank_code,
        account_number,
      });
      
      if (validationResponse && validationResponse.account_name) {
        validatedAccountName = validationResponse.account_name;
        console.log('Account validated:', validatedAccountName);
      }
    } catch (validationError) {
      console.warn('Account validation failed, proceeding with provided name:', validationError);
      // Continue with user-provided name if validation fails
    }

    // Calculate fee BEFORE checking SageCloud balance (we only need netAmount from SageCloud)
    const feePercentage = 2;
    const feeAmount = Math.ceil((withdrawalAmount * feePercentage) / 100);
    const netAmount = withdrawalAmount - feeAmount;
    
    console.log(`Fee calculation: Gross=₦${withdrawalAmount}, Fee=₦${feeAmount} (${feePercentage}%), Net=₦${netAmount}`);

    // Step 2: Check SageCloud balance (only need netAmount since fee stays as our profit)
    console.log('Checking SageCloud balance...');
    const sageCloudBalance = await sageCloudClient.getBalanceAmount();
    const balanceCheck: BalanceCheckResult = {
      hasBalance: sageCloudBalance >= netAmount, // Only need netAmount from SageCloud!
      currentBalance: sageCloudBalance,
      requestedAmount: netAmount, // The actual amount we'll send
      shortfall: Math.max(0, netAmount - sageCloudBalance),
      isLowBalance: sageCloudBalance < LOW_BALANCE_THRESHOLD,
      isCriticalBalance: sageCloudBalance < CRITICAL_BALANCE_THRESHOLD,
    };
    
    // Log balance status for monitoring
    console.log(`SageCloud balance check: Current=₦${balanceCheck.currentBalance.toLocaleString()}, Required=₦${balanceCheck.requestedAmount.toLocaleString()}, HasBalance=${balanceCheck.hasBalance}`);
    
    // Trigger admin alerts based on balance thresholds
    if (balanceCheck.isCriticalBalance) {
      await logAdminAlert(supabaseAdmin, 'critical_balance', balanceCheck, {
        transaction_type: 'withdrawal',
        user_id: user.id,
      });
    } else if (balanceCheck.isLowBalance) {
      await logAdminAlert(supabaseAdmin, 'low_balance', balanceCheck, {
        transaction_type: 'withdrawal',
        user_id: user.id,
      });
    }
    
    // If insufficient balance, log alert and return user-friendly error
    if (!balanceCheck.hasBalance) {
      await logAdminAlert(supabaseAdmin, 'insufficient_balance', balanceCheck, {
        transaction_type: 'withdrawal',
        user_id: user.id,
      });
      throw new Error('SERVICE_UNAVAILABLE: We\'re experiencing a temporary issue on our end. Please try again in a few minutes. If the problem persists, contact our support team.');
    }

    // Generate unique reference
    const reference = `TALLY-WD-${Date.now()}-${user.id.substring(0, 8)}`;

    // Step 3: Create withdrawal record (pending status)
    const { data: withdrawalRecord, error: dbError } = await supabaseClient
      .from('crypto_withdrawals')
      .insert({
        user_id: user.id,
        amount: withdrawalAmount,
        fee: feeAmount,
        net_amount: netAmount,
        bank_code,
        bank_name,
        account_number,
        account_name: validatedAccountName,
        status: 'pending',
        withdrawal_provider: 'sagecloud',
        balance_source: balanceSource,
        sagecloud_reference: reference,
        sagecloud_narration: narration || `Withdrawal to ${validatedAccountName}`,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to create withdrawal record: ${dbError.message}`);
    }

    // Step 4: Deduct from user's crypto balance with optimistic locking
    let balanceDeducted = false;
    let actualCurrentBalance = currentBalance;
    
    for (let attempt = 0; attempt < 5 && !balanceDeducted; attempt++) {
      // Re-fetch balance to ensure we have latest value (use admin client to bypass RLS)
      const { data: freshUserData } = await supabaseAdmin
        .from('profiles')
        .select(balanceColumn)
        .eq('id', user.id)
        .single();

      actualCurrentBalance = parseFloat((freshUserData as any)?.[balanceColumn] || '0');

      // Re-check balance is sufficient
      if (actualCurrentBalance < withdrawalAmount) {
        // Rollback withdrawal record
        await supabaseAdmin
          .from('crypto_withdrawals')
          .delete()
          .eq('id', withdrawalRecord.id);
        throw new Error(`Insufficient balance. Available: ₦${actualCurrentBalance.toLocaleString()}, Requested: ₦${withdrawalAmount.toLocaleString()}`);
      }

      // Optimistic lock: only update if balance matches what we read (use admin client)
      const { data: updateData, error: balanceError } = await supabaseAdmin
        .from('profiles')
        .update({ [balanceColumn]: actualCurrentBalance - withdrawalAmount })
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
        console.log(`✅ Deducted ₦${withdrawalAmount} (${balanceColumn}) from user ${user.id}, new balance: ₦${(updateData as any)[balanceColumn]}`);
      } else {
        console.warn(`🔁 No rows updated on attempt ${attempt + 1}, retrying...`);
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    
    if (!balanceDeducted) {
      // Rollback withdrawal record
      await supabaseAdmin
        .from('crypto_withdrawals')
        .delete()
        .eq('id', withdrawalRecord.id);
      throw new Error('Failed to deduct balance after multiple attempts. Please try again.');
    }

    // Step 5: Process transfer via SageCloud
    let transferResponse;
    let finalStatus = 'pending';
    
    try {
      console.log('Processing SageCloud transfer...');
      console.log(`Sending net amount: ₦${netAmount} (original: ₦${withdrawalAmount}, fee: ₦${feeAmount})`);
      transferResponse = await sageCloudClient.transfer({
        reference,
        bank_code,
        account_number,
        account_name: validatedAccountName,
        amount: netAmount, // Send NET amount (after fee deduction) - fee stays as your profit
        narration: narration || `Withdrawal to ${validatedAccountName}`,
      });

      console.log('SageCloud response:', JSON.stringify(transferResponse, null, 2));

      // Check if transfer was successful
      if (transferResponse.success && transferResponse.status === 'success') {
        finalStatus = 'completed';
      } else {
        finalStatus = 'failed';
      }

      // Update withdrawal record with transfer response
      await supabaseClient
        .from('crypto_withdrawals')
        .update({
          status: finalStatus,
          sagecloud_response: JSON.stringify(transferResponse),
          sagecloud_transfer_status: transferResponse.status,
          completed_at: finalStatus === 'completed' ? new Date().toISOString() : null,
        })
        .eq('id', withdrawalRecord.id);

    } catch (transferError: unknown) {
      console.error('SageCloud transfer failed:', transferError);
      const errorMessage = transferError instanceof Error ? transferError.message : 'Unknown transfer error';

      // Update withdrawal as failed
      await supabaseClient
        .from('crypto_withdrawals')
        .update({
          status: 'failed',
          sagecloud_response: JSON.stringify({ error: errorMessage }),
        })
        .eq('id', withdrawalRecord.id);

      // Refund user's balance with optimistic locking
      let refunded = false;
      for (let attempt = 0; attempt < 5 && !refunded; attempt++) {
        const { data: currentUserData } = await supabaseAdmin
          .from('profiles')
          .select(balanceColumn)
          .eq('id', user.id)
          .single();

        const currentBal = parseFloat((currentUserData as any)?.[balanceColumn] || '0');
        const refundedBalance = currentBal + withdrawalAmount;

        const { data: refundData } = await supabaseAdmin
          .from('profiles')
          .update({ [balanceColumn]: refundedBalance })
          .eq('id', user.id)
          .eq(balanceColumn, currentBal)
          .select()
          .single();
        
        if (refundData) {
          refunded = true;
          console.log(`✅ Refunded ₦${withdrawalAmount} to user ${user.id}`);
        } else {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }

      throw new Error(`Transfer failed: ${errorMessage}`);
    }

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        withdrawal_id: withdrawalRecord.id,
        reference,
        status: finalStatus,
        amount: withdrawalAmount,
        account_name: validatedAccountName,
        message: finalStatus === 'completed' 
          ? 'Withdrawal processed successfully' 
          : 'Withdrawal is being processed',
        transfer_response: transferResponse,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error('Error in create-withdrawal-request:', error);
    let errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    // Handle SERVICE_UNAVAILABLE errors (our internal issues like low balance)
    if (errorMessage.startsWith('SERVICE_UNAVAILABLE:')) {
      errorMessage = errorMessage.replace('SERVICE_UNAVAILABLE: ', '');
    }
    // Handle SageCloud API errors with professional message
    else if (errorMessage.includes('SageCloud API error') || errorMessage.includes('SageCloud authentication failed')) {
      console.error('SageCloud API Error (hidden from user):', errorMessage);
      errorMessage = 'We\'re experiencing a temporary service disruption. Please try again later. If this continues, contact support.';
    }
    // Handle transfer failures with professional message
    else if (errorMessage.includes('Transfer failed')) {
      console.error('Transfer Error (hidden from user):', errorMessage);
      errorMessage = 'Your withdrawal could not be processed at this time. Your balance has been restored. Please try again later.';
    }
    
    // Return 200 status with success: false so client can read the error message
    // Only return non-200 for auth errors
    const statusCode = errorMessage.includes('Missing authorization') || errorMessage.includes('Unauthorized') ? 401 : 200;
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: statusCode,
      }
    );
  }
});
