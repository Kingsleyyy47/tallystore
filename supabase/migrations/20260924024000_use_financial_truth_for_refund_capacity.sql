-- Keep the original-debit refund linkage checks in the existing trigger, but
-- remove its separate full-history principal/refund calculation. It can
-- disagree with the canonical reader after an admin-role change or a legacy
-- funding approval.
DO $patch$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.guard_trusted_principal_transaction()'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition,
    '(v_financial_truth->>''eligible_refunds'')::numeric') > 0
  THEN
    RETURN;
  END IF;

  -- The legacy-funding migration replaced the original SUM with this helper.
  v_start := pg_catalog.strpos(v_definition,
    '  SELECT public.trusted_principal_for_user(NEW.user_id)');
  IF v_start = 0 THEN
    v_start := pg_catalog.strpos(v_definition,
      '  SELECT COALESCE(SUM(amount), 0)' || chr(10) ||
      '    INTO v_trusted_principal');
  END IF;
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected refund guard principal calculation';
  END IF;
  IF pg_catalog.strpos(v_definition,
    '  v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);') = 0
  THEN
    RAISE EXCEPTION 'Canonical purchase guard must exist before refund guard patch';
  END IF;
  v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start),
    '  IF v_type = ''purchase'' THEN');
  IF v_end = 0 THEN
    RAISE EXCEPTION 'Unexpected refund guard purchase boundary';
  END IF;
  v_end := v_start + v_end - 1;

  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);
  v_refundable_remaining := GREATEST(
    LEAST(
      (v_financial_truth->>'completed_debits')::numeric,
      (v_financial_truth->>'trusted_principal')::numeric
    ) - (v_financial_truth->>'eligible_refunds')::numeric,
    0
  );

$body$ || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;
END;
$patch$;
