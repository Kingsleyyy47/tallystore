-- Admin ledger-repair rows preserve evidence but do not move wallet value.
-- Exclude only rows with the exact repair markers and unchanged snapshots.
DO $patch$
DECLARE
  v_definition text;
  v_existing text := $existing$  posted AS (
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
$existing$;
  v_replacement text := $replacement$  posted AS (
    SELECT t.*
    FROM ledger t
    WHERE (
      t.movement_status IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      OR (
        t.amount < 0
        AND t.balance_before IS NOT NULL
        AND t.balance_after IS NOT NULL
        AND round(t.balance_before - t.balance_after, 2) = round(abs(t.amount), 2)
      )
    )
    AND NOT (
      t.movement_type IN ('admin_credit', 'correction_credit')
      AND t.amount > 0
      AND t.balance_before IS NOT NULL
      AND t.balance_after IS NOT NULL
      AND t.balance_before = t.balance_after
      AND COALESCE(t.metadata->>'source', '') = 'admin-ledger-repair'
      AND COALESCE(t.metadata->>'balance_unchanged', '') = 'true'
      AND COALESCE(t.metadata->>'requires_owner_evidence', '') = 'true'
    )
  ),
$replacement$;
BEGIN
  IF to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_internal must exist before neutral-evidence patch';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_replacement) > 0 THEN
    RETURN;
  END IF;
  IF pg_catalog.strpos(v_definition, v_existing) = 0 THEN
    RAISE EXCEPTION 'Unexpected canonical posted-movement definition';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_existing, v_replacement);
END;
$patch$;
