-- Recognize refunds created by the old SMM flow before it recorded source
-- debit metadata. These rows still need a matching trusted debit and a
-- cancelled/partial SMM order. Current refunds keep the strict metadata link.
DO $patch$
DECLARE
  v_definition text;
  v_old text := $old$
      AND public.wallet_refund_links_debit(
        r.metadata, d.id, d.idempotency_key, d.metadata, d.reference
      )$old$;
  v_new text := $new$
      AND (
        public.wallet_refund_links_debit(
          r.metadata, d.id, d.idempotency_key, d.metadata, d.reference
        )
        OR (
          COALESCE(r.metadata, '{}'::jsonb) = '{}'::jsonb
          AND r.created_at >= d.created_at
          AND r.created_at < public.wallet_legacy_funding_cutoff()
          AND d.created_at < public.wallet_legacy_funding_cutoff()
          AND r.amount <= abs(d.amount)
          AND r.reference = 'REFUND-' || d.reference
          AND EXISTS (
            SELECT 1
            FROM public.smm_orders o
            WHERE o.user_id = r.user_id
              AND o.reference = d.reference
              AND o.amount_ngn = abs(d.amount)
              AND o.status IN ('cancelled', 'partial')
          )
        )
      )$new$;
  v_cycles_old text := $old$
  movements AS ($old$;
  v_cycles_new text := $new$
  legacy_failed_smm_cycles AS (
    SELECT COALESCE(SUM(r.amount), 0)::numeric AS neutral_refunds
    FROM public.transactions d
    JOIN public.transactions r
      ON r.user_id = d.user_id
      AND r.reference = 'REFUND-' || d.reference
      AND lower(COALESCE(r.type, '')) = 'refund'
      AND lower(COALESCE(r.status, '')) = 'completed'
      AND r.amount = abs(d.amount)
      AND COALESCE(r.metadata, '{}'::jsonb) = '{}'::jsonb
    JOIN public.smm_orders o
      ON o.user_id = d.user_id
      AND o.reference = d.reference
      AND o.status = 'failed'
      AND o.amount_ngn = abs(d.amount)
    WHERE d.user_id = p_user_id
      AND COALESCE(d.balance_type, 'wallet') = 'wallet'
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(d.type, '')) = 'purchase'
      AND lower(COALESCE(d.status, '')) = 'failed'
      AND d.amount < 0
      AND d.balance_before IS NULL
      AND d.balance_after IS NOT NULL
      AND r.balance_after IS NOT NULL
      AND r.balance_after - d.balance_after = r.amount
      AND d.created_at <= r.created_at
      AND d.created_at < public.wallet_legacy_funding_cutoff()
      AND r.created_at < public.wallet_legacy_funding_cutoff()
  ),
  movements AS ($new$;
  v_balance_old text := $old$
      m.expected_ledger_balance AS recorded_transaction_balance,
      (m.expected_ledger_balance + a.amount) AS expected_ledger_balance,$old$;
  v_balance_new text := $new$
      (m.expected_ledger_balance - n.neutral_refunds) AS recorded_transaction_balance,
      (m.expected_ledger_balance - n.neutral_refunds + a.amount) AS expected_ledger_balance,$new$;
  v_join_old text := $old$
    CROSS JOIN movements m
    CROSS JOIN refunds r$old$;
  v_join_new text := $new$
    CROSS JOIN movements m
    CROSS JOIN legacy_failed_smm_cycles n
    CROSS JOIN refunds r$new$;
BEGIN
  SELECT replace(
    pg_catalog.pg_get_functiondef(
      'public.wallet_financial_truth_internal(uuid)'::regprocedure
    ), E'\r\n', E'\n'
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_old) = 0
    OR pg_catalog.strpos(v_definition, 'r.reference = ''REFUND-'' || d.reference') > 0
    OR length(v_definition) - length(pg_catalog.replace(v_definition, v_old, '')) <> length(v_old)
  THEN
    RAISE EXCEPTION 'Unexpected canonical refund matcher; review deployed definition';
  END IF;

  IF pg_catalog.strpos(v_definition, v_cycles_old) = 0
    OR length(v_definition) - length(pg_catalog.replace(v_definition, v_cycles_old, '')) <> length(v_cycles_old)
    OR pg_catalog.strpos(v_definition, v_balance_old) = 0
    OR length(v_definition) - length(pg_catalog.replace(v_definition, v_balance_old, '')) <> length(v_balance_old)
    OR pg_catalog.strpos(v_definition, v_join_old) = 0
    OR length(v_definition) - length(pg_catalog.replace(v_definition, v_join_old, '')) <> length(v_join_old)
  THEN
    RAISE EXCEPTION 'Unexpected canonical balance calculation; review deployed definition';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(v_definition, v_cycles_old, v_cycles_new);
  v_definition := pg_catalog.replace(v_definition, v_balance_old, v_balance_new);
  v_definition := pg_catalog.replace(v_definition, v_join_old, v_join_new);
  EXECUTE v_definition;
END;
$patch$;
