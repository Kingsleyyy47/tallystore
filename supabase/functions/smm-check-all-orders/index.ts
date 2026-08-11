import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createSmmPanelClient } from '../_shared/smm-panel-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * SMM Order Status Checker (Cron Job)
 * 
 * Automatically polls the SMM panel for status updates on all active orders.
 * Handles auto-refunds for cancelled and partial orders.
 * 
 * Designed to run every 15 minutes via pg_cron.
 */

/**
 * Map panel status to our internal status
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
    // This function can be called by cron (with service role key) or by admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all active orders (pending, processing, in_progress) that have external_order_ids
    const { data: activeOrders, error: fetchError } = await supabaseAdmin
      .from('smm_orders')
      .select('id, user_id, reference, external_order_id, status, quantity, amount_ngn, link, service_id, created_at')
      .in('status', ['pending', 'processing', 'in_progress'])
      .not('external_order_id', 'is', null)
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch active orders: ${fetchError.message}`);
    }

    if (!activeOrders || activeOrders.length === 0) {
      console.log('No active SMM orders to check.');
      return new Response(
        JSON.stringify({ success: true, message: 'No active orders to check', checked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Checking ${activeOrders.length} active SMM orders...`);

    const smmClient = createSmmPanelClient();

    // Process orders in batches of 100 (panel API limit for multi-status)
    const BATCH_SIZE = 100;
    let totalChecked = 0;
    let totalUpdated = 0;
    let totalRefunded = 0;
    let totalRefundAmount = 0;
    const errors: string[] = [];

    for (let i = 0; i < activeOrders.length; i += BATCH_SIZE) {
      const batch = activeOrders.slice(i, i + BATCH_SIZE);
      const orderIds = batch.map(o => o.external_order_id).filter(Boolean);

      if (orderIds.length === 0) continue;

      try {
        // Use multi-status API for efficiency
        let statusResults: Record<string, any>;
        
        if (orderIds.length === 1) {
          // Single order — use single status endpoint
          const singleResult = await smmClient.getOrderStatus(orderIds[0]);
          statusResults = { [String(orderIds[0])]: singleResult };
        } else {
          // Multiple orders — use batch status endpoint
          statusResults = await smmClient.getMultipleOrderStatus(orderIds);
        }

        // Process each order's status
        for (const order of batch) {
          const externalId = String(order.external_order_id);
          const panelData = statusResults[externalId];

          if (!panelData || panelData.error) {
            console.warn(`No status data for order ${order.reference} (external: ${externalId}): ${panelData?.error || 'missing'}`);
            continue;
          }

          totalChecked++;

          const newStatus = mapPanelStatus(panelData.status || 'pending');

          // Skip if status hasn't changed
          if (newStatus === order.status) continue;

          const isTerminal = newStatus === 'completed' || newStatus === 'partial' || newStatus === 'cancelled' || newStatus === 'failed';

          // Update order in database
          const updateData: Record<string, any> = {
            status: newStatus,
            start_count: panelData.start_count ? parseInt(panelData.start_count) : undefined,
            remains: panelData.remains ? parseInt(panelData.remains) : undefined,
            panel_response: panelData,
            updated_at: new Date().toISOString(),
          };

          // Remove undefined fields
          Object.keys(updateData).forEach(key => {
            if (updateData[key] === undefined) delete updateData[key];
          });

          if (isTerminal) {
            updateData.completed_at = new Date().toISOString();
          }

          await supabaseAdmin
            .from('smm_orders')
            .update(updateData)
            .eq('id', order.id);

          totalUpdated++;
          console.log(`Order ${order.reference}: ${order.status} → ${newStatus}`);

          // Handle auto-refund for cancelled/partial/failed orders
          let refundAmount = 0;
          let refundMessage = '';

          if (newStatus === 'cancelled') {
            const panelCharge = parseFloat(panelData.charge || '0');
            if (panelCharge === 0) {
              // Full refund — panel charged nothing
              refundAmount = parseFloat(order.amount_ngn) || 0;
              refundMessage = `Auto-refund for cancelled SMM order (panel charge: $0)`;
            }
          } else if (newStatus === 'partial') {
            // Partial refund based on undelivered quantity
            const totalRemains = parseInt(panelData.remains || '0');
            if (totalRemains > 0 && order.quantity > 0) {
              const undeliveredRatio = totalRemains / order.quantity;
              refundAmount = Math.floor(parseFloat(order.amount_ngn) * undeliveredRatio);
              refundMessage = `Auto-refund for partial SMM order (${totalRemains}/${order.quantity} undelivered)`;
            }
          } else if (newStatus === 'failed') {
            // Full refund for failed orders
            refundAmount = parseFloat(order.amount_ngn) || 0;
            refundMessage = `Auto-refund for failed SMM order`;
          }

          if (refundAmount > 0) {
            // Check if refund was already issued (idempotency)
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
                  description: `${refundMessage}: ${order.reference}`,
                  reference: `REFUND-${order.reference}`,
                  status: 'completed',
                });

                totalRefunded++;
                totalRefundAmount += refundAmount;
                console.log(`Auto-refunded ₦${refundAmount} for order ${order.reference} (${newStatus})`);
              }
            }
          }
        }
      } catch (batchError) {
        const errorMsg = `Batch error (orders ${i}-${i + batch.length}): ${batchError.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < activeOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const summary = {
      success: true,
      message: `Checked ${totalChecked} orders, updated ${totalUpdated}, refunded ${totalRefunded}`,
      details: {
        total_active: activeOrders.length,
        checked: totalChecked,
        updated: totalUpdated,
        refunded: totalRefunded,
        refund_amount_ngn: totalRefundAmount,
        errors: errors.length > 0 ? errors : undefined,
      },
    };

    console.log('SMM Check All Orders Summary:', JSON.stringify(summary));

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('SMM Check All Orders Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
