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
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Parse request body
    const { bank_code, account_number } = await req.json();

    if (!bank_code || !account_number) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: bank_code, account_number' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (account_number.length !== 10) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Account number must be 10 digits' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔍 Validating bank account: ${bank_code} - ${account_number.substring(0, 4)}****`);

    // Initialize SageCloud client
    const sageCloudClient = createSageCloudClient({
      publicKey: Deno.env.get('SAGECLOUD_PUBLIC_KEY') || '',
      secretKey: Deno.env.get('SAGECLOUD_SECRET_KEY') || '',
    });

    // Validate account via SageCloud
    const validationResponse = await sageCloudClient.validateBankAccount({
      bank_code,
      account_number,
    });

    console.log('SageCloud validation response:', JSON.stringify(validationResponse));

    // SageCloud response structure varies - check multiple paths
    const accountName = validationResponse.account_name || 
                        validationResponse.data?.account_name || 
                        validationResponse.data?.accountName ||
                        validationResponse.accountName;
    
    if (accountName) {
      console.log(`✅ Account validated: ${accountName}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          account_name: accountName,
          bank_code,
          account_number,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // If we get here, validation failed or no account name returned
    console.error('❌ Account validation failed - no account name in response:', validationResponse);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: validationResponse.message || 'Could not verify account details. Please check your bank and account number.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );

  } catch (error: any) {
    console.error('Error in validate-bank-account:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
