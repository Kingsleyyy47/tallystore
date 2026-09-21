-- Service-role-only wallet reservation operations.
--
-- These functions are additive reserve-first infrastructure. They do not
-- reopen checkout routes. Future purchase routes should reserve through this
-- boundary, enqueue dispatch only after a committed reservation, then capture
-- or release the reservation through these functions.

CREATE OR REPLACE FUNCTION public.create_wallet_reservation(
  p_user_id uuid,
  p_amount numeric,
  p_order_table text,
  p_order_id uuid,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_currency text DEFAULT 'NGN',
  p_financial_security_version integer DEFAULT 1,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_amount numeric := COALESCE(p_amount, 0);
  v_currency text := upper(COALESCE(NULLIF(btrim(p_currency), ''), 'NGN'));
  v_order_table text := NULLIF(btrim(COALESCE(p_order_table, '')), '');
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing public.wallet_reservations%ROWTYPE;
  v_current_security_version integer;
  v_scan jsonb;
  v_trusted_available numeric := 0;
  v_active_reserved numeric := 0;
  v_available_after_holds numeric := 0;
  v_reservation public.wallet_reservations%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_user_required';
  END IF;

  IF v_order_table IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_order_table_required';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_order_required';
  END IF;

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_idempotency_key_required';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'wallet_reservation_amount_must_be_positive';
  END IF;

  IF v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'wallet_reservation_amount_precision_invalid';
  END IF;

  IF v_amount > 1000000000 THEN
    RAISE EXCEPTION 'wallet_reservation_amount_too_large';
  END IF;

  IF v_currency !~ '^[A-Z]{3,8}$' THEN
    RAISE EXCEPTION 'wallet_reservation_invalid_currency';
  END IF;

  IF p_financial_security_version IS NULL OR p_financial_security_version < 1 THEN
    RAISE EXCEPTION 'wallet_reservation_security_version_invalid';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.wallet_reservations
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
      OR round(v_existing.amount, 2) IS DISTINCT FROM round(v_amount, 2)
      OR upper(COALESCE(v_existing.currency, 'NGN')) IS DISTINCT FROM v_currency
      OR v_existing.order_table IS DISTINCT FROM v_order_table
      OR v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.financial_security_version IS DISTINCT FROM p_financial_security_version
      OR v_existing.metadata IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb)
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'WALLET_RESERVATION_IDEMPOTENCY_CONFLICT',
        'error', 'idempotency_key_reused_with_different_reservation',
        'reservation_id', v_existing.id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'reservation_id', v_existing.id,
      'status', v_existing.status,
      'amount', v_existing.amount
    );
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_reservation_profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
    RAISE EXCEPTION 'wallet_reservation_customer_only';
  END IF;

  v_current_security_version := GREATEST(COALESCE(v_profile.financial_security_version, 1), 1);

  IF p_financial_security_version IS DISTINCT FROM v_current_security_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_SECURITY_VERSION_STALE',
      'error', 'wallet_reservation_security_version_stale',
      'current_financial_security_version', v_current_security_version,
      'requested_financial_security_version', p_financial_security_version
    );
  END IF;

  IF COALESCE(v_profile.account_suspended, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_NOT_ACTIVE',
      'error', 'wallet_not_active'
    );
  END IF;

  SELECT public.evaluate_customer_ledger_suspension(p_user_id, 0)
    INTO v_scan;

  IF COALESCE((v_scan->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FINANCIAL_STATE_UNAVAILABLE',
      'error', 'financial_state_unavailable',
      'scan', v_scan
    );
  END IF;

  IF COALESCE((v_scan->>'suspended')::boolean, false)
    OR COALESCE((v_scan->>'review_required')::boolean, false)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_REVIEW_REQUIRED',
      'error', 'wallet_review_required',
      'scan', v_scan
    );
  END IF;

  v_trusted_available := COALESCE((v_scan->>'trusted_available')::numeric, 0);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_active_reserved
  FROM public.wallet_reservations
  WHERE user_id = p_user_id
    AND upper(COALESCE(currency, 'NGN')) = v_currency
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  v_available_after_holds := GREATEST(v_trusted_available - v_active_reserved, 0);

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

  INSERT INTO public.wallet_reservations (
    user_id,
    amount,
    currency,
    status,
    order_table,
    order_id,
    idempotency_key,
    financial_security_version,
    metadata,
    expires_at
  )
  VALUES (
    p_user_id,
    v_amount,
    v_currency,
    'active',
    v_order_table,
    p_order_id,
    v_idempotency_key,
    p_financial_security_version,
    COALESCE(p_metadata, '{}'::jsonb),
    p_expires_at
  )
  RETURNING *
  INTO v_reservation;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'reservation_id', v_reservation.id,
    'status', v_reservation.status,
    'trusted_available_before', v_trusted_available,
    'active_reserved_before', v_active_reserved,
    'available_after_holds_before', v_available_after_holds
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_wallet_reservation(
  p_reservation_id uuid,
  p_reference text,
  p_description text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_capture jsonb;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_id_required';
  END IF;

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_capture_idempotency_key_required';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_NOT_FOUND',
      'error', 'wallet_reservation_not_found'
    );
  END IF;

  IF v_reservation.status = 'captured' THEN
    IF v_reservation.metadata->>'capture_idempotency_key' IS DISTINCT FROM v_idempotency_key THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'WALLET_RESERVATION_ALREADY_CAPTURED',
        'error', 'wallet_reservation_already_captured',
        'reservation_id', v_reservation.id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'reservation_id', v_reservation.id,
      'status', v_reservation.status
    );
  END IF;

  IF v_reservation.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_NOT_ACTIVE',
      'error', 'wallet_reservation_not_active',
      'reservation_id', v_reservation.id,
      'status', v_reservation.status
    );
  END IF;

  IF v_reservation.expires_at IS NOT NULL AND v_reservation.expires_at <= now() THEN
    UPDATE public.wallet_reservations
       SET status = 'expired',
           released_at = now(),
           updated_at = now()
     WHERE id = v_reservation.id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_EXPIRED',
      'error', 'wallet_reservation_expired',
      'reservation_id', v_reservation.id
    );
  END IF;

  v_metadata := v_metadata || jsonb_build_object(
    'wallet_reservation_id', v_reservation.id,
    'source_order_table', v_reservation.order_table,
    'source_order_id', v_reservation.order_id,
    'reservation_idempotency_key', v_reservation.idempotency_key
  );

  SELECT public.apply_wallet_transaction(
    v_reservation.user_id,
    'purchase',
    v_reservation.amount,
    p_reference,
    p_description,
    v_idempotency_key,
    v_metadata,
    v_reservation.currency,
    'wallet',
    null,
    p_created_by
  )
  INTO v_capture;

  IF COALESCE((v_capture->>'success')::boolean, false) IS NOT TRUE THEN
    UPDATE public.wallet_reservations
       SET status = 'review_required',
           metadata = metadata || jsonb_build_object('capture_error', v_capture),
           updated_at = now()
     WHERE id = v_reservation.id;

    RETURN v_capture || jsonb_build_object('reservation_id', v_reservation.id);
  END IF;

  UPDATE public.wallet_reservations
     SET status = 'captured',
         captured_at = now(),
         metadata = metadata || jsonb_build_object(
           'capture_idempotency_key', v_idempotency_key,
           'capture_transaction_id', v_capture #>> '{transaction,id}'
         ),
         updated_at = now()
   WHERE id = v_reservation.id
   RETURNING *
   INTO v_reservation;

  RETURN v_capture || jsonb_build_object(
    'reservation_id', v_reservation.id,
    'reservation_status', v_reservation.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_reservation(
  p_reservation_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'wallet_reservation_id_required';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_NOT_FOUND',
      'error', 'wallet_reservation_not_found'
    );
  END IF;

  IF v_reservation.status IN ('released', 'expired', 'canceled') THEN
    IF v_idempotency_key IS NOT NULL
      AND v_reservation.metadata->>'release_idempotency_key' IS DISTINCT FROM v_idempotency_key
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'WALLET_RESERVATION_RELEASE_CONFLICT',
        'error', 'wallet_reservation_release_conflict',
        'reservation_id', v_reservation.id,
        'status', v_reservation.status
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'reservation_id', v_reservation.id,
      'status', v_reservation.status
    );
  END IF;

  IF v_reservation.status = 'captured' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_RESERVATION_ALREADY_CAPTURED',
      'error', 'wallet_reservation_already_captured',
      'reservation_id', v_reservation.id
    );
  END IF;

  UPDATE public.wallet_reservations
     SET status = 'released',
         released_at = now(),
         metadata = metadata || jsonb_build_object(
           'release_reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
           'release_idempotency_key', v_idempotency_key
         ),
         updated_at = now()
   WHERE id = v_reservation.id
   RETURNING *
   INTO v_reservation;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'reservation_id', v_reservation.id,
    'status', v_reservation.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_wallet_reservation(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_reservation(uuid, text, text) TO service_role;
