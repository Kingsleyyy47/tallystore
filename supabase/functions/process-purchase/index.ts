import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize user client (to get authenticated user)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Verify the user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Initialize admin client (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { product_group_id, quantity, idempotency_key, discount_code } = await req.json();

    // Validate inputs
    if (!product_group_id || !quantity || quantity < 1) {
      throw new Error('Invalid request: product_group_id and quantity (>= 1) required');
    }

    if (!idempotency_key || typeof idempotency_key !== 'string' || idempotency_key.length < 10) {
      throw new Error('Valid idempotency_key required');
    }

    // Check idempotency - prevent duplicate purchases
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id, amount, status, created_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existingOrder) {
      console.log(`⚠️ Idempotency hit: returning existing order ${existingOrder.id}`);
      return new Response(
        JSON.stringify({
          success: true,
          order_id: existingOrder.id,
          amount: existingOrder.amount,
          status: existingOrder.status,
          message: 'Order already processed',
          idempotency_hit: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🛒 Processing purchase: user=${user.id}, product_group=${product_group_id}, qty=${quantity}`);

    // 1. Get product group details
    const { data: productGroup, error: productError } = await supabaseAdmin
      .from('product_groups')
      .select('*, categories(name)')
      .eq('id', product_group_id)
      .single();

    if (productError || !productGroup) {
      throw new Error('Product not found');
    }

    // 2. Get available accounts (SERVER-SIDE ONLY - never exposed to client)
    const { data: availableAccounts, error: accountsError } = await supabaseAdmin
      .from('individual_accounts')
      .select('*')
      .eq('product_group_id', product_group_id)
      .eq('status', 'available')
      .limit(quantity);

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError);
      throw new Error('Failed to check availability');
    }

    console.log(`📦 Found ${availableAccounts?.length || 0} available accounts for product_group_id: ${product_group_id}`);

    let workingAccounts = availableAccounts || [];

    if (workingAccounts.length < quantity) {
      const shortfall = quantity - workingAccounts.length;
      const available = workingAccounts.length;

      // Auto-fulfillment fallback chain: try each configured live-purchase provider in
      // order until the shortfall is covered or every provider has been tried. Admin
      // "selects" which provider(s) are active for a product simply by filling in that
      // provider's product-id column (leave it blank to skip/disable that provider).
      // MuaBanVia is also gated behind the older auto_fulfill_enabled master switch for
      // backwards compatibility with existing product configs.
      //
      // All three providers share the same API shape (their own docs):
      // POST multipart/form-data: action=buyProduct, id, amount, api_key
      // Response: { status: "success", msg, trans_id, data: ["user|pass", ...] }
      const providers = [
        {
          name: 'muabanvia',
          enabled: !!(productGroup.auto_fulfill_enabled && productGroup.muabanvia_product_id),
          productId: productGroup.muabanvia_product_id,
          apiKeyEnv: 'MUABANVIA_API_KEY',
          baseUrlEnv: 'MUABANVIA_BASE_URL',
          defaultBaseUrl: 'https://muabanvia.org/api/buy_product',
          // MuaBanVia's own examples send the product id as both ID and id.
          idFieldNames: ['ID', 'id'],
        },
        {
          name: 'shopclone',
          enabled: !!productGroup.shopclone_product_id,
          productId: productGroup.shopclone_product_id,
          apiKeyEnv: 'SHOPCLONE_API_KEY',
          baseUrlEnv: 'SHOPCLONE_BASE_URL',
          defaultBaseUrl: 'https://shopclone.vn/api/buy_product',
          idFieldNames: ['id'],
        },
        {
          name: 'shopviaclone',
          enabled: !!productGroup.shopviaclone_product_id,
          productId: productGroup.shopviaclone_product_id,
          apiKeyEnv: 'SHOPVIACLONE_API_KEY',
          baseUrlEnv: 'SHOPVIACLONE_BASE_URL',
          defaultBaseUrl: 'https://shopviaclone22.com/api/buy_product',
          idFieldNames: ['id'],
        },
      ];

      // Parses the shared response shape all three providers use:
      // { status: "success", msg, trans_id, data: ["user|pass", ...] }
      const parseFulfilledAccounts = (rawAccounts: any, limit: number) => {
        const fulfilledRaw: any[] = Array.isArray(rawAccounts) ? rawAccounts : [];
        return fulfilledRaw.slice(0, limit).map((item: any) => {
          if (typeof item === 'string') {
            const parts = item.split('|').map((p: string) => p.trim());
            return {
              username: parts[0] || '',
              password: parts[1] || '',
              email: parts[2] || null,
              email_password: parts[3] || null,
              two_fa_code: parts[4] || null,
            };
          }
          return {
            username: item.username || item.user || item.login || '',
            password: item.password || item.pass || '',
            email: item.email || null,
            email_password: item.email_password || item.emailPass || null,
            two_fa_code: item.two_fa_code || item.twofa || item['2fa'] || null,
            additional_info: item,
          };
        });
      };

      let remainingShortfall = shortfall;

      for (const provider of providers) {
        if (remainingShortfall <= 0) break;
        if (!provider.enabled) continue;

        console.log(`🔄 Stock shortfall (${remainingShortfall}) — attempting ${provider.name} auto-fulfillment for product_group_id: ${product_group_id}`);

        try {
          const apiKey = Deno.env.get(provider.apiKeyEnv);
          if (!apiKey) {
            throw new Error(`${provider.apiKeyEnv} not configured`);
          }

          const baseUrl = Deno.env.get(provider.baseUrlEnv) || provider.defaultBaseUrl;

          const form = new FormData();
          form.set('action', 'buyProduct');
          for (const fieldName of provider.idFieldNames) {
            form.set(fieldName, String(provider.productId));
          }
          form.set('amount', String(remainingShortfall));
          form.set('api_key', apiKey);

          const fulfillResponse = await fetch(baseUrl, {
            method: 'POST',
            body: form,
          });

          const fulfillResult = await fulfillResponse.json().catch(() => null) as any;

          if (!fulfillResponse.ok || fulfillResult?.status !== 'success') {
            throw new Error(fulfillResult?.msg || fulfillResult?.message || fulfillResult?.error || `${provider.name} could not fulfill the shortfall`);
          }

          const fulfilledAccounts = parseFulfilledAccounts(fulfillResult?.data ?? [], remainingShortfall);

          if (fulfilledAccounts.length === 0) {
            throw new Error(`${provider.name} returned no accounts`);
          }

          // Insert the live-fulfilled accounts as available stock, tagged with their source,
          // so the rest of the purchase flow (reserve -> sell) treats them identically to
          // pre-stocked accounts.
          const { data: insertedAccounts, error: insertError } = await supabaseAdmin
            .from('individual_accounts')
            .insert(
              fulfilledAccounts.map((acc) => ({
                product_group_id: product_group_id,
                username: acc.username,
                password: acc.password,
                email: acc.email,
                email_password: acc.email_password,
                two_fa_code: acc.two_fa_code,
                additional_info: acc.additional_info || null,
                status: 'available',
                fulfillment_source: provider.name,
              }))
            )
            .select('*');

          if (insertError || !insertedAccounts) {
            throw new Error(insertError?.message || 'Failed to record auto-fulfilled accounts');
          }

          console.log(`✅ ${provider.name} auto-fulfillment succeeded: ${insertedAccounts.length} account(s)`);
          workingAccounts = [...workingAccounts, ...insertedAccounts];
          remainingShortfall -= insertedAccounts.length;
        } catch (fulfillErr) {
          console.error(`❌ ${provider.name} auto-fulfillment failed:`, fulfillErr);
          // Fall through to the next provider in the chain, or to the standard
          // out-of-stock error below if this was the last one.
        }
      }

      if (workingAccounts.length < quantity) {
        const stillAvailable = workingAccounts.length;
        console.error(`❌ Stock mismatch: product_group_id=${product_group_id}, found=${stillAvailable}, requested=${quantity}`);

        if (stillAvailable === 0) {
          throw new Error(`OUT_OF_STOCK: ${productGroup.name} is currently out of stock. Please check back later or contact support.`);
        } else {
          throw new Error(`INSUFFICIENT_STOCK: Only ${stillAvailable} account(s) available for ${productGroup.name}. You requested ${quantity}.`);
        }
      }
    }

    // 3. Check wallet balance
    // Discount codes are enabled. Quantity-tier bulk discounts remain off for now.
    // Mirrors DISCOUNTS_ENABLED in src/lib/supabase.ts — keep both in sync.
    const DISCOUNTS_ENABLED = true;

    // Apply quantity discount tiers (same logic as computeDiscountedTotal in
    // src/lib/supabase.ts - keep both in sync). Highest-min_qty tier the
    // purchased quantity meets or exceeds wins.
    const tiers: Array<{ min_qty: number; discount_pct: number }> = DISCOUNTS_ENABLED && Array.isArray(productGroup.quantity_discount_tiers)
      ? productGroup.quantity_discount_tiers
      : [];
    const originalTotal = productGroup.price * quantity;
    const applicableTier = tiers
      .filter((t) => quantity >= t.min_qty)
      .sort((a, b) => b.discount_pct - a.discount_pct)[0];
    const discountPct = applicableTier ? Math.min(Math.max(applicableTier.discount_pct, 0), 100) : 0;
    let totalPrice = discountPct > 0 ? Math.round(originalTotal * (1 - discountPct / 100)) : originalTotal;

    // Apply a discount code on top of the quantity-tier price, if one was
    // supplied. Fully re-validated server-side - the client-side preview in
    // src/lib/supabase.ts (previewDiscountCode) is just a UX convenience and
    // is never trusted for the actual charge.
    let appliedDiscountCode: { id: string; code: string } | null = null;
    if (DISCOUNTS_ENABLED && discount_code && typeof discount_code === 'string' && discount_code.trim()) {
      if (discountPct > 0) {
        throw new Error('Discount codes can\'t be combined with the bulk quantity discount already applied to this order.');
      }
      const { data: codeRow } = await supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', discount_code.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (!codeRow) {
        throw new Error('Invalid or expired discount code');
      }
      if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
        throw new Error('This discount code has expired');
      }
      if (codeRow.max_uses && codeRow.used_count >= codeRow.max_uses) {
        throw new Error('This discount code has reached its usage limit');
      }
      if (codeRow.product_group_id && codeRow.product_group_id !== product_group_id) {
        throw new Error('This discount code is not valid for this product');
      }
      if (codeRow.category_id && !codeRow.product_group_id && codeRow.category_id !== productGroup.category_id) {
        throw new Error('This discount code is not valid for this category');
      }
      // Reward codes are user-specific — reject if presented by a different user
      if (codeRow.user_id && codeRow.user_id !== user.id) {
        throw new Error('This discount code is not valid for your account');
      }
      // Reward codes have a max order amount — reject if this order exceeds it
      if (codeRow.max_order_amount && totalPrice > codeRow.max_order_amount) {
        throw new Error(`This code is only valid for orders up to ₦${codeRow.max_order_amount.toLocaleString()}`);
      }

      const codePct = Math.min(Math.max(codeRow.percent_off, 0), 100);
      totalPrice = Math.round(totalPrice * (1 - codePct / 100));
      appliedDiscountCode = { id: codeRow.id, code: codeRow.code };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Failed to fetch wallet balance');
    }

    const walletBalance = profile.wallet_balance || 0;
    if (walletBalance < totalPrice) {
      throw new Error(`Insufficient balance. Required: ₦${totalPrice.toLocaleString()}, Available: ₦${walletBalance.toLocaleString()}`);
    }

    // 4. Reserve accounts atomically (workingAccounts includes any MuaBanVia auto-fulfilled
    // accounts inserted above, already in 'available' status alongside the pre-stocked ones)
    const accountIds = workingAccounts.slice(0, quantity).map((acc: any) => acc.id);
    const purchasedAccounts = workingAccounts.slice(0, quantity);

    const { data: reservedAccounts, error: reserveError } = await supabaseAdmin
      .from('individual_accounts')
      .update({ status: 'reserved' })
      .in('id', accountIds)
      .eq('status', 'available')
      .select('id');

    if (reserveError || !reservedAccounts || reservedAccounts.length < quantity) {
      throw new Error('Failed to reserve accounts - some may have been sold');
    }

    // 5. Deduct wallet balance with optimistic locking
    const newBalance = walletBalance - totalPrice;

    const { data: updatedProfile, error: balanceError } = await supabaseAdmin
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('wallet_balance', walletBalance) // Optimistic lock
      .select()
      .single();

    if (balanceError || !updatedProfile) {
      // Rollback: unreserve accounts
      await supabaseAdmin
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds);

      throw new Error('Balance changed during purchase. Please try again.');
    }

    // 6. Create order with credentials (stored in account_details JSON)
    const orderData = {
      user_id: user.id,
      product_group_id: product_group_id,
      amount: totalPrice,
      status: 'completed',
      idempotency_key: idempotency_key,
      discount_code_id: appliedDiscountCode?.id || null,
      account_details: {
        accounts: purchasedAccounts.map((acc: any) => ({
          username: acc.username,
          password: acc.password,
          email: acc.email,
          email_password: acc.email_password,
          two_fa_code: acc.two_fa_code,
          recovery_email: acc.recovery_email,
          recovery_email_password: acc.recovery_email_password,
          additional_info: acc.additional_info,
        })),
        product_name: productGroup.name,
        category: productGroup.categories?.name,
        quantity: quantity,
        price_per_unit: productGroup.price,
      },
    };

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (orderError) {
      console.error('❌ Order creation failed:', orderError);

      // Rollback: restore balance and unreserve accounts
      await supabaseAdmin
        .from('profiles')
        .update({ wallet_balance: walletBalance })
        .eq('id', user.id);

      await supabaseAdmin
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds);

      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // 6b. Bump the discount code's used_count now that the order is locked in.
    // Done after order creation (not before) so a failed/rolled-back purchase
    // never consumes a use.
    if (appliedDiscountCode) {
      const { data: codeNow } = await supabaseAdmin
        .from('discount_codes')
        .select('used_count')
        .eq('id', appliedDiscountCode.id)
        .single();
      await supabaseAdmin
        .from('discount_codes')
        .update({ used_count: (codeNow?.used_count || 0) + 1 })
        .eq('id', appliedDiscountCode.id);
    }

    // 6c. Auto-reward: purchases with an original value of ₦100,000+ earn a
    //     personalised 20%-off code valid on any next order up to ₦12,000.
    //     Generated AFTER the order is committed so a rollback never issues one.
    //     Failures are non-fatal — the purchase is already complete.
    const REWARD_THRESHOLD = 100_000;
    const REWARD_PERCENT_OFF = 20;
    const REWARD_MAX_ORDER = 12_000;
    let rewardCode: string | null = null;
    if (originalTotal >= REWARD_THRESHOLD) {
      try {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0 or I/1 confusion
        const rand = Array.from({ length: 8 }, () =>
          chars[Math.floor(Math.random() * chars.length)]
        ).join('');
        const code = `REWARD-${rand}`;
        const { error: rewardError } = await supabaseAdmin
          .from('discount_codes')
          .insert({
            code,
            percent_off: REWARD_PERCENT_OFF,
            max_uses: 1,
            user_id: user.id,
            max_order_amount: REWARD_MAX_ORDER,
            is_reward: true,
            is_active: true,
          });
        if (!rewardError) {
          rewardCode = code;
          console.log(`🎁 Reward code ${code} issued to user ${user.id} for ₦${originalTotal} purchase`);
        } else {
          console.error('⚠️ Failed to issue reward code:', rewardError);
        }
      } catch (rewardErr) {
        console.error('⚠️ Reward code generation error:', rewardErr);
      }
    }

    // 7. Mark accounts as sold
    await supabaseAdmin
      .from('individual_accounts')
      .update({
        status: 'sold',
        sold_at: new Date().toISOString(),
      })
      .in('id', accountIds);

    // 8. Update product group stock
    const { count: remainingStock } = await supabaseAdmin
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('product_group_id', product_group_id)
      .eq('status', 'available');

    await supabaseAdmin
      .from('product_groups')
      .update({ stock_count: remainingStock || 0 })
      .eq('id', product_group_id);

    // 9. Record transaction
    await supabaseAdmin
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'purchase',
        amount: -totalPrice,
        status: 'completed',
        balance_after: newBalance,
        description: `Purchase: ${quantity}x ${productGroup.name}`,
        reference: `ORD-${order.id.substring(0, 8).toUpperCase()}`,
      }]);

    console.log(`✅ Purchase completed: order=${order.id}, amount=₦${totalPrice}`);

    // Return success - credentials are in order.account_details, user views via orders page
    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        amount: totalPrice,
        quantity: quantity,
        product_name: productGroup.name,
        new_balance: newBalance,
        message: `Successfully purchased ${quantity} account(s)`,
        ...(rewardCode ? { reward_code: rewardCode } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Purchase error:', error);

    const message = error instanceof Error ? error.message : 'Purchase failed';
    
    // Return 200 with success: false for business errors so the client can read the message
    // Only return 401 for auth errors
    const status = message === 'Unauthorized' ? 401 : 200;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
