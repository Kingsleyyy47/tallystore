-- Record owner-verified credits that an older admin path already added to the
-- displayed wallet without a committed ledger row. This never changes balance.
-- No historical credit is inserted by this migration.
CREATE TABLE IF NOT EXISTS public.wallet_historical_admin_funding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  amount numeric NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  original_credit_at timestamptz NOT NULL
    CHECK (original_credit_at <= recorded_at),
  approved_by uuid NOT NULL REFERENCES public.profiles(id),
  approval_reference text NOT NULL UNIQUE CHECK (length(btrim(approval_reference)) >= 8),
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) >= 20),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  balance_already_includes_amount boolean NOT NULL DEFAULT true
    CHECK (balance_already_includes_amount)
);

CREATE INDEX IF NOT EXISTS wallet_historical_admin_funding_user_idx
  ON public.wallet_historical_admin_funding (user_id);
ALTER TABLE public.wallet_historical_admin_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_historical_admin_funding
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_historical_wallet_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Historical wallet evidence is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_historical_wallet_evidence_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_historical_admin_funding_immutable
  ON public.wallet_historical_admin_funding;
CREATE TRIGGER guard_historical_admin_funding_immutable
BEFORE UPDATE OR DELETE ON public.wallet_historical_admin_funding
FOR EACH ROW EXECUTE FUNCTION public.guard_historical_wallet_evidence_immutable();

DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  IF to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Historical admin funding requires canonical financial truth';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, '  historical_admin AS (') > 0 THEN
    IF pg_catalog.strpos(v_definition, 'approved_historical_admin_credits') = 0 THEN
      RAISE EXCEPTION 'Historical admin funding patch is incomplete';
    END IF;
    RETURN;
  END IF;

  v_old := '  ledger AS (';
  v_new := $replacement$  historical_admin AS (
    SELECT COALESCE(SUM(h.amount), 0)::numeric AS amount,
      COUNT(*)::integer AS recovery_rows
    FROM public.wallet_historical_admin_funding h
    WHERE h.user_id = p_user_id
  ),
  ledger AS ($replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical ledger anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'f.verified_payment_rows, f.approved_admin_rows,';
  v_new := $replacement$f.verified_payment_rows,
      (f.approved_admin_rows + a.recovery_rows) AS approved_admin_rows,
      a.recovery_rows AS approved_historical_admin_rows,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical admin-credit count anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'f.verified_gateway_deposits, f.approved_admin_credits,';
  v_new := $replacement$f.verified_gateway_deposits,
      (f.approved_admin_credits + a.amount) AS approved_admin_credits,
      a.amount AS approved_historical_admin_credits,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical admin-credit anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $existing$    'approved_admin_rows', b.approved_admin_rows,$existing$;
  v_new := $replacement$    'approved_admin_rows', b.approved_admin_rows,
    'approved_historical_admin_rows', b.approved_historical_admin_rows,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical admin-credit output count anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := '(l.principal + f.verified_gateway_deposits + f.approved_admin_credits)';
  v_new := '(l.principal + f.verified_gateway_deposits + f.approved_admin_credits + a.amount)';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical trusted-principal anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'm.completed_refunds, m.expected_ledger_balance, m.unclassified_posted_rows,';
  v_new := $replacement$m.completed_refunds,
      m.expected_ledger_balance AS recorded_transaction_balance,
      (m.expected_ledger_balance + a.amount) AS expected_ledger_balance,
      m.unclassified_posted_rows,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical expected-balance anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $existing$    'expected_ledger_balance', b.expected_ledger_balance,$existing$;
  v_new := $replacement$    'expected_ledger_balance', b.expected_ledger_balance,
    'recorded_transaction_balance', b.recorded_transaction_balance,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical raw transaction balance anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := '    CROSS JOIN funding f';
  v_new := $replacement$    CROSS JOIN historical_admin a
    CROSS JOIN funding f$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical facts join changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $existing$    'approved_admin_credits', b.approved_admin_credits,$existing$;
  v_new := $replacement$    'approved_admin_credits', b.approved_admin_credits,
    'approved_historical_admin_credits', b.approved_historical_admin_credits,$replacement$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Canonical output anchor changed; review funding patch';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  EXECUTE v_definition;
END;
$patch$;

CREATE TABLE IF NOT EXISTS public.wallet_historical_review_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  funding_reference text NOT NULL REFERENCES public.wallet_historical_admin_funding(approval_reference),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  previous_reason text,
  review_note text NOT NULL,
  truth_before jsonb NOT NULL,
  truth_after jsonb NOT NULL
);

ALTER TABLE public.wallet_historical_review_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_historical_review_resolutions
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_historical_review_resolutions_immutable
  ON public.wallet_historical_review_resolutions;
CREATE TRIGGER guard_historical_review_resolutions_immutable
BEFORE UPDATE OR DELETE ON public.wallet_historical_review_resolutions
FOR EACH ROW EXECUTE FUNCTION public.guard_historical_wallet_evidence_immutable();

CREATE OR REPLACE FUNCTION public.resolve_reviewed_historical_admin_funding(
  p_user_id uuid, p_approval_reference text, p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_approver uuid;
  v_before jsonb;
  v_after jsonb;
  v_old_context text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Historical wallet review requires the database owner';
  END IF;
  IF length(btrim(COALESCE(p_review_note, ''))) < 20 THEN
    RAISE EXCEPTION 'A specific owner review note is required';
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet profile not found';
  END IF;
  IF NOT v_profile.wallet_review_required THEN
    RAISE EXCEPTION 'Wallet review is not active';
  END IF;
  IF COALESCE(v_profile.account_suspended, false) THEN
    RAISE EXCEPTION 'Manual account suspension requires separate review';
  END IF;
  IF NOT (
    COALESCE(v_profile.wallet_review_reason, '') LIKE 'Auto-suspended:%'
    OR COALESCE(v_profile.wallet_review_reason, '') LIKE 'Wallet frozen:%'
    OR COALESCE(v_profile.wallet_review_reason, '') LIKE 'Wallet financial review:%'
  ) THEN
    RAISE EXCEPTION 'Wallet review reason requires separate investigation';
  END IF;

  SELECT h.approved_by INTO v_approver
  FROM public.wallet_historical_admin_funding h
  WHERE h.user_id = p_user_id
    AND h.approval_reference = p_approval_reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No matching owner-approved historical funding';
  END IF;

  v_before := public.wallet_financial_truth_internal(p_user_id);
  IF COALESCE((v_before->>'evidence_complete')::boolean, false) = false
    OR (v_before->>'trusted_book_balance')::numeric < 0
    OR (v_before->>'unexplained_difference')::numeric <> 0
    OR (v_before->>'integrity_status') NOT IN ('consistent', 'quarantined_excess')
  THEN
    RAISE EXCEPTION 'Wallet still has unresolved financial inconsistency';
  END IF;

  v_old_context := current_setting('app.tally_profile_privileged_authorized', true);
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
  UPDATE public.profiles
     SET wallet_review_required = false,
         wallet_review_reason = NULL,
         wallet_reviewed_at = now(),
         wallet_reviewed_by = v_approver,
         updated_at = now()
   WHERE id = p_user_id;
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized',
    COALESCE(v_old_context, ''), true);

  v_after := public.wallet_financial_truth_internal(p_user_id);
  IF (v_after->>'spending_blocked')::boolean
    OR (v_after->>'confirmed_spendable')::numeric >
      GREATEST(LEAST((v_after->>'trusted_book_balance')::numeric,
                     (v_after->>'stored_wallet_balance')::numeric), 0)
  THEN
    RAISE EXCEPTION 'Review release did not pass the purchase gate';
  END IF;

  INSERT INTO public.wallet_historical_review_resolutions (
    user_id, funding_reference, reviewed_by, previous_reason, review_note,
    truth_before, truth_after
  ) VALUES (
    p_user_id, p_approval_reference, v_approver, v_profile.wallet_review_reason,
    btrim(p_review_note), v_before, v_after
  );
  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_reviewed_historical_admin_funding(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_reviewed_historical_admin_funding(uuid,text,text)
  TO postgres;
