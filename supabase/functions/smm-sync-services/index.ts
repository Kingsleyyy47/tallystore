import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createSmmPanelClient, normalizePlatform, type SmmService } from '../_shared/smm-panel-client.ts';

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

    // Get USD to NGN rate from settings
    const { data: rateSetting, error: rateError } = await supabaseAdmin
      .from('smm_settings')
      .select('value')
      .eq('key', 'usd_ngn_rate')
      .single();

    if (rateError || !rateSetting) {
      throw new Error('Failed to get USD/NGN rate from settings');
    }

    const usdNgnRate = parseFloat(rateSetting.value);
    const markup = 2; // 2x markup as specified

    console.log(`Using USD/NGN rate: ${usdNgnRate}, markup: ${markup}x`);

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
