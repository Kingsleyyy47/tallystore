-- Keep fraud suspension logic aligned with the wallet authorization engine.
-- New trusted spendable principal can enter only through verified gateway
-- deposits or approved admin credits. Staff, promotion, correction, generic,
-- and crypto-sale credits are not trusted principal during incident review.

CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension(
  target_user_id uuid,
  tolerance_ngn numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row record;
  trusted_credits numeric := 0;
  crypto_credits numeric := 0;
  completed_spend numeric := 0;
  completed_refunds numeric := 0;
  trusted_debit_capacity numeric := 0;
  eligible_refunds numeric := 0;
  trusted_consumed_spend numeric := 0;
  trusted_available numeric := 0;
  net_spend numeric := 0;
  displayed_balance_exposure numeric := 0;
  spend_exposure numeric := 0;
  should_suspend boolean := false;
  reason_text text;
BEGIN
  SELECT id, is_admin, is_staff, account_suspended, suspension_reason, wallet_balance
    INTO profile_row
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF COALESCE(profile_row.is_admin, false) OR COALESCE(profile_row.is_staff, false) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'staff_or_admin');
  END IF;

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO trusted_credits
  FROM public.transactions t
  WHERE t.user_id = target_user_id
    AND COALESCE(t.balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(t.status, 'completed')) IN ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    AND t.amount > 0
    AND (
      (
        lower(COALESCE(t.type, '')) IN (
          'topup',
          'top_up',
          'top-up',
          'wallet_topup',
          'wallet_deposit',
          'deposit'
        )
        AND NULLIF(trim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
        AND round((t.metadata->>'verified_amount_ngn')::numeric, 2) = round(t.amount, 2)
        AND (
          (
            lower(COALESCE(t.metadata->>'provider', '')) IN ('ercaspay', 'ercas')
            AND EXISTS (
              SELECT 1
              FROM public.pending_payments pp
                WHERE pp.user_id = t.user_id
                  AND round(pp.amount, 2) = round(t.amount, 2)
                  AND lower(COALESCE(pp.status, 'pending')) = 'credited'
                  AND (
                  pp.transaction_reference = NULLIF(trim(COALESCE(t.reference, '')), '')
                  OR pp.transaction_reference = NULLIF(trim(COALESCE(t.external_payment_id, '')), '')
                  OR pp.ercas_reference = NULLIF(trim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
            AND COALESCE(t.metadata->>'webhook_log_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1
              FROM public.pocketfi_webhook_logs pwl
              WHERE pwl.id = (t.metadata->>'webhook_log_id')::uuid
                AND pwl.matched_user_id = t.user_id
                AND COALESCE(pwl.processed, false) = true
                AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
                AND NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN (
                  NULLIF(trim(COALESCE(t.reference, '')), ''),
                  NULLIF(trim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
        )
      )
      OR (
        lower(COALESCE(t.type, '')) = 'admin_credit'
        AND COALESCE(t.balance_after, 0) > COALESCE(t.balance_before, 0)
        AND COALESCE(t.metadata->>'source', '') <> 'admin-ledger-repair'
        AND COALESCE(t.metadata->>'balance_unchanged', '') <> 'true'
        AND COALESCE(t.metadata->>'requires_owner_evidence', '') <> 'true'
        AND COALESCE(t.metadata->>'approved_by', '') = t.created_by::text
        AND length(btrim(COALESCE(t.metadata->>'approval_reference', ''))) >= 8
        AND length(btrim(COALESCE(t.metadata->>'reason', ''))) >= 3
        AND t.created_by IN (
          SELECT id
          FROM public.profiles
          WHERE COALESCE(is_admin, false) = true
        )
      )
    );

  SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO completed_spend
  FROM public.transactions
  WHERE user_id = target_user_id
    AND COALESCE(balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(status, 'completed')) IN ('completed', 'success', 'successful', 'complete', 'paid', 'finished')
    AND lower(COALESCE(type, '')) IN ('purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal', 'chargeback', 'correction_debit');

  WITH eligible_refund_matches AS (
    SELECT DISTINCT ON (r.id)
      r.id AS refund_id,
      abs(COALESCE(r.amount, 0)) AS refund_amount,
      d.id AS debit_id,
      LEAST(
        abs(COALESCE(d.amount, 0)),
        CASE
          WHEN COALESCE(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
          THEN (d.metadata->>'trusted_principal_debit_amount')::numeric
          ELSE 0
        END
      ) AS debit_amount
    FROM public.transactions r
    JOIN public.transactions d
      ON d.user_id = r.user_id
     AND COALESCE(d.balance_type, 'wallet') = 'wallet'
     AND lower(COALESCE(d.status, 'completed')) IN ('completed', 'success', 'successful', 'complete', 'paid', 'finished')
     AND d.amount < 0
     AND lower(COALESCE(d.type, '')) IN ('purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal', 'chargeback', 'correction_debit')
     AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
     AND COALESCE(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
     AND (d.metadata->>'trusted_principal_debit_amount')::numeric > 0
     AND (
       NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text
       OR (
         NULLIF(trim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(
           r.metadata->>'source_debit_idempotency_key',
           r.metadata->>'original_purchase_idempotency_key',
           ''
         )), '') = d.idempotency_key
       )
       OR (
         NULLIF(trim(COALESCE(
           r.metadata->>'source_order_id',
           r.metadata->>'order_id',
           r.metadata->>'transaction_id',
           ''
         )), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(
           r.metadata->>'source_order_id',
           r.metadata->>'order_id',
           r.metadata->>'transaction_id',
           ''
         )), '') IN (
           NULLIF(trim(COALESCE(d.metadata->>'source_order_id', '')), ''),
           NULLIF(trim(COALESCE(d.metadata->>'order_id', '')), ''),
           NULLIF(trim(COALESCE(d.metadata->>'transaction_id', '')), '')
         )
         AND (
           NULLIF(trim(COALESCE(r.metadata->>'source_order_table', '')), '') IS NULL
           OR NULLIF(trim(COALESCE(r.metadata->>'source_order_table', '')), '') = NULLIF(trim(COALESCE(d.metadata->>'source_order_table', '')), '')
         )
       )
       OR (
         NULLIF(trim(COALESCE(r.metadata->>'original_reference', '')), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(r.metadata->>'original_reference', '')), '') = NULLIF(trim(COALESCE(d.reference, '')), '')
       )
     )
    WHERE r.user_id = target_user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) IN ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      AND r.amount > 0
      AND lower(COALESCE(r.type, '')) IN ('refund', 'purchase_refund', 'auto_refund')
    ORDER BY
      r.id,
      CASE
        WHEN NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text THEN 0
        WHEN NULLIF(trim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
          AND NULLIF(trim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key',
            ''
          )), '') = d.idempotency_key THEN 1
        ELSE 2
      END,
      d.created_at DESC,
      d.id DESC
  ),
  capped_refunds_by_debit AS (
    SELECT
      debit_id,
      debit_amount,
      SUM(refund_amount) AS refund_amount
    FROM eligible_refund_matches
    GROUP BY debit_id, debit_amount
  )
  SELECT COALESCE(SUM(LEAST(refund_amount, debit_amount)), 0)
    INTO completed_refunds
  FROM capped_refunds_by_debit;

  trusted_debit_capacity := LEAST(completed_spend, trusted_credits);
  eligible_refunds := LEAST(completed_refunds, trusted_debit_capacity);
  trusted_consumed_spend := GREATEST(trusted_debit_capacity - eligible_refunds, 0);
  trusted_available := GREATEST(trusted_credits - trusted_consumed_spend, 0);
  net_spend := GREATEST(completed_spend - eligible_refunds, 0);
  spend_exposure := GREATEST(net_spend - trusted_credits, 0);
  displayed_balance_exposure := GREATEST(COALESCE(profile_row.wallet_balance, 0) - trusted_available, 0);
  should_suspend := spend_exposure > tolerance_ngn OR displayed_balance_exposure > tolerance_ngn;

  IF should_suspend THEN
    IF displayed_balance_exposure > tolerance_ngn THEN
      reason_text := format(
        'Auto-suspended: displayed wallet balance %s exceeds trusted available funds %s by %s',
        COALESCE(profile_row.wallet_balance, 0),
        trusted_available,
        displayed_balance_exposure
      );
    ELSE
      reason_text := format(
        'Auto-suspended: net completed wallet spend %s exceeds trusted principal %s by %s',
        net_spend,
        trusted_credits,
        spend_exposure
      );
    END IF;

    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

    UPDATE public.profiles
      SET account_suspended = true,
          suspension_reason = reason_text,
          suspended_at = COALESCE(suspended_at, now()),
          suspended_by = NULL,
          updated_at = now()
      WHERE id = target_user_id
        AND COALESCE(account_suspended, false) = false;

    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'suspended', should_suspend,
    'review_required', COALESCE(profile_row.account_suspended, false) AND COALESCE(profile_row.suspension_reason, '') LIKE 'Auto-suspended:%',
    'trusted_credits', trusted_credits,
    'crypto_credits_quarantined', crypto_credits,
    'completed_refunds', completed_refunds,
    'eligible_refunds', eligible_refunds,
    'completed_spend', completed_spend,
    'trusted_consumed_spend', trusted_consumed_spend,
    'trusted_available', trusted_available,
    'net_spend', net_spend,
    'spend_exposure', spend_exposure,
    'displayed_balance_exposure', displayed_balance_exposure
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_customer_ledger_suspension(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_customer_ledger_suspension(uuid, numeric) TO service_role;
