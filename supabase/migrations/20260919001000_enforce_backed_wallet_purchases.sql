-- P0 containment: a stored wallet balance is not sufficient authority to buy.
-- New trusted spendable principal can enter only through verified gateway
-- deposits or approved admin credits. Refunds only restore the trusted part of
-- prior completed debits.

DO $$
BEGIN
  IF to_regclass('public.pocketfi_webhook_logs') IS NOT NULL THEN
    ALTER TABLE public.pocketfi_webhook_logs
      ADD COLUMN IF NOT EXISTS verified_amount_ngn numeric,
      ADD COLUMN IF NOT EXISTS verified_reference text,
      ADD COLUMN IF NOT EXISTS verified_status text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_user_id uuid,
  p_type text,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_currency text DEFAULT 'NGN',
  p_balance_type text DEFAULT 'wallet',
  p_external_payment_id text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_type text := lower(trim(COALESCE(p_type, '')));
  v_balance_type text := lower(trim(COALESCE(p_balance_type, 'wallet')));
  v_amount numeric := COALESCE(p_amount, 0);
  v_signed_amount numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_idempotency_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_reference text := NULLIF(trim(COALESCE(p_reference, '')), '');
  v_currency text := upper(COALESCE(NULLIF(trim(p_currency), ''), 'NGN'));
  v_external_payment_id text := NULLIF(trim(COALESCE(p_external_payment_id, '')), '');
  v_created_by uuid;
  v_existing public.transactions%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_previous_hash text;
  v_trusted_credits numeric := 0;
  v_previous_wallet_debits numeric := 0;
  v_completed_refunds numeric := 0;
  v_trusted_debit_capacity numeric := 0;
  v_eligible_refunds numeric := 0;
  v_trusted_consumed_spend numeric := 0;
  v_refundable_remaining numeric := 0;
  v_authoritative_available numeric := 0;
  v_pending_payment public.pending_payments%ROWTYPE;
  v_pocketfi_log public.pocketfi_webhook_logs%ROWTYPE;
  v_transaction_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_original_debit public.transactions%ROWTYPE;
  v_original_debit_id uuid;
  v_original_debit_key text;
  v_source_order_id text;
  v_source_order_table text;
  v_original_reference text;
  v_refunded_against_original numeric := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet_transaction_user_required';
  END IF;

  IF v_type = '' THEN
    RAISE EXCEPTION 'wallet_transaction_type_required';
  END IF;

  IF v_amount::text = 'NaN' THEN
    RAISE EXCEPTION 'wallet_transaction_amount_invalid';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'wallet_transaction_amount_must_be_positive';
  END IF;

  IF v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'wallet_transaction_amount_precision_invalid';
  END IF;

  IF v_amount > 1000000000 THEN
    RAISE EXCEPTION 'wallet_transaction_amount_too_large';
  END IF;

  IF v_currency !~ '^[A-Z]{3,8}$' THEN
    RAISE EXCEPTION 'wallet_transaction_invalid_currency';
  END IF;

  IF v_balance_type NOT IN ('wallet', 'crypto', 'referral') THEN
    RAISE EXCEPTION 'wallet_transaction_invalid_balance_type';
  END IF;

  v_created_by := COALESCE(p_created_by, auth.uid());

  IF v_type IN (
    'topup',
    'top_up',
    'top-up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
    'admin_credit',
    'staff_credit',
    'refund',
    'purchase_refund',
    'auto_refund',
    'referral_withdrawal',
    'referral_credit',
    'promotion_credit',
    'correction_credit'
  ) THEN
    v_signed_amount := v_amount;
  ELSIF v_type IN (
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'chargeback',
    'withdrawal',
    'correction_debit'
  ) THEN
    v_signed_amount := -v_amount;
  ELSE
    RAISE EXCEPTION 'wallet_transaction_unsupported_type: %', v_type;
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT *
      INTO v_existing
    FROM public.transactions
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.user_id IS DISTINCT FROM p_user_id
        OR lower(trim(COALESCE(v_existing.type, ''))) IS DISTINCT FROM v_type
        OR COALESCE(v_existing.balance_type, 'wallet') IS DISTINCT FROM v_balance_type
        OR COALESCE(v_existing.amount, 0) IS DISTINCT FROM v_signed_amount
        OR NULLIF(trim(COALESCE(v_existing.reference, '')), '') IS DISTINCT FROM v_reference
        OR upper(COALESCE(NULLIF(trim(v_existing.currency), ''), 'NGN')) IS DISTINCT FROM v_currency
        OR NULLIF(trim(COALESCE(v_existing.external_payment_id, '')), '') IS DISTINCT FROM v_external_payment_id
        OR v_existing.created_by IS DISTINCT FROM v_created_by
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'idempotent_replay', false,
          'error', 'idempotency_key_reused_with_different_transaction',
          'code', 'IDEMPOTENCY_CONFLICT',
          'existing_transaction_id', v_existing.id
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'transaction', to_jsonb(v_existing),
        'balance_before', v_existing.balance_before,
        'balance_after', v_existing.balance_after
      );
    END IF;
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_transaction_profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_staff, false) OR COALESCE(v_profile.is_admin, false) THEN
    RAISE EXCEPTION 'wallet_transaction_customer_only';
  END IF;

  IF COALESCE(v_profile.account_suspended, false)
    AND v_signed_amount < 0
    AND v_type NOT IN ('chargeback', 'correction_debit')
  THEN
    RAISE EXCEPTION 'wallet_transaction_account_suspended';
  END IF;

  IF v_balance_type = 'crypto' THEN
    v_current_balance := COALESCE(v_profile.crypto_balance, 0);
  ELSIF v_balance_type = 'referral' THEN
    v_current_balance := COALESCE(v_profile.referral_balance, 0);
  ELSE
    v_current_balance := COALESCE(v_profile.wallet_balance, 0);
  END IF;

  IF v_balance_type = 'wallet' THEN
    IF v_type = 'admin_credit'
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = v_created_by
          AND COALESCE(is_admin, false) = true
      )
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'admin_credit_admin_actor_required',
        'code', 'ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED',
        'message', 'Approved admin credits must be created by a current admin profile.'
      );
    END IF;

    IF v_type = 'admin_credit'
      AND (
        COALESCE(p_metadata, '{}'::jsonb)->>'approved_by' IS DISTINCT FROM COALESCE(v_created_by::text, '')
        OR length(btrim(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'approval_reference', ''))) < 8
        OR length(btrim(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'reason', ''))) < 3
      )
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'admin_credit_approval_evidence_required',
        'code', 'ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED',
        'message', 'Approved admin credits must include approved_by, approval_reference, and reason metadata matching the approving admin.'
      );
    END IF;

    IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      AND v_external_payment_id IS NULL
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'payment_evidence_required',
        'code', 'PAYMENT_EVIDENCE_REQUIRED',
        'message', 'Verified gateway deposits must carry a provider payment identity before they can create trusted principal.'
      );
    END IF;

    IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit') THEN
      IF COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'verified_amount_ngn', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        OR round((COALESCE(p_metadata, '{}'::jsonb)->>'verified_amount_ngn')::numeric, 2) <> round(v_amount, 2)
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'payment_verification_evidence_required',
          'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
          'message', 'Wallet deposits must include provider-verified amount evidence matching the posted credit.'
        );
      END IF;

      IF lower(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'provider', '')) IN ('ercaspay', 'ercas') THEN
        SELECT *
          INTO v_pending_payment
        FROM public.pending_payments pp
        WHERE pp.user_id = p_user_id
          AND round(pp.amount, 2) = round(v_amount, 2)
          AND lower(COALESCE(pp.status, 'pending')) = 'pending'
          AND (
            pp.transaction_reference = v_reference
            OR pp.transaction_reference = v_external_payment_id
            OR pp.ercas_reference = v_external_payment_id
          )
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'Ercas wallet deposits must atomically consume server-created pending payment evidence before they can create trusted principal.'
          );
        END IF;

        UPDATE public.pending_payments
           SET status = 'credited',
               ercas_reference = COALESCE(NULLIF(ercas_reference, ''), v_external_payment_id),
               last_check_at = now(),
               error_message = NULL
         WHERE id = v_pending_payment.id;
      ELSIF lower(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'provider', '')) = 'pocketfi' THEN
        IF COALESCE(p_metadata, '{}'::jsonb)->>'webhook_log_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'PocketFi wallet deposits must be tied to a verified webhook log before they can create trusted principal.'
          );
        END IF;

        SELECT *
          INTO v_pocketfi_log
        FROM public.pocketfi_webhook_logs pwl
        WHERE pwl.id = (COALESCE(p_metadata, '{}'::jsonb)->>'webhook_log_id')::uuid
          AND pwl.matched_user_id = p_user_id
          AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(v_amount, 2)
          AND NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN (v_reference, v_external_payment_id)
          AND COALESCE(pwl.processed, false) = false
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'PocketFi wallet deposits must atomically consume matching webhook amount/reference evidence before they can create trusted principal.'
          );
        END IF;

        UPDATE public.pocketfi_webhook_logs
           SET processed = true,
               error_message = NULL
         WHERE id = v_pocketfi_log.id;
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'payment_verification_evidence_required',
          'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
          'message', 'Wallet deposits must identify a supported verified payment provider before they can create trusted principal.'
        );
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_trusted_credits
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(t.status, 'completed')) = 'completed'
      AND t.amount > 0
      AND (
        (
          t.type IN (
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
          t.type = 'admin_credit'
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

    SELECT COALESCE(SUM(abs(amount)), 0)
      INTO v_previous_wallet_debits
    FROM public.transactions
    WHERE user_id = p_user_id
      AND COALESCE(balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(status, 'completed')) = 'completed'
      AND type IN (
        'purchase',
        'admin_debit',
        'staff_debit',
        'debit',
        'withdrawal',
        'chargeback',
        'correction_debit'
      );

    WITH eligible_refund_matches AS (
      SELECT DISTINCT ON (r.id)
        r.id AS refund_id,
        r.amount AS refund_amount,
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
       AND lower(COALESCE(d.status, 'completed')) = 'completed'
       AND d.amount < 0
       AND d.type IN (
         'purchase',
         'admin_debit',
         'staff_debit',
         'debit',
         'withdrawal',
         'chargeback',
         'correction_debit'
       )
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
      WHERE r.user_id = p_user_id
        AND COALESCE(r.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(r.status, 'completed')) = 'completed'
        AND r.amount > 0
        AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
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
      INTO v_completed_refunds
    FROM capped_refunds_by_debit;

    v_trusted_debit_capacity := LEAST(v_previous_wallet_debits, v_trusted_credits);
    v_eligible_refunds := LEAST(v_completed_refunds, v_trusted_debit_capacity);
    v_trusted_consumed_spend := GREATEST(v_trusted_debit_capacity - v_eligible_refunds, 0);
    v_authoritative_available := GREATEST(v_trusted_credits - v_trusted_consumed_spend, 0);
  END IF;

  IF v_balance_type = 'wallet' AND v_type IN ('refund', 'purchase_refund', 'auto_refund') THEN
    v_original_debit_key := NULLIF(trim(COALESCE(
      p_metadata->>'source_debit_idempotency_key',
      p_metadata->>'original_purchase_idempotency_key',
      ''
    )), '');
    v_source_order_id := NULLIF(trim(COALESCE(
      p_metadata->>'source_order_id',
      p_metadata->>'order_id',
      p_metadata->>'transaction_id',
      ''
    )), '');
    v_source_order_table := NULLIF(trim(COALESCE(p_metadata->>'source_order_table', '')), '');
    v_original_reference := NULLIF(trim(COALESCE(p_metadata->>'original_reference', '')), '');

    IF COALESCE(p_metadata->>'source_debit_transaction_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_original_debit_id := (p_metadata->>'source_debit_transaction_id')::uuid;
    END IF;

    SELECT *
      INTO v_original_debit
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(t.status, 'completed')) = 'completed'
      AND t.amount < 0
      AND t.type IN (
        'purchase',
        'admin_debit',
        'staff_debit',
        'debit',
        'withdrawal',
        'chargeback',
        'correction_debit'
      )
      AND (
        (v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id)
        OR (v_original_debit_key IS NOT NULL AND t.idempotency_key = v_original_debit_key)
        OR (
          v_source_order_id IS NOT NULL
          AND (
            NULLIF(trim(COALESCE(t.metadata->>'source_order_id', '')), '') = v_source_order_id
            OR NULLIF(trim(COALESCE(t.metadata->>'order_id', '')), '') = v_source_order_id
            OR NULLIF(trim(COALESCE(t.metadata->>'transaction_id', '')), '') = v_source_order_id
          )
          AND (
            v_source_order_table IS NULL
            OR NULLIF(trim(COALESCE(t.metadata->>'source_order_table', '')), '') = v_source_order_table
          )
        )
        OR (v_original_reference IS NOT NULL AND NULLIF(trim(COALESCE(t.reference, '')), '') = v_original_reference)
      )
    ORDER BY
      CASE
        WHEN v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id THEN 0
        WHEN v_original_debit_key IS NOT NULL AND t.idempotency_key = v_original_debit_key THEN 1
        ELSE 2
      END,
      t.created_at DESC,
      t.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_required',
        'code', 'REFUND_ORIGINAL_DEBIT_REQUIRED',
        'message', 'Refunds must reference the original completed wallet debit by transaction ID, purchase idempotency key, or protected source order metadata.'
      );
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_authorized', '') <> 'true' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_not_trusted',
        'code', 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED',
        'original_debit_id', v_original_debit.id,
        'message', 'Refunds can restore only a prior debit that was authorized from trusted principal.'
      );
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_debit_amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric <= 0
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_not_trusted',
        'code', 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED',
        'original_debit_id', v_original_debit.id,
        'message', 'Refunds can restore only a prior debit with wallet-engine trusted-principal amount evidence.'
      );
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_refunded_against_original
    FROM public.transactions r
    WHERE r.user_id = p_user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) = 'completed'
      AND r.amount > 0
      AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
      AND (
        NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = v_original_debit.id::text
        OR (
          NULLIF(trim(COALESCE(v_original_debit.idempotency_key, '')), '') IS NOT NULL
          AND NULLIF(trim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key',
            ''
          )), '') = v_original_debit.idempotency_key
        )
        OR (
          v_source_order_id IS NOT NULL
          AND (
            NULLIF(trim(COALESCE(r.metadata->>'source_order_id', '')), '') = v_source_order_id
            OR NULLIF(trim(COALESCE(r.metadata->>'order_id', '')), '') = v_source_order_id
            OR NULLIF(trim(COALESCE(r.metadata->>'transaction_id', '')), '') = v_source_order_id
          )
          AND (
            v_source_order_table IS NULL
            OR NULLIF(trim(COALESCE(r.metadata->>'source_order_table', '')), '') = v_source_order_table
          )
        )
        OR (v_original_reference IS NOT NULL AND NULLIF(trim(COALESCE(r.metadata->>'original_reference', '')), '') = v_original_reference)
      );

    IF v_refunded_against_original + v_amount > LEAST(
      abs(COALESCE(v_original_debit.amount, 0)),
      (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_exceeds_original_debit',
        'code', 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT',
        'original_debit_id', v_original_debit.id,
        'original_debit_amount', abs(COALESCE(v_original_debit.amount, 0)),
        'trusted_original_debit_amount', LEAST(
          abs(COALESCE(v_original_debit.amount, 0)),
          (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
        ),
        'already_refunded', v_refunded_against_original,
        'requested_amount', v_amount
      );
    END IF;

    v_refundable_remaining := GREATEST(v_trusted_debit_capacity - v_completed_refunds, 0);

    IF v_amount > v_refundable_remaining THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_exceeds_trusted_original_debit',
        'code', 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT',
        'trusted_principal', v_trusted_credits,
        'previous_completed_debits', v_previous_wallet_debits,
        'trusted_debit_capacity', v_trusted_debit_capacity,
        'completed_refunds', v_completed_refunds,
        'refundable_remaining', v_refundable_remaining,
        'requested_amount', v_amount
      );
    END IF;
  END IF;

  v_new_balance := v_current_balance + v_signed_amount;

  IF v_new_balance < 0 AND v_type NOT IN ('chargeback', 'correction_debit') THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  IF v_balance_type = 'wallet'
    AND v_type IN ('chargeback', 'correction_debit')
    AND v_new_balance < 0
  THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);
    PERFORM set_config('app.tally_request_forensics', COALESCE((p_metadata->'request_forensics')::text, '{}'), true);

    UPDATE public.profiles
       SET account_suspended = true,
           suspension_reason = concat(
             'Wallet frozen: ',
             v_type,
             ' posted a debt balance of ',
             v_new_balance::text,
             '. Review before further spending.'
           ),
           suspended_at = COALESCE(suspended_at, now()),
           updated_at = now()
     WHERE id = p_user_id;

    PERFORM set_config('app.tally_request_forensics', '{}', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  END IF;

  IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN
    IF v_authoritative_available < v_amount THEN
      PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);
      PERFORM set_config('app.tally_request_forensics', COALESCE((p_metadata->'request_forensics')::text, '{}'), true);

      UPDATE public.profiles
         SET account_suspended = true,
             suspension_reason = concat(
               'Wallet frozen: requested purchase ',
               v_amount::text,
               ' exceeds backed available funds ',
               v_authoritative_available::text,
               '. Stored balance was ',
               v_current_balance::text,
               '.'
             ),
             suspended_at = COALESCE(suspended_at, now()),
             updated_at = now()
       WHERE id = p_user_id;

      PERFORM set_config('app.tally_request_forensics', '{}', true);
      PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

      RETURN jsonb_build_object(
        'success', false,
        'error', 'wallet_unbacked_funds',
        'code', 'WALLET_UNBACKED_FUNDS',
        'backed_available', v_authoritative_available,
        'trusted_principal', v_trusted_credits,
        'eligible_refunds', v_eligible_refunds,
        'trusted_consumed_spend', v_trusted_consumed_spend,
        'previous_debits', v_previous_wallet_debits,
        'stored_balance', v_current_balance,
        'requested_amount', v_amount
      );
    END IF;

    v_transaction_metadata := v_transaction_metadata
      || jsonb_build_object(
        'trusted_principal_authorized', true,
        'trusted_principal_debit_amount', v_amount,
        'trusted_available_before', v_authoritative_available,
        'trusted_principal_before', v_trusted_credits,
        'trusted_consumed_spend_before', v_trusted_consumed_spend
      );
  END IF;

  SELECT transaction_hash
    INTO v_previous_hash
  FROM public.transactions
  WHERE user_id = p_user_id
    AND balance_type = v_balance_type
    AND transaction_hash IS NOT NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  INSERT INTO public.transactions (
    user_id,
    type,
    amount,
    status,
    balance_before,
    balance_after,
    currency,
    reference,
    description,
    idempotency_key,
    external_payment_id,
    created_by,
    metadata,
    balance_type,
    previous_hash
  )
  VALUES (
    p_user_id,
    v_type,
    v_signed_amount,
    'completed',
    v_current_balance,
    v_new_balance,
    v_currency,
    v_reference,
    p_description,
    v_idempotency_key,
    v_external_payment_id,
    v_created_by,
    v_transaction_metadata,
    v_balance_type,
    v_previous_hash
  )
  RETURNING *
  INTO v_transaction;

  IF v_balance_type = 'crypto' THEN
    UPDATE public.profiles
       SET crypto_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  ELSIF v_balance_type = 'referral' THEN
    UPDATE public.profiles
       SET referral_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET wallet_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  END IF;

  UPDATE public.transactions
     SET transaction_hash = encode(
       digest(
         concat_ws(
           '|',
           COALESCE(v_previous_hash, ''),
           v_transaction.id::text,
           p_user_id::text,
           v_type,
           v_signed_amount::text,
           v_current_balance::text,
           v_new_balance::text,
           COALESCE(v_reference, ''),
           v_transaction.created_at::text,
           v_balance_type
         ),
         'sha256'
       ),
       'hex'
     )
   WHERE id = v_transaction.id
   RETURNING *
   INTO v_transaction;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'transaction', to_jsonb(v_transaction),
    'balance_before', v_current_balance,
    'balance_after', v_new_balance
  );
EXCEPTION
  WHEN unique_violation THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_request_forensics', '{}', true);

    IF v_idempotency_key IS NOT NULL THEN
      SELECT *
        INTO v_existing
      FROM public.transactions
      WHERE idempotency_key = v_idempotency_key
      LIMIT 1;

      IF FOUND THEN
        IF v_existing.user_id IS DISTINCT FROM p_user_id
          OR lower(trim(COALESCE(v_existing.type, ''))) IS DISTINCT FROM v_type
          OR COALESCE(v_existing.balance_type, 'wallet') IS DISTINCT FROM v_balance_type
          OR COALESCE(v_existing.amount, 0) IS DISTINCT FROM v_signed_amount
          OR NULLIF(trim(COALESCE(v_existing.reference, '')), '') IS DISTINCT FROM v_reference
          OR upper(COALESCE(NULLIF(trim(v_existing.currency), ''), 'NGN')) IS DISTINCT FROM v_currency
          OR NULLIF(trim(COALESCE(v_existing.external_payment_id, '')), '') IS DISTINCT FROM v_external_payment_id
        THEN
          RETURN jsonb_build_object(
            'success', false,
            'idempotent_replay', false,
            'error', 'idempotency_key_reused_with_different_transaction',
            'code', 'IDEMPOTENCY_CONFLICT',
            'existing_transaction_id', v_existing.id
          );
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'idempotent_replay', true,
          'transaction', to_jsonb(v_existing),
          'balance_before', v_existing.balance_before,
          'balance_after', v_existing.balance_after
        );
      END IF;
    END IF;
    RAISE;
  WHEN OTHERS THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_request_forensics', '{}', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_wallet_transaction(
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  uuid
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  uuid
) TO service_role;
