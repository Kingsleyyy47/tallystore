-- Supplier fallback after local stock is insufficient. Financial authorization
-- and partial local inventory are reserved before any paid supplier request.
-- All functions below are service-role only; no HTTP call occurs in SQL.

-- The original completed/failed/refunded-only constraint prevented the existing
-- reserve-first local purchase RPC from creating its processing order as well.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('completed','failed','refunded','processing','cancelled')) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;

ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS supplier_fallback_blocked boolean NOT NULL DEFAULT false;

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

CREATE TABLE public.supplier_purchase_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('muabanvia', 'shopclone', 'shopviaclone')),
  provider_product_id text NOT NULL CHECK (btrim(provider_product_id) <> ''),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'sending', 'succeeded', 'rejected', 'unknown')),
  rejection_reason text CHECK (rejection_reason IS NULL OR rejection_reason IN ('no_stock', 'insufficient_balance')),
  provider_reference text,
  credentials jsonb,
  reserved_account_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  sending_at timestamptz,
  resolved_at timestamptz,
  UNIQUE (order_id, provider, attempt_number),
  CHECK ((status = 'rejected' AND rejection_reason IS NOT NULL) OR (status <> 'rejected' AND rejection_reason IS NULL)),
  CHECK ((status = 'succeeded' AND jsonb_typeof(credentials) = 'array') OR (status <> 'succeeded' AND credentials IS NULL))
);
CREATE INDEX supplier_purchase_attempts_order_idx ON public.supplier_purchase_attempts(order_id, created_at);
CREATE UNIQUE INDEX supplier_purchase_provider_reference_unique
  ON public.supplier_purchase_attempts(provider,provider_reference)
  WHERE status='succeeded' AND provider_reference IS NOT NULL;
ALTER TABLE public.supplier_purchase_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_purchase_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_purchase_attempts TO service_role;

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

CREATE OR REPLACE FUNCTION public.record_supplier_purchase_outcome(
  p_attempt_id uuid,
  p_outcome text,
  p_provider_reference text DEFAULT NULL,
  p_credentials jsonb DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt public.supplier_purchase_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_item jsonb;
BEGIN
  IF p_outcome NOT IN ('succeeded','rejected','unknown') THEN RAISE EXCEPTION 'supplier_outcome_invalid'; END IF;
  IF p_outcome = 'rejected' AND p_error NOT IN ('no_stock','insufficient_balance') THEN
    RAISE EXCEPTION 'supplier_rejection_not_confirmed';
  END IF;
  IF p_outcome <> 'rejected' AND p_error IS NOT NULL THEN RAISE EXCEPTION 'supplier_error_code_invalid'; END IF;
  SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ATTEMPT_NOT_FOUND'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_attempt.order_id FOR UPDATE;
  SELECT * INTO v_reservation FROM public.wallet_reservations WHERE id=v_attempt.reservation_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF v_attempt.status IN ('succeeded','rejected','unknown') THEN
    IF v_attempt.status = p_outcome AND v_attempt.rejection_reason IS NOT DISTINCT FROM p_error
      AND v_attempt.provider_reference IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(p_provider_reference,'')),'')
      AND v_attempt.credentials IS NOT DISTINCT FROM p_credentials THEN
      RETURN jsonb_build_object('success',true,'idempotent_replay',true,'status',v_attempt.status);
    END IF;
    RETURN jsonb_build_object('success',false,'code','OUTCOME_CONFLICT');
  END IF;
  IF v_attempt.status <> 'sending' THEN RETURN jsonb_build_object('success',false,'code','ATTEMPT_NOT_SENDING'); END IF;
  IF v_order.status <> 'processing' OR v_order.wallet_reservation_id IS DISTINCT FROM v_reservation.id
    OR v_reservation.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'code','AUTHORIZATION_NOT_ACTIVE');
  END IF;
  IF p_outcome='succeeded' THEN
    IF NULLIF(btrim(COALESCE(p_provider_reference,'')),'') IS NULL
      OR length(p_provider_reference)>200 OR p_credentials IS NULL
      OR jsonb_typeof(p_credentials)<>'array' OR jsonb_array_length(p_credentials)<>v_attempt.quantity THEN
      RAISE EXCEPTION 'supplier_success_evidence_invalid';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_credentials) AS entries(value) LOOP
      IF jsonb_typeof(v_item)<>'object' OR NULLIF(btrim(COALESCE(v_item->>'username','')),'') IS NULL
        OR NULLIF(btrim(COALESCE(v_item->>'password','')),'') IS NULL THEN
        RAISE EXCEPTION 'supplier_credentials_invalid';
      END IF;
    END LOOP;
  ELSIF p_credentials IS NOT NULL THEN
    RAISE EXCEPTION 'supplier_non_success_credentials_forbidden';
  END IF;
  UPDATE public.supplier_purchase_attempts SET status=p_outcome,
    rejection_reason=CASE WHEN p_outcome='rejected' THEN p_error ELSE NULL END,
    provider_reference=NULLIF(btrim(COALESCE(p_provider_reference,'')),'') ,
    credentials=CASE WHEN p_outcome='succeeded' THEN p_credentials ELSE NULL END,
    resolved_at=now() WHERE id=p_attempt_id;
  IF p_outcome='unknown' THEN
    UPDATE public.orders SET financial_authorization_status='outcome_unknown' WHERE id=v_order.id;
    UPDATE public.product_groups SET supplier_fallback_blocked=true WHERE id=v_order.product_group_id;
    PERFORM public.refresh_supplier_product_availability(v_order.product_group_id,true);
  ELSIF p_outcome='rejected' THEN
    PERFORM public.refresh_supplier_product_availability(v_order.product_group_id,true);
  END IF;
  RETURN jsonb_build_object('success',true,'status',p_outcome);
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_supplier_purchase_accounts(
  p_order_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_attempt public.supplier_purchase_attempts%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_item jsonb;
  v_account_id uuid;
  v_local_ids uuid[] := ARRAY[]::uuid[];
  v_all_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id;
  IF v_attempt.id IS NOT NULL THEN
    SELECT * INTO v_reservation FROM public.wallet_reservations WHERE id=v_attempt.reservation_id FOR UPDATE;
    SELECT * INTO v_attempt FROM public.supplier_purchase_attempts WHERE id=p_attempt_id FOR UPDATE;
  END IF;
  IF v_order.id IS NULL OR v_attempt.id IS NULL OR v_attempt.order_id IS DISTINCT FROM p_order_id
    OR v_attempt.status <> 'succeeded' THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_SUCCESS_NOT_RECORDED');
  END IF;
  IF v_attempt.reserved_account_ids IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'idempotent_replay',true,
      'account_ids',to_jsonb(v_attempt.reserved_account_ids));
  END IF;
  IF v_order.status <> 'processing' OR v_order.wallet_reservation_id IS DISTINCT FROM v_reservation.id
    OR v_reservation.status <> 'active' THEN
    RETURN jsonb_build_object('success',false,'code','AUTHORIZATION_NOT_ACTIVE');
  END IF;
  SELECT COALESCE(array_agg(value::uuid ORDER BY value::text),ARRAY[]::uuid[]) INTO v_local_ids
  FROM jsonb_array_elements_text(COALESCE(v_reservation.metadata->'reserved_account_ids','[]'::jsonb)) AS ids(value);
  v_all_ids := v_local_ids;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_attempt.credentials) AS entries(value) LOOP
    v_account_id := gen_random_uuid();
    INSERT INTO public.individual_accounts(
      id,product_group_id,username,password,email,email_password,two_fa_code,
      recovery_email,recovery_email_password,additional_info,status
    ) VALUES (
      v_account_id,v_order.product_group_id,v_item->>'username',v_item->>'password',
      v_item->>'email',v_item->>'email_password',v_item->>'two_fa_code',
      v_item->>'recovery_email',v_item->>'recovery_email_password',v_item->'additional_info','reserved'
    );
    v_all_ids := array_append(v_all_ids,v_account_id);
  END LOOP;
  IF cardinality(v_all_ids) <> COALESCE((v_order.account_details->>'quantity')::integer,0) THEN
    RAISE EXCEPTION 'supplier_final_account_count_invalid';
  END IF;
  UPDATE public.wallet_reservations SET metadata=metadata || jsonb_build_object(
    'reserved_account_ids',to_jsonb(v_all_ids),'supplier_attempt_id',p_attempt_id),updated_at=now()
    WHERE id=v_reservation.id;
  UPDATE public.orders SET account_details=account_details || jsonb_build_object(
    'reserved_account_ids',to_jsonb(v_all_ids),'supplier_attempt_id',p_attempt_id)
    WHERE id=v_order.id;
  UPDATE public.supplier_purchase_attempts SET reserved_account_ids=v_all_ids WHERE id=p_attempt_id;
  RETURN jsonb_build_object('success',true,'account_ids',to_jsonb(v_all_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_exhausted_supplier_purchase(
  p_order_id uuid,
  p_reservation_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reservation public.wallet_reservations%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_release jsonb;
  v_stock integer;
  v_provider text;
  v_count integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.wallet_reservation_id IS DISTINCT FROM p_reservation_id
    OR v_order.status <> 'processing' THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_AUTHORIZED');
  END IF;
  SELECT * INTO v_reservation FROM public.wallet_reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status <> 'active' OR v_reservation.order_id IS DISTINCT FROM p_order_id THEN
    RETURN jsonb_build_object('success',false,'code','RESERVATION_NOT_ACTIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_purchase_attempts WHERE order_id=p_order_id)
    OR EXISTS (SELECT 1 FROM public.supplier_purchase_attempts WHERE order_id=p_order_id AND status <> 'rejected') THEN
    RETURN jsonb_build_object('success',false,'code','SUPPLIER_OUTCOME_UNRESOLVED');
  END IF;
  SELECT * INTO v_product FROM public.product_groups WHERE id=v_order.product_group_id FOR UPDATE;
  FOR v_provider IN SELECT value FROM jsonb_array_elements_text(
    COALESCE(v_order.account_details->'supplier_configured_providers','[]'::jsonb)) AS configured(value) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.supplier_purchase_attempts
      WHERE order_id=p_order_id AND provider=v_provider AND status='rejected'
        AND rejection_reason='insufficient_balance')
      AND (SELECT count(*) FROM public.supplier_purchase_attempts
        WHERE order_id=p_order_id AND provider=v_provider AND status='rejected'
          AND rejection_reason='no_stock') < 3 THEN
      RETURN jsonb_build_object('success',false,'code','SUPPLIER_NOT_EXHAUSTED','provider',v_provider);
    END IF;
  END LOOP;
  SELECT COALESCE(array_agg(value::uuid),ARRAY[]::uuid[]) INTO v_ids FROM
    jsonb_array_elements_text(COALESCE(v_reservation.metadata->'reserved_account_ids','[]'::jsonb)) AS ids(value);
  UPDATE public.individual_accounts SET status='available' WHERE id=ANY(v_ids) AND status='reserved';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'supplier_local_inventory_release_conflict'; END IF;
  SELECT public.release_wallet_reservation(p_reservation_id,'supplier_confirmed_exhausted',
    'supplier:release:'||p_order_id::text) INTO v_release;
  IF COALESCE((v_release->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'supplier_wallet_release_failed';
  END IF;
  UPDATE public.orders SET status='cancelled',financial_authorization_status='released' WHERE id=p_order_id;
  SELECT count(*)::integer INTO v_stock FROM public.individual_accounts
    WHERE product_group_id=v_product.id AND status='available';
  UPDATE public.product_groups SET supplier_fallback_blocked=true,stock_count=v_stock,
    is_sellable=(v_stock>0 AND v_product.is_active IS TRUE AND upper(COALESCE(v_product.availability_status,''))<>'PAUSED'),availability_status=CASE WHEN v_product.is_active IS NOT TRUE OR upper(COALESCE(v_product.availability_status,''))='PAUSED' THEN 'PAUSED' WHEN v_stock=0 THEN 'UNAVAILABLE'
      WHEN v_stock<=3 THEN 'LOW_STOCK' ELSE 'AVAILABLE' END WHERE id=v_product.id;
  RETURN jsonb_build_object('success',true,'status','cancelled','local_stock',v_stock);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_supplier_product_availability(
  p_product_group_id uuid,
  p_fallback_enabled boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product public.product_groups%ROWTYPE;
  v_stock integer;
  v_fallback boolean;
  v_status text;
BEGIN
  SELECT * INTO v_product FROM public.product_groups WHERE id=p_product_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PRODUCT_NOT_FOUND'); END IF;
  IF v_product.is_active IS FALSE OR upper(COALESCE(v_product.availability_status,''))='PAUSED' THEN
    RETURN jsonb_build_object('success',true,'preserved',true,'availability_status',v_product.availability_status);
  END IF;
  SELECT count(*)::integer INTO v_stock FROM public.individual_accounts
    WHERE product_group_id=p_product_group_id AND status='available';
  v_fallback := COALESCE(p_fallback_enabled,false)
    AND COALESCE(v_product.auto_fulfill_enabled,false)
    AND NOT COALESCE(v_product.supplier_fallback_blocked,false)
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_purchase_attempts spa
      JOIN public.orders pending_order ON pending_order.id=spa.order_id
      WHERE pending_order.product_group_id=p_product_group_id
        AND (spa.status IN ('sending','unknown') OR (spa.status='succeeded' AND pending_order.status='processing'))
    )
    AND (NULLIF(btrim(COALESCE(v_product.muabanvia_product_id,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(v_product.shopclone_product_id,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(v_product.shopviaclone_product_id,'')),'') IS NOT NULL);
  v_status := CASE WHEN v_stock>3 THEN 'AVAILABLE' WHEN v_stock>0 THEN 'LOW_STOCK'
    WHEN v_fallback THEN 'UNLIMITED' ELSE 'UNAVAILABLE' END;
  UPDATE public.product_groups SET stock_count=v_stock,is_sellable=(v_stock>0 OR v_fallback),
    availability_status=v_status WHERE id=p_product_group_id;
  RETURN jsonb_build_object('success',true,'stock_count',v_stock,'supplier_fallback_enabled',v_fallback,
    'availability_status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.block_supplier_product_fallback(
  p_product_group_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.product_groups SET supplier_fallback_blocked=true WHERE id=p_product_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PRODUCT_NOT_FOUND'); END IF;
  RETURN public.refresh_supplier_product_availability(p_product_group_id,false);
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_supplier_product_purchase(uuid,uuid,integer,numeric,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_supplier_purchase_attempt(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_supplier_purchase_sending(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_supplier_purchase_outcome(uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.attach_supplier_purchase_accounts(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_exhausted_supplier_purchase(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.refresh_supplier_product_availability(uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.block_supplier_product_fallback(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_supplier_product_purchase(uuid,uuid,integer,numeric,text,jsonb,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_supplier_purchase_attempt(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_supplier_purchase_sending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_purchase_outcome(uuid,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_supplier_purchase_accounts(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_exhausted_supplier_purchase(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_supplier_product_availability(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_supplier_product_fallback(uuid) TO service_role;
