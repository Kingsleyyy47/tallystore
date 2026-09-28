-- A provider evidence row can support only one trusted wallet credit, even
-- when two ledger rows carry different external_payment_id values. Keep the
-- existing credit history visible, but block spending until it is reconciled.
DO $patch$
DECLARE
  v_definition text;
  v_old_uuid_check text := $old_uuid$'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$old_uuid$;
  v_new_uuid_check text := $new_uuid$'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$new_uuid$;
  v_old text := $old$
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
  ),$old$;
  v_new text := $new$
  duplicate_payment_identities AS (
    SELECT COUNT(*)::integer AS count
    FROM (
      SELECT 'external:' || lower(COALESCE(t.metadata->>'provider', '')) || ':' ||
        btrim(t.external_payment_id) AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
      GROUP BY 1
      HAVING COUNT(*) > 1

      UNION ALL

      SELECT 'ercas-evidence:' || pp.id::text AS identity
      FROM funding_rows t
      JOIN public.pending_payments pp
        ON pp.user_id = t.user_id
        AND round(pp.amount, 2) = round(t.amount, 2)
        AND lower(COALESCE(pp.status, 'pending')) = 'credited'
        AND (
          pp.transaction_reference = NULLIF(btrim(COALESCE(t.reference, '')), '')
          OR pp.transaction_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          OR pp.ercas_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
        )
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
      GROUP BY pp.id
      HAVING COUNT(DISTINCT t.id) > 1

      UNION ALL

      SELECT 'pocketfi-evidence:' || (t.metadata->>'webhook_log_id') AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
      GROUP BY t.metadata->>'webhook_log_id'
      HAVING COUNT(DISTINCT t.id) > 1
    ) duplicates
  ),$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unexpected canonical payment-identity calculation';
  END IF;
  IF pg_catalog.strpos(v_definition, v_old_uuid_check) = 0 THEN
    RAISE EXCEPTION 'Unexpected PocketFi webhook evidence ID check';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(v_definition, v_old_uuid_check, v_new_uuid_check);
  EXECUTE v_definition;
END;
$patch$;
