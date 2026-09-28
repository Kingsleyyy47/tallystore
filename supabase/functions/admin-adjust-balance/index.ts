import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


async function applyWalletTransaction(
  supabaseAdmin: any,
  params: {
    userId: string
    type: string
    amount: number
    reference?: string
    description?: string
    idempotencyKey?: string
    metadata?: Record<string, unknown>
    balanceType?: 'wallet' | 'crypto' | 'referral'
    createdBy?: string
  },
) {
  const { data, error } = await supabaseAdmin.rpc('apply_wallet_transaction', {
    p_user_id: params.userId,
    p_type: params.type,
    p_amount: params.amount,
    p_reference: params.reference || null,
    p_description: params.description || null,
    p_idempotency_key: params.idempotencyKey || null,
    p_metadata: params.metadata || {},
    p_currency: 'NGN',
    p_balance_type: params.balanceType || 'wallet',
    p_external_payment_id: null,
    p_created_by: params.createdBy || null,
  })

  if (error) throw new Error(error.message || 'Wallet transaction failed')

  const result = data as any
  if (!result?.success) throw new Error(result?.error || 'Wallet transaction failed')

  return result
}

async function transactionsHaveIdempotencyKey(supabaseAdmin: any) {
  const { error } = await supabaseAdmin
    .from('transactions')
    .select('idempotency_key')
    .limit(1)

  return !(error && /idempotency_key/i.test(error.message || ''))
}

type WalletFinancialTruth = {
  user_id: string
  account_suspended: boolean
  wallet_review_required: boolean
  wallet_review_reason: string | null
  spending_blocked: boolean
  evidence_complete: boolean
  integrity_status: string
  stored_wallet_balance: number
  trusted_book_balance: number
  confirmed_spendable: number
  quarantined_excess: number
  spend_exposure: number
}

function requiredTruthAmount(value: unknown, field: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
    value === '' || !Number.isFinite(Number(value))) {
    throw new Error(`Wallet financial truth is missing ${field}`)
  }
  return Number(value)
}

async function loadWalletFinancialTruth(supabaseAdmin: any, userId: string): Promise<WalletFinancialTruth> {
  const { data, error } = await supabaseAdmin.rpc('wallet_financial_truth_internal', {
    p_user_id: userId,
  })
  if (error) throw new Error(`Wallet financial truth unavailable: ${error.message}`)
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
    data.user_id !== userId ||
    typeof data.account_suspended !== 'boolean' ||
    typeof data.wallet_review_required !== 'boolean' ||
    (data.wallet_review_reason !== null && typeof data.wallet_review_reason !== 'string') ||
    typeof data.spending_blocked !== 'boolean' ||
    typeof data.evidence_complete !== 'boolean' ||
    typeof data.integrity_status !== 'string') {
    throw new Error('Wallet financial truth is incomplete')
  }

  return {
    user_id: data.user_id,
    account_suspended: data.account_suspended,
    wallet_review_required: data.wallet_review_required,
    wallet_review_reason: data.wallet_review_reason,
    spending_blocked: data.spending_blocked,
    evidence_complete: data.evidence_complete,
    integrity_status: data.integrity_status,
    stored_wallet_balance: requiredTruthAmount(data.stored_wallet_balance, 'stored_wallet_balance'),
    trusted_book_balance: requiredTruthAmount(data.trusted_book_balance, 'trusted_book_balance'),
    confirmed_spendable: requiredTruthAmount(data.confirmed_spendable, 'confirmed_spendable'),
    quarantined_excess: requiredTruthAmount(data.quarantined_excess, 'quarantined_excess'),
    spend_exposure: requiredTruthAmount(data.spend_exposure, 'spend_exposure'),
  }
}

function isAutomaticExcessReview(truth: WalletFinancialTruth, profile: any): boolean {
  if (!truth.wallet_review_required || truth.integrity_status !== 'quarantined_excess' ||
    truth.quarantined_excess <= 0 || profile.wallet_reviewed_by != null) return false

  const reason = truth.wallet_review_reason || ''
  return reason.startsWith('Auto-suspended: displayed wallet balance ') ||
    (reason.startsWith('Wallet frozen: requested purchase ') &&
      reason.includes(' exceeds backed available funds ')) ||
    reason.startsWith('Wallet financial review: quarantined displayed excess ')
}

function unsuspendBlockReason(truth: WalletFinancialTruth, profile: any): string | null {
  if (!truth.evidence_complete) return 'EVIDENCE_INCOMPLETE'
  if (!['consistent', 'quarantined_excess'].includes(truth.integrity_status) ||
    truth.trusted_book_balance < 0 || truth.spend_exposure > 0) {
    return 'SEVERE_INTEGRITY_REVIEW'
  }
  if (truth.wallet_review_required && !isAutomaticExcessReview(truth, profile)) {
    return 'WALLET_REVIEW_HOLD'
  }
  // Suspension itself sets spending_blocked; check for independent blockers.
  if (!truth.account_suspended && truth.spending_blocked) return 'SPENDING_BLOCKED'
  if (truth.account_suspended && !truth.spending_blocked) return 'FINANCIAL_STATE_INCONSISTENT'
  return null
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

    const ownerUserId = Deno.env.get('TALLYSTORE_OWNER_USER_ID')?.trim();
    if (!ownerUserId || user.id !== ownerUserId) {
      console.error('Owner-only wallet adjustment denied');
      throw new Error('Admin access required');
    }

    // Initialize admin client (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify admin status in database
    const { data: adminProfile, error: adminProfileError } = await supabaseAdmin
      .from('profiles')
      .select('is_admin, account_suspended')
      .eq('id', user.id)
      .single();

    if (adminProfileError || adminProfile?.is_admin !== true || adminProfile.account_suspended === true) {
      console.error('Owner wallet adjustment denied: current admin role unavailable');
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
        balance_before: Number(targetProfile.wallet_balance || 0),
        balance_after: Number(targetProfile.wallet_balance || 0),
        description: `Admin ledger repair by ${user.email}: ${cleanLedgerReason}`,
        reference: repairReference,
        created_by: user.id,
        metadata: {
          source: 'admin-ledger-repair',
          admin_email: user.email,
          reason: cleanLedgerReason,
          balance_unchanged: true,
          requires_owner_evidence: true,
        },
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
        .select('id, email, wallet_balance, is_staff, is_admin, account_suspended, wallet_review_required, wallet_review_reason, wallet_reviewed_by')
        .eq('id', targetUserId)
        .single();

      if (profileError || !targetProfile) {
        throw new Error('Target user not found');
      }

      if (targetProfile.is_staff || targetProfile.is_admin) {
        throw new Error('Suspension controls are only available for customer accounts');
      }

      let unsuspendReview: WalletFinancialTruth | null = null;
      if (!isSuspending) {
        unsuspendReview = await loadWalletFinancialTruth(supabaseAdmin, targetUserId);
        if (unsuspendReview.account_suspended !== Boolean(targetProfile.account_suspended) ||
          unsuspendReview.wallet_review_required !== Boolean(targetProfile.wallet_review_required) ||
          unsuspendReview.wallet_review_reason !== (targetProfile.wallet_review_reason ?? null) ||
          unsuspendReview.stored_wallet_balance !== Number(targetProfile.wallet_balance || 0)) {
          throw new Error('Wallet financial truth changed during admin review');
        }

        const blockReason = unsuspendBlockReason(unsuspendReview, targetProfile);
        if (blockReason) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Wallet review is still required before unsuspending this account.',
              code: 'WALLET_REVIEW_REQUIRED',
              review_reason_code: blockReason,
              target_user_id: targetUserId,
              target_email: targetProfile.email,
              wallet_balance: unsuspendReview.stored_wallet_balance,
              confirmed_spendable: unsuspendReview.confirmed_spendable,
              trusted_book_balance: unsuspendReview.trusted_book_balance,
              quarantined_excess: unsuspendReview.quarantined_excess,
              integrity_status: unsuspendReview.integrity_status,
              evidence_complete: unsuspendReview.evidence_complete,
              spending_blocked: unsuspendReview.spending_blocked,
              wallet_review_required: unsuspendReview.wallet_review_required,
            }),
            {
              status: 409,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }
      }

      const { error: updateError } = await supabaseAdmin.rpc('set_customer_suspension_state', {
        p_user_id: targetUserId,
        p_suspended: isSuspending,
        p_reason: isSuspending ? cleanSuspendReason : null,
        p_actor_id: user.id,
      });

      if (updateError) {
        throw new Error(`Failed to ${isSuspending ? 'suspend' : 'unsuspend'} account: ${updateError.message}`);
      }

      // Visits use client-controllable headers. Do not turn them into shared
      // IP/device bans when suspending an account.
      const banResult = { ipBans: 0, deviceBans: 0 };

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
          wallet_review: unsuspendReview,
          ip_bans_created: banResult.ipBans,
          device_bans_created: banResult.deviceBans,
          [isSuspending ? 'suspended_by' : 'reinstated_by']: user.email,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body?.action === 'record_chargeback') {
      const targetUserId = String(body.target_user_id || '').trim();
      const amount = Number(body.amount);
      const cleanChargebackReason = String(body.reason || '').trim();
      const externalPaymentId = String(body.external_payment_id || body.payment_reference || '').trim();
      const chargebackReference = String(body.reference || externalPaymentId || '').trim();
      const idempotencyKey = String(body.idempotency_key || `chargeback:${targetUserId}:${chargebackReference}`).trim();

      if (!targetUserId) throw new Error('target_user_id is required');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('A positive chargeback amount is required');
      if (cleanChargebackReason.length < 3) throw new Error('A chargeback reason with at least 3 characters is required');
      if (chargebackReference.length < 3) throw new Error('A chargeback reference with at least 3 characters is required');

      const { data: targetProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, email, wallet_balance, is_staff, is_admin')
        .eq('id', targetUserId)
        .single();

      if (profileError || !targetProfile) {
        throw new Error('Target user not found');
      }

      if (targetProfile.is_staff || targetProfile.is_admin) {
        throw new Error('Chargebacks can only be recorded against customer accounts');
      }

      if (idempotencyKey && hasTransactionIdempotencyKey) {
        const { data: existingTx } = await supabaseAdmin
          .from('transactions')
          .select('id, balance_after')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingTx) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'This chargeback has already been recorded',
              code: 'CHARGEBACK_ALREADY_RECORDED',
              transaction_id: existingTx.id,
              balance_after: existingTx.balance_after,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
          );
        }
      }

      const reviewReason = `Wallet review required: chargeback recorded by ${user.email}. ${cleanChargebackReason}`;
      const { error: preSuspendError } = await supabaseAdmin.rpc('set_customer_suspension_state', {
        p_user_id: targetUserId,
        p_suspended: true,
        p_reason: reviewReason,
        p_actor_id: user.id,
      });

      if (preSuspendError) {
        throw new Error(`Could not place account into chargeback review before posting debit: ${preSuspendError.message}`);
      }

      const chargebackResult = await applyWalletTransaction(supabaseAdmin, {
        userId: targetUserId,
        type: 'chargeback',
        amount,
        reference: chargebackReference,
        description: `Chargeback recorded by ${user.email}: ${cleanChargebackReason}`,
        idempotencyKey: hasTransactionIdempotencyKey ? idempotencyKey : undefined,
        balanceType: 'wallet',
        createdBy: user.id,
        metadata: {
          source: 'admin-record-chargeback',
          admin_email: user.email,
          reason: cleanChargebackReason,
          external_payment_id: externalPaymentId || null,
          requires_owner_evidence: true,
        },
      });

      const { error: suspendError } = await supabaseAdmin.rpc('set_customer_suspension_state', {
        p_user_id: targetUserId,
        p_suspended: true,
        p_reason: reviewReason,
        p_actor_id: user.id,
      });

      if (suspendError) {
        throw new Error(`Chargeback was recorded but account review state could not be set: ${suspendError.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          target_user_id: targetUserId,
          target_email: targetProfile.email,
          previous_balance: Number(targetProfile.wallet_balance || 0),
          chargeback_amount: amount,
          new_balance: Number(chargebackResult.balance_after ?? Number(targetProfile.wallet_balance || 0) - amount),
          transaction: chargebackResult.transaction || chargebackResult,
          account_suspended: true,
          recorded_by: user.email,
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

    const currentBalance = Number((targetProfile as Record<string, unknown>)[balanceColumn] || 0);
    const newBalance = currentBalance + adjustment_amount;

    // Prevent negative balance
    if (newBalance < 0) {
      throw new Error(`Cannot reduce ${balance_type} balance below zero. Current: ₦${currentBalance}, Adjustment: ₦${adjustment_amount}`);
    }

    const transactionType = adjustment_amount > 0 ? 'admin_credit' : 'admin_debit';
    const adjustmentReference = `ADMIN-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const adjustmentResult = await applyWalletTransaction(supabaseAdmin, {
      userId: target_user_id,
      type: transactionType,
      amount: Math.abs(adjustment_amount),
      reference: adjustmentReference,
      description: `Admin adjustment by ${user.email}: ${cleanReason}`,
      idempotencyKey: hasTransactionIdempotencyKey ? idempotency_key || undefined : undefined,
      balanceType: balance_type,
      createdBy: user.id,
      metadata: {
        source: 'admin-adjust-balance',
        approved_by: user.id,
        approval_type: 'direct_admin_adjustment',
        approval_reference: idempotency_key || adjustmentReference,
        admin_email: user.email,
        reason: cleanReason,
        requested_adjustment_amount: adjustment_amount,
      },
    })

    const committedNewBalance = Number(adjustmentResult.balance_after ?? newBalance);

    console.log(`✅ Balance adjusted: ${balance_type} ${adjustment_amount > 0 ? '+' : ''}₦${adjustment_amount}`);
    console.log(`   User: ${targetProfile.email}, New balance: ₦${committedNewBalance}`);

    return new Response(
      JSON.stringify({
        success: true,
        target_user_id,
        target_email: targetProfile.email,
        balance_type,
        previous_balance: currentBalance,
        adjustment: adjustment_amount,
        new_balance: committedNewBalance,
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
