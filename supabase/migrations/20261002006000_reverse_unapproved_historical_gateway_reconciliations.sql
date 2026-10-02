-- Owner authorized only two customer payment recoveries. Reverse the eleven
-- additional October 2 profile/snapshot corrections pending owner review.
-- Preserve original gateway transactions and both authorized recoveries.
DO $reverse$
DECLARE
  v_event public.wallet_security_events%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_snapshot public.wallet_legacy_spend_allowance_snapshot%ROWTYPE;
  v_old numeric;
  v_corrected numeric;
  v_amount numeric;
  v_truth jsonb;
  v_rows integer;
  v_count integer := 0;
  v_total numeric := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Database owner required for wallet correction reversal';
  END IF;
  IF (SELECT count(*) FROM public.wallet_security_events
      WHERE event_type = 'OWNER_VERIFIED_HISTORICAL_GATEWAY_BALANCE_RECONCILIATION') <> 11
    OR (SELECT sum((evidence->>'verified_amount_ngn')::numeric)
        FROM public.wallet_security_events
        WHERE event_type = 'OWNER_VERIFIED_HISTORICAL_GATEWAY_BALANCE_RECONCILIATION') <> 30030
  THEN
    RAISE EXCEPTION 'Historical correction set changed';
  END IF;

  FOR v_event IN
    SELECT * FROM public.wallet_security_events
    WHERE event_type = 'OWNER_VERIFIED_HISTORICAL_GATEWAY_BALANCE_RECONCILIATION'
    ORDER BY wallet_user_id
  LOOP
    v_old := (v_event.old_values->>'wallet_balance')::numeric;
    v_corrected := (v_event.new_values->>'wallet_balance')::numeric;
    v_amount := (v_event.evidence->>'verified_amount_ngn')::numeric;
    SELECT * INTO v_profile FROM public.profiles
      WHERE id = v_event.wallet_user_id FOR UPDATE;
    SELECT * INTO v_snapshot FROM public.wallet_legacy_spend_allowance_snapshot
      WHERE user_id = v_event.wallet_user_id FOR UPDATE;

    IF v_event.operation_reference IN (
        'PFI|100004260927175851172557720290', 'ER|A2CC9D93E07B4'
      )
      OR v_old IS NULL OR v_corrected IS NULL OR v_amount IS NULL
      OR v_amount <= 0 OR v_corrected <> v_old + v_amount
      OR v_profile.id IS DISTINCT FROM v_event.wallet_user_id
      OR v_profile.wallet_balance IS DISTINCT FROM v_corrected
      OR v_snapshot.user_id IS DISTINCT FROM v_event.wallet_user_id
      OR v_snapshot.baseline_available IS DISTINCT FROM v_corrected
      OR v_snapshot.stored_balance_at_snapshot IS DISTINCT FROM v_corrected
      OR EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = v_event.wallet_user_id AND t.created_at > v_event.created_at
      )
      OR EXISTS (
        SELECT 1 FROM public.wallet_reservations r
        WHERE r.user_id = v_event.wallet_user_id AND r.created_at > v_event.created_at
      )
      OR EXISTS (
        SELECT 1 FROM public.profile_balance_audit a
        WHERE a.profile_id = v_event.wallet_user_id AND a.changed_at > v_event.created_at
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.profile_balance_audit a
        WHERE a.profile_id = v_event.wallet_user_id
          AND a.old_wallet_balance = v_old AND a.new_wallet_balance = v_corrected
      )
    THEN
      RAISE EXCEPTION 'Reversal state changed for %', v_event.wallet_user_id;
    END IF;

    v_truth := public.wallet_financial_truth_internal(v_event.wallet_user_id);
    IF (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM v_corrected
      OR (v_truth->>'active_reservations')::numeric IS DISTINCT FROM 0
    THEN
      RAISE EXCEPTION 'Spendable funds changed for %', v_event.wallet_user_id;
    END IF;

    PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'true', true);
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
    UPDATE public.profiles
      SET wallet_balance = v_old, updated_at = now()
      WHERE id = v_event.wallet_user_id AND wallet_balance = v_corrected;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Profile reversal failed for %', v_event.wallet_user_id; END IF;

    UPDATE public.wallet_legacy_spend_allowance_snapshot
      SET baseline_available = v_old, stored_balance_at_snapshot = v_old
      WHERE user_id = v_event.wallet_user_id
        AND baseline_available = v_corrected
        AND stored_balance_at_snapshot = v_corrected;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Snapshot reversal failed for %', v_event.wallet_user_id; END IF;

    v_truth := public.wallet_financial_truth_internal(v_event.wallet_user_id);
    IF (v_truth->>'stored_wallet_balance')::numeric IS DISTINCT FROM v_old
      OR (v_truth->>'confirmed_spendable')::numeric IS DISTINCT FROM v_old
      OR NOT EXISTS (
        SELECT 1 FROM public.profile_balance_audit a
        WHERE a.profile_id = v_event.wallet_user_id
          AND a.old_wallet_balance = v_corrected AND a.new_wallet_balance = v_old
          AND a.changed_at >= now() - interval '1 minute'
      )
    THEN
      RAISE EXCEPTION 'Reversal postcondition failed for %', v_event.wallet_user_id;
    END IF;

    INSERT INTO public.wallet_security_events (
      event_type, severity, wallet_user_id, source, route,
      operation_reference, old_values, new_values, financial_snapshot,
      evidence, result
    ) VALUES (
      'REVERSE_UNAPPROVED_HISTORICAL_GATEWAY_RECONCILIATION', 'warning',
      v_event.wallet_user_id, 'database_migration', 'owner_scope_correction',
      v_event.operation_reference,
      jsonb_build_object('wallet_balance', v_corrected, 'snapshot_baseline', v_corrected),
      jsonb_build_object('wallet_balance', v_old, 'snapshot_baseline', v_old),
      jsonb_build_object('after_reversal', v_truth),
      jsonb_build_object('original_correction_event_id', v_event.id,
        'amount_removed_from_spendable', v_amount,
        'reason', 'Owner approved only two separate customer payment recoveries. This correction awaits owner review and customer proof.'),
      'reversed'
    );
    v_count := v_count + 1;
    v_total := v_total + v_amount;
  END LOOP;

  IF v_count <> 11 OR v_total <> 30030 THEN
    RAISE EXCEPTION 'Reversal count or total changed';
  END IF;
END;
$reverse$;
