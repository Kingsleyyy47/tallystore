-- Record a provider-confirmed old Ercas payment whose balance was already
-- credited but whose wallet ledger credit is missing. This evidence never
-- increments profiles.wallet_balance or creates a synthetic transaction.
DO $preflight$
BEGIN
  IF to_regclass('public.wallet_missing_gateway_funding') IS NOT NULL
     OR to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'Missing Ercas funding recovery preflight failed';
  END IF;
END;
$preflight$;

CREATE TABLE public.wallet_missing_gateway_funding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_payment_id uuid NOT NULL UNIQUE REFERENCES public.pending_payments(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'ercaspay'),
  provider_reference text NOT NULL UNIQUE CHECK (provider_reference LIKE 'ER|%'),
  confirmed_amount numeric(18, 2) NOT NULL CHECK (confirmed_amount > 0),
  provider_status text NOT NULL CHECK (provider_status = 'SUCCESSFUL'),
  balance_already_includes_amount boolean NOT NULL DEFAULT true CHECK (balance_already_includes_amount),
  provider_checked_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) >= 12)
);
ALTER TABLE public.wallet_missing_gateway_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_missing_gateway_funding FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wallet_missing_gateway_funding TO service_role;

DO $patch$
DECLARE
  v_definition text;
  v_cte_old text := $old$
  duplicate_payment_identities AS ($old$;
  v_cte_new text := $new$
  recovered_ercas_missing AS (
    SELECT COALESCE(SUM(c.confirmed_amount), 0)::numeric AS amount,
      COUNT(*)::integer AS payment_rows
    FROM public.wallet_missing_gateway_funding c
    JOIN public.pending_payments pp
      ON pp.id = c.pending_payment_id
      AND pp.user_id = c.user_id
      AND pp.transaction_reference = c.provider_reference
      AND pp.amount = c.confirmed_amount
    WHERE c.user_id = p_user_id
      AND c.provider = 'ercaspay'
      AND c.provider_status = 'SUCCESSFUL'
      AND c.balance_already_includes_amount
      AND c.provider_checked_at >= pp.created_at
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = c.user_id
          AND t.reference = c.provider_reference
          AND lower(COALESCE(t.type, '')) IN
            ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      )
  ),
  duplicate_payment_identities AS ($new$;
  v_deposits_old text := $old$      (f.verified_gateway_deposits + q.amount) AS verified_gateway_deposits,$old$;
  v_deposits_new text := $new$      (f.verified_gateway_deposits + q.amount + e.amount) AS verified_gateway_deposits,$new$;
  v_rows_old text := $old$      (f.verified_payment_rows + q.payment_rows) AS verified_payment_rows,$old$;
  v_rows_new text := $new$      (f.verified_payment_rows + q.payment_rows + e.payment_rows) AS verified_payment_rows,$new$;
  v_principal_old text := $old$      (l.principal + f.verified_gateway_deposits + q.amount + f.approved_admin_credits + a.amount)
        AS trusted_principal,$old$;
  v_principal_new text := $new$      (l.principal + f.verified_gateway_deposits + q.amount + e.amount + f.approved_admin_credits + a.amount)
        AS trusted_principal,$new$;
  v_expected_old text := $old$      (m.expected_ledger_balance - n.neutral_refunds + a.amount) AS expected_ledger_balance,$old$;
  v_expected_new text := $new$      (m.expected_ledger_balance - n.neutral_refunds + a.amount + e.amount) AS expected_ledger_balance,$new$;
  v_join_old text := $old$    CROSS JOIN recovered_pocketfi q
    CROSS JOIN movements m$old$;
  v_join_new text := $new$    CROSS JOIN recovered_pocketfi q
    CROSS JOIN recovered_ercas_missing e
    CROSS JOIN movements m$new$;
BEGIN
  SELECT replace(pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ), E'\r\n', E'\n') INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_cte_old) = 0
     OR pg_catalog.strpos(v_definition, v_deposits_old) = 0
     OR pg_catalog.strpos(v_definition, v_rows_old) = 0
     OR pg_catalog.strpos(v_definition, v_principal_old) = 0
     OR pg_catalog.strpos(v_definition, v_expected_old) = 0
     OR pg_catalog.strpos(v_definition, v_join_old) = 0
     OR pg_catalog.strpos(v_definition, 'recovered_ercas_missing AS (') > 0
  THEN
    RAISE EXCEPTION 'Unexpected deployed wallet truth; review before recovery';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_cte_old, v_cte_new);
  v_definition := pg_catalog.replace(v_definition, v_deposits_old, v_deposits_new);
  v_definition := pg_catalog.replace(v_definition, v_rows_old, v_rows_new);
  v_definition := pg_catalog.replace(v_definition, v_principal_old, v_principal_new);
  v_definition := pg_catalog.replace(v_definition, v_expected_old, v_expected_new);
  v_definition := pg_catalog.replace(v_definition, v_join_old, v_join_new);
  EXECUTE v_definition;
END;
$patch$;
