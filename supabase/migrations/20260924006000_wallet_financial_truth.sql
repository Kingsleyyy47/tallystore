-- One full-history wallet calculation for internal authorization and admin review.
-- This is read-only. Missing payment-evidence objects raise an error, never a
-- synthetic zero-deposit result. Purchase callers must hold the profile lock.
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.transactions') IS NULL
    OR to_regclass('public.wallet_legacy_funding') IS NULL
    OR to_regclass('public.pending_payments') IS NULL
    OR to_regclass('public.pocketfi_webhook_logs') IS NULL
    OR to_regclass('public.wallet_reservations') IS NULL
  THEN
    RAISE EXCEPTION 'wallet_financial_truth_required_evidence_object_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_truth jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_user_required';
  END IF;

  WITH profile AS (
    SELECT p.id, COALESCE(p.wallet_balance, 0)::numeric AS stored_balance,
      COALESCE(p.account_suspended, false) AS account_suspended,
      COALESCE(p.wallet_review_required, false) AS wallet_review_required,
      p.wallet_review_reason, p.wallet_reviewed_by,
      GREATEST(COALESCE(p.financial_security_version, 1), 1) AS security_version
    FROM public.profiles p
    WHERE p.id = p_user_id
  ),
  legacy AS (
    SELECT COALESCE(MAX(f.grandfathered_principal), 0)::numeric AS principal,
      COUNT(f.user_id)::integer AS baseline_rows
    FROM public.wallet_legacy_funding f
    WHERE f.user_id = p_user_id
  ),
  ledger AS (
    SELECT t.*,
      lower(COALESCE(t.type, '')) AS movement_type,
      lower(COALESCE(t.status, 'completed')) AS movement_status
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
  ),
  posted AS (
    SELECT t.*
    FROM ledger t
    WHERE t.movement_status IN
      ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      OR (
        t.amount < 0
        AND t.balance_before IS NOT NULL
        AND t.balance_after IS NOT NULL
        AND round(t.balance_before - t.balance_after, 2) = round(abs(t.amount), 2)
      )
  ),
  classified AS (
    SELECT t.*,
      t.amount < 0 AS is_debit,
      t.amount > 0 AND
        t.movement_type IN ('refund', 'purchase_refund', 'auto_refund') AS is_refund,
      t.amount > 0 AND
        t.movement_type NOT IN ('refund', 'purchase_refund', 'auto_refund') AS is_credit,
      (
        t.amount > 0 AND t.movement_type IN
          ('purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal',
           'chargeback', 'correction_debit')
      ) OR (
        t.amount < 0 AND t.movement_type IN
          ('refund', 'purchase_refund', 'auto_refund')
      ) AS sign_conflict,
      t.movement_type IN
        ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
        AS is_gateway_type
    FROM posted t
  ),
  funding_rows AS (
    SELECT t.*,
      (
        t.is_gateway_type
        AND t.amount > 0
        AND t.created_at >= public.wallet_legacy_funding_cutoff()
        AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
        AND CASE
          WHEN COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
          THEN round((t.metadata->>'verified_amount_ngn')::numeric, 2) = round(t.amount, 2)
          ELSE false
        END
        AND (
          (
            lower(COALESCE(t.metadata->>'provider', '')) IN ('ercaspay', 'ercas')
            AND EXISTS (
              SELECT 1 FROM public.pending_payments pp
              WHERE pp.user_id = t.user_id
                AND round(pp.amount, 2) = round(t.amount, 2)
                AND lower(COALESCE(pp.status, 'pending')) = 'credited'
                AND (
                  pp.transaction_reference = NULLIF(btrim(COALESCE(t.reference, '')), '')
                  OR pp.transaction_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                  OR pp.ercas_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
            AND COALESCE(t.metadata->>'webhook_log_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.pocketfi_webhook_logs pwl
              WHERE pwl.id = CASE
                  WHEN COALESCE(t.metadata->>'webhook_log_id', '') ~*
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (t.metadata->>'webhook_log_id')::uuid
                  ELSE NULL
                END
                AND pwl.matched_user_id = t.user_id
                AND COALESCE(pwl.processed, false)
                AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
                AND NULLIF(btrim(COALESCE(pwl.verified_reference, '')), '') IN (
                  NULLIF(btrim(COALESCE(t.reference, '')), ''),
                  NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
        )
      ) AS verified_gateway,
      (
        t.movement_type = 'admin_credit'
        AND t.amount > 0
        AND t.created_at >= public.wallet_legacy_funding_cutoff()
        AND COALESCE(t.balance_after, 0) > COALESCE(t.balance_before, 0)
        AND COALESCE(t.metadata->>'source', '') <> 'admin-ledger-repair'
        AND COALESCE(t.metadata->>'balance_unchanged', '') <> 'true'
        AND COALESCE(t.metadata->>'requires_owner_evidence', '') <> 'true'
        AND COALESCE(t.metadata->>'approved_by', '') = t.created_by::text
        AND length(btrim(COALESCE(t.metadata->>'approval_reference', ''))) >= 8
        AND length(btrim(COALESCE(t.metadata->>'reason', ''))) >= 3
        AND EXISTS (
          SELECT 1 FROM public.profiles approver
          WHERE approver.id = t.created_by AND COALESCE(approver.is_admin, false)
        )
      ) AS approved_admin
    FROM classified t
  ),
  funding AS (
    SELECT COALESCE(SUM(amount) FILTER (WHERE verified_gateway), 0)::numeric
        AS verified_gateway_deposits,
      COALESCE(SUM(amount) FILTER (WHERE approved_admin), 0)::numeric
        AS approved_admin_credits,
      COUNT(*) FILTER (WHERE verified_gateway)::integer AS verified_payment_rows,
      COUNT(*) FILTER (WHERE approved_admin)::integer AS approved_admin_rows
    FROM funding_rows
  ),
  duplicate_payment_identities AS (
    SELECT COUNT(*)::integer AS count
    FROM (
      SELECT lower(COALESCE(t.metadata->>'provider', '')) AS provider,
        btrim(t.external_payment_id) AS payment_id
      FROM funding_rows t
      WHERE t.verified_gateway
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    ) duplicates
  ),
  debits AS (
    SELECT t.*,
      LEAST(
        abs(COALESCE(t.amount, 0)),
        CASE
          WHEN COALESCE(t.metadata->>'trusted_principal_debit_amount', '') ~
            '^[0-9]+(\.[0-9]{1,2})?$'
          THEN (t.metadata->>'trusted_principal_debit_amount')::numeric
          ELSE 0
        END
      ) AS trusted_debit_amount
    FROM classified t
    WHERE t.is_debit
  ),
  eligible_refund_matches AS (
    SELECT DISTINCT ON (r.id)
      r.id AS refund_id, d.id AS debit_id,
      abs(COALESCE(r.amount, 0)) AS refund_amount,
      d.trusted_debit_amount AS debit_amount
    FROM classified r
    JOIN debits d ON d.user_id = r.user_id
      AND d.amount < 0
      AND d.trusted_debit_amount > 0
      AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
      AND (
        NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text
        OR (
          NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') IS NULL
          AND NULLIF(btrim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key', ''
          )), '') = d.idempotency_key
        )
        OR (
          NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') IS NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key', ''
          )), '') IS NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_order_id', r.metadata->>'order_id',
            r.metadata->>'transaction_id', ''
          )), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_order_id', r.metadata->>'order_id',
            r.metadata->>'transaction_id', ''
          )), '') IN (
            NULLIF(btrim(COALESCE(d.metadata->>'source_order_id', '')), ''),
            NULLIF(btrim(COALESCE(d.metadata->>'order_id', '')), ''),
            NULLIF(btrim(COALESCE(d.metadata->>'transaction_id', '')), '')
          )
          AND (
            NULLIF(btrim(COALESCE(r.metadata->>'source_order_table', '')), '') IS NULL
            OR NULLIF(btrim(COALESCE(r.metadata->>'source_order_table', '')), '') =
              NULLIF(btrim(COALESCE(d.metadata->>'source_order_table', '')), '')
          )
        )
        OR (
          NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') IS NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key', ''
          )), '') IS NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_order_id', r.metadata->>'order_id',
            r.metadata->>'transaction_id', ''
          )), '') IS NULL
          AND NULLIF(btrim(COALESCE(r.metadata->>'original_reference', '')), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(r.metadata->>'original_reference', '')), '') =
            NULLIF(btrim(COALESCE(d.reference, '')), '')
        )
      )
    WHERE r.is_refund AND r.amount > 0
    ORDER BY r.id,
      CASE
        WHEN NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text THEN 0
        WHEN NULLIF(btrim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key', ''
          )), '') = d.idempotency_key THEN 1
        ELSE 2
      END,
      d.created_at DESC, d.id DESC
  ),
  refunds_by_debit AS (
    SELECT debit_id, debit_amount,
      LEAST(SUM(refund_amount), debit_amount) AS eligible_amount
    FROM eligible_refund_matches
    GROUP BY debit_id, debit_amount
  ),
  refunds AS (
    SELECT COALESCE(SUM(eligible_amount), 0)::numeric AS linked_eligible_refunds
    FROM refunds_by_debit
  ),
  movements AS (
    SELECT
      COALESCE(SUM(abs(amount)) FILTER (WHERE is_debit), 0)::numeric AS completed_debits,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'purchase' AND amount < 0), 0)::numeric
        AS completed_purchases,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'withdrawal' AND amount < 0), 0)::numeric
        AS withdrawals,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'chargeback' AND amount < 0), 0)::numeric
        AS chargebacks,
      COALESCE(SUM(abs(amount)) FILTER (WHERE is_refund AND amount > 0), 0)::numeric
        AS completed_refunds,
      COALESCE(SUM(
        CASE
          WHEN is_debit THEN -abs(amount)
          WHEN is_credit OR is_refund THEN abs(amount)
          ELSE amount
        END
      ), 0)::numeric AS expected_ledger_balance,
      COUNT(*) FILTER (WHERE amount IS NULL OR amount = 0
        OR sign_conflict)::integer
        AS unclassified_posted_rows,
      COUNT(*) FILTER (WHERE upper(COALESCE(currency, 'NGN')) <> 'NGN')::integer
        AS unsupported_currency_rows,
      COUNT(*) FILTER (WHERE amount < 0 AND movement_status NOT IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished'))::integer
        AS posted_debits_with_noncompleted_status
    FROM classified
  ),
  holds AS (
    SELECT COALESCE(SUM(r.amount), 0)::numeric AS active_reservations,
      COUNT(*)::integer AS active_reservation_count
    FROM public.wallet_reservations r
    WHERE r.user_id = p_user_id
      AND upper(COALESCE(r.currency, 'NGN')) = 'NGN'
      AND r.status IN ('active', 'review_required')
  ),
  facts AS (
    SELECT p.*, l.principal AS legacy_principal, l.baseline_rows,
      f.verified_gateway_deposits, f.approved_admin_credits,
      f.verified_payment_rows, f.approved_admin_rows,
      (l.principal + f.verified_gateway_deposits + f.approved_admin_credits)
        AS trusted_principal,
      m.completed_debits, m.completed_purchases, m.withdrawals, m.chargebacks,
      m.completed_refunds, m.expected_ledger_balance, m.unclassified_posted_rows,
      m.unsupported_currency_rows,
      m.posted_debits_with_noncompleted_status,
      LEAST(r.linked_eligible_refunds,
        LEAST(m.completed_debits,
          l.principal + f.verified_gateway_deposits + f.approved_admin_credits))
        AS eligible_refunds,
      h.active_reservations, h.active_reservation_count,
      d.count AS duplicate_payment_identities
    FROM profile p
    CROSS JOIN legacy l
    CROSS JOIN funding f
    CROSS JOIN movements m
    CROSS JOIN refunds r
    CROSS JOIN holds h
    CROSS JOIN duplicate_payment_identities d
  ),
  balances AS (
    SELECT facts.*,
      (trusted_principal - completed_debits + eligible_refunds) AS trusted_book_balance,
      (stored_balance - expected_ledger_balance) AS unexplained_difference,
      (expected_ledger_balance -
        (trusted_principal - completed_debits + eligible_refunds)) AS explained_difference
    FROM facts
  )
  SELECT jsonb_build_object(
    'user_id', b.id,
    'currency', 'NGN',
    'verified_gateway_deposits', b.verified_gateway_deposits,
    'approved_admin_credits', b.approved_admin_credits,
    'legacy_approved_principal', b.legacy_principal,
    'trusted_principal', b.trusted_principal,
    'completed_debits', b.completed_debits,
    'completed_purchases', b.completed_purchases,
    'eligible_refunds', b.eligible_refunds,
    'completed_refunds', b.completed_refunds,
    'active_reservations', b.active_reservations,
    'active_reservation_count', b.active_reservation_count,
    'withdrawals', b.withdrawals,
    'chargebacks', b.chargebacks,
    'trusted_book_balance', b.trusted_book_balance,
    'trusted_available_before_holds', GREATEST(LEAST(b.trusted_book_balance, b.stored_balance), 0),
    'net_consumed_spend', GREATEST(b.completed_debits - b.eligible_refunds, 0),
    'spend_exposure', GREATEST(
      b.completed_debits - b.eligible_refunds - b.trusted_principal, 0
    ),
    'confirmed_spendable', CASE
      WHEN b.unclassified_posted_rows > 0 OR b.duplicate_payment_identities > 0
        OR b.unsupported_currency_rows > 0 THEN 0
      ELSE GREATEST(LEAST(b.trusted_book_balance, b.stored_balance) - b.active_reservations, 0)
    END,
    'expected_ledger_balance', b.expected_ledger_balance,
    'stored_wallet_balance', b.stored_balance,
    'explained_difference', b.explained_difference,
    'unexplained_difference', b.unexplained_difference,
    'quarantined_excess', GREATEST(b.stored_balance - b.trusted_book_balance, 0),
    'integrity_status', CASE
      WHEN b.duplicate_payment_identities > 0 THEN 'payment_identity_conflict'
      WHEN b.unsupported_currency_rows > 0 THEN 'unsupported_wallet_currency'
      WHEN b.unclassified_posted_rows > 0 THEN 'unclassified_ledger_movement'
      WHEN b.trusted_book_balance < 0 THEN 'backed_funds_exhausted'
      WHEN b.stored_balance > b.trusted_book_balance THEN 'quarantined_excess'
      WHEN b.stored_balance < b.expected_ledger_balance THEN 'stored_balance_deficit'
      ELSE 'consistent'
    END,
    'evidence_complete', b.unclassified_posted_rows = 0
      AND b.duplicate_payment_identities = 0
      AND b.unsupported_currency_rows = 0,
    'unclassified_posted_rows', b.unclassified_posted_rows,
    'unsupported_currency_rows', b.unsupported_currency_rows,
    'posted_debits_with_noncompleted_status', b.posted_debits_with_noncompleted_status,
    'duplicate_payment_identities', b.duplicate_payment_identities,
    'verified_payment_rows', b.verified_payment_rows,
    'approved_admin_rows', b.approved_admin_rows,
    'account_suspended', b.account_suspended,
    'wallet_review_required', b.wallet_review_required,
    'wallet_review_reason', b.wallet_review_reason,
    'spending_blocked',
      b.account_suspended
      OR b.duplicate_payment_identities > 0
      OR b.unsupported_currency_rows > 0
      OR b.unclassified_posted_rows > 0
      OR b.trusted_book_balance < 0
      OR (
        b.wallet_review_required
        AND NOT (
          b.wallet_reviewed_by IS NULL
          AND b.stored_balance > b.trusted_book_balance
          AND (
            b.wallet_review_reason LIKE 'Auto-suspended: displayed wallet balance %'
            OR b.wallet_review_reason LIKE
              'Wallet frozen: requested purchase % exceeds backed available funds %'
            OR b.wallet_review_reason LIKE
              'Wallet financial review: quarantined displayed excess %'
          )
        )
      ),
    'financial_security_version', b.security_version
  ) INTO v_truth
  FROM balances b;

  IF v_truth IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_profile_not_found';
  END IF;
  RETURN v_truth;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_financial_truth_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_financial_truth_internal(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_wallet_financial_truth(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'wallet_financial_truth_admin_required' USING ERRCODE = '42501';
  END IF;
  RETURN public.wallet_financial_truth_internal(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_wallet_financial_truth(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_wallet_financial_truth(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_wallet_financial_truth_page(
  p_after_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  is_staff boolean,
  is_admin boolean,
  account_suspended boolean,
  wallet_review_required boolean,
  suspension_reason text,
  suspended_at timestamptz,
  truth jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'wallet_financial_truth_admin_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.email::text, p.full_name::text,
    COALESCE(p.is_staff, false), COALESCE(p.is_admin, false),
    COALESCE(p.account_suspended, false),
    COALESCE(p.wallet_review_required, false),
    p.suspension_reason::text, p.suspended_at,
    public.wallet_financial_truth_internal(p.id)
  FROM public.profiles p
  WHERE (p_after_user_id IS NULL OR p.id > p_after_user_id)
  ORDER BY p.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_wallet_financial_truth_page(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_wallet_financial_truth_page(uuid, integer)
  TO authenticated;
