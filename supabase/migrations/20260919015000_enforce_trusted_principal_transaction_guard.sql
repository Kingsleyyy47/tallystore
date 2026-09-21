-- Defense-in-depth for already-deployed wallet engines.
-- Only verified gateway deposits and approved admin credits create trusted
-- principal. Refunds can restore only the trusted part of prior debits.

CREATE OR REPLACE FUNCTION public.guard_trusted_principal_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := lower(COALESCE(NEW.type, ''));
  v_balance_type text := COALESCE(NEW.balance_type, 'wallet');
  v_status text := lower(COALESCE(NEW.status, 'completed'));
  v_trusted_principal numeric := 0;
  v_completed_debits numeric := 0;
  v_completed_refunds numeric := 0;
  v_trusted_debit_capacity numeric := 0;
  v_eligible_refunds numeric := 0;
  v_trusted_consumed_spend numeric := 0;
  v_trusted_available numeric := 0;
  v_refundable_remaining numeric := 0;
  v_original_debit public.transactions%ROWTYPE;
  v_original_debit_id uuid;
  v_original_debit_key text;
  v_source_order_id text;
  v_source_order_table text;
  v_original_reference text;
  v_refunded_against_original numeric := 0;
BEGIN
  -- Unauthorized direct ledger writes are handled by
  -- guard_transaction_ledger_authority(), which records the attempted row and
  -- skips the mutation. Keep this guard scoped to wallet-engine inserts so it
  -- cannot raise first and roll back that audit path.
  IF COALESCE(current_setting('app.tally_wallet_engine_authorized', true), '') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF v_balance_type <> 'wallet'
    OR v_status <> 'completed'
    OR v_type NOT IN (
      'purchase',
      'refund',
      'purchase_refund',
      'auto_refund',
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'wallet_deposit',
      'deposit'
    )
  THEN
    RETURN NEW;
  END IF;

  IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    AND NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_REQUIRED: verified gateway deposits require external_payment_id';
  END IF;

  IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit') THEN
    IF COALESCE(NEW.metadata->>'verified_amount_ngn', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR round((NEW.metadata->>'verified_amount_ngn')::numeric, 2) <> round(NEW.amount, 2)
    THEN
      RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: wallet deposits require provider-verified amount evidence matching the posted credit';
    END IF;

    IF lower(COALESCE(NEW.metadata->>'provider', '')) IN ('ercaspay', 'ercas') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.pending_payments pp
        WHERE pp.user_id = NEW.user_id
          AND round(pp.amount, 2) = round(NEW.amount, 2)
          AND lower(COALESCE(pp.status, 'pending')) = 'credited'
          AND (
            pp.transaction_reference = NULLIF(trim(COALESCE(NEW.reference, '')), '')
            OR pp.transaction_reference = NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
            OR pp.ercas_reference = NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
          )
      ) THEN
        RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: Ercas wallet deposits require matching pending payment evidence';
      END IF;
    ELSIF lower(COALESCE(NEW.metadata->>'provider', '')) = 'pocketfi' THEN
      IF COALESCE(NEW.metadata->>'webhook_log_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR NOT EXISTS (
          SELECT 1
          FROM public.pocketfi_webhook_logs pwl
          WHERE pwl.id = (NEW.metadata->>'webhook_log_id')::uuid
            AND pwl.matched_user_id = NEW.user_id
            AND COALESCE(pwl.processed, false) = true
            AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(NEW.amount, 2)
            AND NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN (
              NULLIF(trim(COALESCE(NEW.reference, '')), ''),
              NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
            )
        )
      THEN
        RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: PocketFi wallet deposits require matching webhook evidence';
      END IF;
    ELSE
      RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: wallet deposits require supported verified payment provider evidence';
    END IF;

    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_trusted_principal
  FROM public.transactions t
  WHERE t.user_id = NEW.user_id
    AND COALESCE(t.balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(t.status, 'completed')) = 'completed'
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

  SELECT COALESCE(SUM(abs(amount)), 0)
    INTO v_completed_debits
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND COALESCE(balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(status, 'completed')) = 'completed'
    AND lower(COALESCE(type, '')) IN (
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
     AND lower(COALESCE(d.type, '')) IN (
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
    WHERE r.user_id = NEW.user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) = 'completed'
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
    INTO v_completed_refunds
  FROM capped_refunds_by_debit;

  v_trusted_debit_capacity := LEAST(v_completed_debits, v_trusted_principal);
  v_eligible_refunds := LEAST(v_completed_refunds, v_trusted_debit_capacity);
  v_trusted_consumed_spend := GREATEST(v_trusted_debit_capacity - v_eligible_refunds, 0);
  v_trusted_available := GREATEST(v_trusted_principal - v_trusted_consumed_spend, 0);
  v_refundable_remaining := GREATEST(v_trusted_debit_capacity - v_completed_refunds, 0);

  IF v_type = 'purchase' THEN
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'trusted_principal_authorized', true,
        'trusted_principal_debit_amount', abs(COALESCE(NEW.amount, 0)),
        'trusted_available_before', v_trusted_available,
        'trusted_principal_before', v_trusted_principal,
        'trusted_consumed_spend_before', v_trusted_consumed_spend
      );
  END IF;

  IF v_type = 'purchase' AND abs(COALESCE(NEW.amount, 0)) > v_trusted_available THEN
    RAISE EXCEPTION 'WALLET_UNBACKED_FUNDS: requested % exceeds trusted available %',
      abs(COALESCE(NEW.amount, 0)),
      v_trusted_available;
  END IF;

  IF v_type IN ('refund', 'purchase_refund', 'auto_refund') THEN
    v_original_debit_key := NULLIF(trim(COALESCE(
      NEW.metadata->>'source_debit_idempotency_key',
      NEW.metadata->>'original_purchase_idempotency_key',
      ''
    )), '');
    v_source_order_id := NULLIF(trim(COALESCE(
      NEW.metadata->>'source_order_id',
      NEW.metadata->>'order_id',
      NEW.metadata->>'transaction_id',
      ''
    )), '');
    v_source_order_table := NULLIF(trim(COALESCE(NEW.metadata->>'source_order_table', '')), '');
    v_original_reference := NULLIF(trim(COALESCE(NEW.metadata->>'original_reference', '')), '');

    IF COALESCE(NEW.metadata->>'source_debit_transaction_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_original_debit_id := (NEW.metadata->>'source_debit_transaction_id')::uuid;
    END IF;

    SELECT *
      INTO v_original_debit
    FROM public.transactions t
    WHERE t.user_id = NEW.user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(t.status, 'completed')) = 'completed'
      AND t.amount < 0
      AND lower(COALESCE(t.type, '')) IN (
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
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_REQUIRED: refunds must reference an original completed wallet debit';
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_authorized', '') <> 'true' THEN
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED: refunds can restore only a prior trusted-principal-authorized debit';
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_debit_amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric <= 0
    THEN
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED: refunds can restore only a prior debit with wallet-engine trusted-principal amount evidence';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_refunded_against_original
    FROM public.transactions r
    WHERE r.user_id = NEW.user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) = 'completed'
      AND r.amount > 0
      AND lower(COALESCE(r.type, '')) IN ('refund', 'purchase_refund', 'auto_refund')
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

    IF v_refunded_against_original + COALESCE(NEW.amount, 0) > LEAST(
      abs(COALESCE(v_original_debit.amount, 0)),
      (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
    ) THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT: requested % exceeds original debit remaining %',
        COALESCE(NEW.amount, 0),
        GREATEST(
          LEAST(
            abs(COALESCE(v_original_debit.amount, 0)),
            (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
          ) - v_refunded_against_original,
          0
        );
    END IF;

    IF COALESCE(NEW.amount, 0) > v_refundable_remaining THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT: requested % exceeds refundable remaining %',
        COALESCE(NEW.amount, 0),
        v_refundable_remaining;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_trusted_principal_transaction_insert ON public.transactions;

CREATE TRIGGER guard_trusted_principal_transaction_insert
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_trusted_principal_transaction();

REVOKE ALL ON FUNCTION public.guard_trusted_principal_transaction() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_trusted_principal_transaction() TO service_role;
