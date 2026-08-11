import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createSmmPanelClient } from '../_shared/smm-panel-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Map panel status to our status
 */
function mapPanelStatus(panelStatus: string): string {
  const statusMap: Record<string, string> = {
    'Pending': 'pending',
    'In progress': 'in_progress',
    'Processing': 'processing',
    'Completed': 'completed',
    'Partial': 'partial',
    'Canceled': 'cancelled',
    'Cancelled': 'cancelled',
    'Refunded': 'cancelled',
    'Failed': 'failed',
  };

  return statusMap[panelStatus] || panelStatus.toLowerCase().replace(' ', '_');
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

    // Parse request body
    const { order_id } = await req.json();

    if (!order_id) {
      throw new Error('order_id is required');
    }

    // Initialize admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get order from database
    const { data: order, error: orderError } = await supabaseAdmin
      .from('smm_orders')
      .select('*, smm_services(name, category)')
      .eq('id', order_id)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      throw new Error('Order not found');
    }

    // If no external order ID, return current status
    if (!order.external_order_id) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            order_id: order.id,
            reference: order.reference,
            status: order.status,
            message: 'Order has not been submitted to panel yet',
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Check status from panel
    const smmClient = createSmmPanelClient();
    const panelStatus = await smmClient.getOrderStatus(order.external_order_id);

    console.log(`Panel status for order ${order.external_order_id}:`, panelStatus);

    if (panelStatus.error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Panel error: ${panelStatus.error}`,
          data: {
            order_id: order.id,
            reference: order.reference,
            status: order.status,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Map and update status
    const newStatus = mapPanelStatus(panelStatus.status || 'pending');
    const isCompleted = newStatus === 'completed' || newStatus === 'partial' || newStatus === 'cancelled';

    // Update order in database
    const updateData: Record<string, any> = {
      status: newStatus,
      start_count: panelStatus.start_count ? parseInt(panelStatus.start_count) : order.start_count,
      remains: panelStatus.remains ? parseInt(panelStatus.remains) : order.remains,
      panel_response: panelStatus,
      updated_at: new Date().toISOString(),
    };

    if (isCompleted && !order.completed_at) {
      updateData.completed_at = new Date().toISOString();
    }

    await supabaseAdmin
      .from('smm_orders')
      .update(updateData)
      .eq('id', order.id);

    // Auto-refund for cancelled orders where panel charge is 0 (nothing was delivered)
    // Also handle partial refunds for partial orders
    let refundAmount = 0;
    let refundMessage = '';

    if (newStatus === 'cancelled' && order.status !== 'cancelled') {
      // Full refund — panel cancelled and charged nothing
      const panelCharge = parseFloat(panelStatus.charge || '0');
      if (panelCharge === 0) {
        refundAmount = parseFloat(order.amount_ngn) || 0;
        refundMessage = `Auto-refund for cancelled SMM order (panel charge: $0)`;
      }
    } else if (newStatus === 'partial' && order.status !== 'partial') {
      // Partial refund — panel only delivered some of the order
      const totalRemains = parseInt(panelStatus.remains || '0');
      if (totalRemains > 0 && order.quantity > 0) {
        const undeliveredRatio = totalRemains / order.quantity;
        refundAmount = Math.floor(parseFloat(order.amount_ngn) * undeliveredRatio);
        refundMessage = `Auto-refund for partial SMM order (${totalRemains}/${order.quantity} undelivered)`;
      }
    }

    if (refundAmount > 0) {
      // Check if refund was already issued
      const { data: existingRefund } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('reference', `REFUND-${order.reference}`)
        .eq('type', 'refund')
        .limit(1);

      if (!existingRefund || existingRefund.length === 0) {
        // Get current wallet balance
        const { data: userProfile } = await supabaseAdmin
          .from('profiles')
          .select('wallet_balance')
          .eq('id', order.user_id)
          .single();

        if (userProfile) {
          const currentWallet = parseFloat(userProfile.wallet_balance) || 0;
          const refundedBalance = currentWallet + refundAmount;

          // Credit wallet
          await supabaseAdmin
            .from('profiles')
            .update({
              wallet_balance: refundedBalance,
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.user_id);

          // Record refund transaction
          await supabaseAdmin.from('transactions').insert({
            user_id: order.user_id,
            type: 'refund',
            amount: refundAmount,
            balance_after: refundedBalance,
            description: refundMessage + `: ${order.reference}`,
            reference: `REFUND-${order.reference}`,
            status: 'completed',
          });

          console.log(`Auto-refunded ₦${refundAmount} for order ${order.reference} (${newStatus})`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          order_id: order.id,
          reference: order.reference,
          external_order_id: order.external_order_id,
          service: order.smm_services?.name,
          link: order.link,
          quantity: order.quantity,
          amount: order.amount_ngn,
          status: newStatus,
          start_count: updateData.start_count,
          remains: updateData.remains,
          charge: panelStatus.charge,
          refund_amount: refundAmount > 0 ? refundAmount : undefined,
          created_at: order.created_at,
          updated_at: updateData.updated_at,
          completed_at: updateData.completed_at || order.completed_at,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('SMM Check Status Error:', error);
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
