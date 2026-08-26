import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ── revenue-events.ts (inlined) ──
export const REVENUE_EVENT_TYPES = [
  'SESSION_STARTED',
  'PAGE_VIEWED',
  'PRODUCT_IMPRESSION',
  'PRODUCT_VIEWED',
  'SEARCHED',
  'FILTER_USED',
  'SORT_USED',
  'PRODUCT_CLICKED',
  'BUY_CLICKED',
  'PAYMENT_STARTED',
  'PAYMENT_PROVIDER_LOADED',
  'PAYMENT_ATTEMPTED',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'PRODUCT_PURCHASED',
  'PRODUCT_PURCHASE_REVERSED',
  'PRODUCT_REJECTED',
  'SMS_ORDER_CANCELLED',
  'SMS_ORDER_COMPLETED',
  'SMS_ORDER_REFUNDED',
  'RECOMMENDATION_SHOWN',
  'RECOMMENDATION_CLICKED',
  'RECOMMENDATION_DISMISSED',
  'PROMOTION_SHOWN',
  'PROMOTION_CLICKED',
  'OFFER_SHOWN',
  'OFFER_ACCEPTED',
  'OFFER_DISMISSED',
  'CHAT_OPENED',
  'CHAT_MESSAGE',
  'CHAT_INTENT',
  'CHAT_PRODUCT_SHOWN',
  'SUPPORT_HANDOFF',
  'CHECKOUT_ABANDONED',
  'RETURN_VISIT',
] as const

export type RevenueEventType = (typeof REVENUE_EVENT_TYPES)[number]

export type RevenueRequestContext = {
  visitor_id?: string | null
  session_id?: string | null
  path?: string | null
  referrer?: string | null
  device?: string | null
  display_currency?: string | null
  attribution?: Record<string, unknown> | null
  traffic_quality?: string | null
}

const knownRevenueEventTypes = new Set<string>(REVENUE_EVENT_TYPES as readonly string[])

export function isKnownRevenueEventType(eventType: string): eventType is RevenueEventType {
  return knownRevenueEventTypes.has(eventType)
}

export function sanitizeRevenueEventType(source: string, eventType: string): RevenueEventType | null {
  if (!isKnownRevenueEventType(eventType)) {
    console.warn(`Unsupported revenue event type from ${source}: ${eventType}`)
    return null
  }
  return eventType
}

const SENSITIVE_REVENUE_METADATA_KEY = /(^|_|\b)(password|passcode|otp|pin|token|secret|api[_-]?key|authorization|cookie|session|email|phone|account[_-]?number|accountnumber|account[_-]?name|bank[_-]?name|wallet[_-]?address|pay[_-]?address|address|memo|tag|hash|reference|payment[_-]?reference|transaction[_-]?reference|transaction[_-]?id|payment[_-]?id|purchase[_-]?id|provider[_-]?request[_-]?id|provider[_-]?response|api[_-]?response|raw[_-]?response|response[_-]?body|activation[_-]?id|external[_-]?order[_-]?id|order[_-]?id|idempotency[_-]?key|recipient|username|login|profile[_-]?url|url|link|comment|comments|group|groups)(\b|_)?/i

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sanitizeRevenueEventId(source: string, eventId: string) {
  const normalizedSource = source.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'event'
  const hash = await sha256Hex(`${source}:${eventId}`)
  return `server:${normalizedSource}:${hash.slice(0, 48)}`
}

function sanitizeRevenueMetadataValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 4) return '[truncated]'

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const redacted = value
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted_url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
      .replace(/(?:\+?\d[\s().-]*){10,}/g, '[redacted_number]')
      .replace(/\b(?:[a-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b/g, '[redacted_token]')
    return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeRevenueMetadataValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      output[key] = SENSITIVE_REVENUE_METADATA_KEY.test(key)
        ? '[redacted]'
        : sanitizeRevenueMetadataValue(child, depth + 1)
    }
    return output
  }

  return String(value)
}

export function sanitizeRevenueMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeRevenueMetadataValue(metadata) as Record<string, unknown>
}

function cleanRevenueContextText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function cleanRevenueContextId(value: unknown) {
  const text = cleanRevenueContextText(value, 120)
  if (!text) return null
  return /^[a-z0-9:_-]{8,120}$/i.test(text) ? text : null
}

function cleanRevenueContextPath(value: unknown) {
  const text = cleanRevenueContextText(value, 240)
  if (!text) return null
  try {
    const url = new URL(text, 'https://tallystore.local')
    return url.pathname || '/'
  } catch {
    return text.split('?')[0].slice(0, 240) || null
  }
}

function cleanRevenueContextReferrer(value: unknown) {
  const text = cleanRevenueContextText(value, 240)
  if (!text) return null
  try {
    const url = new URL(text)
    return `${url.origin}${url.pathname || '/'}`.slice(0, 240)
  } catch {
    return null
  }
}

export function sanitizeRevenueRequestContext(input: unknown): RevenueRequestContext {
  const context = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const device = cleanRevenueContextText(context.device, 40)
  const displayCurrency = cleanRevenueContextText(context.display_currency, 12)
  const trafficQuality = cleanRevenueContextText(context.traffic_quality, 40)
  const attribution = context.attribution && typeof context.attribution === 'object'
    ? sanitizeRevenueMetadata(context.attribution as Record<string, unknown>)
    : null

  return {
    visitor_id: cleanRevenueContextId(context.visitor_id),
    session_id: cleanRevenueContextId(context.session_id),
    path: cleanRevenueContextPath(context.path),
    referrer: cleanRevenueContextReferrer(context.referrer),
    device: device && ['mobile', 'desktop', 'tablet', 'unknown'].includes(device.toLowerCase()) ? device.toLowerCase() : null,
    display_currency: displayCurrency && /^[A-Z]{3,8}$/.test(displayCurrency) ? displayCurrency : null,
    attribution,
    traffic_quality: trafficQuality && /^[a-z_ -]{3,40}$/i.test(trafficQuality) ? trafficQuality.toLowerCase().replace(/\s+/g, '_') : null,
  }
}

export function revenueContextEventColumns(context?: RevenueRequestContext | null) {
  return {
    visitor_id: context?.visitor_id || null,
    session_id: context?.session_id || null,
    path: context?.path || null,
    referrer: context?.referrer || null,
    device: context?.device || null,
  }
}

export function revenueContextMetadata(context?: RevenueRequestContext | null) {
  if (!context) return {}
  return {
    display_currency: context.display_currency || undefined,
    attribution: context.attribution || undefined,
    traffic_quality: context.traffic_quality || undefined,
  }
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

// ── staff-purchase-guard.ts ──
export async function assertPurchasingCustomer(admin: any, userId: string) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error('Could not verify purchase permission')
  }

  if (profile?.is_staff || profile?.is_admin) {
    throw new Error('Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.')
  }
}

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

async function recordRevenueEvent(
  supabaseAdmin: any,
  input: {
    eventType: RevenueEventType;
    eventId: string;
    userId?: string | null;
    surface?: string;
    revenueContext?: RevenueRequestContext | null;
    metadata?: Record<string, unknown>;
  }
) {
  const eventType = sanitizeRevenueEventType('purchase-bills', input.eventType);
  if (!eventType) return;

  const { error } = await supabaseAdmin.from('revenue_events').upsert({
    event_id: await sanitizeRevenueEventId('purchase-bills', input.eventId),
    event_type: eventType,
    ...revenueContextEventColumns(input.revenueContext),
    user_id: input.userId || null,
    surface: input.surface || 'bills',
    metadata: sanitizeRevenueMetadata({
      ...input.metadata,
      ...revenueContextMetadata(input.revenueContext),
    }),
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    console.error(`Failed to record bills revenue event ${eventType}:`, error.message);
  }
}

async function refundBalance(
  supabaseAdmin: any,
  userId: string,
  balanceColumn: string,
  amount: number,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: currentUserData } = await supabaseAdmin
      .from('profiles')
      .select(balanceColumn)
      .eq('id', userId)
      .single();

    const currentBal = parseFloat(currentUserData?.[balanceColumn] || '0');
    const refundedBalance = currentBal + amount;

    const { data: refundData } = await supabaseAdmin
      .from('profiles')
      .update({ [balanceColumn]: refundedBalance })
      .eq('id', userId)
      .eq(balanceColumn, currentBal)
      .select()
      .single();

    if (refundData) {
      return refundedBalance;
    }

    await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
  }

  throw new Error('Refund could not be credited. Please contact support.');
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await assertPurchasingCustomer(supabaseAdmin, user.id);

    // Parse request body - includes payment_source and idempotency_key
    const { transaction_type, amount, service_provider, phone, data_plan_code, payment_source = 'wallet', idempotency_key, revenue_context } = await req.json();
    const revenueContext = sanitizeRevenueRequestContext(revenue_context);

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

    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (!/^0\d{10}$/.test(normalizedPhone)) {
      throw new Error('Invalid phone number. Enter an 11-digit Nigerian phone number.');
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
      console.log('Bills idempotency hit: returning existing transaction.');
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
    if (transaction_type === 'airtime' && (purchaseAmount < 50 || purchaseAmount > 50000)) {
      throw new Error('Airtime amount must be between ₦50 and ₦50,000');
    }

    // For data purchase, validate plan code
    if (transaction_type === 'data' && !data_plan_code) {
      throw new Error('data_plan_code is required for data purchases');
    }

    // Initialize SageCloud client before any charge calculation that depends on
    // provider-owned catalogue data. Never trust client-supplied data-plan prices.
    const sageCloudClient = createSageCloudClient({
      publicKey: Deno.env.get('SAGECLOUD_PUBLIC_KEY') ?? '',
      secretKey: Deno.env.get('SAGECLOUD_SECRET_KEY') ?? '',
    });

    if (transaction_type === 'data') {
      const dataType = `${normalizedProvider}DATA` as 'MTNDATA' | 'GLODATA' | 'AIRTELDATA' | '9MOBILEDATA';
      const plansResponse = await sageCloudClient.getDataPlans(dataType);
      if (!plansResponse.success || !Array.isArray(plansResponse.data)) {
        throw new Error('Could not verify live data plan price. Please try again.');
      }
      const livePlan = plansResponse.data.find((plan) => String(plan.code) === String(data_plan_code));
      const livePlanPrice = Number(livePlan?.price);
      if (!livePlan || !Number.isFinite(livePlanPrice) || livePlanPrice <= 0) {
        throw new Error('Selected data plan is no longer available.');
      }
      if (Math.round(purchaseAmount) !== Math.round(livePlanPrice)) {
        throw new Error(`Data plan price changed from ₦${purchaseAmount.toLocaleString()} to ₦${livePlanPrice.toLocaleString()}. Please refresh and try again.`);
      }
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

    // Check SageCloud balance
    const sageCloudBalance = await sageCloudClient.getBalanceAmount();
    const balanceCheck: BalanceCheckResult = {
      hasBalance: sageCloudBalance >= purchaseAmount,
      currentBalance: sageCloudBalance,
      requestedAmount: purchaseAmount,
      shortfall: Math.max(0, purchaseAmount - sageCloudBalance),
      isLowBalance: sageCloudBalance < LOW_BALANCE_THRESHOLD,
      isCriticalBalance: sageCloudBalance < CRITICAL_BALANCE_THRESHOLD,
    };
    
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
      throw new Error('This service is temporarily unavailable. Please contact support.');
    }

    // Generate unique reference
    const reference = `TALLY-${transaction_type.toUpperCase()}-${Date.now()}-${user.id.substring(0, 8)}`;

    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_STARTED',
      eventId: `bills:PAYMENT_STARTED:${idempotency_key}`,
      userId: user.id,
      surface: 'bills',
      revenueContext,
      metadata: {
        reference,
        transaction_type,
        amount_ngn: purchaseAmount,
        service_provider: normalizedProvider,
        beneficiary_phone: normalizedPhone,
        payment_source,
        idempotency_key,
      },
    });
    await recordRevenueEvent(supabaseAdmin, {
      eventType: 'PAYMENT_ATTEMPTED',
      eventId: `bills:PAYMENT_ATTEMPTED:${idempotency_key}`,
      userId: user.id,
      surface: 'bills',
      revenueContext,
      metadata: {
        reference,
        transaction_type,
        amount_ngn: purchaseAmount,
        service_provider: normalizedProvider,
        beneficiary_phone: normalizedPhone,
        payment_source,
        idempotency_key,
      },
    });

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
        beneficiary_phone: normalizedPhone,
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
        const service = `${normalizedProvider}VTU`; // e.g., MTNVTU, GLOVTU
        
        purchaseResponse = await sageCloudClient.purchaseAirtime({
          reference,
          network: normalizedProvider as 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE',
          service,
          phone: normalizedPhone,
          amount: purchaseAmount.toString(),
        });

      } else {
        // Purchase data
        const dataType = `${normalizedProvider}DATA`; // e.g., MTNDATA, GLODATA
        
        purchaseResponse = await sageCloudClient.purchaseData({
          reference,
          type: dataType,
          code: data_plan_code!,
          network: normalizedProvider as 'MTN' | 'GLO' | 'AIRTEL' | '9MOBILE',
          phone: normalizedPhone,
          provider: normalizedProvider,
        });
      }
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

      if (finalStatus === 'failed') {
        const refundedBalance = await refundBalance(supabaseAdmin, user.id, balanceColumn, purchaseAmount);
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PAYMENT_FAILED',
          eventId: `bills:PAYMENT_FAILED:${idempotency_key}`,
          userId: user.id,
          surface: 'bills',
          revenueContext,
          metadata: {
            transaction_id: billRecord.id,
            reference,
            transaction_type,
            amount_ngn: purchaseAmount,
            service_provider: normalizedProvider,
            beneficiary_phone: normalizedPhone,
            payment_source,
            provider_status: finalStatus,
            provider_reference_present: Boolean(purchaseResponse.reference),
          },
        });
        await recordRevenueEvent(supabaseAdmin, {
          eventType: 'PRODUCT_PURCHASE_REVERSED',
          eventId: `bills:PRODUCT_PURCHASE_REVERSED:${idempotency_key}`,
          userId: user.id,
          surface: 'bills',
          revenueContext,
          metadata: {
            transaction_id: billRecord.id,
            reference,
            transaction_type,
            amount_ngn: purchaseAmount,
            balance_after: refundedBalance,
            reason: 'provider_returned_failed',
          },
        });
        return new Response(
          JSON.stringify({
            success: false,
            transaction_id: billRecord.id,
            reference,
            status: finalStatus,
            error: `${transaction_type === 'airtime' ? 'Airtime' : 'Data'} purchase failed. Your balance has been refunded.`,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_COMPLETED',
        eventId: `bills:PAYMENT_COMPLETED:${idempotency_key}`,
        userId: user.id,
        surface: 'bills',
        revenueContext,
        metadata: {
          transaction_id: billRecord.id,
          reference,
          transaction_type,
          amount_ngn: purchaseAmount,
          service_provider: normalizedProvider,
          beneficiary_phone: normalizedPhone,
          payment_source,
          provider_reference: purchaseResponse.reference || reference,
        },
      });
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASED',
        eventId: `bills:PRODUCT_PURCHASED:${idempotency_key}`,
        userId: user.id,
        surface: 'bills',
        revenueContext,
        metadata: {
          transaction_id: billRecord.id,
          reference,
          transaction_type,
          amount_ngn: purchaseAmount,
          service_provider: normalizedProvider,
          beneficiary_phone: normalizedPhone,
          payment_source,
          provider_reference: purchaseResponse.reference || reference,
        },
      });

    } catch (purchaseError: unknown) {
      console.error('SageCloud purchase failed:', purchaseError instanceof Error ? purchaseError.message : 'Unknown purchase error');
      const errorMessage = purchaseError instanceof Error ? purchaseError.message : 'Unknown purchase error';

      // Update transaction as failed
      await supabaseClient
        .from('bills_transactions')
        .update({
          status: 'failed',
          sagecloud_response: JSON.stringify({ error: errorMessage }),
        })
        .eq('id', billRecord.id);

      const refundedBalance = await refundBalance(supabaseAdmin, user.id, balanceColumn, purchaseAmount);
      console.log('Bills purchase refunded after provider failure.');
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PAYMENT_FAILED',
        eventId: `bills:PAYMENT_FAILED:${idempotency_key}`,
        userId: user.id,
        surface: 'bills',
        revenueContext,
        metadata: {
          transaction_id: billRecord.id,
          reference,
          transaction_type,
          amount_ngn: purchaseAmount,
          service_provider: normalizedProvider,
          beneficiary_phone: normalizedPhone,
          payment_source,
          error: errorMessage,
        },
      });
      await recordRevenueEvent(supabaseAdmin, {
        eventType: 'PRODUCT_PURCHASE_REVERSED',
        eventId: `bills:PRODUCT_PURCHASE_REVERSED:${idempotency_key}`,
        userId: user.id,
        surface: 'bills',
        revenueContext,
        metadata: {
          transaction_id: billRecord.id,
          reference,
          transaction_type,
          amount_ngn: purchaseAmount,
          balance_after: refundedBalance,
          reason: 'provider_purchase_error',
        },
      });

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
        beneficiary_phone: normalizedPhone,
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
    console.error('Error in purchase-bills:', error instanceof Error ? error.message : 'Unknown error');
    
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
