-- Recheck derived, service-verified supplier readiness at each boundary that
-- can start a NEW paid request. Existing successful attempts still replay and
-- attach when readiness is false, so purchased credentials can be settled.
-- Based on the exact 02000 function bodies, after 03000 adds readiness.

CREATE OR REPLACE FUNCTION public.authorize_supplier_product_purchase(
  p_user_id uuid,
  p_product_group_id uuid,
  p_quantity integer,
  p_amount numeric,
  p_idempotency_key text,
  p_order_metadata jsonb DEFAULT '{}'::jsonb,
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
  v_account_count integer := 0;
  v_current_security_version integer;
  v_configured_providers text[] := ARRAY[]::text[];
  v_provider text;
BEGIN
  IF p_user_id IS NULL OR p_product_group_id IS NULL THEN
    RAISE EXCEPTION 'product_purchase_identity_required';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 500 THEN
    RAISE EXCEPTION 'product_purchase_quantity_invalid';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
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
      OR COALESCE((v_existing.account_details->>'quantity')::integer, 0) <> p_quantity
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
      , 'supplier_quantity', COALESCE((v_existing.account_details->>'supplier_quantity')::integer, 0)
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

  IF v_product.supplier_fallback_ready IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_READY');
  END IF;
  IF COALESCE(v_product.auto_fulfill_enabled, false) IS NOT TRUE
    OR COALESCE(v_product.supplier_fallback_blocked, false)
    OR (NULLIF(btrim(COALESCE(v_product.muabanvia_product_id, '')), '') IS NULL
      AND NULLIF(btrim(COALESCE(v_product.shopclone_product_id, '')), '') IS NULL
      AND NULLIF(btrim(COALESCE(v_product.shopviaclone_product_id, '')), '') IS NULL)
  THEN
    RETURN jsonb_build_object('success', false, 'code', 'SUPPLIER_NOT_CONFIGURED');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_attempts spa
    JOIN public.orders pending_order ON pending_order.id=spa.order_id
    WHERE pending_order.product_group_id=p_product_group_id
      AND (spa.status IN ('sending','unknown') OR (spa.status='succeeded' AND pending_order.status='processing'))
  ) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_RECONCILIATION_PENDING');
  END IF;

  IF jsonb_typeof(v_order_metadata->'supplier_configured_providers') <> 'array' THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_CONFIG_SNAPSHOT_REQUIRED');
  END IF;
  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_configured_providers
  FROM jsonb_array_elements_text(v_order_metadata->'supplier_configured_providers') AS entries(value);
  IF cardinality(v_configured_providers) < 1 OR cardinality(v_configured_providers) > 3
    OR (SELECT count(DISTINCT provider) FROM unnest(v_configured_providers) AS configured(provider))
      <> cardinality(v_configured_providers) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_CONFIG_SNAPSHOT_INVALID');
  END IF;
  FOREACH v_provider IN ARRAY v_configured_providers LOOP
    IF (v_provider='muabanvia' AND NULLIF(btrim(COALESCE(v_product.muabanvia_product_id,'')),'') IS NOT NULL)
      OR (v_provider='shopclone' AND NULLIF(btrim(COALESCE(v_product.shopclone_product_id,'')),'') IS NOT NULL)
      OR (v_provider='shopviaclone' AND NULLIF(btrim(COALESCE(v_product.shopviaclone_product_id,'')),'') IS NOT NULL) THEN
      CONTINUE;
    END IF;
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_CONFIG_SNAPSHOT_INVALID');
  END LOOP;

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

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_account_ids
  FROM (
    SELECT id FROM public.individual_accounts
    WHERE product_group_id = p_product_group_id AND status = 'available'
    ORDER BY id LIMIT p_quantity FOR UPDATE SKIP LOCKED
  ) available;

  IF cardinality(v_account_ids) >= p_quantity THEN
    RETURN jsonb_build_object('success', false, 'code', 'LOCAL_STOCK_AVAILABLE');
  END IF;

  v_order_metadata := v_order_metadata || jsonb_build_object(
    'reserved_account_ids', to_jsonb(v_account_ids),
    'quantity', p_quantity,
    'supplier_quantity', p_quantity - cardinality(v_account_ids),
    'product_group_id', p_product_group_id,
    'financial_authorization', 'supplier_reserve_first'
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
  IF v_account_count <> cardinality(v_account_ids) THEN
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
    'account_ids', to_jsonb(v_account_ids),
    'supplier_quantity', p_quantity - cardinality(v_account_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_supplier_purchase_attempt(
  p_order_id uuid,
  p_reservation_id uuid,
  p_provider text,
  p_product_id text,
  p_idempotency_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_existing public.supplier_purchase_attempts%ROWTYPE;
  v_attempt public.supplier_purchase_attempts%ROWTYPE;
  v_product_id text;
  v_count integer;
  v_quantity integer;
BEGIN
  IF p_order_id IS NULL OR p_reservation_id IS NULL OR NULLIF(btrim(COALESCE(p_idempotency_key,'')), '') IS NULL THEN
    RAISE EXCEPTION 'supplier_attempt_identity_required';
  END IF;
  IF p_provider NOT IN ('muabanvia', 'shopclone', 'shopviaclone') THEN
    RAISE EXCEPTION 'supplier_provider_invalid';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'processing' OR v_order.wallet_reservation_id IS DISTINCT FROM p_reservation_id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_AUTHORIZED');
  END IF;
  SELECT * INTO v_reservation FROM public.wallet_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.order_id IS DISTINCT FROM p_order_id OR v_reservation.status <> 'active'
    OR v_reservation.financial_security_version IS DISTINCT FROM v_order.financial_security_version THEN
    RETURN jsonb_build_object('success',false,'code','RESERVATION_NOT_ACTIVE');
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_order.user_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_profile.account_suspended,false)
    OR COALESCE(v_profile.is_admin,false) OR COALESCE(v_profile.is_staff,false)
    OR v_profile.financial_security_version IS DISTINCT FROM v_order.financial_security_version THEN
    RETURN jsonb_build_object('success',false,'code','CUSTOMER_AUTHORIZATION_STALE');
  END IF;
  v_quantity := COALESCE((v_order.account_details->>'supplier_quantity')::integer, 0);
  IF v_quantity < 1 THEN RETURN jsonb_build_object('success',false,'code','SUPPLIER_QUANTITY_INVALID'); END IF;
  IF NOT COALESCE(v_order.account_details->'supplier_configured_providers' ? p_provider,false) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_IN_ORDER_SNAPSHOT');
  END IF;
  SELECT * INTO v_existing FROM public.supplier_purchase_attempts WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.provider IS DISTINCT FROM p_provider
      OR v_existing.provider_product_id IS DISTINCT FROM p_product_id THEN
      RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('success',true,'idempotent_replay',true,'attempt_id',v_existing.id,
      'status',v_existing.status,'outcome',v_existing.status,'reason',v_existing.rejection_reason,
      'quantity',v_existing.quantity,'provider_product_id',v_existing.provider_product_id);
  END IF;
  SELECT * INTO v_product FROM public.product_groups WHERE id = v_order.product_group_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_product.auto_fulfill_enabled,false) IS NOT TRUE
    OR COALESCE(v_product.supplier_fallback_blocked,false)
    OR v_product.is_active IS FALSE OR v_product.is_sellable IS FALSE
    OR upper(COALESCE(v_product.availability_status,'')) IN ('UNAVAILABLE','PAUSED') THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_DISABLED');
  END IF;
  IF v_product.supplier_fallback_ready IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_READY');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_attempts spa
    JOIN public.orders pending_order ON pending_order.id=spa.order_id
    WHERE pending_order.product_group_id=v_order.product_group_id
      AND (spa.status IN ('sending','unknown') OR (spa.status='succeeded' AND pending_order.status='processing'))
  ) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_RECONCILIATION_PENDING');
  END IF;
  v_product_id := CASE p_provider
    WHEN 'muabanvia' THEN v_product.muabanvia_product_id
    WHEN 'shopclone' THEN v_product.shopclone_product_id
    WHEN 'shopviaclone' THEN v_product.shopviaclone_product_id END;
  IF NULLIF(btrim(COALESCE(v_product_id,'')), '') IS NULL
    OR v_product_id IS DISTINCT FROM p_product_id THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_MAPPED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_purchase_attempts WHERE order_id = p_order_id AND status <> 'rejected') THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_OUTCOME_UNRESOLVED');
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.supplier_purchase_attempts
    WHERE order_id = p_order_id AND provider = p_provider;
  IF EXISTS (SELECT 1 FROM public.supplier_purchase_attempts
    WHERE order_id=p_order_id AND provider=p_provider AND rejection_reason='insufficient_balance') THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_BALANCE_REJECTED');
  END IF;
  IF v_count >= 3 THEN RETURN jsonb_build_object('success',false,'code','SUPPLIER_ATTEMPT_LIMIT'); END IF;
  INSERT INTO public.supplier_purchase_attempts(order_id,reservation_id,provider,provider_product_id,
    quantity,attempt_number,idempotency_key)
  VALUES (p_order_id,p_reservation_id,p_provider,v_product_id,v_quantity,v_count+1,p_idempotency_key)
  RETURNING * INTO v_attempt;
  RETURN jsonb_build_object('success',true,'attempt_id',v_attempt.id,'status','prepared',
    'quantity',v_quantity,'provider_product_id',v_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_supplier_purchase_sending(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt public.supplier_purchase_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_product_id text;
BEGIN
  SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ATTEMPT_NOT_FOUND'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_attempt.order_id FOR UPDATE;
  SELECT * INTO v_reservation FROM public.wallet_reservations WHERE id=v_attempt.reservation_id FOR UPDATE;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_order.user_id FOR UPDATE;
  SELECT * INTO v_product FROM public.product_groups WHERE id=v_order.product_group_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF v_attempt.status <> 'prepared' THEN
    RETURN jsonb_build_object('success',false,'code','ATTEMPT_NOT_PREPARED');
  END IF;
  IF v_order.status <> 'processing' OR v_order.financial_authorization_status <> 'funds_held'
    OR v_order.wallet_reservation_id IS DISTINCT FROM v_reservation.id
    OR v_reservation.status <> 'active' OR v_reservation.order_id IS DISTINCT FROM v_order.id
    OR v_reservation.financial_security_version IS DISTINCT FROM v_order.financial_security_version
    OR v_profile.id IS NULL OR COALESCE(v_profile.account_suspended,false)
    OR COALESCE(v_profile.is_staff,false) OR COALESCE(v_profile.is_admin,false)
    OR v_profile.financial_security_version IS DISTINCT FROM v_order.financial_security_version THEN
    RETURN jsonb_build_object('success',false,'code','CUSTOMER_AUTHORIZATION_STALE');
  END IF;
  v_product_id := CASE v_attempt.provider
    WHEN 'muabanvia' THEN v_product.muabanvia_product_id
    WHEN 'shopclone' THEN v_product.shopclone_product_id
    WHEN 'shopviaclone' THEN v_product.shopviaclone_product_id END;
  IF v_product.id IS NULL OR v_product.is_active IS FALSE OR v_product.is_sellable IS FALSE
    OR upper(COALESCE(v_product.availability_status,'')) IN ('UNAVAILABLE','PAUSED')
    OR COALESCE(v_product.auto_fulfill_enabled,false) IS NOT TRUE
    OR COALESCE(v_product.supplier_fallback_blocked,false)
    OR v_product_id IS DISTINCT FROM v_attempt.provider_product_id
    OR NOT COALESCE(v_order.account_details->'supplier_configured_providers' ? v_attempt.provider,false)
    OR v_attempt.quantity IS DISTINCT FROM COALESCE((v_order.account_details->>'supplier_quantity')::integer,0) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_AVAILABLE');
  END IF;
  IF v_product.supplier_fallback_ready IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_READY');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_attempts spa
    JOIN public.orders pending_order ON pending_order.id=spa.order_id
    WHERE pending_order.product_group_id=v_order.product_group_id
      AND spa.id<>p_attempt_id AND (spa.status IN ('sending','unknown') OR (spa.status='succeeded' AND pending_order.status='processing'))
  ) THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_RECONCILIATION_PENDING');
  END IF;
  UPDATE public.supplier_purchase_attempts SET status='sending',sending_at=now()
    WHERE id=p_attempt_id;
  RETURN jsonb_build_object('success',true,'attempt_id',p_attempt_id,'send_allowed',true);
END;
$$;
