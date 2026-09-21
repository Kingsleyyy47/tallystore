-- Grandfather credible wallet funding that predates the backed-funding
-- enforcement cutoff, while keeping all post-cutoff funding strict.
--
-- The cutoff is deliberately explicit and immutable in this migration:
-- 2026-09-19 00:00:00 UTC. Before it, legacy top-up/credit rows are treated
-- as historical opening principal even when the newer provider evidence
-- columns did not exist. After it, only verified gateway deposits and
-- properly approved admin credits create trusted principal.

CREATE OR REPLACE FUNCTION public.wallet_legacy_funding_cutoff()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-09-19 00:00:00+00'::timestamptz;
$$;

CREATE TABLE IF NOT EXISTS public.wallet_legacy_funding (
  user_id uuid PRIMARY KEY,
  cutoff_at timestamptz NOT NULL,
  grandfathered_principal numeric NOT NULL CHECK (grandfathered_principal >= 0),
  source text NOT NULL DEFAULT 'pre_enforcement_ledger',
  approved_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.wallet_legacy_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_legacy_funding FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wallet_legacy_funding TO service_role;

COMMENT ON TABLE public.wallet_legacy_funding IS
  'Immutable-by-policy baseline of qualifying wallet credits recorded before backed-funding enforcement.';

COMMENT ON COLUMN public.wallet_legacy_funding.grandfathered_principal IS
  'Historical trusted principal only; not a current balance and not a new customer deposit.';

-- Capture legacy principal once. Refunds are intentionally excluded: they
-- restore an eligible debit rather than create independent principal.
INSERT INTO public.wallet_legacy_funding (
  user_id,
  cutoff_at,
  grandfathered_principal,
  source,
  metadata
)
SELECT
  t.user_id,
  public.wallet_legacy_funding_cutoff(),
  round(SUM(t.amount), 2),
  'pre_enforcement_ledger',
  jsonb_build_object(
    'migration', '20260921010000_grandfather_legacy_wallet_funding',
    'credit_rows', COUNT(*),
    'first_credit_at', MIN(t.created_at),
    'last_credit_at', MAX(t.created_at)
  )
FROM public.transactions t
WHERE COALESCE(t.balance_type, 'wallet') = 'wallet'
  AND lower(COALESCE(t.status, 'completed')) IN (
    'completed',
    'success',
    'successful',
    'credited',
    'complete',
    'paid',
    'finished'
  )
  AND t.amount > 0
  AND t.created_at < public.wallet_legacy_funding_cutoff()
  AND lower(COALESCE(t.type, '')) IN (
    'topup',
    'top_up',
    'top-up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
    'credit',
    'admin_credit',
    'staff_credit',
    'promotion_credit',
    'correction_credit'
  )
  AND NOT (
    lower(COALESCE(t.type, '')) = 'admin_credit'
    AND (
      COALESCE(t.metadata->>'source', '') = 'admin-ledger-repair'
      OR COALESCE(t.metadata->>'balance_unchanged', '') = 'true'
      OR COALESCE(t.metadata->>'requires_owner_evidence', '') = 'true'
      OR COALESCE(t.balance_after, 0) <= COALESCE(t.balance_before, 0)
    )
  )
GROUP BY t.user_id
HAVING round(SUM(t.amount), 2) > 0
ON CONFLICT (user_id) DO NOTHING;

-- Historical debits from a grandfathered account can legitimately have been
-- recorded before the newer authorization metadata existed. Mark those
-- debits for refund linkage only. This does not increase a balance or create
-- a credit; the principal table remains the source of the grandfathered value.
SELECT set_config('app.tally_wallet_engine_authorized', 'true', true);

UPDATE public.transactions t
SET metadata = COALESCE(t.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'trusted_principal_authorized', true,
    'trusted_principal_debit_amount', abs(t.amount),
    'legacy_trusted_principal', true,
    'legacy_trusted_principal_cutoff', public.wallet_legacy_funding_cutoff()
  )
FROM public.wallet_legacy_funding f
WHERE f.user_id = t.user_id
  AND COALESCE(t.balance_type, 'wallet') = 'wallet'
  AND lower(COALESCE(t.status, 'completed')) IN (
    'completed',
    'success',
    'successful',
    'complete',
    'paid',
    'finished'
  )
  AND t.amount < 0
  AND t.created_at < f.cutoff_at
  AND lower(COALESCE(t.type, '')) IN (
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'withdrawal',
    'chargeback',
    'correction_debit'
  )
  AND COALESCE(t.metadata->>'trusted_principal_authorized', '') <> 'true';

SELECT set_config('app.tally_wallet_engine_authorized', 'false', true);

CREATE OR REPLACE FUNCTION public.legacy_trusted_principal_for_user(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(grandfathered_principal, 0)
  FROM public.wallet_legacy_funding
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.trusted_principal_for_user(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(public.legacy_trusted_principal_for_user(p_user_id), 0)
    + COALESCE((
      SELECT SUM(t.amount)
      FROM public.transactions t
      WHERE t.user_id = p_user_id
        AND COALESCE(t.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(t.status, 'completed')) IN (
          'completed',
          'success',
          'successful',
          'credited',
          'complete',
          'paid',
          'finished'
        )
        AND t.amount > 0
        AND t.created_at >= public.wallet_legacy_funding_cutoff()
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
        )
    ), 0);
$$;

REVOKE ALL ON FUNCTION public.wallet_legacy_funding_cutoff() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_trusted_principal_for_user(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.trusted_principal_for_user(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_legacy_funding_cutoff() TO service_role;
GRANT EXECUTE ON FUNCTION public.legacy_trusted_principal_for_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.trusted_principal_for_user(uuid) TO service_role;

-- Patch the already-created functions without duplicating their large bodies.
-- Locate each complete SELECT ... INTO statement by its target variable instead
-- of depending on pg_get_functiondef() whitespace, casts, or letter casing.
DO $patch$
DECLARE
  v_definition text;
  v_patched text;
  v_lower_definition text;
  v_before_into text;
  v_into_position integer;
  v_select_position integer;
  v_statement_end integer;
  v_reverse_position integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.evaluate_customer_ledger_suspension(uuid,numeric)'::regprocedure
  )
  INTO v_definition;

  IF strpos(lower(v_definition), 'trusted_principal_for_user(') = 0 THEN
    v_lower_definition := lower(v_definition);
    v_into_position := strpos(v_lower_definition, 'into trusted_credits');
    v_before_into := substr(v_lower_definition, 1, v_into_position - 1);
    v_reverse_position := strpos(reverse(v_before_into), 'tceles');
    v_select_position := length(v_before_into) - v_reverse_position - 4;
    v_statement_end := CASE
      WHEN v_into_position > 0
      THEN v_into_position + strpos(substr(v_definition, v_into_position), ';') - 1
      ELSE 0
    END;

    IF v_into_position = 0
      OR v_reverse_position = 0
      OR v_statement_end <= v_into_position
    THEN
      RAISE EXCEPTION 'Could not locate evaluator trusted-credit statement for legacy funding';
    END IF;

    v_patched :=
      substr(v_definition, 1, v_select_position - 1)
      || '  trusted_credits := public.trusted_principal_for_user(target_user_id);'
      || substr(v_definition, v_statement_end + 1);

    v_patched := replace(
      v_patched,
      'SELECT id, is_admin, is_staff, account_suspended, suspension_reason, wallet_balance',
      'SELECT id, is_admin, is_staff, account_suspended, suspension_reason, wallet_balance, wallet_review_required'
    );

    v_patched := replace(
      v_patched,
      '''review_required'', COALESCE(profile_row.account_suspended, false) AND COALESCE(profile_row.suspension_reason, '''') LIKE ''Auto-suspended:%''',
      '''review_required'', COALESCE(profile_row.wallet_review_required, false) OR (COALESCE(profile_row.account_suspended, false) AND COALESCE(profile_row.suspension_reason, '''') LIKE ''Auto-suspended:%'')'
    );

    IF strpos(v_patched, 'wallet_review_required') = 0 THEN
      RAISE EXCEPTION 'Could not add wallet review state to evaluate_customer_ledger_suspension';
    END IF;

    EXECUTE v_patched;
  END IF;

  SELECT pg_get_functiondef(
    'public.guard_trusted_principal_transaction()'::regprocedure
  )
  INTO v_definition;

  IF strpos(lower(v_definition), 'trusted_principal_for_user(') = 0 THEN
    v_lower_definition := lower(v_definition);
    v_into_position := strpos(v_lower_definition, 'into v_trusted_principal');
    v_before_into := substr(v_lower_definition, 1, v_into_position - 1);
    v_reverse_position := strpos(reverse(v_before_into), 'tceles');
    v_select_position := length(v_before_into) - v_reverse_position - 4;
    v_statement_end := CASE
      WHEN v_into_position > 0
      THEN v_into_position + strpos(substr(v_definition, v_into_position), ';') - 1
      ELSE 0
    END;

    IF v_into_position = 0
      OR v_reverse_position = 0
      OR v_statement_end <= v_into_position
    THEN
      RAISE EXCEPTION 'Could not locate transaction-guard trusted-credit statement for legacy funding';
    END IF;

    v_patched :=
      substr(v_definition, 1, v_select_position - 1)
      || '  SELECT public.trusted_principal_for_user(NEW.user_id)'
      || chr(10) || '    INTO v_trusted_principal;'
      || substr(v_definition, v_statement_end + 1);

    EXECUTE v_patched;
  END IF;

  SELECT pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  )
  INTO v_definition;

  IF strpos(lower(v_definition), 'trusted_principal_for_user(') = 0 THEN
    v_lower_definition := lower(v_definition);
    v_into_position := strpos(v_lower_definition, 'into v_trusted_credits');
    v_before_into := substr(v_lower_definition, 1, v_into_position - 1);
    v_reverse_position := strpos(reverse(v_before_into), 'tceles');
    v_select_position := length(v_before_into) - v_reverse_position - 4;
    v_statement_end := CASE
      WHEN v_into_position > 0
      THEN v_into_position + strpos(substr(v_definition, v_into_position), ';') - 1
      ELSE 0
    END;

    IF v_into_position = 0
      OR v_reverse_position = 0
      OR v_statement_end <= v_into_position
    THEN
      RAISE EXCEPTION 'Could not locate wallet-engine trusted-credit statement for legacy funding';
    END IF;

    v_patched :=
      substr(v_definition, 1, v_select_position - 1)
      || '    SELECT public.trusted_principal_for_user(p_user_id)'
      || chr(10) || '      INTO v_trusted_credits;'
      || substr(v_definition, v_statement_end + 1);

    EXECUTE v_patched;
  END IF;
END;
$patch$;

COMMENT ON FUNCTION public.trusted_principal_for_user(uuid) IS
  'Returns grandfathered pre-cutoff principal plus strictly verified post-cutoff deposits and approved admin credits.';
