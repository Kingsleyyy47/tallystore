import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
      } catch (e) {
        console.error(`Service ${service} failed:`, e);
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

  } catch (error: any) {
    console.error('Error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
