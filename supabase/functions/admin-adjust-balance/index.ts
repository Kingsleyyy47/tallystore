import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'wisdomthedev@gmail.com';

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanDeviceText(value: unknown, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

async function upsertFraudDeviceBans(
  supabaseAdmin: any,
  targetUserId: string,
  adminUserId: string,
  reason: string,
) {
  const { data: visits, error } = await supabaseAdmin
    .from('site_visits')
    .select('ip_address, user_agent, created_at')
    .eq('user_id', targetUserId)
    .eq('ip_source', 'edge')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.warn(`Could not load site visits for fraud bans: ${error.message}`)
    return { ipBans: 0, deviceBans: 0 }
  }

  const ipAddresses = new Set<string>()
  const userAgents = new Map<string, string>()

  for (const visit of visits || []) {
    const ip = cleanDeviceText(visit.ip_address, 80)
    if (ip) ipAddresses.add(ip)

    const userAgent = cleanDeviceText(visit.user_agent, 500)
    if (userAgent) {
      const hash = await sha256Hex(userAgent)
      if (!userAgents.has(hash)) userAgents.set(hash, userAgent.slice(0, 220))
    }
  }

  let ipBans = 0
  let deviceBans = 0

  for (const ipAddress of ipAddresses) {
    const { data: existing } = await supabaseAdmin
      .from('fraud_device_bans')
      .select('id')
      .eq('active', true)
      .eq('banned_user_id', targetUserId)
      .eq('ip_address', ipAddress)
      .maybeSingle()

    if (existing?.id) continue

    const { error: insertError } = await supabaseAdmin
      .from('fraud_device_bans')
      .insert({
        banned_user_id: targetUserId,
        created_by: adminUserId,
        ip_address: ipAddress,
        reason,
      })

    if (!insertError) ipBans += 1
    else console.warn(`Could not insert fraud IP ban ${ipAddress}: ${insertError.message}`)
  }

  for (const [userAgentHash, excerpt] of userAgents) {
    const { data: existing } = await supabaseAdmin
      .from('fraud_device_bans')
      .select('id')
      .eq('active', true)
      .eq('banned_user_id', targetUserId)
      .eq('user_agent_hash', userAgentHash)
      .maybeSingle()

    if (existing?.id) continue

    const { error: insertError } = await supabaseAdmin
      .from('fraud_device_bans')
      .insert({
        banned_user_id: targetUserId,
        created_by: adminUserId,
        user_agent_hash: userAgentHash,
        user_agent_excerpt: excerpt,
        reason,
      })

    if (!insertError) deviceBans += 1
    else console.warn(`Could not insert fraud device ban: ${insertError.message}`)
  }

  return { ipBans, deviceBans }
}

async function transactionsHaveIdempotencyKey(supabaseAdmin: any) {
  const { error } = await supabaseAdmin
    .from('transactions')
    .select('idempotency_key')
    .limit(1)

  return !(error && /idempotency_key/i.test(error.message || ''))
}

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

    if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
      console.error(`Admin access denied for ${user.email}`);
      throw new Error('Admin access required');
    }

    // Initialize admin client (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify admin status in database
    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!adminProfile?.is_admin) {
      console.error(`❌ User ${user.email} is not marked as admin in database`);
      throw new Error('Admin access required');
    }

    // Parse request body
    const body = await req.json();
    const hasTransactionIdempotencyKey = await transactionsHaveIdempotencyKey(supabaseAdmin);

    if (body?.action === 'record_ledger_credit') {
      const targetUserId = String(body.target_user_id || '').trim();
      const amount = Number(body.amount);
      const cleanLedgerReason = String(body.reason || '').trim();

      if (!targetUserId) throw new Error('target_user_id is required');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('A positive amount is required');
      if (cleanLedgerReason.length < 3) throw new Error('A reason with at least 3 characters is required');

      const { data: targetProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, email, wallet_balance, is_staff, is_admin')
        .eq('id', targetUserId)
        .single();

      if (profileError || !targetProfile) {
        throw new Error('Target user not found');
      }

      if (targetProfile.is_staff || targetProfile.is_admin) {
        throw new Error('Ledger repair is only available for customer accounts');
      }

      const repairReference = `ADMIN-LEDGER-REPAIR-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const repairPayload: Record<string, unknown> = {
        user_id: targetUserId,
        type: 'admin_credit',
        amount,
        status: 'completed',
        balance_after: Number(targetProfile.wallet_balance || 0),
        description: `Admin ledger repair by ${user.email}: ${cleanLedgerReason}`,
        reference: repairReference,
      };
      if (hasTransactionIdempotencyKey) repairPayload.idempotency_key = body.idempotency_key || null;

      const { data: repairTx, error: repairError } = await supabaseAdmin
        .from('transactions')
        .insert(repairPayload)
        .select('*')
        .single();

      if (repairError || !repairTx) {
        throw new Error(`Could not record ledger repair: ${repairError?.message || 'unknown error'}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          target_user_id: targetUserId,
          target_email: targetProfile.email,
          amount,
          balance_unchanged: true,
          current_balance: Number(targetProfile.wallet_balance || 0),
          transaction: repairTx,
          recorded_by: user.email,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body?.action === 'suspend_user' || body?.action === 'unsuspend_user') {
      const targetUserId = String(body.target_user_id || '').trim();
      if (!targetUserId) {
        throw new Error('target_user_id is required');
      }
      const isSuspending = body.action === 'suspend_user';
      const cleanSuspendReason = String(body.reason || '').trim();
      if (isSuspending && cleanSuspendReason.length < 3) {
        throw new Error('A suspension reason with at least 3 characters is required');
      }

      const { data: targetProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, email, is_staff, is_admin, account_suspended')
        .eq('id', targetUserId)
        .single();

      if (profileError || !targetProfile) {
        throw new Error('Target user not found');
      }

      if (targetProfile.is_staff || targetProfile.is_admin) {
        throw new Error('Suspension controls are only available for customer accounts');
      }

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(isSuspending
          ? {
              account_suspended: true,
              suspension_reason: cleanSuspendReason,
              suspended_at: new Date().toISOString(),
              suspended_by: user.id,
              suspension_reinstated_at: null,
              reinstated_by: null,
              updated_at: new Date().toISOString(),
            }
          : {
              account_suspended: false,
              suspension_reason: null,
              suspension_reinstated_at: new Date().toISOString(),
              reinstated_by: user.id,
              updated_at: new Date().toISOString(),
            })
        .eq('id', targetUserId);

      if (updateError) {
        throw new Error(`Failed to ${isSuspending ? 'suspend' : 'unsuspend'} account: ${updateError.message}`);
      }

      const banResult = isSuspending
        ? await upsertFraudDeviceBans(supabaseAdmin, targetUserId, user.id, cleanSuspendReason)
        : { ipBans: 0, deviceBans: 0 };

      if (!isSuspending) {
        const { error: banUpdateError } = await supabaseAdmin
          .from('fraud_device_bans')
          .update({
            active: false,
            deactivated_at: new Date().toISOString(),
            deactivated_by: user.id,
          })
          .eq('banned_user_id', targetUserId)
          .eq('active', true);

        if (banUpdateError) {
          console.warn(`Could not deactivate fraud bans for ${targetProfile.email}: ${banUpdateError.message}`);
        }
      }

      console.log(`✅ Admin ${user.email} ${isSuspending ? 'suspended' : 'unsuspended'} ${targetProfile.email}`);

      return new Response(
        JSON.stringify({
          success: true,
          target_user_id: targetUserId,
          target_email: targetProfile.email,
          account_suspended: isSuspending,
          suspension_reason: isSuspending ? cleanSuspendReason : null,
          ip_bans_created: banResult.ipBans,
          device_bans_created: banResult.deviceBans,
          [isSuspending ? 'suspended_by' : 'reinstated_by']: user.email,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      target_user_id, 
      adjustment_amount, 
      balance_type, 
      reason,
      idempotency_key 
    } = body;
    const cleanReason = String(reason || '').trim();

    // Validate inputs
    if (!target_user_id || typeof target_user_id !== 'string') {
      throw new Error('target_user_id is required');
    }

    if (typeof adjustment_amount !== 'number' || adjustment_amount === 0) {
      throw new Error('Valid adjustment_amount is required (positive to add, negative to subtract)');
    }

    if (!['wallet', 'crypto'].includes(balance_type)) {
      throw new Error('balance_type must be "wallet" or "crypto"');
    }

    if (cleanReason.length < 3) {
      throw new Error('A reason with at least 3 characters is required');
    }

    console.log(`🔧 Admin ${user.email} adjusting balance for user ${target_user_id}`);
    console.log(`   Amount: ${adjustment_amount > 0 ? '+' : ''}₦${adjustment_amount}, Type: ${balance_type}`);
    console.log(`   Reason: ${cleanReason}`);

    // Check idempotency (prevent duplicate adjustments)
    if (idempotency_key && hasTransactionIdempotencyKey) {
      const { data: existingTx } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('idempotency_key', idempotency_key)
        .single();

      if (existingTx) {
        console.log('Duplicate balance adjustment prevented.');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This adjustment has already been processed',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }
    }

    // Get target user's current balance
    const balanceColumn = balance_type === 'wallet' ? 'wallet_balance' : 'crypto_balance';
    
    const { data: targetProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select(`id, email, is_staff, is_admin, ${balanceColumn}`)
      .eq('id', target_user_id)
      .single();

    if (profileError || !targetProfile) {
      throw new Error('Target user not found');
    }

    if (targetProfile.is_staff || targetProfile.is_admin) {
      throw new Error('Balance adjustments are only allowed for customer accounts');
    }

    const currentBalance = targetProfile[balanceColumn] || 0;
    const newBalance = currentBalance + adjustment_amount;

    // Prevent negative balance
    if (newBalance < 0) {
      throw new Error(`Cannot reduce ${balance_type} balance below zero. Current: ₦${currentBalance}, Adjustment: ₦${adjustment_amount}`);
    }

    // Record a pending transaction before changing the balance. If this fails,
    // the wallet must not move because the fraud ledger would lose authority.
    const transactionType = adjustment_amount > 0 ? 'admin_credit' : 'admin_debit';
    const adjustmentReference = `ADMIN-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const adjustmentPayload: Record<string, unknown> = {
      user_id: target_user_id,
      type: transactionType,
      amount: Math.abs(adjustment_amount),
      status: 'pending',
      balance_after: currentBalance,
      description: `Admin adjustment by ${user.email}: ${cleanReason}`,
      reference: adjustmentReference,
    };
    if (hasTransactionIdempotencyKey) adjustmentPayload.idempotency_key = idempotency_key || null;

    const { data: transactionRow, error: txInsertError } = await supabaseAdmin
      .from('transactions')
      .insert(adjustmentPayload)
      .select('id')
      .single();

    if (txInsertError || !transactionRow) {
      throw new Error(`Could not create balance adjustment ledger entry: ${txInsertError?.message || 'unknown error'}`);
    }

    // Update balance with optimistic locking
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        [balanceColumn]: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', target_user_id)
      .eq(balanceColumn, currentBalance) // Optimistic lock
      .select()
      .single();

    if (updateError || !updatedProfile) {
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed', description: `Failed admin adjustment by ${user.email}: ${cleanReason}` })
        .eq('id', transactionRow.id);
      throw new Error('Balance update failed - concurrent modification detected. Please try again.');
    }

    const { error: txCompleteError } = await supabaseAdmin
      .from('transactions')
      .update({
        status: 'completed',
        balance_after: newBalance,
      })
      .eq('id', transactionRow.id);

    if (txCompleteError) {
      console.error('❌ Failed to complete transaction after balance update:', txCompleteError);
      await supabaseAdmin
        .from('profiles')
        .update({
          [balanceColumn]: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target_user_id)
        .eq(balanceColumn, newBalance);
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed', description: `Rolled back admin adjustment by ${user.email}: ${cleanReason}` })
        .eq('id', transactionRow.id);
      throw new Error(`Balance adjustment rolled back because the ledger could not be completed: ${txCompleteError.message}`);
    }

    console.log(`✅ Balance adjusted: ${balance_type} ${adjustment_amount > 0 ? '+' : ''}₦${adjustment_amount}`);
    console.log(`   User: ${targetProfile.email}, New balance: ₦${newBalance}`);

    return new Response(
      JSON.stringify({
        success: true,
        target_user_id,
        target_email: targetProfile.email,
        balance_type,
        previous_balance: currentBalance,
        adjustment: adjustment_amount,
        new_balance: newBalance,
        reason: cleanReason,
        adjusted_by: user.email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Admin adjust balance error:', error);

    const message = error instanceof Error ? error.message : 'Failed to adjust balance';
    const status = message.includes('Unauthorized') || message.includes('Admin access') ? 403 : 400;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
    );
  }
});
