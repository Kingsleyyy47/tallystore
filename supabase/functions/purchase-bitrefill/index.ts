import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createBitrefillClient } from '../_shared/bitrefill-client.ts';
import { convertToNgn } from '../_shared/exchange-rate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Kill switch
    if (Deno.env.get('BITREFILL_ENABLED') === 'false') {
      throw new Error('Gift cards & eSIMs are temporarily disabled for maintenance. Please try again later.');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const {
      product_id,
      product_name,
      package_id,
      value, // for flexible-denomination products
      quantity = 1,
      recipient_phone,
      payment_source = 'wallet',
      idempotency_key,
    } = await req.json();

    if (!product_id || !product_name) {
      throw new Error('Missing required fields: product_id, product_name');
    }
    if (!package_id && !value) {
      throw new Error('Either package_id or value is required to select a denomination');
    }
    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key is required');
    }
    if (!['wallet', 'crypto'].includes(payment_source)) {
      throw new Error('Invalid payment_source. Must be "wallet" or "crypto"');
    }

    const qty = parseInt(quantity, 10) || 1;
    if (qty < 1 || qty > 20) {
      throw new Error('quantity must be between 1 and 20');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Idempotency check
    const { data: existingOrder } = await supabaseClient
      .from('bitrefill_orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      console.log(`Idempotency hit: returning existing order ${existingOrder.id}`);
      return new Response(
        JSON.stringify({
          success: true,
          order: existingOrder,
          message: 'Order already processed',
          idempotency_hit: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Reject any product an admin has blocked via the catalog curation list
    // in AdminPage, even if the client has a stale/cached product_id from
    // before it was blocked.
    try {
      const { data: blockSetting } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', 'bitrefill_blocked_products')
        .single();
      if (blockSetting?.value) {
        const parsed = JSON.parse(blockSetting.value);
        if (Array.isArray(parsed) && parsed.some((p: { product_id: string }) => p.product_id === product_id)) {
          throw new Error('This product is no longer available.');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'This product is no longer available.') throw err;
      // no blocklist configured — nothing to check
    }

    const bitrefill = createBitrefillClient({ apiKey: Deno.env.get('BITREFILL_API_KEY') ?? '' });

    // Re-fetch the product to confirm the denomination/price server-side
    // (never trust a client-supplied price).
    const product = await bitrefill.getProductDetails(product_id);
    const currency = product.currency || 'USD';

    let unitPrice: number;
    let resolvedPackageId: string | undefined = package_id;

    if (package_id) {
      const pkg = product.packages?.find((p) => p.package_id === package_id);
      if (!pkg) throw new Error('Selected denomination is no longer available');
      unitPrice = pkg.value;
    } else {
      const numericValue = parseFloat(value);
      if (!product.range || numericValue < product.range.min || numericValue > product.range.max) {
        throw new Error('Selected amount is outside the allowed range for this product');
      }
      unitPrice = numericValue;
    }

    const totalOriginal = unitPrice * qty;

    // Apply optional admin markup (app_settings.bitrefill_markup_pct), defaults to 0
    let markupPct = 0;
    try {
      const { data: markupSetting } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', 'bitrefill_markup_pct')
        .single();
      if (markupSetting?.value) {
        const parsed = parseFloat(markupSetting.value);
        if (!isNaN(parsed) && parsed >= 0) markupPct = parsed;
      }
    } catch (_err) {
      // no markup configured, default to 0
    }

    const baseNgn = await convertToNgn(totalOriginal, currency, supabaseAdmin);
    const chargeNgn = Math.ceil(baseNgn * (1 + markupPct / 100));

    // Determine balance column
    const balanceColumn = payment_source === 'wallet' ? 'wallet_balance' : 'crypto_balance';
    const balanceDisplayName = payment_source === 'wallet' ? 'TallyStore' : 'Crypto';

    const { data: userData, error: userFetchError } = await supabaseClient
      .from('profiles')
      .select(balanceColumn)
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      throw new Error('Failed to fetch user balance');
    }

    const currentBalance = parseFloat(userData?.[balanceColumn] || '0');
    if (currentBalance < chargeNgn) {
      throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${currentBalance.toLocaleString()}, Required: ₦${chargeNgn.toLocaleString()}`);
    }

    // Check TallyStore's own Bitrefill account balance can cover this purchase
    const bitrefillBalance = await bitrefill.getBalance();
    if (bitrefillBalance.balance < totalOriginal) {
      console.error(`[ADMIN ALERT] Bitrefill account balance too low. Have ${bitrefillBalance.balance} ${bitrefillBalance.currency}, need ${totalOriginal} ${currency}`);
      throw new Error('Gift cards & eSIMs are temporarily unavailable. Please try again later or contact support.');
    }

    const reference = `TALLY-GIFT-${Date.now()}-${user.id.substring(0, 8)}`;

    // Create pending order record
    const { data: orderRecord, error: dbError } = await supabaseClient
      .from('bitrefill_orders')
      .insert({
        user_id: user.id,
        reference,
        idempotency_key,
        product_id,
        product_name,
        package_id: resolvedPackageId || null,
        quantity: qty,
        recipient_phone: recipient_phone || null,
        amount_ngn: chargeNgn,
        amount_original: totalOriginal,
        currency,
        payment_source,
        status: 'pending',
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to create order record: ${dbError.message}`);
    }

    // Deduct from user's balance with optimistic locking
    let balanceDeducted = false;
    for (let attempt = 0; attempt < 5 && !balanceDeducted; attempt++) {
      const { data: freshUserData } = await supabaseAdmin
        .from('profiles')
        .select(balanceColumn)
        .eq('id', user.id)
        .single();

      const actualCurrentBalance = parseFloat(freshUserData?.[balanceColumn] || '0');

      if (actualCurrentBalance < chargeNgn) {
        await supabaseAdmin.from('bitrefill_orders').delete().eq('id', orderRecord.id);
        throw new Error(`Insufficient ${balanceDisplayName} balance. Available: ₦${actualCurrentBalance.toLocaleString()}, Required: ₦${chargeNgn.toLocaleString()}`);
      }

      const { data: updateData, error: balanceError } = await supabaseAdmin
        .from('profiles')
        .update({ [balanceColumn]: actualCurrentBalance - chargeNgn })
        .eq('id', user.id)
        .eq(balanceColumn, actualCurrentBalance)
        .select()
        .single();

      if (balanceError) {
        console.warn(`Balance deduction conflict on attempt ${attempt + 1}, retrying...`);
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }

      if (updateData) {
        balanceDeducted = true;
        console.log(`Deducted ₦${chargeNgn} from user ${user.id} ${balanceColumn}`);
      } else {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }

    if (!balanceDeducted) {
      await supabaseAdmin.from('bitrefill_orders').delete().eq('id', orderRecord.id);
      throw new Error('Failed to deduct balance after multiple attempts. Please try again.');
    }

    // Buy from Bitrefill using TallyStore's own Bitrefill account balance
    try {
      const invoice = await bitrefill.createInvoice({
        products: [
          {
            product_id,
            package_id: resolvedPackageId,
            value: resolvedPackageId ? undefined : unitPrice,
            quantity: qty,
            phone_number: recipient_phone || undefined,
          },
        ],
        payment_method: 'balance',
        auto_pay: true,
      });

      console.log('Bitrefill invoice created:', JSON.stringify(invoice));

      let finalStatus = 'pending';
      let redemption: any = null;
      const orderId = invoice.orders?.[0]?.id;

      if (invoice.status === 'complete' && orderId) {
        const orderDetail = await bitrefill.getOrder(orderId);
        redemption = orderDetail.redemption_info || null;
        finalStatus = 'successful';
      } else if (['blocked', 'denied', 'payment_error'].includes(invoice.status)) {
        finalStatus = 'failed';
      }
      // otherwise leave as 'pending' — a webhook/poll can resolve this later

      await supabaseClient
        .from('bitrefill_orders')
        .update({
          status: finalStatus,
          bitrefill_invoice_id: invoice.id,
          bitrefill_order_id: orderId || null,
          bitrefill_response: invoice,
          redemption_code: redemption?.code || null,
          redemption_link: redemption?.link || null,
          redemption_pin: redemption?.pin || null,
          redemption_instructions: redemption?.instructions || null,
          redemption_expiration: redemption?.expiration_date || null,
          completed_at: finalStatus === 'successful' ? new Date().toISOString() : null,
        })
        .eq('id', orderRecord.id);

      if (finalStatus === 'failed') {
        // Refund — Bitrefill rejected the purchase
        await refundBalance(supabaseAdmin, user.id, balanceColumn, chargeNgn);
        throw new Error('Purchase was declined by the provider. Your balance has been refunded.');
      }

      return new Response(
        JSON.stringify({
          success: true,
          order_id: orderRecord.id,
          reference,
          status: finalStatus,
          product_name,
          amount_ngn: chargeNgn,
          payment_source,
          redemption,
          message: finalStatus === 'successful' ? 'Purchase successful' : 'Purchase is being processed',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );

    } catch (purchaseError: unknown) {
      const errorMessage = purchaseError instanceof Error ? purchaseError.message : 'Unknown purchase error';
      console.error('Bitrefill purchase failed:', errorMessage);

      await supabaseClient
        .from('bitrefill_orders')
        .update({
          status: 'failed',
          bitrefill_response: { error: errorMessage },
        })
        .eq('id', orderRecord.id);

      await refundBalance(supabaseAdmin, user.id, balanceColumn, chargeNgn);

      throw new Error(`Purchase failed: ${errorMessage}`);
    }

  } catch (error) {
    console.error('Error in purchase-bitrefill:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'An unexpected error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});

async function refundBalance(supabaseAdmin: any, userId: string, balanceColumn: string, amount: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: currentUserData } = await supabaseAdmin
      .from('profiles')
      .select(balanceColumn)
      .eq('id', userId)
      .single();

    const currentBal = parseFloat(currentUserData?.[balanceColumn] || '0');
    const refundedBalance = currentBal + amount;

    const { data: refundData } = await supabaseAdmin
      .from('profiles')
      .update({ [balanceColumn]: refundedBalance })
      .eq('id', userId)
      .eq(balanceColumn, currentBal)
      .select()
      .single();

    if (refundData) {
      console.log(`Refunded ₦${amount} to user ${userId} ${balanceColumn}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
  console.error(`[ADMIN ALERT] Failed to refund ₦${amount} to user ${userId} after multiple attempts`);
}
