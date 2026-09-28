-- Use one strict refund-to-original-debit matcher in the reader and writers.
-- A supplied debit ID takes precedence over a key, order ID, or reference;
-- a mismatching stronger identifier never falls through to a weaker one.
CREATE OR REPLACE FUNCTION public.wallet_refund_links_debit(
  p_refund_metadata jsonb,
  p_debit_id uuid,
  p_debit_idempotency_key text,
  p_debit_metadata jsonb,
  p_debit_reference text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH identifiers AS (
    SELECT
      NULLIF(btrim(COALESCE(p_refund_metadata->>'source_debit_transaction_id', '')), '') AS debit_id,
      NULLIF(btrim(COALESCE(
        p_refund_metadata->>'source_debit_idempotency_key',
        p_refund_metadata->>'original_purchase_idempotency_key', ''
      )), '') AS debit_key,
      NULLIF(btrim(COALESCE(
        p_refund_metadata->>'source_order_id', p_refund_metadata->>'order_id',
        p_refund_metadata->>'transaction_id', ''
      )), '') AS order_id,
      NULLIF(btrim(COALESCE(p_refund_metadata->>'source_order_table', '')), '') AS order_table,
      NULLIF(btrim(COALESCE(p_refund_metadata->>'original_reference', '')), '') AS original_reference
  )
  SELECT COALESCE(CASE
    WHEN debit_id IS NOT NULL THEN lower(debit_id) = p_debit_id::text
    WHEN debit_key IS NOT NULL THEN debit_key = NULLIF(btrim(COALESCE(p_debit_idempotency_key, '')), '')
    WHEN order_id IS NOT NULL THEN
      order_id IN (
        NULLIF(btrim(COALESCE(p_debit_metadata->>'source_order_id', '')), ''),
        NULLIF(btrim(COALESCE(p_debit_metadata->>'order_id', '')), ''),
        NULLIF(btrim(COALESCE(p_debit_metadata->>'transaction_id', '')), '')
      ) AND (
        order_table IS NULL OR order_table =
          NULLIF(btrim(COALESCE(p_debit_metadata->>'source_order_table', '')), '')
      )
    WHEN original_reference IS NOT NULL THEN
      original_reference = NULLIF(btrim(COALESCE(p_debit_reference, '')), '')
    ELSE false
  END, false)
  FROM identifiers;
$function$;

REVOKE ALL ON FUNCTION public.wallet_refund_links_debit(jsonb,uuid,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_refund_links_debit(jsonb,uuid,text,jsonb,text)
  TO service_role;

DO $patch$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
  v_target text;
  v_metadata text;
  v_anchor text;
  v_boundary text;
BEGIN
  IF to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_internal must exist before refund-link patch';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'AND public.wallet_refund_links_debit(') = 0 THEN
    v_anchor := $anchor$      AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
      AND ($anchor$;
    v_start := pg_catalog.strpos(v_definition, v_anchor);
    IF v_start = 0 THEN
      RAISE EXCEPTION 'Unexpected canonical refund-matching anchor';
    END IF;
    v_start := v_start + pg_catalog.length(v_anchor) - pg_catalog.length('      AND (');
    v_boundary := '    WHERE r.is_refund AND r.amount > 0';
    v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start), v_boundary);
    IF v_end = 0 THEN
      RAISE EXCEPTION 'Unexpected canonical refund-matching boundary';
    END IF;
    v_end := v_start + v_end - 1;
    v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
      $replacement$      AND public.wallet_refund_links_debit(
        r.metadata, d.id, d.idempotency_key, d.metadata, d.reference
      )
$replacement$ || pg_catalog.substr(v_definition, v_end);
    EXECUTE v_definition;
  END IF;

  FOREACH v_target IN ARRAY ARRAY[
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)',
    'public.guard_trusted_principal_transaction()'
  ] LOOP
    IF to_regprocedure(v_target) IS NULL THEN
      RAISE EXCEPTION 'Required refund writer missing: %', v_target;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_target)) INTO v_definition;
    v_metadata := CASE WHEN v_target LIKE '%apply_wallet_transaction%'
      THEN 'p_metadata' ELSE 'NEW.metadata' END;

    IF pg_catalog.strpos(v_definition, 'AND public.wallet_refund_links_debit(') > 0 THEN
      CONTINUE;
    END IF;

    v_anchor := $anchor$      AND (
        (v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id)$anchor$;
    v_start := pg_catalog.strpos(v_definition, v_anchor);
    IF v_start = 0 THEN
      RAISE EXCEPTION 'Unexpected original-debit lookup in %', v_target;
    END IF;
    v_boundary := '    ORDER BY';
    v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start), v_boundary);
    IF v_end = 0 THEN
      RAISE EXCEPTION 'Unexpected original-debit lookup boundary in %', v_target;
    END IF;
    v_end := v_start + v_end - 1;
    v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
      '      AND public.wallet_refund_links_debit(' || v_metadata ||
      ', t.id, t.idempotency_key, t.metadata, t.reference)' || chr(10) ||
      pg_catalog.substr(v_definition, v_end);

    v_anchor := $anchor$      AND (
        NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '')$anchor$;
    v_start := pg_catalog.strpos(v_definition, v_anchor);
    IF v_start = 0 THEN
      RAISE EXCEPTION 'Unexpected refund-cap matcher in %', v_target;
    END IF;
    v_boundary := '      );';
    v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start), v_boundary);
    IF v_end = 0 THEN
      RAISE EXCEPTION 'Unexpected refund-cap boundary in %', v_target;
    END IF;
    v_end := v_start + v_end - 1 + pg_catalog.length(v_boundary);
    v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
      $replacement$      AND public.wallet_refund_links_debit(
        r.metadata, v_original_debit.id, v_original_debit.idempotency_key,
        v_original_debit.metadata, v_original_debit.reference
      );$replacement$ || pg_catalog.substr(v_definition, v_end);

    EXECUTE v_definition;
  END LOOP;
END;
$patch$;
