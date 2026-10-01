-- Record provider-confirmed PocketFi transfers from the short post-cutoff
-- period before top-up rows carried the newer verification fields. The table
-- is append-only evidence; inserting a row never changes a wallet balance.
DO $preflight$
BEGIN
  IF to_regclass('public.wallet_provider_confirmations') IS NOT NULL
     OR to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'Historical PocketFi recovery preflight failed';
  END IF;
END;
$preflight$;

CREATE TABLE public.wallet_provider_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'pocketfi'),
  provider_reference text NOT NULL UNIQUE CHECK (provider_reference LIKE 'PFI|%'),
  confirmed_amount numeric(18, 2) NOT NULL CHECK (confirmed_amount > 0),
  provider_status text NOT NULL CHECK (provider_status = 'completed'),
  provider_checked_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) >= 12)
);
ALTER TABLE public.wallet_provider_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_provider_confirmations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wallet_provider_confirmations TO service_role;

DO $patch$
DECLARE
  v_definition text;
  v_funding_old text := $old$
  duplicate_payment_identities AS ($old$;
  v_funding_new text := $new$
  recovered_pocketfi AS (
    SELECT COALESCE(SUM(t.amount), 0)::numeric AS amount,
      COUNT(*)::integer AS payment_rows
    FROM public.wallet_provider_confirmations c
    JOIN public.transactions t
      ON t.id = c.transaction_id
      AND t.user_id = c.user_id
      AND t.reference = c.provider_reference
      AND t.amount = c.confirmed_amount
    JOIN public.profiles pc ON pc.id = t.user_id
    WHERE t.user_id = p_user_id
      AND lower(COALESCE(t.type, '')) IN
        ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      AND lower(COALESCE(t.status, '')) IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND t.amount > 0
      AND t.created_at >= public.wallet_legacy_funding_cutoff()
      AND t.created_at < '2026-09-24 00:00:00+00'::timestamptz
      AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NULL
      AND c.provider = 'pocketfi'
      AND c.provider_status = 'completed'
      AND c.provider_checked_at >= t.created_at
      AND EXISTS (
        SELECT 1
        FROM public.pocketfi_webhook_logs w
        WHERE w.matched_user_id = t.user_id
          AND w.matched_account_number = pc.pocketfi_account_number
          AND w.processed
          AND w.error_message IS NULL
          AND w.raw_payload::jsonb->'transaction'->>'reference' = t.reference
          AND (w.raw_payload::jsonb->'order'->>'amount')::numeric = t.amount
      )
  ),
  duplicate_payment_identities AS ($new$;
  v_deposits_old text := $old$      f.verified_gateway_deposits,$old$;
  v_deposits_new text := $new$      (f.verified_gateway_deposits + q.amount) AS verified_gateway_deposits,$new$;
  v_rows_old text := $old$      f.verified_payment_rows,$old$;
  v_rows_new text := $new$      (f.verified_payment_rows + q.payment_rows) AS verified_payment_rows,$new$;
  v_principal_old text := $old$      (l.principal + f.verified_gateway_deposits + f.approved_admin_credits + a.amount)
        AS trusted_principal,$old$;
  v_principal_new text := $new$      (l.principal + f.verified_gateway_deposits + q.amount + f.approved_admin_credits + a.amount)
        AS trusted_principal,$new$;
  v_join_old text := $old$    CROSS JOIN funding f
    CROSS JOIN movements m$old$;
  v_join_new text := $new$    CROSS JOIN funding f
    CROSS JOIN recovered_pocketfi q
    CROSS JOIN movements m$new$;
BEGIN
  SELECT replace(pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ), E'\r\n', E'\n') INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_funding_old) = 0
     OR pg_catalog.strpos(v_definition, v_deposits_old) = 0
     OR pg_catalog.strpos(v_definition, v_rows_old) = 0
     OR pg_catalog.strpos(v_definition, v_principal_old) = 0
     OR pg_catalog.strpos(v_definition, v_join_old) = 0
     OR pg_catalog.strpos(v_definition, 'recovered_pocketfi AS (') > 0
  THEN
    RAISE EXCEPTION 'Unexpected deployed wallet truth; review before recovery';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_funding_old, v_funding_new);
  v_definition := pg_catalog.replace(v_definition, v_deposits_old, v_deposits_new);
  v_definition := pg_catalog.replace(v_definition, v_rows_old, v_rows_new);
  v_definition := pg_catalog.replace(v_definition, v_principal_old, v_principal_new);
  v_definition := pg_catalog.replace(v_definition, v_join_old, v_join_new);
  EXECUTE v_definition;
END;
$patch$;
