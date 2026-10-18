-- One service-side transaction for a confirmed Daisy cancellation or an
-- explicitly reviewed, expired, undelivered owner override. No provider call
-- or purchase retry occurs here. The wallet engine remains the only credit
-- writer; its failure aborts this entire transaction.
CREATE OR REPLACE FUNCTION public.cancel_sms_order_and_refund(
  p_order_id uuid,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid DEFAULT NULL,
  p_owner_undelivered_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_user_id uuid;
  v_order public.sms_orders%ROWTYPE;
  v_debit public.transactions%ROWTYPE;
  v_refund public.transactions%ROWTYPE;
  v_debit_count integer;
  v_linked_count integer;
  v_other_refund_count integer;
  v_refund_reference text;
  v_refund_key text;
  v_result jsonb;
  v_proof jsonb;
  v_response text;
  v_override boolean := COALESCE(p_owner_undelivered_override, false);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_reason IS NULL OR p_reason !~ '^[a-z][a-z_]{2,63}$'
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_REQUEST');
  END IF;

  -- Wallet engine locks the profile before crediting. Use the same order here
  -- so concurrent cancellation, purchase, and refund paths cannot deadlock.
  SELECT user_id INTO v_user_id FROM public.sms_orders WHERE id = p_order_id;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'CUSTOMER_NOT_FOUND');
  END IF;
  SELECT * INTO v_order FROM public.sms_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_CHANGED');
  END IF;
  IF v_order.messages IS NOT NULL AND jsonb_typeof(v_order.messages) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_REVIEW_REQUIRED');
  END IF;
  IF v_order.order_type IS DISTINCT FROM 'otp'
    OR v_order.provider IS DISTINCT FROM 'smsbus'
    OR v_order.status = 'completed' OR v_order.completed_at IS NOT NULL
    OR jsonb_array_length(COALESCE(v_order.messages, '[]'::jsonb)) <> 0
    OR v_order.price_ngn IS NULL OR v_order.price_ngn <= 0
    OR v_order.price_ngn <> round(v_order.price_ngn, 2)
    OR NULLIF(btrim(v_order.reference), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_REVIEW_REQUIRED');
  END IF;

  -- The reference is unique on sms_orders. Do not require a modern purchase
  -- idempotency key: verified historical orders predate that key convention.
  SELECT count(*)::integer INTO v_debit_count
  FROM public.transactions t
  WHERE t.user_id = v_order.user_id AND t.reference = v_order.reference
    AND t.type = 'purchase';
  IF v_debit_count <> 1 THEN
    RETURN jsonb_build_object('success', false, 'code', 'PURCHASE_DEBIT_REVIEW_REQUIRED');
  END IF;
  SELECT * INTO v_debit FROM public.transactions t
  WHERE t.user_id = v_order.user_id AND t.reference = v_order.reference
    AND t.type = 'purchase' FOR UPDATE;
  IF v_debit.status IS DISTINCT FROM 'completed'
    OR upper(COALESCE(v_debit.currency, '')) <> 'NGN'
    OR COALESCE(v_debit.balance_type, 'wallet') <> 'wallet'
    OR v_debit.amount IS DISTINCT FROM -v_order.price_ngn THEN
    RETURN jsonb_build_object('success', false, 'code', 'PURCHASE_DEBIT_REVIEW_REQUIRED');
  END IF;

  v_refund_reference := 'REFUND-' || v_order.reference;
  v_refund_key := 'sms:refund:' || v_refund_reference;
  SELECT count(*)::integer INTO v_linked_count
  FROM public.transactions r
  WHERE r.user_id = v_order.user_id
    AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
    AND (r.reference = v_refund_reference
      OR r.metadata->>'source_order_id' = v_order.id::text
      OR r.metadata->>'order_id' = v_order.id::text
      OR public.wallet_refund_links_debit(r.metadata, v_debit.id,
        v_debit.idempotency_key, v_debit.metadata, v_debit.reference));
  IF v_linked_count > 1 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_LEDGER_REVIEW_REQUIRED');
  END IF;
  IF v_linked_count = 1 THEN
    SELECT * INTO v_refund FROM public.transactions r
    WHERE r.user_id = v_order.user_id
      AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
      AND (r.reference = v_refund_reference
        OR r.metadata->>'source_order_id' = v_order.id::text
        OR r.metadata->>'order_id' = v_order.id::text
        OR public.wallet_refund_links_debit(r.metadata, v_debit.id,
          v_debit.idempotency_key, v_debit.metadata, v_debit.reference))
    FOR UPDATE;
    IF v_refund.status IS DISTINCT FROM 'completed'
      OR v_refund.amount IS DISTINCT FROM v_order.price_ngn
      OR upper(COALESCE(v_refund.currency, '')) <> 'NGN'
      OR COALESCE(v_refund.balance_type, 'wallet') <> 'wallet'
      OR v_refund.reference IS DISTINCT FROM v_refund_reference
      -- Historical staff refunds supplied order/reference proof before the
      -- original debit had order metadata. Explicit conflicting identifiers
      -- still defeat the reference fallback.
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'source_debit_transaction_id', '')), '') IS NOT NULL
        AND lower(v_refund.metadata->>'source_debit_transaction_id') <> v_debit.id::text)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'source_debit_idempotency_key', '')), '') IS NOT NULL
        AND v_refund.metadata->>'source_debit_idempotency_key' IS DISTINCT FROM v_debit.idempotency_key)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'original_purchase_idempotency_key', '')), '') IS NOT NULL
        AND v_refund.metadata->>'original_purchase_idempotency_key' IS DISTINCT FROM v_debit.idempotency_key)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'source_order_id', '')), '') IS NOT NULL
        AND v_refund.metadata->>'source_order_id' <> v_order.id::text)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'order_id', '')), '') IS NOT NULL
        AND v_refund.metadata->>'order_id' <> v_order.id::text)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'transaction_id', '')), '') IS NOT NULL
        AND v_refund.metadata->>'transaction_id' <> v_order.id::text)
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'source_order_table', '')), '') IS NOT NULL
        AND v_refund.metadata->>'source_order_table' <> 'sms_orders')
      OR (NULLIF(btrim(COALESCE(v_refund.metadata->>'original_reference', '')), '') IS NOT NULL
        AND v_refund.metadata->>'original_reference' <> v_order.reference) THEN
      RETURN jsonb_build_object('success', false, 'code', 'REFUND_LEDGER_REVIEW_REQUIRED');
    END IF;
  END IF;
  -- A canonical key claimed by an unrelated ledger row is never replayed.
  SELECT count(*)::integer INTO v_other_refund_count
  FROM public.transactions r
  WHERE r.idempotency_key = v_refund_key
    AND (v_linked_count = 0 OR r.id <> v_refund.id);
  IF v_other_refund_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_LEDGER_REVIEW_REQUIRED');
  END IF;
  IF (v_order.refunded_at IS NOT NULL OR v_order.refund_amount_ngn > 0
      OR NULLIF(v_order.refund_reference, '') IS NOT NULL) AND v_linked_count <> 1 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_LEDGER_REVIEW_REQUIRED');
  END IF;
  IF (v_order.refund_amount_ngn IS NOT NULL AND v_order.refund_amount_ngn <> 0
      AND v_order.refund_amount_ngn <> v_order.price_ngn)
    OR (NULLIF(v_order.refund_reference, '') IS NOT NULL
      AND v_order.refund_reference <> v_refund_reference) THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_LEDGER_REVIEW_REQUIRED');
  END IF;

  IF v_linked_count = 1 AND v_order.status = 'cancelled' THEN
    -- Repair the known cancelled/full-refund bookkeeping gap, then replay.
    UPDATE public.sms_orders SET
      refunded_at = COALESCE(v_order.refunded_at, v_refund.created_at, now()),
      refund_amount_ngn = v_order.price_ngn,
      refund_reference = v_refund_reference,
      cancelled_at = COALESCE(v_order.cancelled_at, v_refund.created_at, now())
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
      'status', 'cancelled', 'refunded', true, 'idempotent_replay', true,
      'refund_amount_ngn', v_order.price_ngn);
  END IF;
  IF v_order.status NOT IN ('pending', 'processing', 'active', 'waiting', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_REVIEW_REQUIRED');
  END IF;

  IF v_override THEN
    IF p_actor_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_user_id
        AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true)
      OR v_order.expires_at IS NULL OR v_order.expires_at >= now()
      OR v_order.created_at IS NULL OR v_order.created_at >= now() - interval '24 hours' THEN
      RETURN jsonb_build_object('success', false, 'code', 'OWNER_OVERRIDE_REVIEW_REQUIRED');
    END IF;
    IF p_evidence->>'kind' = 'OWNER_UNDELIVERED_ALLOCATION' THEN
      IF v_order.status IS DISTINCT FROM 'processing'
        OR v_order.provider_payload->>'pending_provider_allocation' IS DISTINCT FROM 'true'
        OR NULLIF(btrim(COALESCE(v_order.provider_request_id, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(v_order.provider_order_id, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(v_order.phone_number, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(v_order.raw_phone_number, '')), '') IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'OWNER_OVERRIDE_REVIEW_REQUIRED');
      END IF;
      v_proof := jsonb_build_object('kind', 'OWNER_UNDELIVERED_ALLOCATION',
        'owner_user_id', p_actor_user_id, 'pending_provider_allocation', true,
        'supplier_outcome', 'unknown', 'reason', p_reason, 'recorded_at', now());
    ELSIF p_evidence->>'kind' = 'OWNER_UNDELIVERED_NO_ACTIVATION' THEN
      IF v_order.status NOT IN ('waiting', 'active', 'processing')
        OR NULLIF(btrim(COALESCE(v_order.provider_request_id, '')), '') IS NULL
        OR NULLIF(btrim(COALESCE(v_order.phone_number, '')), '') IS NULL
        OR p_evidence->>'provider_response' IS DISTINCT FROM 'NO_ACTIVATION'
        OR p_evidence->>'activation_id' IS DISTINCT FROM v_order.provider_request_id
        OR p_evidence->>'probe_source' IS DISTINCT FROM 'daisysms_status'
        OR COALESCE(p_evidence->>'probed_at', '') !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'OWNER_OVERRIDE_REVIEW_REQUIRED');
      END IF;
      IF (p_evidence->>'probed_at')::timestamptz < now() - interval '60 minutes'
        OR (p_evidence->>'probed_at')::timestamptz > now() + interval '1 minute' THEN
        RETURN jsonb_build_object('success', false, 'code', 'OWNER_OVERRIDE_REVIEW_REQUIRED');
      END IF;
      v_proof := jsonb_build_object('kind', 'OWNER_UNDELIVERED_NO_ACTIVATION',
        'owner_user_id', p_actor_user_id, 'activation_id', v_order.provider_request_id,
        'provider_response', 'NO_ACTIVATION', 'probe_source', 'daisysms_status',
        'probed_at', p_evidence->>'probed_at',
        'supplier_outcome', 'unknown', 'reason', p_reason, 'recorded_at', now());
    ELSE
      RETURN jsonb_build_object('success', false, 'code', 'OWNER_OVERRIDE_REVIEW_REQUIRED');
    END IF;
  ELSIF p_evidence->>'phase' = 'allocation' THEN
    v_response := p_evidence->>'response';
    IF v_response IS NULL OR v_response NOT IN (
      'NO_NUMBERS', 'MAX_PRICE_EXCEEDED', 'NO_MONEY', 'TOO_MANY_ACTIVE_RENTALS',
      'BAD_KEY', 'BAD_SERVICE', 'NOT_REQUESTED'
    ) OR p_evidence->>'activation_id' IS DISTINCT FROM ''
      OR v_order.status IS DISTINCT FROM 'processing'
      OR v_order.provider_payload->>'pending_provider_allocation' IS DISTINCT FROM 'true'
      OR NULLIF(btrim(COALESCE(v_order.provider_request_id, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(v_order.provider_order_id, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(v_order.phone_number, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(v_order.raw_phone_number, '')), '') IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'PROVIDER_CANCELLATION_REQUIRED');
    END IF;
    v_proof := jsonb_build_object('kind', 'DAISY_ALLOCATION_DECLINED',
      'provider_response', v_response, 'activation_id', '',
      'reason', p_reason, 'recorded_at', now());
  ELSE
    v_response := p_evidence->>'provider_response';
    IF v_response IS NULL OR v_response NOT IN ('ACCESS_CANCEL', 'STATUS_CANCEL')
      OR NULLIF(btrim(COALESCE(v_order.provider_request_id, '')), '') IS NULL
      OR p_evidence->>'activation_id' IS DISTINCT FROM v_order.provider_request_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'PROVIDER_CANCELLATION_REQUIRED');
    END IF;
    v_proof := jsonb_build_object('kind', 'DAISY_CONFIRMED_CANCEL',
      'provider_response', v_response, 'activation_id', v_order.provider_request_id,
      'reason', p_reason, 'recorded_at', now());
  END IF;

  IF v_linked_count = 0 THEN
    v_result := public.apply_wallet_transaction(
      p_user_id := v_order.user_id, p_type := 'refund', p_amount := v_order.price_ngn,
      p_reference := v_refund_reference, p_description := 'SMS order cancellation refund',
      p_idempotency_key := v_refund_key,
      p_metadata := jsonb_build_object('source', 'smsbus',
        'source_order_id', v_order.id, 'source_order_table', 'sms_orders',
        'order_id', v_order.id, 'original_reference', v_order.reference,
        'source_debit_transaction_id', v_debit.id,
        'cancellation_reason', p_reason),
      p_currency := 'NGN', p_balance_type := 'wallet',
      p_external_payment_id := NULL, p_created_by := NULL
    );
    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'sms_wallet_refund_rejected';
    END IF;
    -- Confirm the actual posted row; never trust a response object alone.
    SELECT * INTO v_refund FROM public.transactions r
    WHERE r.idempotency_key = v_refund_key FOR UPDATE;
    IF NOT FOUND OR v_refund.user_id IS DISTINCT FROM v_order.user_id
      OR v_refund.type IS DISTINCT FROM 'refund'
      OR v_refund.status IS DISTINCT FROM 'completed'
      OR v_refund.amount IS DISTINCT FROM v_order.price_ngn
      OR v_refund.reference IS DISTINCT FROM v_refund_reference
      OR upper(COALESCE(v_refund.currency, '')) <> 'NGN'
      OR COALESCE(v_refund.balance_type, 'wallet') <> 'wallet'
      OR NOT public.wallet_refund_links_debit(v_refund.metadata, v_debit.id,
        v_debit.idempotency_key, v_debit.metadata, v_debit.reference) THEN
      RAISE EXCEPTION 'sms_wallet_refund_unverified';
    END IF;
  END IF;
  UPDATE public.sms_orders SET status = 'cancelled',
    cancelled_at = COALESCE(v_order.cancelled_at, now()),
    refunded_at = COALESCE(v_order.refunded_at, v_refund.created_at, now()),
    refund_amount_ngn = v_order.price_ngn,
    refund_reference = v_refund_reference,
    last_provider_response = (CASE WHEN jsonb_typeof(v_order.last_provider_response) = 'object'
      THEN v_order.last_provider_response ELSE '{}'::jsonb END)
      || jsonb_build_object('cancellation_evidence', v_proof)
  WHERE id = p_order_id;
  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'status', 'cancelled', 'refunded', true,
    'idempotent_replay', v_linked_count = 1,
    'refund_amount_ngn', v_order.price_ngn);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)
  TO service_role;
