// Edge Function: update-crypto-rates (RENAMED: get-crypto-estimate)
// Gets real-time crypto price estimates from NowPayments API
// Converts crypto amount to NGN with live market rates

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── nowpayments-client.ts ──
/**
 * NowPayments API Client
 * Handles all interactions with NowPayments API for crypto payments
 * Documentation: https://documenter.getpostman.com/view/7907941/S1a32n38
 */

const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

interface NowPaymentsConfig {
  apiKey: string;
  email?: string;
  password?: string;
}

interface CreatePaymentParams {
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  pay_amount?: number; // Optional: specify exact crypto amount
  ipn_callback_url?: string;
  order_id?: string;
  order_description?: string;
  payout_address?: string; // Optional: custom payout address
  payout_currency?: string; // Required if payout_address is specified
  payout_extra_id?: string; // Optional: memo/tag for payout_address
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
}

interface CreatePaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string | null;
  order_description: string | null;
  ipn_callback_url: string | null;
  created_at: string;
  updated_at: string;
  purchase_id: string;
  amount_received: number | null;
  payin_extra_id: string | null; // Memo/Tag for currencies like XRP, XLM, EOS
  smart_contract: string;
  network: string;
  network_precision: number;
  time_limit: string | null;
  burning_percent: number | null;
  expiration_estimate_date: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
  valid_until?: string; // When fixed rate expires
  type?: string; // crypto2crypto or fiat2crypto
}

interface PaymentStatus {
  payment_id: number; // Note: ID is number in response, not string
  invoice_id: number | null;
  payment_status: string; // waiting, confirming, confirmed, sending, partially_paid, finished, failed, refunded, expired
  pay_address: string;
  payin_extra_id: string | null; // Memo/Tag for XRP, XLM, EOS, etc.
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number; // Actual amount received (may differ from pay_amount)
  pay_currency: string;
  order_id: string | null;
  order_description: string | null;
  purchase_id: number; // Note: ID is number in response, not string
  outcome_amount: number; // Amount to be received on your Outcome Wallet
  outcome_currency: string; // Currency for settlement
  payout_hash: string | null;
  payin_hash: string | null;
  created_at: string;
  updated_at: string;
  burning_percent?: string | null; // Can be "null" as string
  type: string; // crypto2crypto or fiat2crypto
  payment_extra_ids?: number[]; // Child payment IDs (for repeated deposits)
  parent_payment_id?: number; // Parent payment ID (only exists on child payments)
  origin_type?: string; // "REPEATED" for child payments
}

export class NowPaymentsClient {
  private config: NowPaymentsConfig;
  private authToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(config: NowPaymentsConfig) {
    this.config = config;
  }

  /**
   * Get authentication token (JWT)
   * Token expires in 5 minutes, we cache it for 4 minutes
   */
  private async getAuthToken(): Promise<string> {
    // Check if token is still valid (with 1 min buffer)
    if (this.authToken && this.tokenExpiry && this.tokenExpiry > Date.now() + 60000) {
      return this.authToken;
    }

    // Only get token if email/password provided
    if (!this.config.email || !this.config.password) {
      throw new Error('Email and password required for authentication');
    }

    const response = await fetch(`${NOWPAYMENTS_API_URL}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.authToken = data.token;
    this.tokenExpiry = Date.now() + (4 * 60 * 1000); // Cache for 4 minutes

    return this.authToken!; // Non-null assertion: we just set it above
  }

  /**
   * Make authenticated request to NowPayments API
   */
  private async makeRequest(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth: boolean = false
  ): Promise<any> {
    const headers: Record<string, string> = {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    // Add Bearer token if required
    if (requiresAuth) {
      const token = await this.getAuthToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NOWPAYMENTS_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NowPayments API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get API status
   */
  async getStatus(): Promise<{ message: string }> {
    return this.makeRequest('/status');
  }

  /**
   * Get available currencies
   */
  async getAvailableCurrencies(fixedRate?: boolean): Promise<{ currencies: string[] }> {
    const query = fixedRate ? '?fixed_rate=true' : '';
    return this.makeRequest(`/currencies${query}`);
  }

  /**
   * Create a payment
   */
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResponse> {
    return this.makeRequest('/payment', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    return this.makeRequest(`/payment/${paymentId}`);
  }

  /**
   * Get list of payments (requires authentication)
   */
  async getListOfPayments(params?: {
    limit?: number; // 1-500
    page?: number; // 0 to pagesCount-1
    sortBy?: string; // payment_id, payment_status, created_at, etc.
    orderBy?: 'asc' | 'desc';
    dateFrom?: string; // YYYY-MM-DD or ISO format
    dateTo?: string; // YYYY-MM-DD or ISO format
    invoiceId?: number; // Filter by invoice ID
  }): Promise<{ data: PaymentStatus[]; limit: number; page: number; pagesCount: number; total: number }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params?.orderBy) queryParams.set('orderBy', params.orderBy);
    if (params?.dateFrom) queryParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) queryParams.set('dateTo', params.dateTo);
    if (params?.invoiceId) queryParams.set('invoiceId', params.invoiceId.toString());

    const query = queryParams.toString();
    return this.makeRequest(`/payment/?${query}`, {}, true);
  }

  /**
   * Get minimum payment amount for a currency pair
   */
  async getMinimumPaymentAmount(
    currency_from: string,
    currency_to?: string,
    fiat_equivalent?: string,
    is_fixed_rate?: boolean,
    is_fee_paid_by_user?: boolean
  ): Promise<{ 
    currency_from: string; 
    currency_to: string; 
    min_amount: number;
    fiat_equivalent?: number;
  }> {
    const params = new URLSearchParams({ currency_from });
    if (currency_to) params.set('currency_to', currency_to);
    if (fiat_equivalent) params.set('fiat_equivalent', fiat_equivalent);
    if (is_fixed_rate !== undefined) params.set('is_fixed_rate', String(is_fixed_rate));
    if (is_fee_paid_by_user !== undefined) params.set('is_fee_paid_by_user', String(is_fee_paid_by_user));
    
    return this.makeRequest(`/min-amount?${params.toString()}`);
  }

  /**
   * Get estimated price
   */
  async getEstimatedPrice(
    amount: number,
    currency_from: string,
    currency_to: string
  ): Promise<{ currency_from: string; amount_from: number; currency_to: string; estimated_amount: number }> {
    return this.makeRequest(
      `/estimate?amount=${amount}&currency_from=${currency_from}&currency_to=${currency_to}`
    );
  }
}

// Export singleton instance
export function createNowPaymentsClient(config: NowPaymentsConfig): NowPaymentsClient {
  return new NowPaymentsClient(config);
}

// ── exchange-rate.ts ──
/**
 * Server-side NGN/USD exchange rate resolution for Edge Functions.
 * Mirrors the client-side logic in src/hooks/useExchangeRate.ts:
 * priority = admin override (app_settings.ngn_usd_rate) -> live API.
 *
 * Edge functions can't import from src/, so this is a small standalone copy.
 */

const LIVE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

export async function getNgnUsdRate(supabaseAdmin: any): Promise<{ rate: number; source: 'override' | 'live' }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'ngn_usd_rate')
      .single();

    if (!error && data?.value) {
      const parsed = parseFloat(data.value);
      if (!isNaN(parsed) && parsed > 0) {
        return { rate: parsed, source: 'override' };
      }
    }
  } catch (_err) {
    // fall through to live rate
  }

  try {
    const res = await fetch(LIVE_RATE_URL);
    const json = await res.json();
    const liveRate = json?.rates?.NGN;
    if (liveRate && typeof liveRate === 'number' && liveRate > 0) {
      return { rate: liveRate, source: 'live' };
    }
  } catch (_err) {
    // handled below
  }

  throw new Error('NGN/USD exchange rate is temporarily unavailable. Set ngn_usd_rate in app settings or try again when the live rate service is reachable.');
}

/** Convert an amount in `currency` (currently only USD is supported) to NGN. */
export async function convertToNgn(amount: number, currency: string, supabaseAdmin: any): Promise<number> {
  if (currency.toUpperCase() !== 'USD') {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }
  const { rate } = await getNgnUsdRate(supabaseAdmin);
  return amount * rate;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { crypto_amount, crypto_currency } = await req.json();

    // Validation
    if (!crypto_amount || !crypto_currency) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: crypto_amount, crypto_currency' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (crypto_amount <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'crypto_amount must be greater than 0' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`🔄 Fetching live rate for ${crypto_amount} ${crypto_currency.toUpperCase()}...`);

    // Initialize NowPayments client
    const nowpaymentsApiKey = Deno.env.get('NOWPAYMENTS_API_KEY');
    if (!nowpaymentsApiKey) {
      throw new Error('NOWPAYMENTS_API_KEY not configured');
    }

    const nowpayments = createNowPaymentsClient({
      apiKey: nowpaymentsApiKey,
    });
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get estimated price from NowPayments
    // currency_from = crypto (e.g., btc, eth, usdt)
    // currency_to = usd (we'll convert USD to NGN)
    const estimate = await nowpayments.getEstimatedPrice(
      crypto_amount,
      crypto_currency.toLowerCase(),
      'usd'
    );

    console.log(`✅ NowPayments estimate: ${estimate.amount_from} ${estimate.currency_from.toUpperCase()} = $${estimate.estimated_amount}`);

    // Convert USD to NGN using the same admin/live rate path used at order time.
    const { rate: usdToNgn, source: rateSource } = await getNgnUsdRate(supabaseAdmin);
    const ngnAmount = estimate.estimated_amount * usdToNgn;

    // Apply 5% markup for service fee
    const markup = 1.05;
    const finalNgnAmount = ngnAmount * markup;

    console.log(`💰 Final amount: ₦${finalNgnAmount.toLocaleString()} (with 5% markup)`);

    return new Response(
      JSON.stringify({
        success: true,
        crypto_amount: crypto_amount,
        crypto_currency: crypto_currency.toLowerCase(),
        usd_amount: estimate.estimated_amount,
        ngn_amount: Math.round(finalNgnAmount * 100) / 100, // Round to 2 decimal places
        usd_to_ngn_rate: usdToNgn,
        usd_to_ngn_rate_source: rateSource,
        markup_percentage: 5,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('❌ Error getting crypto estimate:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to get estimate',
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
