import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { createSageCloudClient } from "../_shared/sagecloud-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
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

    // Verify authentication
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

    // Get provider from request
    const { provider } = await req.json();
    
    if (!provider) {
      throw new Error('Provider is required (MTN, GLO, AIRTEL, 9MOBILE)');
    }

    // Normalize provider to uppercase
    const normalizedProvider = provider.toUpperCase();

    // Map provider to SageCloud format
    const providerMap: Record<string, string> = {
      'MTN': 'MTNDATA',
      'GLO': 'GLODATA',
      'AIRTEL': 'AIRTELDATA',
      '9MOBILE': '9MOBILEDATA',
    };

    const sageProvider = providerMap[normalizedProvider];
    if (!sageProvider) {
      throw new Error('Invalid provider. Must be one of: MTN, GLO, AIRTEL, 9MOBILE');
    }

    // Initialize SageCloud client
    const sagecloud = createSageCloudClient({
      publicKey: Deno.env.get('SAGECLOUD_PUBLIC_KEY') || '',
      secretKey: Deno.env.get('SAGECLOUD_SECRET_KEY') || '',
    });

    // Fetch real data plans from SageCloud
    const plansResponse = await sagecloud.getDataPlans(
      sageProvider as 'MTNDATA' | 'GLODATA' | 'AIRTELDATA' | '9MOBILEDATA'
    );

    if (!plansResponse.success) {
      throw new Error('Failed to fetch data plans from SageCloud');
    }

    // Transform SageCloud response to frontend format
    const plans = plansResponse.data.map((plan) => ({
      code: plan.code,
      name: plan.description,
      price: parseFloat(plan.price),
      validity: plan.duration,
      type: plan.type,
    }));

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: plans,
        provider: provider,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error fetching data plans:', error);
    
    // Log detailed error for server-side debugging only
    console.error('Detailed error:', JSON.stringify({
      message: error.message,
      stack: error.stack,
      name: error.name,
    }));
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to fetch data plans',
        // Don't expose stack traces to client
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
