-- Replace the two wallet authorization calculations that could diverge from
-- the full-history truth RPC. The existing signatures remain unchanged.
-- Abort on an unexpected deployed function body; never silently leave an
-- older permissive purchase gate in place.
DO $patch$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'v_financial_truth jsonb;') = 0 THEN
    IF pg_catalog.strpos(v_definition, '  v_original_reference text;') = 0 THEN
      RAISE EXCEPTION 'Unexpected wallet engine declaration; canonical gate not installed';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition,
      '  v_original_reference text;',
      '  v_original_reference text;' || chr(10) ||
      '  v_financial_truth jsonb;' || chr(10) ||
      '  v_own_hold numeric := 0;'
    );
  END IF;

  v_start := pg_catalog.strpos(v_definition,
    '  IF v_balance_type = ''wallet'' AND v_type = ''purchase'' THEN');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected wallet engine purchase gate; canonical gate not installed';
  END IF;
  v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start),
    '  SELECT transaction_hash');
  IF v_end = 0 THEN
    RAISE EXCEPTION 'Unexpected wallet engine purchase boundary; canonical gate not installed';
  END IF;
  v_end := v_start + v_end - 1;

  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN
    IF v_currency <> 'NGN' THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_WALLET_CURRENCY');
    END IF;

    v_financial_truth := public.wallet_financial_truth_internal(p_user_id);
    IF COALESCE((v_financial_truth->>'spending_blocked')::boolean, true) THEN
      RETURN jsonb_build_object(
        'success', false, 'code', 'WALLET_REVIEW_REQUIRED',
        'error', 'wallet_financial_review_required', 'truth', v_financial_truth
      );
    END IF;

    -- A capture consumes its own committed hold. Do not subtract that hold
    -- twice, or let an arbitrary reservation ID increase available funds.
    IF COALESCE(v_transaction_metadata->>'wallet_reservation_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      SELECT r.amount INTO v_own_hold
      FROM public.wallet_reservations r
      WHERE r.id = (v_transaction_metadata->>'wallet_reservation_id')::uuid
        AND r.user_id = p_user_id
        AND r.status = 'active'
        AND r.amount = v_amount
        AND upper(r.currency) = v_currency
        AND r.order_id::text = v_transaction_metadata->>'source_order_id'
        AND r.order_table = v_transaction_metadata->>'source_order_table';
      IF v_own_hold IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_WALLET_RESERVATION');
      END IF;
    ELSIF v_transaction_metadata ? 'wallet_reservation_id' THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_WALLET_RESERVATION');
    END IF;

    v_authoritative_available := GREATEST(
      (v_financial_truth->>'trusted_available_before_holds')::numeric
      - (v_financial_truth->>'active_reservations')::numeric
      + COALESCE(v_own_hold, 0), 0
    );
    IF v_authoritative_available < v_amount THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS',
        'error', 'insufficient_trusted_available_funds',
        'backed_available', v_authoritative_available,
        'requested_amount', v_amount,
        'truth', v_financial_truth
      );
    END IF;

    v_transaction_metadata := v_transaction_metadata || jsonb_build_object(
      'trusted_principal_authorized', true,
      'trusted_principal_debit_amount', v_amount,
      'trusted_available_before', v_authoritative_available,
      'trusted_principal_before', (v_financial_truth->>'trusted_principal')::numeric,
      'trusted_consumed_spend_before', (v_financial_truth->>'net_consumed_spend')::numeric
    );
  END IF;

$body$ || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.create_wallet_reservation(uuid,numeric,text,uuid,text,jsonb,text,integer,timestamp with time zone)'::regprocedure
  ) INTO v_definition;
  v_start := pg_catalog.strpos(v_definition,
    '  SELECT public.evaluate_customer_ledger_suspension(p_user_id, 0)');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected reservation gate; canonical gate not installed';
  END IF;
  v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start),
    '  INSERT INTO public.wallet_reservations (');
  IF v_end = 0 THEN
    RAISE EXCEPTION 'Unexpected reservation insert boundary; canonical gate not installed';
  END IF;
  v_end := v_start + v_end - 1;

  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  IF v_currency <> 'NGN' THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_WALLET_CURRENCY');
  END IF;

  v_scan := public.wallet_financial_truth_internal(p_user_id);
  IF COALESCE((v_scan->>'spending_blocked')::boolean, true) THEN
    RETURN jsonb_build_object(
      'success', false, 'code', 'WALLET_REVIEW_REQUIRED',
      'error', 'wallet_financial_review_required', 'truth', v_scan
    );
  END IF;

  v_trusted_available := (v_scan->>'trusted_available_before_holds')::numeric;
  v_active_reserved := (v_scan->>'active_reservations')::numeric;
  v_available_after_holds := (v_scan->>'confirmed_spendable')::numeric;
  IF v_amount > v_available_after_holds THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS',
      'error', 'insufficient_trusted_available_funds',
      'trusted_available', v_trusted_available,
      'active_reserved', v_active_reserved,
      'available_after_holds', v_available_after_holds,
      'requested_amount', v_amount
    );
  END IF;

$body$ || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.capture_wallet_reservation(uuid,text,text,text,jsonb,uuid)'::regprocedure
  ) INTO v_definition;
  v_start := pg_catalog.strpos(v_definition,
    '  IF v_reservation.expires_at IS NOT NULL AND v_reservation.expires_at <= now() THEN');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected capture expiry gate; unresolved holds not protected';
  END IF;
  v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start),
    '  v_metadata := v_metadata || jsonb_build_object(');
  IF v_end = 0 THEN
    RAISE EXCEPTION 'Unexpected capture metadata boundary; unresolved holds not protected';
  END IF;
  v_end := v_start + v_end - 1;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  IF v_reservation.expires_at IS NOT NULL AND v_reservation.expires_at <= now() THEN
    UPDATE public.wallet_reservations
       SET status = 'review_required',
           metadata = metadata || jsonb_build_object(
             'expired_hold_review_reason', 'supplier_outcome_must_be_resolved_before_release'
           ),
           updated_at = now()
     WHERE id = v_reservation.id;
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_EXPIRED',
      'error', 'wallet_reservation_expired_review_required',
      'reservation_id', v_reservation.id
    );
  END IF;

$body$ || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.release_wallet_reservation(uuid,text,text)'::regprocedure
  ) INTO v_definition;
  v_start := pg_catalog.strpos(v_definition,
    '  UPDATE public.wallet_reservations');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected release gate; review-required holds not protected';
  END IF;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  IF v_reservation.status = 'review_required' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_MANUAL_REVIEW_REQUIRED',
      'error', 'unresolved_reservation_cannot_be_released_automatically',
      'reservation_id', v_reservation.id
    );
  END IF;

$body$ || pg_catalog.substr(v_definition, v_start);
  EXECUTE v_definition;
END;
$patch$;
