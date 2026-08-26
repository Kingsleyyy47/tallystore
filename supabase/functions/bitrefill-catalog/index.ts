import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── bitrefill-client.ts ──
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


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// action: 'list' | 'search' | 'details'
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Verify authentication (catalog browsing still requires a logged-in user,
    // per repo convention, so the Bitrefill API key never reaches the browser)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { action, query, product_id, category, limit, cursor } = await req.json();

    if (!action) {
      throw new Error('action is required (list, search, or details)');
    }

    // eSIM is not offered on this storefront — only gift cards are sold via
    // Bitrefill. Reject the category server-side so it can't be reached even
    // if a client is crafted to request it directly.
    if (category === 'esim') {
      throw new Error('eSIM is not currently available.');
    }

    const bitrefill = createBitrefillClient({
      apiKey: Deno.env.get('BITREFILL_API_KEY') ?? '',
    });

    // Load the admin-curated blocklist (app_settings.bitrefill_blocked_products,
    // a JSON array of { product_id, name }) so blocked brands never reach
    // customers via list/search, regardless of which client calls this.
    let blockedIds = new Set<string>();
    try {
      const { data: blockSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'bitrefill_blocked_products')
        .single();
      if (blockSetting?.value) {
        const parsed = JSON.parse(blockSetting.value);
        if (Array.isArray(parsed)) {
          blockedIds = new Set(parsed.map((p: { product_id: string }) => p.product_id));
        }
      }
    } catch (_err) {
      // no blocklist configured — nothing to filter
    }

    let result;

    switch (action) {
      case 'list': {
        result = await bitrefill.listProducts(limit || 50, cursor);
        break;
      }
      case 'search': {
        if (!query) throw new Error('query is required for search');
        // category is supported as part of the query string convention Bitrefill
        // uses for filtering (e.g. "gift card" vs "esim"); kept simple here.
        const q = category ? `${query} ${category}` : query;
        result = await bitrefill.searchProducts(q, limit || 50);
        break;
      }
      case 'details': {
        if (!product_id) throw new Error('product_id is required for details');
        result = await bitrefill.getProductDetails(product_id);
        if (blockedIds.has(result.product_id)) {
          throw new Error('This product is no longer available.');
        }
        break;
      }
      default:
        throw new Error('Invalid action. Must be one of: list, search, details');
    }

    // Filter blocked products out of list/search result sets. Bitrefill's
    // list/search responses nest the array under `data.data` (see
    // BitrefillProductsResponse) per the GiftCardsEsims.tsx client usage.
    if ((action === 'list' || action === 'search') && blockedIds.size > 0 && result?.data) {
      result = {
        ...result,
        data: result.data.filter((p: { product_id: string }) => !blockedIds.has(p.product_id)),
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: result,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in bitrefill-catalog:', error);

    console.error('Detailed error:', JSON.stringify({
      message: (error as Error).message,
      stack: (error as Error).stack,
      name: (error as Error).name,
    }));

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to fetch Bitrefill catalog',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
