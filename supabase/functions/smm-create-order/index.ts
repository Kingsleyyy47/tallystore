import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createSmmPanelClient } from '../_shared/smm-panel-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generate unique order reference
 */
function generateReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SMM-${timestamp}-${random}`;
}

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

    // Parse request body - accept all possible fields for different service types
    const { 
      service_id, 
      link, 
      quantity,
      comments,      // For Custom Comments type
      usernames,     // For Mentions type
      username,      // For Comment Likes, Subscriptions
      hashtags,      // For Mentions with Hashtags
      hashtag,       // For Mentions Hashtag
      keywords,      // For SEO
      answer_number, // For Poll
      groups,        // For Invites from Groups
      idempotency_key 
    } = await req.json();

    // Validate required fields
    if (!service_id) {
      throw new Error('service_id is required');
    }

    // Initialize admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check for duplicate order (idempotency)
    if (idempotency_key) {
      const { data: existingOrder } = await supabaseAdmin
        .from('smm_orders')
        .select('id, reference, status')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotency_key)
        .single();

      if (existingOrder) {
        console.log(`Duplicate order detected for idempotency_key: ${idempotency_key}`);
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Order already exists',
            data: existingOrder,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }
    }

    // Get service details
    const { data: service, error: serviceError } = await supabaseAdmin
      .from('smm_services')
      .select('*')
      .eq('id', service_id)
      .eq('is_active', true)
      .single();

    if (serviceError || !service) {
      throw new Error('Service not found or inactive');
    }

    // Determine the actual quantity to use
    // Package services have fixed quantity (1 package)
    // Other services use the provided quantity
    const actualQuantity = service.service_type === 'Package' ? 1 : (quantity || service.min_quantity);

    // Validate quantity against min/max (skip for packages)
    if (service.service_type !== 'Package') {
      if (actualQuantity < service.min_quantity) {
        throw new Error(`Minimum quantity is ${service.min_quantity}`);
      }
      if (actualQuantity > service.max_quantity) {
        throw new Error(`Maximum quantity is ${service.max_quantity}`);
      }
    }

    // Calculate price
    // For packages: price_ngn is the total price
    // For others: price_ngn is per 1000, so calculate based on quantity
    let totalAmount: number;
    let totalCost: number;
    
    if (service.service_type === 'Package') {
      totalAmount = Math.ceil(service.price_ngn);
      totalCost = service.rate_usd;
    } else {
      const pricePerUnit = service.price_ngn / 1000;
      totalAmount = Math.ceil(pricePerUnit * actualQuantity);
      const costPerUnit = service.rate_usd / 1000;
      totalCost = costPerUnit * actualQuantity;
    }

    console.log(`Order calculation: ${actualQuantity} units, type: ${service.service_type}, total: ₦${totalAmount}`);

    // Check for duplicate active order with same link (prevent "active order" panel errors)
    if (link) {
      const { data: activeOrders } = await supabaseAdmin
        .from('smm_orders')
        .select('id, reference, status')
        .eq('user_id', user.id)
        .eq('service_id', service.id)
        .eq('link', link)
        .in('status', ['pending', 'processing', 'in_progress'])
        .limit(1);

      if (activeOrders && activeOrders.length > 0) {
        throw new Error(
          `You already have an active order for this link (${activeOrders[0].reference}). ` +
          `Please wait for it to complete before placing a new one.`
        );
      }
    }

    // Generate order reference
    const reference = generateReference();

    // Atomic wallet deduction with optimistic locking to prevent race conditions
    // Read balance → check sufficient → deduct with WHERE matching original balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch user profile');
    }

    const currentBalance = parseFloat(profile.wallet_balance) || 0;

    if (currentBalance < totalAmount) {
      throw new Error(`Insufficient balance. Required: ₦${totalAmount.toLocaleString()}, Available: ₦${currentBalance.toLocaleString()}`);
    }

    const newBalance = currentBalance - totalAmount;

    // Optimistic locking: only update if balance hasn't changed since we read it
    // This prevents race conditions from concurrent orders
    const { data: updateResult, error: balanceError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('wallet_balance', currentBalance)
      .select('wallet_balance')
      .single();

    if (balanceError || !updateResult) {
      throw new Error('Balance changed during transaction. Please try again.');
    }

    console.log(`Deducted ₦${totalAmount} from user ${user.id}. New balance: ₦${newBalance}`);

    // Create order record (pending) - service_name not in table, only service_id FK
    const orderData = {
      user_id: user.id,
      reference: reference,
      service_id: service.id,
      link: link || '',
      quantity: actualQuantity,
      amount_ngn: totalAmount,
      cost_usd: totalCost,
      status: 'pending',
      idempotency_key: idempotency_key || null,
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('smm_orders')
      .insert(orderData)
      .select()
      .single();

    if (orderError) {
      // Rollback balance deduction
      await supabaseAdmin
        .from('profiles')
        .update({
          wallet_balance: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // Place order with SMM Panel
    let panelOrderId: number | null = null;
    let panelError: string | null = null;

    try {
      const smmClient = createSmmPanelClient();
      
      // Build order params based on service type
      // Each type has specific required parameters per API docs:
      // - Default: link, quantity
      // - Package: link (no quantity)
      // - Custom Comments: link, comments
      // - Custom Comments Package: link, comments
      // - Mentions: link, quantity, usernames
      // - Mentions with Hashtags: link, quantity, usernames, hashtags
      // - Mentions Custom List: link, usernames
      // - Mentions Hashtag: link, quantity, hashtag
      // - Mentions User Followers: link, quantity, username
      // - Mentions Media Likers: link, quantity, username
      // - Comment Likes: link, quantity, username
      // - Comment Replies: link, username, comments (NO quantity!)
      // - Poll: link, answer_number
      // - Invites from Groups: link, quantity, groups
      // - Subscriptions: username, quantity (NO link!)
      // - SEO: link, keywords
      // - Web Traffic: link, quantity
      
      const orderParams: Record<string, any> = {
        service: service.external_id,
      };
      
      const serviceType = service.service_type;
      
      // Add link for types that need it (all except Subscriptions)
      if (serviceType !== 'Subscriptions' && link) {
        orderParams.link = link;
      }
      
      // Add quantity for types that need it
      const typesWithQuantity = [
        'Default', 'Mentions', 'Mentions with Hashtags', 'Mentions Hashtag',
        'Mentions User Followers', 'Mentions Media Likers', 'Comment Likes',
        'Invites from Groups', 'Subscriptions', 'Web Traffic'
      ];
      if (typesWithQuantity.includes(serviceType) && actualQuantity) {
        orderParams.quantity = actualQuantity;
      }
      
      // Add type-specific fields
      if (comments) orderParams.comments = comments;
      if (usernames) orderParams.usernames = usernames;
      if (username) orderParams.username = username;
      if (hashtags) orderParams.hashtags = hashtags;
      if (hashtag) orderParams.hashtag = hashtag;
      if (keywords) orderParams.keywords = keywords;
      if (answer_number) orderParams.answer_number = answer_number;
      if (groups) orderParams.groups = groups;
      
      console.log(`Sending to panel for type "${serviceType}":`, orderParams);
      
      const panelResponse = await smmClient.createOrder(orderParams);

      console.log('Panel response:', panelResponse);

      if (panelResponse.order) {
        panelOrderId = panelResponse.order;

        // Update order with panel order ID
        await supabaseAdmin
          .from('smm_orders')
          .update({
            external_order_id: panelOrderId,
            status: 'processing',
            panel_response: panelResponse,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      } else if (panelResponse.error) {
        panelError = panelResponse.error;
      }
    } catch (err) {
      console.error('Panel API error:', err);
      panelError = err.message || 'Failed to place order with panel';
    }

    // If panel order failed, auto-refund the user immediately
    if (panelError) {
      // Refund wallet balance
      const { data: currentProfile } = await supabaseAdmin
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();

      const refundedBalance = (parseFloat(currentProfile?.wallet_balance) || 0) + totalAmount;

      await supabaseAdmin
        .from('profiles')
        .update({
          wallet_balance: refundedBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      console.log(`Auto-refunded ₦${totalAmount} to user ${user.id}. Balance restored to ₦${refundedBalance}`);

      // Mark order as failed
      await supabaseAdmin
        .from('smm_orders')
        .update({
          status: 'failed',
          panel_response: { error: panelError },
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      // Log the failed purchase transaction
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        type: 'purchase',
        amount: -totalAmount,
        balance_after: newBalance,
        description: `SMM Order Failed: ${service.name} (${actualQuantity} units) - ${panelError}`,
        reference: reference,
        status: 'failed',
      });

      // Log the automatic refund transaction
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        type: 'refund',
        amount: totalAmount,
        balance_after: refundedBalance,
        description: `Auto-refund for failed SMM order: ${service.name} (${actualQuantity} units)`,
        reference: `REFUND-${reference}`,
        status: 'completed',
      });

      throw new Error(`Order failed: ${panelError}. Your balance of ₦${totalAmount.toLocaleString()} has been automatically refunded.`);
    }

    // Log successful transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: user.id,
      type: 'purchase',
      amount: -totalAmount,
      balance_after: newBalance,
      description: `SMM Order: ${service.name} (${actualQuantity} units)`,
      reference: reference,
      status: 'completed',
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Order placed successfully',
        data: {
          order_id: order.id,
          reference: reference,
          external_order_id: panelOrderId,
          service: service.name,
          quantity: quantity,
          amount: totalAmount,
          status: 'processing',
          new_balance: newBalance,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('SMM Create Order Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 400,
      }
    );
  }
});
