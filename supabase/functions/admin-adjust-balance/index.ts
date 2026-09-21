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

function cleanDeviceText(value: unknown, max = 500) {
  return Array.from(String(value || '')).filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, max)
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

function getTransactionMetadata(row: any) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
}

function isBalanceNeutralAdminRepair(row: any) {
  const metadata = getTransactionMetadata(row)
  const balanceBefore = Number(row?.balance_before || 0)
  const balanceAfter = Number(row?.balance_after || 0)
  return (
    String(metadata.source || '') === 'admin-ledger-repair' ||
    String(metadata.balance_unchanged || '').toLowerCase() === 'true' ||
    String(metadata.requires_owner_evidence || '').toLowerCase() === 'true' ||
    balanceAfter <= balanceBefore
  )
}

const WALLET_FUNDING_ENFORCEMENT_CUTOFF = '2026-09-19T00:00:00.000Z'

function isLegacyGrandfatheredCredit(row: any) {
  const createdAt = new Date(row?.created_at || '').getTime()
  const amount = Number(row?.amount || 0)
  const type = String(row?.type || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (!Number.isFinite(createdAt) || createdAt >= Date.parse(WALLET_FUNDING_ENFORCEMENT_CUTOFF) || amount <= 0) {
    return false
  }
  if (type === 'admin_credit' && isBalanceNeutralAdminRepair(row)) return false

  return [
    'topup',
    'top_up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
    'credit',
    'admin_credit',
    'staff_credit',
    'promotion_credit',
    'correction_credit',
  ].includes(type)
}

function isWalletDebitType(type: string) {
  return [
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'withdrawal',
    'chargeback',
    'correction_debit',
  ].includes(type)
}

function getTrustedPrincipalDebitAmount(row: any, metadata: any) {
  if (String(metadata.trusted_principal_authorized || '').toLowerCase() !== 'true') return 0
  const trustedAmount = Number(metadata.trusted_principal_debit_amount || 0)
  if (!Number.isFinite(trustedAmount) || trustedAmount <= 0) return 0
  return Math.min(Math.abs(Number(row.amount || 0)), trustedAmount)
}

function getWalletDebitEvidence(row: any) {
  const type = String(row.type || '').toLowerCase()
  if (!isWalletDebitType(type)) return null

  const metadata = getTransactionMetadata(row)
  const trustedDebitAmount = getTrustedPrincipalDebitAmount(row, metadata)
  if (trustedDebitAmount <= 0) return null

  const debitId = String(row.id || row.transaction_id || row.idempotency_key || '').trim()
  if (!debitId) return null

  return {
    id: debitId,
    amount: trustedDebitAmount,
    idempotencyKey: String(row.idempotency_key || '').trim(),
    reference: String(row.reference || '').trim(),
    sourceOrderTable: String(metadata.source_order_table || '').trim(),
    sourceOrderIds: [
      metadata.source_order_id,
      metadata.order_id,
      metadata.transaction_id,
    ].map((value) => String(value || '').trim()).filter(Boolean),
  }
}

function hasApprovedAdminCreditEvidence(row: any, metadata: any) {
  const createdBy = String(row.created_by || '').trim()
  return Boolean(createdBy)
    && String(metadata.approved_by || '').trim() === createdBy
    && String(metadata.approval_reference || '').trim().length >= 8
    && String(metadata.reason || '').trim().length >= 3
}

function findLinkedTrustedDebit(refund: any, trustedDebits: Map<string, NonNullable<ReturnType<typeof getWalletDebitEvidence>>>) {
  const metadata = getTransactionMetadata(refund)
  const directId = String(metadata.source_debit_transaction_id || '').trim()
  if (directId && trustedDebits.has(directId)) return trustedDebits.get(directId) || null

  const sourceKey = String(metadata.source_debit_idempotency_key || metadata.original_purchase_idempotency_key || '').trim()
  if (sourceKey) {
    return Array.from(trustedDebits.values()).find((debit) => debit.idempotencyKey && debit.idempotencyKey === sourceKey) || null
  }

  const sourceOrderId = String(metadata.source_order_id || metadata.order_id || metadata.transaction_id || '').trim()
  const sourceOrderTable = String(metadata.source_order_table || '').trim()
  if (sourceOrderId) {
    return Array.from(trustedDebits.values()).find((debit) => {
      if (sourceOrderTable && debit.sourceOrderTable && debit.sourceOrderTable !== sourceOrderTable) return false
      return debit.sourceOrderIds.includes(sourceOrderId)
    }) || null
  }

  const originalReference = String(metadata.original_reference || '').trim()
  if (originalReference) {
    return Array.from(trustedDebits.values()).find((debit) => debit.reference && debit.reference === originalReference) || null
  }

  return null
}

async function calculateWalletBacking(supabaseAdmin: any, userId: string) {
  const hasTransactionIdempotencyKey = await transactionsHaveIdempotencyKey(supabaseAdmin)
  const transactionSelect = hasTransactionIdempotencyKey
    ? 'id, user_id, type, amount, status, balance_type, reference, metadata, created_by, external_payment_id, balance_before, balance_after, idempotency_key'
    : 'id, user_id, type, amount, status, balance_type, reference, metadata, created_by, external_payment_id, balance_before, balance_after'
  const [
    { data: rows, error },
    { data: pendingPayments, error: pendingError },
    { data: pocketfiWebhookLogs, error: pocketfiLogError },
  ] = await Promise.all([
    supabaseAdmin
      .from('transactions')
      .select(transactionSelect)
      .eq('user_id', userId)
      .or('balance_type.eq.wallet,balance_type.is.null'),
    supabaseAdmin
      .from('pending_payments')
      .select('user_id, transaction_reference, ercas_reference, amount, status')
      .eq('user_id', userId),
    supabaseAdmin
      .from('pocketfi_webhook_logs')
      .select('id, matched_user_id, processed, verified_amount_ngn, verified_reference')
      .eq('matched_user_id', userId),
  ])

  if (error) {
    throw new Error(`Could not calculate wallet backing: ${error.message}`)
  }
  if (pendingError && !['42P01', '42703', 'PGRST204', 'PGRST200'].includes(pendingError.code || '')) {
    throw new Error(`Could not load pending payment evidence: ${pendingError.message}`)
  }
  if (pocketfiLogError && !['42P01', '42703', 'PGRST204', 'PGRST200'].includes(pocketfiLogError.code || '')) {
    throw new Error(`Could not load PocketFi webhook evidence: ${pocketfiLogError.message}`)
  }

  let trustedCredits = 0
  let previousCompletedDebits = 0
  let completedRefunds = 0
  let linkedEligibleRefunds = 0
  const trustedDebits = new Map<string, NonNullable<ReturnType<typeof getWalletDebitEvidence>>>()
  const completedRefundRows: any[] = []
  const approvingActorIds = Array.from(new Set(
    (rows || [])
      .filter((row: any) => String(row.type || '').toLowerCase() === 'admin_credit' && row.created_by)
      .map((row: any) => String(row.created_by))
  ))
  let adminActorIds = new Set<string>()
  if (approvingActorIds.length) {
    const { data: adminActors, error: adminActorError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('id', approvingActorIds)
      .eq('is_admin', true)

    if (adminActorError) {
      throw new Error(`Could not verify admin credit actors: ${adminActorError.message}`)
    }
    adminActorIds = new Set((adminActors || []).map((row: any) => String(row.id)))
  }

  for (const row of rows || []) {
    const status = String(row.status || 'completed').toLowerCase()
    if (status !== 'completed') continue

    const type = String(row.type || '').toLowerCase()
    const amount = Number(row.amount || 0)
    const balanceBefore = Number(row.balance_before || 0)
    const balanceAfter = Number(row.balance_after || 0)
    const metadata = getTransactionMetadata(row)
    const isBalanceNeutralAdminRepair = (
      String(metadata.source || '') === 'admin-ledger-repair' ||
      String(metadata.balance_unchanged || '').toLowerCase() === 'true' ||
      String(metadata.requires_owner_evidence || '').toLowerCase() === 'true' ||
      balanceAfter <= balanceBefore
    )
    if (amount > 0) {
      if (
        (
          [
            'topup',
            'top_up',
            'top-up',
            'wallet_topup',
            'wallet_deposit',
            'deposit',
          ].includes(type) &&
          isVerifiedGatewayCredit(row, pendingPayments || [], pocketfiWebhookLogs || [])
        ) ||
        isLegacyGrandfatheredCredit(row)
      ) {
        trustedCredits += amount
      } else if (
        type === 'admin_credit'
        && adminActorIds.has(String(row.created_by || ''))
        && hasApprovedAdminCreditEvidence(row, metadata)
        && !isBalanceNeutralAdminRepair
      ) {
        trustedCredits += amount
      } else if (['refund', 'purchase_refund', 'auto_refund'].includes(type)) {
        completedRefunds += amount
        completedRefundRows.push(row)
      }
    }

    if (isWalletDebitType(type)) {
      previousCompletedDebits += Math.abs(amount)
      const trustedDebit = getWalletDebitEvidence(row)
      if (trustedDebit) trustedDebits.set(trustedDebit.id, trustedDebit)
    }
  }

  const trustedDebitCapacity = Math.min(previousCompletedDebits, trustedCredits)
  const refundedByOriginal = new Map<string, number>()
  for (const refund of completedRefundRows) {
    const original = findLinkedTrustedDebit(refund, trustedDebits)
    if (!original) continue

    const alreadyRefunded = refundedByOriginal.get(original.id) || 0
    const refundableRemaining = Math.max(original.amount - alreadyRefunded, 0)
    const eligibleAmount = Math.min(Number(refund.amount || 0), refundableRemaining)
    refundedByOriginal.set(original.id, alreadyRefunded + eligibleAmount)
  }
  linkedEligibleRefunds = Array.from(refundedByOriginal.values()).reduce((sum, amount) => sum + amount, 0)
  const eligibleRefunds = Math.min(linkedEligibleRefunds, trustedDebitCapacity)
  const trustedConsumedSpend = Math.max(trustedDebitCapacity - eligibleRefunds, 0)
  const backedAvailable = Math.max(trustedCredits - trustedConsumedSpend, 0)

  return {
    trustedCredits,
    previousCompletedDebits,
    completedRefunds,
    linkedEligibleRefunds,
    eligibleRefunds,
    trustedConsumedSpend,
    backedAvailable,
  }
}

function toCents(value: unknown) {
  return Math.round(Number(value || 0) * 100)
}

function isVerifiedGatewayCredit(row: any, pendingPayments: any[], pocketfiWebhookLogs: any[]) {
  const amount = Number(row.amount || 0)
  const externalPaymentId = String(row.external_payment_id || '').trim()
  const reference = String(row.reference || '').trim()
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const provider = String(metadata.provider || '').toLowerCase()
  const verifiedAmount = Number(metadata.verified_amount_ngn || 0)

  if (!externalPaymentId || amount <= 0 || toCents(verifiedAmount) !== toCents(amount)) return false

  if (['ercaspay', 'ercas'].includes(provider)) {
    const localRefs = [reference, externalPaymentId].filter(Boolean)
    return pendingPayments.some((payment: any) => {
      const paymentRefs = [
        String(payment.transaction_reference || '').trim(),
        String(payment.ercas_reference || '').trim(),
      ].filter(Boolean)
      return String(payment.user_id || '') === String(row.user_id || '') &&
        String(payment.status || 'pending').toLowerCase() === 'credited' &&
        toCents(payment.amount) === toCents(amount) &&
        localRefs.some((localRef) => paymentRefs.includes(localRef))
    })
  }

  if (provider === 'pocketfi') {
    const webhookLogId = String(metadata.webhook_log_id || '').trim()
    return Boolean(webhookLogId) && pocketfiWebhookLogs.some((log: any) =>
      String(log.id || '') === webhookLogId &&
      String(log.matched_user_id || '') === String(row.user_id || '') &&
      Boolean(log.processed) === true &&
      toCents(log.verified_amount_ngn) === toCents(amount) &&
      [reference, externalPaymentId].filter(Boolean).includes(String(log.verified_reference || '').trim())
    )
  }

  return false
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
        .select('id, email, wallet_balance, is_staff, is_admin, account_suspended')
        .eq('id', targetUserId)
        .single();

      if (profileError || !targetProfile) {
        throw new Error('Target user not found');
      }

      if (targetProfile.is_staff || targetProfile.is_admin) {
        throw new Error('Suspension controls are only available for customer accounts');
      }

      let unsuspendReview: Awaited<ReturnType<typeof calculateWalletBacking>> | null = null;
      if (!isSuspending) {
        unsuspendReview = await calculateWalletBacking(supabaseAdmin, targetUserId);
        const storedWalletBalance = Number(targetProfile.wallet_balance || 0);
        const tolerance = 1;

        if (unsuspendReview.backedAvailable < -tolerance || storedWalletBalance > unsuspendReview.backedAvailable + tolerance) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Wallet review is still required before unsuspending this account.',
              code: 'WALLET_REVIEW_REQUIRED',
              target_user_id: targetUserId,
              target_email: targetProfile.email,
              wallet_balance: storedWalletBalance,
              backed_available: unsuspendReview.backedAvailable,
              trusted_credits: unsuspendReview.trustedCredits,
              previous_completed_debits: unsuspendReview.previousCompletedDebits,
              completed_refunds: unsuspendReview.completedRefunds,
              linked_eligible_refunds: unsuspendReview.linkedEligibleRefunds,
              eligible_refunds: unsuspendReview.eligibleRefunds,
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
