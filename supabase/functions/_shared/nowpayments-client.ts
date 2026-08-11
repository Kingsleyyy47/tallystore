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
