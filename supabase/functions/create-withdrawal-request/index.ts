import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

async function applyWalletTransaction(
  supabaseAdmin: any,
  params: {
    userId: string;
    type: string;
    amount: number;
    reference?: string;
    description?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    balanceType: 'crypto' | 'referral';
  },
) {
  const { data, error } = await supabaseAdmin.rpc('apply_wallet_transaction', {
    p_user_id: params.userId,
    p_type: params.type,
    p_amount: params.amount,
    p_reference: params.reference || null,
    p_description: params.description || null,
    p_idempotency_key: params.idempotencyKey || null,
    p_metadata: params.metadata || {},
    p_currency: 'NGN',
    p_balance_type: params.balanceType,
    p_external_payment_id: null,
    p_created_by: null,
  });

  if (error) throw new Error(error.message || 'Wallet transaction failed');
  const result = data as any;
  if (!result?.success) throw new Error(result?.error || 'Wallet transaction failed');
  return result;
}

async function purchaseGuardSha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanPurchaseGuardIp(value: string | null) {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() || '';
  const withoutPort = first.includes('.') ? first.replace(/:\d+$/, '') : first;
  const cleaned = withoutPort.replace(/[^a-fA-F0-9:.[\]]/g, '').replace(/^\[|\]$/g, '');
  if (!cleaned || cleaned.length > 80) return null;
  return cleaned;
}

function getPurchaseGuardIp(req?: Request | null) {
  if (!req) return null;
  return cleanPurchaseGuardIp(
    req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for') ||
      req.headers.get('forwarded')?.match(/for="?([^";,]+)"?/i)?.[1] ||
      null,
  );
}

function getPurchaseGuardUserAgent(req?: Request | null) {
  return Array.from(String(req?.headers.get('user-agent') || '')).filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('').trim().slice(0, 500);
}

async function getWalletRequestForensics(req: Request, route: string) {
  const userAgent = getPurchaseGuardUserAgent(req);
  return {
    request_id: req.headers.get('x-request-id') || req.headers.get('x-correlation-id') || crypto.randomUUID(),
    route,
    ip_address: getPurchaseGuardIp(req),
    user_agent: userAgent || null,
    user_agent_hash: userAgent ? await purchaseGuardSha256Hex(userAgent) : null,
    device_fingerprint: req.headers.get('x-device-fingerprint') || req.headers.get('x-client-device-id') || null,
    forwarded_for: req.headers.get('x-forwarded-for') || null,
    cf_ray: req.headers.get('cf-ray') || null,
    vercel_id: req.headers.get('x-vercel-id') || null,
  };
}

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── sagecloud-client.ts ──
/**
 * SageCloud API Client
 * Handles bank transfers, airtime, data, electricity, and TV bills
 * Documentation: https://docs.sagecloud.ng
 *
 * Migrated to the new platform (app.sagecloud.ng / api.sagecloud.ng) -
 * old base URL was https://sagecloud.ng/api/v2.
 */

const SAGECLOUD_API_URL = 'https://api.sagecloud.ng/api';

interface SageCloudConfig {
  publicKey: string;
  secretKey: string;
}

interface AuthResponse {
  success: boolean;
  data: {
    business_name: string;
    token: {
      access_token: string;
      token_type: string;
      expires_at: string;
    };
  };
}

interface BalanceResponse {
  success: boolean;
  status: string;
  general_wallet: {
    is_gl: number;
    can_be_negative: number;
    account_number: string;
    balance: string;
    commission: number;
    status: string;
    type: string | null;
  };
  sme_data_wallet: {
    balance: string;
    status: string;
  };
  corporate_data_wallet: {
    balance: string;
    status: string;
  };
}

interface TransferParams {
  reference: string;
  bank_code: string;
  account_number: string;
  account_name: string;
  amount: number;
  narration: string;
}

interface TransferResponse {
  success: boolean;
  status: string;
  message: string;
}

interface ValidateAccountParams {
  bank_code: string;
  account_number: string;
}

interface AirtimeParams {
  reference: string;
  network: 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE';
  service: string; // e.g., 'MTNVTU', 'GLOVTU'
  phone: string;
  amount: string;
}

interface AirtimeResponse {
  success: boolean;
  status: string;
  message: string;
  reference: string;
}

interface DataPlan {
  type: string;
  code: string;
  description: string;
  amount: string;
  price: string;
  value: string;
  duration: string;
}

interface DataLookupResponse {
  success: boolean;
  data: DataPlan[];
}

interface PurchaseDataParams {
  reference: string;
  type: string; // e.g., 'MTNDATA'
  code: string; // Plan code from lookup
  network: 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE';
  phone: string;
  provider: string; // e.g., 'MTN'
}

interface RequeryResponse {
  success: boolean;
  message: string;
  transaction: {
    type: string;
    reference: string;
    status: 'successful' | 'pending' | 'failed';
    date: string;
  };
  data?: any;
}

// Result from balance check with detailed info for alerting
export interface BalanceCheckResult {
  hasBalance: boolean;
  currentBalance: number;
  requestedAmount: number;
  shortfall: number;
  isLowBalance: boolean; // true if balance < LOW_BALANCE_THRESHOLD
  isCriticalBalance: boolean; // true if balance < CRITICAL_BALANCE_THRESHOLD
}

// Thresholds for balance alerts (in NGN)
const LOW_BALANCE_THRESHOLD = 50000; // ₦50,000 - warn admin
const CRITICAL_BALANCE_THRESHOLD = 10000; // ₦10,000 - critical alert

export class SageCloudClient {
  private config: SageCloudConfig;
  private authToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: SageCloudConfig) {
    this.config = config;
  }

  /**
   * Get OAuth2 authentication token
   * Token expiry is returned in response, we cache until then
   */
  private async getAuthToken(): Promise<string> {
    // Check if token is still valid
    if (this.authToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.authToken;
    }

    // Create Basic Auth header (Base64 encoded "PublicKey:SecretKey")
    const credentials = btoa(`${this.config.publicKey}:${this.config.secretKey}`);

    const response = await fetch(`${SAGECLOUD_API_URL}/merchant/authorization`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SageCloud authentication failed: ${response.status} - ${errorText}`);
    }

    const data: AuthResponse = await response.json();
    this.authToken = data.data.token.access_token;
    this.tokenExpiry = new Date(data.data.token.expires_at);

    return this.authToken;
  }

  /**
   * Make authenticated request to SageCloud API
   */
  private async makeRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    const token = await this.getAuthToken();

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers as Record<string, string>,
    };

    const response = await fetch(`${SAGECLOUD_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SageCloud API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<BalanceResponse> {
    return this.makeRequest('/wallet/balance');
  }

  /**
   * Validate bank account (verify account name)
   */
  async validateBankAccount(params: ValidateAccountParams): Promise<any> {
    return this.makeRequest('/transfer/verify-bank-account', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Transfer funds to bank account
   */
  async transfer(params: TransferParams): Promise<TransferResponse> {
    return this.makeRequest('/transfer/fund-transfer', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Purchase airtime
   */
  async purchaseAirtime(params: AirtimeParams): Promise<AirtimeResponse> {
    return this.makeRequest('/airtime', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get available data plans for a provider
   */
  async getDataPlans(provider: 'MTNDATA' | 'GLODATA' | 'AIRTELDATA' | '9MOBILEDATA'): Promise<DataLookupResponse> {
    return this.makeRequest(`/internet/data/lookup?provider=${provider}`);
  }

  /**
   * Purchase data bundle
   */
  async purchaseData(params: PurchaseDataParams): Promise<AirtimeResponse> {
    return this.makeRequest('/internet/data', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Requery transaction status
   */
  async requeryTransaction(reference: string): Promise<RequeryResponse> {
    return this.makeRequest('/transaction/requery', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    });
  }

  /**
   * Check if balance is sufficient for transaction
   * @deprecated Use checkBalanceWithDetails for comprehensive checking
   */
  async hasBalance(amount: number): Promise<boolean> {
    const result = await this.checkBalanceWithDetails(amount);
    return result.hasBalance;
  }

  /**
   * Get balance as number
   */
  async getBalanceAmount(): Promise<number> {
    const balance = await this.getBalance();
    return parseFloat(balance.general_wallet.balance);
  }

  /**
   * Comprehensive balance check with detailed info for alerting
   * Returns detailed info about balance status for admin alerts
   */
  async checkBalanceWithDetails(amount: number): Promise<BalanceCheckResult> {
    const balance = await this.getBalance();
    const currentBalance = parseFloat(balance.general_wallet.balance);
    const shortfall = Math.max(0, amount - currentBalance);
    
    return {
      hasBalance: currentBalance >= amount,
      currentBalance,
      requestedAmount: amount,
      shortfall,
      isLowBalance: currentBalance < LOW_BALANCE_THRESHOLD,
      isCriticalBalance: currentBalance < CRITICAL_BALANCE_THRESHOLD,
    };
  }

  /**
   * Get balance thresholds for external use
   */
  static getThresholds() {
    return {
      LOW_BALANCE_THRESHOLD,
      CRITICAL_BALANCE_THRESHOLD,
    };
  }
}

// Export singleton instance creator
export function createSageCloudClient(config: SageCloudConfig): SageCloudClient {
  return new SageCloudClient(config);
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    // Fail closed during wallet security review. Re-enable only after this
    // route is migrated to the wallet authorization engine end to end.
    if (String(Deno.env.get('WITHDRAWALS_ENABLED') || '').trim().toLowerCase() !== 'true') {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'WITHDRAWALS_PAUSED',
          error: 'Withdrawals are temporarily disabled during wallet security review.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503,
        },
      );
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
    const walletRequestForensics = await getWalletRequestForensics(req, 'create-withdrawal-request');

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

    // Check user's balance
    const { data: userData, error: userFetchError } = await supabaseClient
      .from('profiles')
      .select('is_staff, is_admin')
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      throw new Error('Failed to fetch user balance');
    }

    if ((userData as any).is_staff || (userData as any).is_admin) {
      throw new Error('Withdrawals are only available to customer accounts');
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

    // Step 4: Deduct from the selected balance through the wallet engine.
    const debitIdempotencyKey = `withdrawal:${withdrawalRecord.id}`;
    let debitResult: any = null;

    try {
      debitResult = await applyWalletTransaction(supabaseAdmin, {
        userId: user.id,
        type: 'withdrawal',
        amount: withdrawalAmount,
        reference,
        description: `${balanceSource} withdrawal to ${validatedAccountName}`,
        idempotencyKey: debitIdempotencyKey,
        balanceType: balanceSource,
        metadata: {
          source: 'create-withdrawal-request',
          withdrawal_id: withdrawalRecord.id,
          source_order_id: withdrawalRecord.id,
          source_order_table: 'crypto_withdrawals',
          balance_source: balanceSource,
          net_amount: netAmount,
          fee_amount: feeAmount,
          bank_code,
          bank_name,
          request_forensics: walletRequestForensics,
        },
      });
    } catch (debitError: unknown) {
      const errorMessage = debitError instanceof Error ? debitError.message : 'Wallet debit failed before provider dispatch';
      await supabaseAdmin
        .from('crypto_withdrawals')
        .update({
          status: 'failed',
          sagecloud_response: JSON.stringify({ error: errorMessage, stage: 'wallet_debit' }),
        })
        .eq('id', withdrawalRecord.id);
      throw debitError;
    }

    // Step 5: Process transfer via SageCloud
    let transferResponse;
    let finalStatus = 'pending';
    
    try {
      transferResponse = await sageCloudClient.transfer({
        reference,
        bank_code,
        account_number,
        account_name: validatedAccountName,
        amount: netAmount, // Send NET amount (after fee deduction) - fee stays as your profit
        narration: narration || `Withdrawal to ${validatedAccountName}`,
      });

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

      if (finalStatus === 'failed') {
        await applyWalletTransaction(supabaseAdmin, {
          userId: user.id,
          type: 'refund',
          amount: withdrawalAmount,
          reference: `REFUND-${reference}`,
          description: `Refund failed ${balanceSource} withdrawal to ${validatedAccountName}`,
          idempotencyKey: `withdrawal:refund:${withdrawalRecord.id}:provider-returned-failed`,
          balanceType: balanceSource,
          metadata: {
            source: 'create-withdrawal-request',
            withdrawal_id: withdrawalRecord.id,
            source_order_id: withdrawalRecord.id,
            source_order_table: 'crypto_withdrawals',
            original_reference: reference,
            source_debit_transaction_id: debitResult?.transaction?.id || null,
            source_debit_idempotency_key: debitIdempotencyKey,
            balance_source: balanceSource,
            reason: 'provider_returned_failed',
            provider_status: transferResponse.status,
            request_forensics: walletRequestForensics,
          },
        });

        return new Response(
          JSON.stringify({
            success: false,
            withdrawal_id: withdrawalRecord.id,
            reference,
            status: finalStatus,
            error: 'Withdrawal failed. Your balance has been restored.',
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

    } catch (transferError: unknown) {
      console.error('SageCloud transfer failed:', transferError instanceof Error ? transferError.message : 'Unknown transfer error');
      const errorMessage = transferError instanceof Error ? transferError.message : 'Unknown transfer error';

      // Update withdrawal as failed
      await supabaseClient
        .from('crypto_withdrawals')
        .update({
          status: 'failed',
          sagecloud_response: JSON.stringify({ error: errorMessage }),
        })
        .eq('id', withdrawalRecord.id);

      await applyWalletTransaction(supabaseAdmin, {
        userId: user.id,
        type: 'refund',
        amount: withdrawalAmount,
        reference: `REFUND-${reference}`,
        description: `Refund failed ${balanceSource} withdrawal to ${validatedAccountName}`,
        idempotencyKey: `withdrawal:refund:${withdrawalRecord.id}`,
        balanceType: balanceSource,
        metadata: {
          source: 'create-withdrawal-request',
          withdrawal_id: withdrawalRecord.id,
          source_order_id: withdrawalRecord.id,
          source_order_table: 'crypto_withdrawals',
          original_reference: reference,
          source_debit_transaction_id: debitResult?.transaction?.id || null,
          source_debit_idempotency_key: debitIdempotencyKey,
          balance_source: balanceSource,
          reason: 'provider_transfer_error',
          error: errorMessage,
          request_forensics: walletRequestForensics,
        },
      });
      console.log('Withdrawal refunded after provider failure.');

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
