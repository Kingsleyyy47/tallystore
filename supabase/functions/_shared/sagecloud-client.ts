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
