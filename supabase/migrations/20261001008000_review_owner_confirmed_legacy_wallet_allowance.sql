-- The owner confirmed that the existing Tallystore wallet balance came from
-- earlier admin top-ups. Restore only its balance at the policy snapshot.
-- This does not post a credit or approve any later balance increase.
CREATE TABLE public.wallet_legacy_spend_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_reference text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid NOT NULL REFERENCES public.profiles(id),
  baseline_before numeric NOT NULL CHECK (baseline_before >= 0),
  baseline_after numeric NOT NULL CHECK (baseline_after > baseline_before),
  stored_balance_at_snapshot numeric NOT NULL CHECK (stored_balance_at_snapshot >= baseline_after),
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) >= 40),
  approved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_legacy_spend_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_legacy_spend_approvals
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_legacy_spend_approvals_immutable
BEFORE UPDATE OR DELETE ON public.wallet_legacy_spend_approvals
FOR EACH ROW EXECUTE FUNCTION public.guard_historical_wallet_evidence_immutable();

DO $approval$
DECLARE
  v_customer constant uuid := '54299aee-1e4a-4e02-b335-94eea91ede70';
  v_owner constant uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
  v_profile public.profiles%ROWTYPE;
  v_snapshot public.wallet_legacy_spend_allowance_snapshot%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_rows integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Legacy allowance approval requires the database owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_owner AND is_admin IS TRUE AND is_staff IS NOT TRUE
      AND account_suspended IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Verified owner account is missing or inactive';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_customer FOR UPDATE;
  SELECT * INTO v_snapshot FROM public.wallet_legacy_spend_allowance_snapshot
    WHERE user_id = v_customer FOR UPDATE;
  IF v_profile.id IS DISTINCT FROM v_customer
    OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE
    OR v_profile.account_suspended IS TRUE
    OR v_profile.wallet_review_required IS TRUE
    OR v_profile.wallet_balance IS DISTINCT FROM 57268.00
    OR v_snapshot.user_id IS DISTINCT FROM v_customer
    OR v_snapshot.baseline_available IS DISTINCT FROM 0
    OR v_snapshot.stored_balance_at_snapshot IS DISTINCT FROM 57268.00
    OR v_snapshot.gateway_deposits_at_snapshot IS DISTINCT FROM 0
    OR v_snapshot.completed_debits_at_snapshot IS DISTINCT FROM 1614622.00
  THEN
    RAISE EXCEPTION 'Tallystore legacy review preconditions changed';
  END IF;

  v_before := public.wallet_financial_truth_internal(v_customer);
  IF (v_before->>'confirmed_spendable')::numeric IS DISTINCT FROM 0
    OR (v_before->>'verified_gateway_deposits')::numeric IS DISTINCT FROM 0
    OR (v_before->>'active_reservations')::numeric IS DISTINCT FROM 0
    OR (v_before->>'spending_blocked')::boolean IS DISTINCT FROM false
    OR (v_before->>'evidence_complete')::boolean IS DISTINCT FROM true
    OR (v_before->>'duplicate_payment_identities')::integer IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION 'Tallystore wallet state needs another review';
  END IF;

  INSERT INTO public.wallet_legacy_spend_approvals (
    approval_reference, user_id, approved_by, baseline_before,
    baseline_after, stored_balance_at_snapshot, evidence_note
  ) VALUES (
    'LEGACY-TALLYSTORE-OWNER-20261001', v_customer, v_owner, 0,
    57268.00, 57268.00,
    'Owner stated on 2026-10-01 that the existing Tallystore wallet money was personally funded through earlier admin top-ups. Approval is limited to the NGN 57,268 balance already present at the policy snapshot. Individual historical top-up events remain unreconciled; this record posts no new credit.'
  );

  UPDATE public.wallet_legacy_spend_allowance_snapshot
     SET baseline_available = 57268.00
   WHERE user_id = v_customer AND baseline_available = 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Legacy allowance changed concurrently';
  END IF;

  v_after := public.wallet_financial_truth_internal(v_customer);
  IF (v_after->>'confirmed_spendable')::numeric IS DISTINCT FROM 57268.00
    OR (v_after->>'stored_wallet_balance')::numeric IS DISTINCT FROM 57268.00
    OR (v_after->>'verified_gateway_deposits')::numeric IS DISTINCT FROM 0
    OR (v_after->>'spending_blocked')::boolean IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'Reviewed legacy allowance did not pass wallet gate';
  END IF;
END;
$approval$;
