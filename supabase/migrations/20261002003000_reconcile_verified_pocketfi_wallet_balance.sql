-- One verified PocketFi deposit was posted to the transaction ledger but was
-- absent from the profile balance captured by the October wallet snapshot.
-- Restore that value without posting another top-up or trusting a browser claim.
DO $reconcile$
DECLARE
  v_owner constant uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
  v_customer constant uuid := 'bc27e66b-06aa-4dba-bc15-226cac1bcdbe';
  v_topup constant uuid := 'a51c112e-bdf0-4bfd-b7aa-2b79cfac6e9f';
  v_webhook constant uuid := '02b6d29e-c5aa-46a8-baa4-c023c695935b';
  v_reference constant text := 'PFI|100004260927175851172557720290';
  v_profile public.profiles%ROWTYPE;
  v_snapshot public.wallet_legacy_spend_allowance_snapshot%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Wallet reconciliation requires the database owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_owner AND is_admin IS TRUE AND is_staff IS NOT TRUE
      AND account_suspended IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Owner account changed';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_customer FOR UPDATE;
  SELECT * INTO v_snapshot FROM public.wallet_legacy_spend_allowance_snapshot
    WHERE user_id = v_customer FOR UPDATE;
  IF v_profile.id IS DISTINCT FROM v_customer
    OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE
    OR v_profile.account_suspended IS TRUE OR v_profile.wallet_review_required IS TRUE
    OR v_profile.wallet_balance IS DISTINCT FROM 1257.00
    OR v_snapshot.user_id IS DISTINCT FROM v_customer
    OR v_snapshot.baseline_available IS DISTINCT FROM 1257.00
    OR v_snapshot.stored_balance_at_snapshot IS DISTINCT FROM 1257.00
    OR v_snapshot.gateway_deposits_at_snapshot IS DISTINCT FROM 4645.00
    OR v_snapshot.completed_debits_at_snapshot IS DISTINCT FROM 2500.00
    OR v_snapshot.eligible_refunds_at_snapshot IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION 'Customer or snapshot state changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pocketfi_webhook_logs w
    WHERE w.id = v_webhook AND w.matched_user_id = v_customer
      AND w.processed IS TRUE AND w.verified_status = 'success'
      AND w.verified_reference = v_reference
      AND w.verified_amount_ngn = 1100.00
  ) THEN
    RAISE EXCEPTION 'Provider webhook evidence changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = v_topup AND t.user_id = v_customer
      AND t.type = 'topup' AND t.status = 'completed'
      AND t.amount = 1100.00 AND t.reference = v_reference
      AND t.balance_before = 1257.00 AND t.balance_after = 2357.00
      AND t.idempotency_key = 'pocketfi:' || v_reference
      AND t.metadata->>'provider' = 'pocketfi'
      AND t.metadata->>'webhook_log_id' = v_webhook::text
  ) OR EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = v_customer
      AND t.created_at > (SELECT created_at FROM public.transactions WHERE id = v_topup)
      AND t.balance_after IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Top-up evidence or later wallet movements changed';
  END IF;

  -- The pre-existing NGN 212 refund is linked to a completed provider-funded
  -- purchase and a cancelled SMM order. It explains the difference between
  -- the strict legacy book and the customer's pre-top-up balance.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions d
    JOIN public.transactions r ON r.user_id = d.user_id
      AND r.reference = 'REFUND-' || d.reference
    JOIN public.smm_orders o ON o.user_id = d.user_id AND o.reference = d.reference
    WHERE d.user_id = v_customer AND d.reference = 'SMM-MU9P1JZW-VHWF5Y'
      AND d.type = 'purchase' AND d.status = 'completed' AND d.amount = -212.00
      AND r.type = 'refund' AND r.status = 'completed' AND r.amount = 212.00
      AND o.status = 'cancelled' AND o.amount_ngn = 212.00
  ) THEN
    RAISE EXCEPTION 'Historical refund evidence changed';
  END IF;

  v_before := public.wallet_financial_truth_internal(v_customer);
  IF (v_before->>'confirmed_spendable')::numeric IS DISTINCT FROM 1257.00
    OR (v_before->>'verified_gateway_deposits')::numeric IS DISTINCT FROM 4645.00
    OR (v_before->>'active_reservations')::numeric IS DISTINCT FROM 0
    OR (v_before->>'evidence_complete')::boolean IS DISTINCT FROM true
    OR (v_before->>'spending_blocked')::boolean IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'Wallet truth changed before reconciliation';
  END IF;

  PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'true', true);
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
  UPDATE public.profiles SET wallet_balance = 2357.00, updated_at = now()
  WHERE id = v_customer AND wallet_balance = 1257.00;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  PERFORM pg_catalog.set_config('app.tally_wallet_engine_authorized', 'false', true);
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
  IF v_changed <> 1 THEN RAISE EXCEPTION 'Profile reconciliation changed concurrently'; END IF;

  UPDATE public.wallet_legacy_spend_allowance_snapshot
  SET baseline_available = 2357.00,
      stored_balance_at_snapshot = 2357.00
  WHERE user_id = v_customer AND baseline_available = 1257.00
    AND stored_balance_at_snapshot = 1257.00;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN RAISE EXCEPTION 'Snapshot reconciliation changed concurrently'; END IF;

  v_after := public.wallet_financial_truth_internal(v_customer);
  IF (v_after->>'stored_wallet_balance')::numeric IS DISTINCT FROM 2357.00
    OR (v_after->>'confirmed_spendable')::numeric IS DISTINCT FROM 2357.00
    OR (v_after->>'verified_gateway_deposits')::numeric IS DISTINCT FROM 4645.00
    OR (v_after->>'spending_blocked')::boolean IS DISTINCT FROM false
    OR NOT EXISTS (
      SELECT 1 FROM public.profile_balance_audit a
      WHERE a.profile_id = v_customer AND a.old_wallet_balance = 1257.00
        AND a.new_wallet_balance = 2357.00 AND a.changed_at >= now() - interval '1 minute'
    )
  THEN
    RAISE EXCEPTION 'Wallet reconciliation failed postcondition';
  END IF;

  INSERT INTO public.wallet_security_events (
    event_type, severity, wallet_user_id, actor_user_id, actor_role,
    source, route, operation_reference, old_values, new_values,
    financial_snapshot, evidence, result
  ) VALUES (
    'OWNER_VERIFIED_POCKETFI_BALANCE_RECONCILIATION', 'info', v_customer,
    v_owner, 'owner', 'database_migration', 'wallet_snapshot_reconciliation',
    v_reference,
    jsonb_build_object('wallet_balance', 1257.00, 'snapshot_baseline', 1257.00),
    jsonb_build_object('wallet_balance', 2357.00, 'snapshot_baseline', 2357.00),
    jsonb_build_object('before', v_before, 'after', v_after),
    jsonb_build_object('transaction_id', v_topup, 'webhook_log_id', v_webhook,
      'verified_provider_amount_ngn', 1100.00,
      'note', 'Corrected a successful provider top-up already posted to the ledger but missing from the customer profile and October wallet snapshot; no second top-up transaction was created.'),
    'reconciled'
  );
END;
$reconcile$;
