import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

    // Parse request body for optional filters
    let platform: string | null = null;
    let category: string | null = null;

    try {
      const body = await req.json();
      platform = body.platform || null;
      category = body.category || null;
    } catch {
      // No body or invalid JSON - that's fine, no filters
    }

    // Initialize admin client for database query
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Build query
    let query = supabaseAdmin
      .from('smm_services')
      .select('*')
      .eq('is_active', true)
      .order('platform')
      .order('category')
      .order('price_ngn');

    if (platform) {
      query = query.eq('platform', platform.toLowerCase());
    }

    if (category) {
      query = query.ilike('category', `%${category}%`);
    }

    const { data: services, error: servicesError } = await query;

    if (servicesError) {
      throw new Error(`Failed to fetch services: ${servicesError.message}`);
    }

    // Group services by platform for easier frontend rendering
    const groupedByPlatform: Record<string, typeof services> = {};
    const platforms: string[] = [];

    for (const service of services || []) {
      if (!groupedByPlatform[service.platform]) {
        groupedByPlatform[service.platform] = [];
        platforms.push(service.platform);
      }
      groupedByPlatform[service.platform].push(service);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          services: services || [],
          grouped: groupedByPlatform,
          platforms: platforms,
          total: services?.length || 0,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('SMM Get Services Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 500,
      }
    );
  }
});
