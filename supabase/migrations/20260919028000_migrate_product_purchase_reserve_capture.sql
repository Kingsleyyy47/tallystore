-- Move the local product-credentials route to a database-owned
-- reserve/capture boundary.
--
-- The authorization function creates the order, wallet reservation, and
-- inventory reservation in one transaction. The completion function captures
-- the reservation, writes the credentials, and marks the same inventory sold
-- in one transaction. Neither function calls an external provider.

CREATE OR REPLACE FUNCTION public.authorize_product_purchase(
  p_user_id uuid,
  p_product_group_id uuid,
  p_quantity integer,
  p_amount numeric,
  p_idempotency_key text,
  p_order_metadata jsonb DEFAULT '{}'::jsonb,
  p_preferred_account_id uuid DEFAULT NULL,
  p_financial_security_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_existing public.orders%ROWTYPE;
  v_reservation jsonb;
  v_scan jsonb;
  v_order_id uuid;
  v_amount numeric := round(COALESCE(p_amount, 0), 2);
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_order_metadata jsonb := COALESCE(p_order_metadata, '{}'::jsonb);
  v_account_ids uuid[] := ARRAY[]::uuid[];
  v_preferred_account_id uuid;
  v_account_count integer := 0;
  v_current_security_version integer;
BEGIN
  IF p_user_id IS NULL OR p_product_group_id IS NULL THEN
    RAISE EXCEPTION 'product_purchase_identity_required';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 500 THEN
    RAISE EXCEPTION 'product_purchase_quantity_invalid';
  END IF;

  IF v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'product_purchase_amount_invalid';
  END IF;

  IF v_idempotency_key IS NULL OR length(v_idempotency_key) < 10 THEN
    RAISE EXCEPTION 'product_purchase_idempotency_key_required';
  END IF;

  IF p_financial_security_version IS NULL OR p_financial_security_version < 1 THEN
    RAISE EXCEPTION 'product_purchase_security_version_invalid';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.orders
  WHERE user_id = p_user_id
    AND idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.product_group_id IS DISTINCT FROM p_product_group_id
      OR round(COALESCE(v_existing.amount, 0), 2) IS DISTINCT FROM v_amount
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_REQUEST_CONFLICT',
        'error', 'product_purchase_idempotency_key_reused_with_different_request',
        'order_id', v_existing.id
      );
    END IF;

    IF lower(COALESCE(v_existing.status, '')) = 'completed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'order_id', v_existing.id,
        'status', v_existing.status,
        'account_details', COALESCE(v_existing.account_details, '{}'::jsonb)
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'authorization_pending', true,
      'order_id', v_existing.id,
      'reservation_id', v_existing.wallet_reservation_id,
      'status', v_existing.status,
      'financial_authorization_status', v_existing.financial_authorization_status,
      'financial_security_version', v_existing.financial_security_version,
      'account_ids', COALESCE(v_existing.account_details->'reserved_account_ids', '[]'::jsonb)
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
      'code', 'PROFILE_NOT_FOUND',
      'error', 'product_purchase_profile_not_found'
    );
  END IF;

  IF COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CUSTOMER_ONLY',
      'error', 'staff_and_admin_purchases_are_not_allowed'
    );
  END IF;

  IF COALESCE(v_profile.account_suspended, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_NOT_ACTIVE',
      'error', 'product_purchase_wallet_not_active'
    );
  END IF;

  v_current_security_version := GREATEST(COALESCE(v_profile.financial_security_version, 1), 1);
  IF p_financial_security_version IS DISTINCT FROM v_current_security_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_SECURITY_VERSION_STALE',
      'error', 'product_purchase_security_version_stale',
      'current_financial_security_version', v_current_security_version,
      'requested_financial_security_version', p_financial_security_version
    );
  END IF;

  SELECT *
    INTO v_product
  FROM public.product_groups
  WHERE id = p_product_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PRODUCT_NOT_FOUND',
      'error', 'product_not_found'
    );
  END IF;

  IF v_product.is_active IS FALSE
    OR v_product.is_sellable IS FALSE
    OR upper(COALESCE(v_product.availability_status, '')) IN ('UNAVAILABLE', 'PAUSED')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PRODUCT_UNAVAILABLE',
      'error', 'product_is_not_sellable'
    );
  END IF;

  IF v_amount > round(COALESCE(v_product.price, 0) * p_quantity, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PRICE_CHANGED',
      'error', 'server_price_is_lower_than_requested_charge'
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

  v_order_id := gen_random_uuid();

  IF p_preferred_account_id IS NOT NULL THEN
    IF p_quantity <> 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'PREFERRED_ACCOUNT_QUANTITY_INVALID',
        'error', 'preferred_account_id_requires_single_item_purchase'
      );
    END IF;

    SELECT id
      INTO v_preferred_account_id
    FROM public.individual_accounts
    WHERE id = p_preferred_account_id
      AND product_group_id = p_product_group_id
      AND status = 'available'
    FOR UPDATE SKIP LOCKED;

    IF v_preferred_account_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'PREFERRED_ACCOUNT_UNAVAILABLE',
        'error', 'selected_account_is_no_longer_available'
      );
    END IF;

    v_account_ids := ARRAY[v_preferred_account_id];
  ELSE
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
      INTO v_account_ids
    FROM (
      SELECT id
      FROM public.individual_accounts
      WHERE product_group_id = p_product_group_id
        AND status = 'available'
      ORDER BY id
      LIMIT p_quantity
      FOR UPDATE SKIP LOCKED
    ) available;
  END IF;

  IF cardinality(v_account_ids) < p_quantity THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INSUFFICIENT_STOCK',
      'error', 'not_enough_accounts_available',
      'available', cardinality(v_account_ids),
      'requested', p_quantity
    );
  END IF;

  v_order_metadata := v_order_metadata || jsonb_build_object(
    'reserved_account_ids', to_jsonb(v_account_ids),
    'quantity', p_quantity,
    'product_group_id', p_product_group_id,
    'financial_authorization', 'reserve_first'
  );

  SELECT public.create_wallet_reservation(
    p_user_id,
    v_amount,
    'orders',
    v_order_id,
    'product:reservation:' || v_idempotency_key,
    v_order_metadata,
    'NGN',
    v_current_security_version,
    NULL
  )
  INTO v_reservation;

  IF COALESCE((v_reservation->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_reservation || jsonb_build_object('order_id', v_order_id);
  END IF;

  UPDATE public.individual_accounts
     SET status = 'reserved'
   WHERE id = ANY(v_account_ids)
     AND status = 'available';

  GET DIAGNOSTICS v_account_count = ROW_COUNT;
  IF v_account_count <> p_quantity THEN
    RAISE EXCEPTION 'product_purchase_inventory_reservation_conflict';
  END IF;

  INSERT INTO public.orders (
    id,
    user_id,
    product_group_id,
    amount,
    status,
    idempotency_key,
    account_details,
    wallet_reservation_id,
    financial_authorization_status,
    financial_security_version,
    financial_authorization_reference
  )
  VALUES (
    v_order_id,
    p_user_id,
    p_product_group_id,
    v_amount,
    'processing',
    v_idempotency_key,
    v_order_metadata,
    (v_reservation->>'reservation_id')::uuid,
    'funds_held',
    v_current_security_version,
    'PUR-' || left(v_idempotency_key, 24)
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'authorization_pending', true,
    'order_id', v_order_id,
    'reservation_id', (v_reservation->>'reservation_id')::uuid,
    'status', 'processing',
    'financial_authorization_status', 'funds_held',
    'financial_security_version', v_current_security_version,
    'account_ids', to_jsonb(v_account_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_product_purchase(
  p_user_id uuid,
  p_order_id uuid,
  p_reservation_id uuid,
  p_account_ids uuid[],
  p_account_details jsonb,
  p_capture_idempotency_key text,
  p_reference text,
  p_description text,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_capture jsonb;
  v_account_count integer := 0;
  v_reserved_account_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'product_purchase_completion_identity_required';
  END IF;

  IF p_account_ids IS NULL OR cardinality(p_account_ids) < 1 THEN
    RAISE EXCEPTION 'product_purchase_completion_accounts_required';
  END IF;

  IF p_account_details IS NULL OR jsonb_typeof(p_account_details) <> 'object' THEN
    RAISE EXCEPTION 'product_purchase_completion_details_required';
  END IF;

  IF NULLIF(btrim(COALESCE(p_capture_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'product_purchase_capture_idempotency_key_required';
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'product_purchase_order_not_found'
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
      'code', 'PROFILE_NOT_FOUND',
      'error', 'product_purchase_profile_not_found'
    );
  END IF;

  IF COALESCE(v_profile.account_suspended, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WALLET_NOT_ACTIVE',
      'error', 'product_purchase_wallet_not_active'
    );
  END IF;

  IF GREATEST(COALESCE(v_profile.financial_security_version, 1), 1)
      IS DISTINCT FROM GREATEST(COALESCE(v_order.financial_security_version, 1), 1)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_AUTHORIZATION_STALE',
      'error', 'product_purchase_security_version_stale'
    );
  END IF;

  IF lower(COALESCE(v_order.status, '')) = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'account_details', COALESCE(v_order.account_details, '{}'::jsonb)
    );
  END IF;

  IF v_order.wallet_reservation_id IS DISTINCT FROM p_reservation_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_RESERVATION_MISMATCH',
      'error', 'product_purchase_reservation_does_not_match_order'
    );
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_reservation.order_table IS DISTINCT FROM 'orders'
    OR v_reservation.order_id IS DISTINCT FROM p_order_id
    OR v_reservation.status NOT IN ('active', 'captured')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FULFILLMENT_RESERVATION_INVALID',
      'error', 'product_purchase_reservation_does_not_match_order'
    );
  END IF;

  SELECT COALESCE(array_agg(value::uuid ORDER BY value::text), ARRAY[]::uuid[])
    INTO v_reserved_account_ids
  FROM jsonb_array_elements_text(
    COALESCE(v_reservation.metadata->'reserved_account_ids', '[]'::jsonb)
  ) AS reserved(value);

  IF cardinality(v_reserved_account_ids) <> cardinality(p_account_ids)
    OR EXISTS (
      SELECT 1
      FROM unnest(p_account_ids) requested(id)
      WHERE NOT (requested.id = ANY(v_reserved_account_ids))
    )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FULFILLMENT_RESERVATION_INVALID',
      'error', 'product_purchase_account_set_does_not_match_reservation'
    );
  END IF;

  SELECT public.capture_wallet_reservation(
    p_reservation_id,
    p_reference,
    p_description,
    p_capture_idempotency_key,
    jsonb_build_object(
      'source', 'authorize_product_purchase',
      'source_order_table', 'orders',
      'source_order_id', p_order_id,
      'source_order_idempotency_key', v_order.idempotency_key
    ),
    p_created_by
  )
  INTO v_capture;

  IF COALESCE((v_capture->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_capture || jsonb_build_object('order_id', p_order_id);
  END IF;

  UPDATE public.individual_accounts
     SET status = 'sold',
         sold_at = now()
   WHERE id = ANY(p_account_ids)
     AND status = 'reserved';

  GET DIAGNOSTICS v_account_count = ROW_COUNT;
  IF v_account_count <> cardinality(p_account_ids) THEN
    RAISE EXCEPTION 'product_purchase_completion_inventory_conflict';
  END IF;

  UPDATE public.orders
     SET account_details = p_account_details,
         status = 'completed',
         wallet_reservation_id = p_reservation_id,
         financial_authorization_status = 'captured',
         financial_security_version = COALESCE(v_order.financial_security_version, 1),
         financial_authorization_reference = COALESCE(
           v_order.financial_authorization_reference,
           p_reference
         )
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'order_id', p_order_id,
    'status', 'completed',
    'transaction', v_capture->'transaction',
    'balance_after', v_capture->'balance_after',
    'account_details', p_account_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer) IS
  'Atomic local product authorization: verifies trusted funds, creates a wallet hold, reserves inventory, and records a non-delivered order.';

COMMENT ON FUNCTION public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid) IS
  'Atomic local product completion: captures the wallet hold, stores credentials, and marks the reserved inventory sold.';
