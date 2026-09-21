-- Service-role-only durable fulfillment outbox operations.
--
-- These functions are additive infrastructure. They do not call suppliers and
-- they do not reopen any paused route. Future workers should claim dispatch
-- through these functions, then still perform provider-specific authorization
-- checks before sending any external request.

CREATE OR REPLACE FUNCTION public.enqueue_fulfillment_dispatch(
  p_route text,
  p_order_table text,
  p_order_id uuid,
  p_user_id uuid,
  p_reservation_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_financial_security_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route text := NULLIF(btrim(COALESCE(p_route, '')), '');
  v_order_table text := NULLIF(btrim(COALESCE(p_order_table, '')), '');
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_profile public.profiles%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_existing public.fulfillment_dispatch_outbox%ROWTYPE;
  v_message public.fulfillment_dispatch_outbox%ROWTYPE;
BEGIN
  IF v_route IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_route_required';
  END IF;

  IF v_order_table IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_order_table_required';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_order_required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_user_required';
  END IF;

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_idempotency_key_required';
  END IF;

  IF p_financial_security_version IS NULL OR p_financial_security_version < 1 THEN
    RAISE EXCEPTION 'fulfillment_dispatch_security_version_invalid';
  END IF;

  IF p_reservation_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FULFILLMENT_RESERVATION_REQUIRED',
      'error', 'fulfillment_dispatch_requires_committed_wallet_reservation'
    );
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FULFILLMENT_PROFILE_NOT_FOUND',
      'error', 'fulfillment_dispatch_profile_not_found'
    );
  END IF;

  IF COALESCE(v_profile.account_suspended, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_NOT_ACTIVE',
      'error', 'fulfillment_dispatch_wallet_not_active'
    );
  END IF;

  IF COALESCE(v_profile.financial_security_version, 1) IS DISTINCT FROM p_financial_security_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_AUTHORIZATION_STALE',
      'error', 'fulfillment_dispatch_security_version_stale',
      'current_financial_security_version', COALESCE(v_profile.financial_security_version, 1),
      'requested_financial_security_version', p_financial_security_version
    );
  END IF;

  SELECT *
    INTO v_existing
  FROM public.fulfillment_dispatch_outbox
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.route IS DISTINCT FROM v_route
      OR v_existing.order_table IS DISTINCT FROM v_order_table
      OR v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.user_id IS DISTINCT FROM p_user_id
      OR v_existing.reservation_id IS DISTINCT FROM p_reservation_id
      OR v_existing.financial_security_version IS DISTINCT FROM p_financial_security_version
      OR v_existing.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb)
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT',
        'error', 'idempotency_key_reused_with_different_dispatch',
        'outbox_id', v_existing.id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'outbox_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  IF p_reservation_id IS NOT NULL THEN
    SELECT *
      INTO v_reservation
    FROM public.wallet_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'FULFILLMENT_RESERVATION_NOT_FOUND',
        'error', 'reservation_not_found'
      );
    END IF;

    IF v_reservation.user_id IS DISTINCT FROM p_user_id
      OR v_reservation.status IS DISTINCT FROM 'active'
      OR v_reservation.financial_security_version IS DISTINCT FROM p_financial_security_version
      OR (v_reservation.order_table IS NOT NULL AND v_reservation.order_table IS DISTINCT FROM v_order_table)
      OR (v_reservation.order_id IS NOT NULL AND v_reservation.order_id IS DISTINCT FROM p_order_id)
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'FULFILLMENT_RESERVATION_INVALID',
        'error', 'reservation_does_not_match_dispatch'
      );
    END IF;
  END IF;

  INSERT INTO public.fulfillment_dispatch_outbox (
    route,
    order_table,
    order_id,
    user_id,
    reservation_id,
    status,
    idempotency_key,
    financial_security_version,
    payload
  )
  VALUES (
    v_route,
    v_order_table,
    p_order_id,
    p_user_id,
    p_reservation_id,
    'pending',
    v_idempotency_key,
    p_financial_security_version,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING *
  INTO v_message;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'outbox_id', v_message.id,
    'status', v_message.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_fulfillment_dispatch(
  p_worker_id text,
  p_route text DEFAULT NULL,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
  v_route text := NULLIF(btrim(COALESCE(p_route, '')), '');
  v_lease_seconds integer := COALESCE(p_lease_seconds, 60);
  v_message public.fulfillment_dispatch_outbox%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
BEGIN
  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_worker_required';
  END IF;

  IF v_lease_seconds < 5 OR v_lease_seconds > 900 THEN
    RAISE EXCEPTION 'fulfillment_dispatch_lease_invalid';
  END IF;

  SELECT *
    INTO v_message
  FROM public.fulfillment_dispatch_outbox
  WHERE (
      status = 'pending'
      OR (status = 'claimed' AND claim_expires_at < now())
    )
    AND (v_route IS NULL OR route = v_route)
  ORDER BY created_at ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NO_PENDING_MESSAGES',
      'error', 'no_pending_dispatch'
    );
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = v_message.user_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_profile.account_suspended, false) THEN
    UPDATE public.fulfillment_dispatch_outbox
       SET status = 'blocked',
           blocked_at = now(),
           last_error = 'WALLET_NOT_ACTIVE',
           updated_at = now()
     WHERE id = v_message.id
     RETURNING *
     INTO v_message;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_NOT_ACTIVE',
      'error', 'wallet_not_active',
      'outbox_id', v_message.id
    );
  END IF;

  IF COALESCE(v_profile.financial_security_version, 1) IS DISTINCT FROM v_message.financial_security_version THEN
    UPDATE public.fulfillment_dispatch_outbox
       SET status = 'blocked',
           blocked_at = now(),
           last_error = 'ORDER_AUTHORIZATION_STALE',
           updated_at = now()
     WHERE id = v_message.id
     RETURNING *
     INTO v_message;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_AUTHORIZATION_STALE',
      'error', 'order_authorization_stale',
      'outbox_id', v_message.id,
      'current_financial_security_version', COALESCE(v_profile.financial_security_version, 1),
      'message_financial_security_version', v_message.financial_security_version
    );
  END IF;

  IF v_message.reservation_id IS NOT NULL THEN
    SELECT *
      INTO v_reservation
    FROM public.wallet_reservations
    WHERE id = v_message.reservation_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_reservation.user_id IS DISTINCT FROM v_message.user_id
      OR v_reservation.status IS DISTINCT FROM 'active'
      OR v_reservation.financial_security_version IS DISTINCT FROM v_message.financial_security_version
    THEN
      UPDATE public.fulfillment_dispatch_outbox
         SET status = 'blocked',
             blocked_at = now(),
             last_error = 'ORDER_AUTHORIZATION_STALE',
             updated_at = now()
       WHERE id = v_message.id
       RETURNING *
       INTO v_message;

      RETURN jsonb_build_object(
        'success', false,
        'code', 'ORDER_AUTHORIZATION_STALE',
        'error', 'order_authorization_stale',
        'outbox_id', v_message.id
      );
    END IF;
  END IF;

  UPDATE public.fulfillment_dispatch_outbox
     SET status = 'claimed',
         claimed_by = v_worker_id,
         claim_expires_at = now() + make_interval(secs => v_lease_seconds),
         attempts = attempts + 1,
         last_error = null,
         updated_at = now()
   WHERE id = v_message.id
   RETURNING *
   INTO v_message;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'FULFILLMENT_DISPATCH_CLAIMED',
    'outbox_id', v_message.id,
    'route', v_message.route,
    'order_table', v_message.order_table,
    'order_id', v_message.order_id,
    'user_id', v_message.user_id,
    'reservation_id', v_message.reservation_id,
    'payload', v_message.payload,
    'attempts', v_message.attempts,
    'claim_expires_at', v_message.claim_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_fulfillment_dispatch(
  p_outbox_id uuid,
  p_worker_id text,
  p_status text,
  p_last_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
  v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_message public.fulfillment_dispatch_outbox%ROWTYPE;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_id_required';
  END IF;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'fulfillment_dispatch_worker_required';
  END IF;

  IF v_status NOT IN ('sent', 'blocked', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'fulfillment_dispatch_finish_status_invalid';
  END IF;

  SELECT *
    INTO v_message
  FROM public.fulfillment_dispatch_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FULFILLMENT_DISPATCH_NOT_FOUND',
      'error', 'dispatch_not_found'
    );
  END IF;

  IF v_message.status IS DISTINCT FROM 'claimed'
    OR v_message.claimed_by IS DISTINCT FROM v_worker_id
    OR v_message.claim_expires_at < now()
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'OUTBOX_CLAIM_INVALID',
      'error', 'outbox_claim_invalid',
      'outbox_id', v_message.id,
      'status', v_message.status
    );
  END IF;

  UPDATE public.fulfillment_dispatch_outbox
     SET status = v_status,
         sent_at = CASE WHEN v_status = 'sent' THEN now() ELSE sent_at END,
         blocked_at = CASE WHEN v_status IN ('blocked', 'failed', 'canceled') THEN now() ELSE blocked_at END,
         last_error = NULLIF(btrim(COALESCE(p_last_error, '')), ''),
         updated_at = now()
   WHERE id = p_outbox_id
   RETURNING *
   INTO v_message;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'FULFILLMENT_DISPATCH_FINISHED',
    'outbox_id', v_message.id,
    'status', v_message.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_fulfillment_dispatch(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_fulfillment_dispatch(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_dispatch(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_fulfillment_dispatch(uuid, text, text, text) TO service_role;
