-- Reconcile historical gateway credits that were recorded once in the ledger
-- but never persisted in the profile. Every row is tied to a successful
-- provider record, has no later transaction, and is checked before update.
DO $reconcile$
DECLARE
  v_owner constant uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
  v_case record;
  v_profile public.profiles%ROWTYPE;
  v_snapshot public.wallet_legacy_spend_allowance_snapshot%ROWTYPE;
  v_txn public.transactions%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_rows integer;
  v_count integer := 0;
  v_total numeric := 0;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_owner
      AND is_admin IS TRUE AND is_staff IS NOT TRUE
      AND account_suspended IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Owner authority for gateway reconciliation changed';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('1ff6554e-c327-497a-887f-8f009ee06317'::uuid, 'ef1b8573-9578-4c74-a100-7d10905af977'::uuid, 'a026d40b-4597-4610-9464-8d2f1c5eb16a'::uuid, 'PFI|100004260927132746172533220450', 'pocketfi', 0::numeric, 2200::numeric, 2200::numeric),
      ('0303bc0a-7370-4230-80f6-9e4e94fc0650'::uuid, '11af4375-05bb-48f0-830d-48b0b7c47870'::uuid, '4da148a4-bde5-4985-9335-dacaa9f729c4'::uuid, 'PFI|AT68_TRF2MPTCZBUZ2103503837134409728', 'pocketfi', 1150, 900, 900),
      ('855fe57c-37c9-4a4b-b407-5bac5735838b'::uuid, 'aa35a4e5-1b3d-4b5a-bb0b-645211024af6'::uuid, '50dfc16c-5227-4bb5-953a-8465c4504354'::uuid, 'ER|A2D49665101A4', 'ercaspay', 270, 2000, 2000),
      ('3541576f-561b-4992-a79f-c547463b35ca'::uuid, '66f314df-4dd1-4a8e-a32b-b588e5137777'::uuid, '67f2a238-3352-4490-9b75-e287b50771ba'::uuid, 'PFI|100004260925111345172323256055', 'pocketfi', 500, 5000, 5000),
      ('b047b36b-9db1-4238-ba7a-8be5431845d7'::uuid, '56d42868-7671-4306-a3a3-5d89d97c80b9'::uuid, '97d9eecb-7f07-4956-aac4-baf63b13d3a5'::uuid, 'ER|A2D2BEA48E794', 'ercaspay', 1700, 200, 200),
      ('594cce8e-1372-47a9-8279-088b344ebdfa'::uuid, 'b9cb7bf3-5072-4c3a-b04e-813851d805f0'::uuid, '08b1cf6c-6649-4cf6-be14-b9edf7d5c156'::uuid, 'PFI|100033260921230942784887886932', 'pocketfi', 20, 3500, 3500),
      ('2b4c22a5-9cab-432e-a046-4ea5deb7dbcb'::uuid, '9e89edd6-2c45-44df-8c9c-f6b28a7102d5'::uuid, '603f9895-8bf1-4fba-b997-4c4e97f87a71'::uuid, 'ER|A2CCFDD97A564', 'ercaspay', 40, 1900, 1900),
      ('7322e644-bb9a-4167-af79-308babbd28f8'::uuid, '7f43b398-bff3-4a55-87ce-eb141d0263fc'::uuid, '60d1acd5-ec50-4afe-a2b4-dab26a05bb1e'::uuid, 'ER|A2CCF65D27294', 'ercaspay', 456, 3000, 4500),
      ('b4bde206-8b14-4ed7-a66f-3506e50170d5'::uuid, '9ca16fcc-b553-4156-9c17-2383291b73ba'::uuid, '7eeea82c-11cd-4d53-a1fe-db554ae46488'::uuid, 'PFI|100004260921143821171951772566', 'pocketfi', 400, 10000, 10000),
      ('6b9f833d-5369-4a7c-927a-03f812304cfd'::uuid, 'a91818c1-9ff7-4519-bc4f-0b7963813dd2'::uuid, '751a552c-3704-43b0-8105-6df4b1c3d44a'::uuid, 'PFI|2609211180826', 'pocketfi', 140, 850, 850),
      ('24a4ca1d-5f99-4757-8ea9-a7f4319bd7fd'::uuid, '95caee85-9db0-4613-b2de-bd8fae247a30'::uuid, '440af3a3-0066-4c49-a259-ddfe845f8ba1'::uuid, 'ER|A2CA093988364', 'ercaspay', 3348, 480, 480)
    ) AS c(user_id, transaction_id, evidence_id, reference, provider, before_balance, amount, gateway_at_snapshot)
    ORDER BY user_id
  LOOP
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_case.user_id FOR UPDATE;
    SELECT * INTO v_snapshot FROM public.wallet_legacy_spend_allowance_snapshot
      WHERE user_id = v_case.user_id FOR UPDATE;
    SELECT * INTO v_txn FROM public.transactions WHERE id = v_case.transaction_id;

    IF v_profile.id IS DISTINCT FROM v_case.user_id
      OR v_profile.wallet_balance IS DISTINCT FROM v_case.before_balance
      OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE
      OR v_profile.account_suspended IS TRUE OR v_profile.wallet_review_required IS TRUE
      OR v_snapshot.user_id IS DISTINCT FROM v_case.user_id
      OR v_snapshot.baseline_available IS DISTINCT FROM v_case.before_balance
      OR v_snapshot.stored_balance_at_snapshot IS DISTINCT FROM v_case.before_balance
      OR v_snapshot.gateway_deposits_at_snapshot IS DISTINCT FROM v_case.gateway_at_snapshot
      OR v_snapshot.recorded_at <= v_txn.created_at
      OR v_txn.id IS DISTINCT FROM v_case.transaction_id
      OR v_txn.user_id IS DISTINCT FROM v_case.user_id
      OR v_txn.type IS DISTINCT FROM 'topup'
      OR v_txn.status IS DISTINCT FROM 'completed'
      OR v_txn.reference IS DISTINCT FROM v_case.reference
      OR v_txn.amount IS DISTINCT FROM v_case.amount
      OR v_txn.balance_before IS DISTINCT FROM v_case.before_balance
      OR v_txn.balance_after IS DISTINCT FROM v_case.before_balance + v_case.amount
      OR v_txn.metadata->>'provider' IS DISTINCT FROM v_case.provider
      OR EXISTS (
        SELECT 1 FROM public.transactions later
        WHERE later.user_id = v_case.user_id AND later.created_at > v_txn.created_at
      )
      OR EXISTS (
        SELECT 1 FROM public.profile_balance_audit a
        WHERE a.profile_id = v_case.user_id AND a.changed_at > v_txn.created_at
      )
    THEN
      RAISE EXCEPTION 'Historical gateway reconciliation state changed for %', v_case.user_id;
    END IF;

    IF v_case.provider = 'pocketfi' THEN
      IF v_txn.metadata->>'webhook_log_id' IS DISTINCT FROM v_case.evidence_id::text
        OR NOT EXISTS (
          SELECT 1 FROM public.pocketfi_webhook_logs w
          WHERE w.id = v_case.evidence_id AND w.matched_user_id = v_case.user_id
            AND w.verified_reference = v_case.reference
            AND w.verified_amount_ngn = v_case.amount
            AND w.verified_status = 'success' AND w.processed IS TRUE
        )
      THEN
        RAISE EXCEPTION 'PocketFi provider evidence changed for %', v_case.user_id;
      END IF;
    ELSIF v_case.provider = 'ercaspay' THEN
      IF v_txn.metadata->>'source' IS DISTINCT FROM 'verify-and-credit-wallet'
        OR v_txn.metadata->>'verified_currency' IS DISTINCT FROM 'NGN'
        OR (v_txn.metadata->>'verified_amount_ngn')::numeric IS DISTINCT FROM v_case.amount
        OR NOT EXISTS (
          SELECT 1 FROM public.pending_payments p
          WHERE p.id = v_case.evidence_id AND p.user_id = v_case.user_id
            AND p.transaction_reference = v_case.reference
            AND p.amount = v_case.amount AND p.status = 'credited'
        )
      THEN
        RAISE EXCEPTION 'Ercas provider evidence changed for %', v_case.user_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported gateway in reconciliation';
    END IF;

    v_before := public.wallet_financial_truth_internal(v_case.user_id);
    IF (v_before->>'confirmed_spendable')::numeric IS DISTINCT FROM v_case.before_balance
      OR (v_before->>'verified_gateway_deposits')::numeric < v_case.amount
      OR (v_before->>'active_reservations')::numeric IS DISTINCT FROM 0
      OR (v_before->>'evidence_complete')::boolean IS DISTINCT FROM true
      OR (v_before->>'spending_blocked')::boolean IS DISTINCT FROM false
    THEN
      RAISE EXCEPTION 'Wallet truth changed for %', v_case.user_id;
    END IF;

    PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'true', true);
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
    UPDATE public.profiles
      SET wallet_balance = v_case.before_balance + v_case.amount, updated_at = now()
      WHERE id = v_case.user_id AND wallet_balance = v_case.before_balance;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Profile correction failed for %', v_case.user_id; END IF;

    UPDATE public.wallet_legacy_spend_allowance_snapshot
      SET baseline_available = v_case.before_balance + v_case.amount,
          stored_balance_at_snapshot = v_case.before_balance + v_case.amount
      WHERE user_id = v_case.user_id
        AND baseline_available = v_case.before_balance
        AND stored_balance_at_snapshot = v_case.before_balance;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Snapshot correction failed for %', v_case.user_id; END IF;

    v_after := public.wallet_financial_truth_internal(v_case.user_id);
    IF (v_after->>'stored_wallet_balance')::numeric IS DISTINCT FROM v_case.before_balance + v_case.amount
      OR (v_after->>'confirmed_spendable')::numeric IS DISTINCT FROM v_case.before_balance + v_case.amount
      OR (v_after->>'verified_gateway_deposits')::numeric IS DISTINCT FROM (v_before->>'verified_gateway_deposits')::numeric
      OR (v_after->>'spending_blocked')::boolean IS DISTINCT FROM false
      OR NOT EXISTS (
        SELECT 1 FROM public.profile_balance_audit a
        WHERE a.profile_id = v_case.user_id AND a.old_wallet_balance = v_case.before_balance
          AND a.new_wallet_balance = v_case.before_balance + v_case.amount
          AND a.changed_at >= now() - interval '1 minute'
      )
    THEN
      RAISE EXCEPTION 'Reconciliation postcondition failed for %', v_case.user_id;
    END IF;

    INSERT INTO public.wallet_security_events (
      event_type, severity, wallet_user_id, actor_user_id, actor_role,
      source, route, operation_reference, old_values, new_values,
      financial_snapshot, evidence, result
    ) VALUES (
      'OWNER_VERIFIED_HISTORICAL_GATEWAY_BALANCE_RECONCILIATION', 'info',
      v_case.user_id, v_owner, 'owner', 'database_migration',
      'wallet_snapshot_reconciliation', v_case.reference,
      jsonb_build_object('wallet_balance', v_case.before_balance, 'snapshot_baseline', v_case.before_balance),
      jsonb_build_object('wallet_balance', v_case.before_balance + v_case.amount, 'snapshot_baseline', v_case.before_balance + v_case.amount),
      jsonb_build_object('before', v_before, 'after', v_after),
      jsonb_build_object('transaction_id', v_case.transaction_id,
        'provider_evidence_id', v_case.evidence_id,
        'provider', v_case.provider, 'verified_amount_ngn', v_case.amount,
        'note', 'Existing verified gateway transaction was missing from the profile and October spend snapshot; no new top-up transaction was created.'),
      'reconciled'
    );

    v_count := v_count + 1;
    v_total := v_total + v_case.amount;
  END LOOP;

  IF v_count <> 11 OR v_total <> 30030 THEN
    RAISE EXCEPTION 'Historical gateway reconciliation count or total changed';
  END IF;
END;
$reconcile$;
