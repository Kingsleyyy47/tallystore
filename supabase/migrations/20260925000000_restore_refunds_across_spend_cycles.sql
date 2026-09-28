-- A principal can be spent and refunded more than once. Per-original-debit
-- conservation remains mandatory, but lifetime refund restoration must not
-- be capped at the lifetime amount ever deposited.
DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := $old$
      LEAST(r.linked_eligible_refunds,
        LEAST(m.completed_debits,
          l.principal + f.verified_gateway_deposits + f.approved_admin_credits))
        AS eligible_refunds,$old$;
  v_new := $new$
      LEAST(r.linked_eligible_refunds, m.completed_debits)
        AS eligible_refunds,$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unexpected canonical refund calculation';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);

  SELECT pg_catalog.pg_get_functiondef(
    'public.guard_trusted_principal_transaction()'::regprocedure
  ) INTO v_definition;
  v_old := $old$
  v_refundable_remaining := GREATEST(
    LEAST(
      (v_financial_truth->>'completed_debits')::numeric,
      (v_financial_truth->>'trusted_principal')::numeric
    ) - (v_financial_truth->>'eligible_refunds')::numeric,
    0
  );$old$;
  v_new := $new$
  v_refundable_remaining := GREATEST(
    (v_financial_truth->>'completed_debits')::numeric
      - (v_financial_truth->>'eligible_refunds')::numeric,
    0
  );$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unexpected refund trigger capacity calculation';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);

  SELECT pg_catalog.pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '    v_refundable_remaining := GREATEST(v_trusted_debit_capacity - v_completed_refunds, 0);';
  v_new := $new$    v_financial_truth := public.wallet_financial_truth_internal(p_user_id);
    v_refundable_remaining := GREATEST(
      (v_financial_truth->>'completed_debits')::numeric
        - (v_financial_truth->>'eligible_refunds')::numeric,
      0
    );$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0
    OR pg_catalog.strpos(v_definition, 'v_financial_truth jsonb;') = 0 THEN
    RAISE EXCEPTION 'Unexpected wallet engine refund capacity calculation';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch$;
