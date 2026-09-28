import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 405,
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!token || !supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('is_admin, account_suspended').eq('id', user.id).single();
    if (profileError || profile?.is_admin !== true || profile.account_suspended === true) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }

    // Call multiple IP detection services for reliability
    const services = [
      'https://api.ipify.org?format=json',
      'https://api64.ipify.org?format=json',
      'https://ipapi.co/json/',
    ];
    
    let detectedIP = 'unknown';
    
    for (const service of services) {
      try {
        const ipResponse = await fetch(service);
        const ipData = await ipResponse.json();
        detectedIP = ipData.ip || ipData.query;
        if (detectedIP && detectedIP !== 'unknown') break;
      } catch {
        console.error('IP detection service unavailable');
      }
    }
    
    console.log('Detected IP:', detectedIP);

    return new Response(
      JSON.stringify({ 
        success: true, 
        ip: detectedIP,
        message: 'Add this IP to SageCloud whitelist',
        instructions: 'Copy this IP and paste it in the "Whitelist IPs" field on SageCloud',
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch {
    console.error('IP detection failed');
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'IP detection unavailable',
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 503,
      }
    );
  }
});
