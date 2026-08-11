/**
 * Bitrefill REST API Client (Personal API tier)
 * Docs: https://api.bitrefill.com/docs
 *
 * Auth: single Bearer token only (Personal API key). This client intentionally
 * does NOT support the Business API's Basic auth (API_ID + API_SECRET) flow —
 * TallyStore only uses a single Personal API key.
 */

const BITREFILL_API_URL = 'https://api.bitrefill.com/v2';

interface BitrefillConfig {
  apiKey: string;
}

export interface BitrefillProductPackage {
  package_id: string;
  value: number;
}

export interface BitrefillProductRange {
  min: number;
  max: number;
  step: number;
}

export interface BitrefillProduct {
  product_id: string;
  name: string;
  countries?: string[];
  currency?: string;
  recipient_type?: string;
  packages?: BitrefillProductPackage[];
  range?: BitrefillProductRange;
  [key: string]: any;
}

export interface BitrefillProductsResponse {
  data: BitrefillProduct[];
  meta?: { _next?: string | null };
}

export interface BitrefillInvoiceItem {
  product_id: string;
  package_id?: string;
  value?: number;
  quantity?: number;
  phone_number?: string;
}

export interface BitrefillCreateInvoiceParams {
  products: BitrefillInvoiceItem[];
  payment_method?: string; // 'balance' | 'bitcoin' | etc.
  refund_address?: string;
  webhook_url?: string;
  auto_pay?: boolean;
  email?: string;
}

export interface BitrefillInvoice {
  id: string;
  status: string; // unpaid | payment_detected | payment_confirmed | pending | complete | blocked | denied | payment_error
  orders?: Array<{ id: string; product_id: string }>;
  [key: string]: any;
}

export interface BitrefillOrder {
  id: string;
  status?: string;
  redemption_info?: {
    code?: string;
    link?: string;
    pin?: string;
    instructions?: string;
    expiration_date?: string;
  };
  [key: string]: any;
}

export interface BitrefillBalance {
  balance: number;
  currency: string;
}

export class BitrefillClient {
  private config: BitrefillConfig;

  constructor(config: BitrefillConfig) {
    this.config = config;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(`${BITREFILL_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bitrefill API error: ${response.status} - ${errorText}`);
    }

    // Some endpoints (e.g. /ping) may return empty bodies
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  /** Connectivity check -> { message: 'pong' } */
  async ping(): Promise<{ message: string }> {
    return this.makeRequest('/ping');
  }

  /** TallyStore's own Bitrefill merchant balance (used to pay invoices) */
  async getBalance(): Promise<BitrefillBalance> {
    return this.makeRequest('/accounts/balance');
  }

  /** Browse catalog, paginated */
  async listProducts(limit = 50, cursor?: string): Promise<BitrefillProductsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.makeRequest(`/products?${params.toString()}`);
  }

  /** Search catalog by query string */
  async searchProducts(query: string, limit = 50): Promise<BitrefillProductsResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.makeRequest(`/products/search?${params.toString()}`);
  }

  /** Fetch a single product's detail (denominations etc.) */
  async getProductDetails(productId: string): Promise<BitrefillProduct> {
    return this.makeRequest(`/products/${encodeURIComponent(productId)}`);
  }

  /** Create an invoice for one or more items (max 20 per invoice) */
  async createInvoice(params: BitrefillCreateInvoiceParams): Promise<BitrefillInvoice> {
    if (!params.products || params.products.length === 0) {
      throw new Error('At least one product is required to create an invoice');
    }
    if (params.products.length > 20) {
      throw new Error('A maximum of 20 items is allowed per invoice');
    }
    return this.makeRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        payment_method: 'balance',
        ...params,
      }),
    });
  }

  /** Pay an invoice that was not auto-paid */
  async payInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    return this.makeRequest(`/invoices/${encodeURIComponent(invoiceId)}/pay`, {
      method: 'POST',
    });
  }

  /** Get current invoice status */
  async getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    return this.makeRequest(`/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** List recent invoices */
  async listInvoices(limit = 20): Promise<{ data: BitrefillInvoice[] }> {
    return this.makeRequest(`/invoices?limit=${limit}`);
  }

  /** Get order detail, including redemption info once complete */
  async getOrder(orderId: string): Promise<BitrefillOrder> {
    return this.makeRequest(`/orders/${encodeURIComponent(orderId)}`);
  }
}

export function createBitrefillClient(config: BitrefillConfig): BitrefillClient {
  return new BitrefillClient(config);
}
