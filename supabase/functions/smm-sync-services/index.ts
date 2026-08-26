import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── smm-panel-client.ts ──
/**
 * SMM Panel API Client
 * API: https://thelordofthepanels.com/api/v2
 * 
 * All requests are POST with key + action parameters
 */

const SMM_API_URL = 'https://thelordofthepanels.com/api/v2';

export interface SmmService {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: string;
  min: string;
  max: string;
  refill: boolean;
  cancel: boolean;
}

export interface SmmOrderResponse {
  order?: number;
  error?: string;
}

export interface SmmStatusResponse {
  charge?: string;
  start_count?: string;
  status?: string;
  remains?: string;
  currency?: string;
  error?: string;
}

export interface SmmBalanceResponse {
  balance?: string;
  currency?: string;
  error?: string;
}

export interface SmmRefillResponse {
  refill?: string | number;
  error?: string;
}

export class SmmPanelClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('SMM Panel API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Make a POST request to the SMM Panel API
   */
  private async request<T>(params: Record<string, string | number>): Promise<T> {
    const formData = new URLSearchParams();
    formData.append('key', this.apiKey);
    
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, String(value));
    }

    const response = await fetch(SMM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`SMM API HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for API-level errors
    if (data.error) {
      throw new Error(`SMM API error: ${data.error}`);
    }

    return data as T;
  }

  /**
   * Get all available services
   */
  async getServices(): Promise<SmmService[]> {
    return this.request<SmmService[]>({ action: 'services' });
  }

  /**
   * Create a new order
   * Different service types require different parameters
   */
  async createOrder(params: {
    service: number;
    link?: string;
    quantity?: number;
    runs?: number;
    interval?: number;
    // For Custom Comments type
    comments?: string;
    // For Mentions types
    usernames?: string;
    username?: string;
    // For Hashtag types
    hashtags?: string;
    hashtag?: string;
    // For SEO type
    keywords?: string;
    // For Poll type
    answer_number?: number;
    // For Invites from Groups
    groups?: string;
  }): Promise<SmmOrderResponse> {
    const requestParams: Record<string, string | number> = {
      action: 'add',
      service: params.service,
    };

    // Add optional params only if provided
    if (params.link) requestParams.link = params.link;
    if (params.quantity) requestParams.quantity = params.quantity;
    if (params.runs) requestParams.runs = params.runs;
    if (params.interval) requestParams.interval = params.interval;
    if (params.comments) requestParams.comments = params.comments;
    if (params.usernames) requestParams.usernames = params.usernames;
    if (params.username) requestParams.username = params.username;
    if (params.hashtags) requestParams.hashtags = params.hashtags;
    if (params.hashtag) requestParams.hashtag = params.hashtag;
    if (params.keywords) requestParams.keywords = params.keywords;
    if (params.answer_number) requestParams.answer_number = params.answer_number;
    if (params.groups) requestParams.groups = params.groups;

    return this.request<SmmOrderResponse>(requestParams);
  }

  /**
   * Check order status
   */
  async getOrderStatus(orderId: number): Promise<SmmStatusResponse> {
    return this.request<SmmStatusResponse>({
      action: 'status',
      order: orderId,
    });
  }

  /**
   * Check multiple orders status
   */
  async getMultipleOrderStatus(orderIds: number[]): Promise<Record<string, SmmStatusResponse>> {
    return this.request<Record<string, SmmStatusResponse>>({
      action: 'status',
      orders: orderIds.join(','),
    });
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<SmmBalanceResponse> {
    return this.request<SmmBalanceResponse>({ action: 'balance' });
  }

  /**
   * Request refill for an order
   */
  async createRefill(orderId: number): Promise<SmmRefillResponse> {
    return this.request<SmmRefillResponse>({
      action: 'refill',
      order: orderId,
    });
  }

  /**
   * Cancel orders
   */
  async cancelOrders(orderIds: number[]): Promise<Array<{ order: number; cancel: number | { error: string } }>> {
    return this.request({
      action: 'cancel',
      orders: orderIds.join(','),
    });
  }
}

/**
 * Create SMM Panel client using environment variable
 */
export function createSmmPanelClient(): SmmPanelClient {
  const apiKey = Deno.env.get('SMM_PANEL_API_KEY');
  if (!apiKey) {
    throw new Error('SMM_PANEL_API_KEY environment variable is not set');
  }
  return new SmmPanelClient(apiKey);
}

/**
 * Normalize platform name from category
 * e.g., "Instagram Followers" -> "instagram"
 */
export function normalizePlatform(category: string): string {
  const lowerCategory = category.toLowerCase();
  
  const platforms = [
    'instagram',
    'tiktok',
    'youtube',
    'twitter',
    'facebook',
    'telegram',
    'spotify',
    'soundcloud',
    'twitch',
    'discord',
    'linkedin',
    'pinterest',
    'snapchat',
    'reddit',
    'threads',
  ];

  for (const platform of platforms) {
    if (lowerCategory.includes(platform)) {
      return platform;
    }
  }

  return 'other';
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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user is admin
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_admin) {
      throw new Error('Admin access required');
    }

    // Initialize admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Use the same admin/live NGN/USD rate as the rest of the storefront.
    const { rate: usdNgnRate, source: rateSource } = await getNgnUsdRate(supabaseAdmin);
    const markup = 2; // 2x markup as specified

    console.log(`Using USD/NGN rate: ${usdNgnRate} (${rateSource}), markup: ${markup}x`);

    // Fetch services from SMM Panel
    const smmClient = createSmmPanelClient();
    const services = await smmClient.getServices();

    console.log(`Fetched ${services.length} services from panel`);

    // Transform services into batch-ready data
    const batchSize = 500;
    let processed = 0;
    let errors = 0;

    // Transform all services first
    const allServiceData = services.map((service) => {
      const rateUsd = parseFloat(service.rate);
      const priceNgn = rateUsd * usdNgnRate * markup;
      const platform = normalizePlatform(service.category);

      return {
        external_id: service.service,
        name: service.name,
        category: service.category,
        platform: platform,
        service_type: service.type,
        rate_usd: rateUsd,
        price_ngn: Math.ceil(priceNgn), // Round up to nearest Naira
        min_quantity: parseInt(service.min),
        max_quantity: parseInt(service.max),
        has_refill: service.refill === true,
        has_cancel: service.cancel === true,
        // NOTE: is_active is intentionally omitted here. On INSERT the DB column
        // default (true) applies, so new services start visible. On UPDATE
        // (conflict on external_id) the existing value is preserved, meaning
        // services an admin has hidden via the dashboard stay hidden after a sync.
        last_synced_at: new Date().toISOString(),
      };
    });

    console.log(`Transformed ${allServiceData.length} services, upserting in batches of ${batchSize}...`);

    // Upsert in batches
    for (let i = 0; i < allServiceData.length; i += batchSize) {
      const batch = allServiceData.slice(i, i + batchSize);
      
      try {
        const { error: upsertError } = await supabaseAdmin
          .from('smm_services')
          .upsert(batch, {
            onConflict: 'external_id',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error(`Error upserting batch ${i / batchSize + 1}:`, upsertError);
          errors += batch.length;
        } else {
          processed += batch.length;
          console.log(`Batch ${Math.floor(i / batchSize) + 1}: Upserted ${batch.length} services (total: ${processed})`);
        }
      } catch (err) {
        console.error(`Error processing batch ${i / batchSize + 1}:`, err);
        errors += batch.length;
      }
    }

    // Get panel balance for info
    let panelBalance = null;
    try {
      const balanceResponse = await smmClient.getBalance();
      panelBalance = balanceResponse.balance;
    } catch (err) {
      console.error('Failed to fetch panel balance:', err);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${services.length} services`,
        stats: {
          total: services.length,
          processed: processed,
          errors: errors,
          usd_ngn_rate: usdNgnRate,
          usd_ngn_rate_source: rateSource,
          markup: `${markup}x`,
          panel_balance_usd: panelBalance,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('SMM Sync Services Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' || error.message === 'Admin access required' ? 401 : 500,
      }
    );
  }
});
