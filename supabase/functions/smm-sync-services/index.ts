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

// Catalogue and balance reads never retry or follow redirects. The deadline
// includes reading the body, rather than ending when response headers arrive.
export async function readSmmJson(url: string, init: RequestInit = {}, deadlineMs = 20_000, maxBytes = 8_388_608): Promise<any> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(deadlineMs) });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('SMM_READ_UNAVAILABLE'); }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {}); throw new Error('SMM_READ_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SMM_READ_UNAVAILABLE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maxBytes) throw new Error('SMM_READ_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('SMM_READ_INVALID'); }
}

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

    const data = await readSmmJson(SMM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!data || typeof data !== 'object' || data.error) throw new Error('SMM_READ_UNAVAILABLE');

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
      const parsed = Number(data.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { rate: parsed, source: 'override' };
      }
    }
  } catch (_err) {
    // fall through to live rate
  }

  try {
    const json = await readSmmJson(LIVE_RATE_URL, {}, 5_000, 65_536);
    const liveRate = json?.rates?.NGN;
    if (typeof liveRate === 'number' && Number.isFinite(liveRate) && liveRate > 0) {
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

const MAX_SERVICES = 20_000;
const INT4_MAX = 2_147_483_647;
function supplierNumber(value: unknown, integer = false): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) throw new Error('SMM_CATALOGUE_INVALID');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (integer && (!Number.isSafeInteger(number) || number > INT4_MAX))) throw new Error('SMM_CATALOGUE_INVALID');
  return number;
}

/**
 * Digest contract: SHA256(UTF8(JSON.stringify(rows))), rows sorted by numeric
 * external_id, keys in the insertion order below. No timestamps/is_active.
 * rate_usd has the database's six-decimal precision; prices retain ceil(raw
 * supplier rate * configured USD/NGN rate * 2), the existing pricing rule.
 */
export async function normalizeSmmCatalogue(services: unknown, usdNgnRate: number) {
  if (!Array.isArray(services) || services.length < 1 || services.length > MAX_SERVICES || !Number.isFinite(usdNgnRate) || usdNgnRate <= 0) throw new Error('SMM_CATALOGUE_INVALID');
  const ids = new Set<number>();
  let maxSupplierRate = 0;
  const rows = services.map((service: any) => {
    if (!service || typeof service !== 'object' || Array.isArray(service)) throw new Error('SMM_CATALOGUE_INVALID');
    const externalId = supplierNumber(service.service, true);
    if (externalId < 1 || ids.has(externalId)) throw new Error('SMM_CATALOGUE_INVALID');
    ids.add(externalId);
    for (const field of ['name', 'category', 'type']) {
      if (typeof service[field] !== 'string' || !service[field].trim() || service[field].length > 20_000 || /\0/.test(service[field])) throw new Error('SMM_CATALOGUE_INVALID');
    }
    const rawRate = supplierNumber(service.rate);
    const min = supplierNumber(service.min, true), max = supplierNumber(service.max, true);
    const priceNgn = Math.ceil(rawRate * usdNgnRate * 2);
    if (max < min || !Number.isSafeInteger(priceNgn) || priceNgn > 9_999_999_999_999) throw new Error('SMM_CATALOGUE_INVALID');
    maxSupplierRate = Math.max(maxSupplierRate, rawRate);
    return {
      external_id: externalId,
      name: service.name,
      category: service.category,
      platform: normalizePlatform(service.category),
      service_type: service.type,
      rate_usd: Number(rawRate.toFixed(6)),
      price_ngn: priceNgn,
      min_quantity: min,
      max_quantity: max,
      has_refill: service.refill === true,
      has_cancel: service.cancel === true,
    };
  }).sort((a, b) => a.external_id - b.external_id);
  const encoded = new TextEncoder().encode(JSON.stringify(rows));
  if (encoded.length > 8_388_608) throw new Error('SMM_CATALOGUE_INVALID');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return { rows, total: rows.length, sha256, max_supplier_rate_usd: maxSupplierRate,
    max_quantity: Math.max(...rows.map(row => row.max_quantity)) };
}

export function normalizeSmmBalance(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.currency !== 'USD') throw new Error('SMM_BALANCE_UNAVAILABLE');
  let balance: number;
  try { balance = supplierNumber(value.balance); } catch { throw new Error('SMM_BALANCE_UNAVAILABLE'); }
  return { balance: String(value.balance), currency: 'USD', available: balance > 0 };
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
      .select('is_admin, account_suspended')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_admin || profile.account_suspended === true) {
      throw new Error('Admin access required');
    }

    // Existing empty-body dashboard calls still sync. Health is strictly a
    // provider read and performs no catalogue, wallet, order or flag writes.
    let action = 'sync';
    const rawBody = await req.text();
    if (rawBody.length > 1_024) throw new Error('SMM_ACTION_INVALID');
    if (rawBody.trim()) {
      let body: any;
      try { body = JSON.parse(rawBody); } catch { throw new Error('SMM_ACTION_INVALID'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('SMM_ACTION_INVALID');
      action = body.action ?? 'sync';
    }
    if (!['sync', 'health'].includes(action)) throw new Error('SMM_ACTION_INVALID');

    // Initialize admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Use the same admin/live NGN/USD rate as the rest of the storefront.
    const { rate: usdNgnRate, source: rateSource } = await getNgnUsdRate(supabaseAdmin);
    const markup = 2;
    const smmClient = createSmmPanelClient();
    const services = await smmClient.getServices();
    // Validate the entire snapshot before the first database write. One bad
    // provider row must not leave an apparently successful partial catalogue.
    const catalogue = await normalizeSmmCatalogue(services, usdNgnRate);
    const balance = normalizeSmmBalance(await smmClient.getBalance());
    const baseStats = {
      total: catalogue.total,
      usd_ngn_rate: usdNgnRate,
      usd_ngn_rate_source: rateSource,
      markup: `${markup}x`,
      panel_balance_usd: balance.balance,
      panel_currency: balance.currency,
      max_supplier_rate_usd: catalogue.max_supplier_rate_usd,
      max_quantity: catalogue.max_quantity,
      catalogue_sha256: catalogue.sha256,
    };
    if (action === 'health') {
      return new Response(JSON.stringify({ success: true, read_only: true,
        ready_for_ordering: balance.available, stats: baseStats, balance, catalogue }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const batchSize = 500;
    let processed = 0;
    let errors = 0;
    const failedBatches: Array<{ offset: number; count: number; code: string }> = [];
    const syncedAt = new Date().toISOString();
    // Omit is_active on every upsert: existing admin-hidden items stay hidden.
    // Removed supplier IDs are not deleted or disabled by an incomplete sync.
    const allServiceData = catalogue.rows.map(row => ({ ...row, last_synced_at: syncedAt }));
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
          errors += batch.length;
          failedBatches.push({ offset: i, count: batch.length,
            code: typeof upsertError.code === 'string' && /^[A-Z0-9]{5}$/.test(upsertError.code) ? upsertError.code : 'DATABASE_WRITE_UNCONFIRMED' });
        } else {
          processed += batch.length;
        }
      } catch {
        errors += batch.length;
        failedBatches.push({ offset: i, count: batch.length, code: 'DATABASE_WRITE_UNCONFIRMED' });
      }
    }
    return new Response(
      JSON.stringify({
        success: errors === 0,
        code: errors ? 'SMM_CATALOGUE_SYNC_INCOMPLETE' : 'SMM_CATALOGUE_SYNCED',
        message: errors ? 'The catalogue refresh was incomplete. Ordering should remain paused until the failed batches are reviewed.' : `Synced ${catalogue.total} services`,
        ready_for_ordering: errors === 0 && balance.available,
        stats: {
          ...baseStats,
          processed: processed,
          errors: errors,
          synced_at: syncedAt,
        },
        failed_batches: failedBatches,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: errors ? 502 : 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    const knownErrors = new Set(['Unauthorized', 'Missing authorization header', 'Admin access required', 'SMM_ACTION_INVALID', 'SMM_CATALOGUE_INVALID', 'SMM_BALANCE_UNAVAILABLE']);
    const publicError = knownErrors.has(errorMessage) ? errorMessage : 'SMM_READ_UNAVAILABLE';
    return new Response(
      JSON.stringify({
        success: false,
        error: publicError,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: ['Unauthorized', 'Missing authorization header', 'Admin access required'].includes(publicError) ? 401
          : ['SMM_ACTION_INVALID', 'SMM_CATALOGUE_INVALID'].includes(publicError) ? 422 : 502,
      }
    );
  }
});
