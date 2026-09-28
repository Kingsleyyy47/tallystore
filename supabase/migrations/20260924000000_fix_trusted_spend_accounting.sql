-- A debit beyond principal must remain consumed even after an eligible refund.
-- Keep refund eligibility capped by backed original debits, but calculate
-- availability from every posted debit. This migration does not alter balances
-- or clear existing financial reviews.
DO $fix$
DECLARE
  v_signature text;
  v_definition text;
  v_original text;
  v_expected text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.evaluate_customer_ledger_suspension(uuid,numeric)',
    'public.guard_trusted_principal_transaction()',
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
    v_original := v_definition;

    IF v_signature LIKE '%evaluate_customer_ledger_suspension%' THEN
      v_expected := 'trusted_consumed_spend := GREATEST(completed_spend - eligible_refunds, 0);';
      v_definition := replace(v_definition,
        'trusted_consumed_spend := GREATEST(trusted_debit_capacity - eligible_refunds, 0);',
        v_expected);
    ELSIF v_signature LIKE '%guard_trusted_principal_transaction%' THEN
      v_expected := 'v_trusted_consumed_spend := GREATEST(v_completed_debits - v_eligible_refunds, 0);';
      v_definition := replace(v_definition,
        'v_trusted_consumed_spend := GREATEST(v_trusted_debit_capacity - v_eligible_refunds, 0);',
        v_expected);
    ELSE
      v_expected := 'v_trusted_consumed_spend := GREATEST(v_previous_wallet_debits - v_eligible_refunds, 0);';
      v_definition := replace(v_definition,
        'v_trusted_consumed_spend := GREATEST(v_trusted_debit_capacity - v_eligible_refunds, 0);',
        v_expected);
    END IF;

    IF v_definition = v_original THEN
      IF strpos(v_definition, v_expected) = 0 THEN
        RAISE EXCEPTION 'Expected spend calculation not found in %', v_signature;
      END IF;
    ELSE
      EXECUTE v_definition;
    END IF;
  END LOOP;
END;
$fix$;

-- A customer who simply lacks enough money gets an ordinary decline. Preserve
-- the integrity freeze when the displayed balance exceeds backed funds.
DO $insufficient$
DECLARE
  v_definition text;
  v_marker text := 'IF v_authoritative_available < v_amount THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF strpos(v_definition, 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS') = 0 THEN
    IF strpos(v_definition, v_marker) = 0 THEN
      RAISE EXCEPTION 'Wallet purchase insufficient-funds branch was not found';
    END IF;

    v_definition := replace(v_definition, v_marker,
      v_marker || chr(10) ||
      '      IF v_current_balance <= v_authoritative_available THEN' || chr(10) ||
      '        RETURN jsonb_build_object(' || chr(10) ||
      '          ''success'', false,' || chr(10) ||
      '          ''error'', ''insufficient_trusted_available_funds'',' || chr(10) ||
      '          ''code'', ''INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'',' || chr(10) ||
      '          ''trusted_available'', v_authoritative_available,' || chr(10) ||
      '          ''requested_amount'', v_amount' || chr(10) ||
      '        );' || chr(10) ||
      '      END IF;'
    );
    EXECUTE v_definition;
  END IF;
END;
$insufficient$;

-- Supabase commonly installs pgcrypto in extensions. The wallet engine has
-- a fixed search_path and needs that schema to compute its transaction hash.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER FUNCTION public.apply_wallet_transaction(
  uuid, text, numeric, text, text, text, jsonb, text, text, text, uuid
) SET search_path = public, extensions;

-- apply_wallet_transaction inserts the ledger row before it updates the
-- profile balance. The old AFTER INSERT trigger compared those two states
-- mid-transaction and falsely froze ordinary funded purchases. Engine writes
-- have already passed the funding guard and become atomic at commit.
CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.tally_wallet_engine_authorized', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, 'completed')) IN
      ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    AND lower(COALESCE(NEW.type, '')) IN (
      'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit',
      'deposit', 'credit', 'admin_credit', 'staff_credit',
      'referral_withdrawal', 'purchase', 'refund'
    )
  THEN
    PERFORM public.evaluate_customer_ledger_suspension(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.evaluate_customer_ledger_suspension_from_transaction()
  FROM public, anon, authenticated;

-- The admin fraud view reads the same frozen historical principal as the
-- purchase gate. Other authenticated users cannot read this table through RLS.
REVOKE ALL ON TABLE public.wallet_legacy_funding FROM service_role;
GRANT SELECT ON TABLE public.wallet_legacy_funding TO service_role;
CREATE OR REPLACE FUNCTION public.can_read_wallet_legacy_funding()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = true
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_wallet_legacy_funding() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_wallet_legacy_funding() TO authenticated;

GRANT SELECT ON public.wallet_legacy_funding TO authenticated;
DROP POLICY IF EXISTS wallet_legacy_funding_admin_read ON public.wallet_legacy_funding;
CREATE POLICY wallet_legacy_funding_admin_read
ON public.wallet_legacy_funding
FOR SELECT TO authenticated
USING (public.can_read_wallet_legacy_funding());

-- Clear only automatic mid-posting display-mismatch holds that now pass the
-- completed ledger check. Keep all other review and manual suspension states.
DO $release$
DECLARE
  v_cleared integer;
BEGIN
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  WITH candidates AS (
    SELECT p.id, public.evaluate_customer_ledger_suspension(p.id, 0) AS result
    FROM public.profiles p
    WHERE p.wallet_review_required = true
      AND p.account_suspended = false
      AND COALESCE(p.is_admin, false) = false
      AND COALESCE(p.is_staff, false) = false
      AND p.wallet_reviewed_by IS NULL
      AND p.wallet_review_reason LIKE 'Auto-suspended: displayed wallet balance %'
  )
  UPDATE public.profiles p
     SET wallet_review_required = false,
         wallet_review_reason = NULL,
         wallet_reviewed_at = now(),
         updated_at = now()
  FROM candidates c
  WHERE p.id = c.id
    AND COALESCE((c.result->>'success')::boolean, false) = true
    AND COALESCE((c.result->>'spend_exposure')::numeric, 1) = 0
    AND COALESCE((c.result->>'displayed_balance_exposure')::numeric, 1) = 0;

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  RAISE NOTICE 'Cleared % reconciled automatic mid-posting reviews', v_cleared;
END;
$release$;
