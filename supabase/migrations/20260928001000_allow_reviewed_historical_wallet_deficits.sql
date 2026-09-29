-- Owner-approved historical credits may expose an older negative balance gap.
-- A deficit cannot create spendable value: the canonical purchase gate caps
-- confirmed_spendable by the lower stored balance. Keep the deficit in the
-- immutable review snapshot while allowing the backed portion to be used.
ALTER TABLE public.wallet_historical_admin_funding
  ADD COLUMN IF NOT EXISTS first_observed_transaction_id uuid
    REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS credit_time_basis text NOT NULL DEFAULT 'owner_reported'
    CHECK (credit_time_basis IN ('owner_reported', 'first_observed_before_anchor'));

CREATE UNIQUE INDEX IF NOT EXISTS wallet_historical_admin_funding_anchor_idx
  ON public.wallet_historical_admin_funding (first_observed_transaction_id)
  WHERE first_observed_transaction_id IS NOT NULL;

DO $patch$
DECLARE
  v_definition text;
  v_old text := $old$    OR (v_before->>'unexplained_difference')::numeric <> 0
    OR (v_before->>'integrity_status') NOT IN ('consistent', 'quarantined_excess')$old$;
  v_new text := $new$    OR (v_before->>'unexplained_difference')::numeric > 0
    OR (v_before->>'integrity_status') NOT IN
      ('consistent', 'quarantined_excess', 'stored_balance_deficit')$new$;
BEGIN
  IF to_regprocedure('public.resolve_reviewed_historical_admin_funding(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Historical review resolver must be installed first';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(
    'public.resolve_reviewed_historical_admin_funding(uuid,text,text)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_new) > 0 THEN
    RETURN;
  END IF;
  IF pg_catalog.strpos(v_definition, v_old) = 0
    OR pg_catalog.strpos(v_definition,
      $guard$OR (v_after->>'confirmed_spendable')::numeric >$guard$) = 0
  THEN
    RAISE EXCEPTION 'Historical review resolver changed; inspect before patching';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch$;
