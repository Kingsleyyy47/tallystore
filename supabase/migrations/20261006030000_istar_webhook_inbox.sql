-- Separate, opt-in post-migration iStar inbox. Installing this migration does
-- not activate the callback route or schedule a worker.
DO $preflight$
BEGIN
  IF to_regclass('public.telegram_orders') IS NULL
    OR to_regclass('public.transactions') IS NULL
    OR to_regprocedure('public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)') IS NULL
  THEN RAISE EXCEPTION 'istar_webhook_dependencies_missing'; END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.istar_webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('order.completed','order.failed')),
  provider_order_id text NOT NULL CHECK (length(provider_order_id) BETWEEN 1 AND 160),
  raw_body text NOT NULL CHECK (octet_length(raw_body) BETWEEN 2 AND 65536),
  signature text NOT NULL CHECK (signature ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','processed','manual_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  delivery_count integer NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX idx_istar_webhook_inbox_claim
  ON private.istar_webhook_inbox (next_attempt_at, created_at)
  WHERE state IN ('pending','leased');
ALTER TABLE private.istar_webhook_inbox ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX idx_telegram_orders_istar_order_id_unique
  ON public.telegram_orders (istar_order_id)
  WHERE istar_order_id IS NOT NULL;
REVOKE ALL ON private.istar_webhook_inbox FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.protect_istar_webhook_inbox() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='TRUNCATE' OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'istar_inbox_history_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.event_hash IS DISTINCT FROM OLD.event_hash
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id
    OR NEW.raw_body IS DISTINCT FROM OLD.raw_body
    OR NEW.signature IS DISTINCT FROM OLD.signature
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'istar_inbox_history_immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER istar_inbox_immutable BEFORE UPDATE OR DELETE ON private.istar_webhook_inbox
FOR EACH ROW EXECUTE FUNCTION private.protect_istar_webhook_inbox();
ALTER TABLE private.istar_webhook_inbox ENABLE ALWAYS TRIGGER istar_inbox_immutable;
CREATE TRIGGER istar_inbox_no_truncate BEFORE TRUNCATE ON private.istar_webhook_inbox
FOR EACH STATEMENT EXECUTE FUNCTION private.protect_istar_webhook_inbox();
ALTER TABLE private.istar_webhook_inbox ENABLE ALWAYS TRIGGER istar_inbox_no_truncate;

CREATE OR REPLACE FUNCTION public.enqueue_istar_webhook_event(
  p_event_hash text, p_event_type text, p_provider_order_id text,
  p_raw_body text, p_signature text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row private.istar_webhook_inbox%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF p_event_hash IS NULL OR p_signature IS NULL OR p_event_type IS NULL
    OR p_provider_order_id IS NULL OR p_raw_body IS NULL
    OR p_event_hash !~ '^[a-f0-9]{64}$'
    OR p_signature !~ '^[a-f0-9]{64}$'
    OR p_event_type NOT IN ('order.completed','order.failed')
    OR p_provider_order_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
    OR octet_length(p_raw_body) NOT BETWEEN 2 AND 65536
    OR p_event_hash IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_raw_body,'UTF8')),'hex')
  THEN RAISE EXCEPTION 'istar_event_invalid'; END IF;
  BEGIN
    v_payload := p_raw_body::jsonb;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'istar_event_invalid';
  END;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
    OR v_payload->>'event_type' IS DISTINCT FROM p_event_type
    OR jsonb_typeof(v_payload->'order') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_payload->'order'->'id') NOT IN ('string','number')
    OR v_payload->'order'->>'id' IS DISTINCT FROM p_provider_order_id
  THEN RAISE EXCEPTION 'istar_event_invalid'; END IF;
  INSERT INTO private.istar_webhook_inbox
    (event_hash,event_type,provider_order_id,raw_body,signature)
  VALUES (p_event_hash,p_event_type,p_provider_order_id,p_raw_body,p_signature)
  ON CONFLICT (event_hash) DO UPDATE SET
    delivery_count=private.istar_webhook_inbox.delivery_count+1,
    last_received_at=now()
  RETURNING * INTO v_row;
  IF v_row.event_type IS DISTINCT FROM p_event_type
    OR v_row.provider_order_id IS DISTINCT FROM p_provider_order_id
    OR v_row.raw_body IS DISTINCT FROM p_raw_body
  THEN RAISE EXCEPTION 'istar_event_hash_conflict'; END IF;
  RETURN jsonb_build_object('success',true,'event_id',v_row.id,'state',v_row.state);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_istar_webhook_events(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'istar_claim_limit_invalid';
  END IF;
  UPDATE private.istar_webhook_inbox SET state='manual_review',lease_token=NULL,
    lease_until=NULL,last_error='lease_retry_limit_reached'
  WHERE state='leased' AND lease_until<now() AND attempts>=12;
  WITH candidate AS (
    SELECT i.id FROM private.istar_webhook_inbox i
    WHERE i.attempts<12 AND ((i.state='pending' AND i.next_attempt_at<=now())
      OR (i.state='leased' AND i.lease_until<now()))
    ORDER BY i.next_attempt_at,i.created_at
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.istar_webhook_inbox i SET
    state='leased', lease_token=gen_random_uuid(), lease_until=now()+interval '60 seconds',
    attempts=i.attempts+1
    FROM candidate c WHERE i.id=c.id
    RETURNING i.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',claimed.id,'provider_order_id',claimed.provider_order_id,
    'lease_token',claimed.lease_token)),'[]'::jsonb)
    INTO v_rows FROM claimed;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_istar_webhook_event(
  p_event_id uuid, p_lease_token uuid, p_error text, p_manual_review boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row private.istar_webhook_inbox%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM private.istar_webhook_inbox
    WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_row.state<>'leased' OR v_row.lease_token IS DISTINCT FROM p_lease_token
    OR v_row.lease_until<=now()
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_LEASE_STALE'); END IF;
  UPDATE private.istar_webhook_inbox SET
    state=CASE WHEN p_manual_review OR attempts>=12 THEN 'manual_review' ELSE 'pending' END,
    next_attempt_at=now()+make_interval(secs=>LEAST(3600,15*power(2,LEAST(attempts,8))::integer)),
    lease_token=NULL,lease_until=NULL,last_error=left(COALESCE(p_error,'review_required'),200)
  WHERE id=p_event_id;
  RETURN jsonb_build_object('success',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_istar_webhook_event(
  p_event_id uuid, p_lease_token uuid, p_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event private.istar_webhook_inbox%ROWTYPE;
  v_order public.telegram_orders%ROWTYPE;
  v_debit public.transactions%ROWTYPE;
  v_debit_key text;
  v_signed jsonb;
  v_signed_order jsonb;
  v_signed_payload jsonb;
  v_type text;
  v_cost numeric;
  v_refund jsonb;
  v_supplier_ids text[];
  v_signed_usernames text[];
  v_signed_recipients text[];
  v_signed_wallet_types text[];
  v_signed_quantities text[];
  v_signed_months text[];
  v_signed_amounts text[];
  v_signed_refunded text[];
  v_signed_refund_amounts text[];
  v_signed_refund_ids text[];
  v_get_refund_ids text[];
  v_get_amounts text[];
  v_get_refunded text[];
  v_get_refund_amounts text[];
  v_usernames text[];
  v_recipients text[];
  v_wallet_types text[];
  v_quantity_text text;
  v_months_text text;
  v_expected_status text;
BEGIN
  SELECT * INTO v_event FROM private.istar_webhook_inbox
    WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.state<>'leased'
    OR v_event.lease_token IS DISTINCT FROM p_lease_token
    OR v_event.lease_until<=now()
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_LEASE_STALE'); END IF;
  SELECT * INTO v_order FROM public.telegram_orders
    WHERE istar_order_id=v_event.provider_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ISTAR_ORDER_NOT_FOUND'); END IF;
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_INVALID');
  END IF;
  v_signed := v_event.raw_body::jsonb;
  v_signed_order := v_signed->'order';
  v_signed_payload := v_signed_order->'payload';
  v_type := CASE WHEN v_order.order_type='stars' THEN 'star' ELSE v_order.order_type END;
  v_expected_status := CASE WHEN v_event.event_type='order.completed' THEN 'completed' ELSE 'failed' END;
  IF jsonb_typeof(v_signed_order) IS DISTINCT FROM 'object'
    OR v_signed->>'event_type' IS DISTINCT FROM v_event.event_type
    OR v_signed_order->>'id' IS DISTINCT FROM v_event.provider_order_id
    OR (v_signed_order ? 'order_id' AND v_signed_order->>'order_id' IS DISTINCT FROM v_event.provider_order_id)
    OR (v_signed_payload ? 'order_id' AND v_signed_payload->>'order_id' IS DISTINCT FROM v_event.provider_order_id)
    OR (v_signed ? 'order_id' AND v_signed->>'order_id' IS DISTINCT FROM v_event.provider_order_id)
    OR (v_signed ? 'id' AND v_signed->>'id' IS DISTINCT FROM v_event.provider_order_id)
    OR v_signed_order->>'status' IS DISTINCT FROM v_expected_status
    OR (v_signed ? 'status' AND v_signed->>'status' IS DISTINCT FROM v_expected_status)
    OR (v_signed_payload ? 'status' AND v_signed_payload->>'status' IS DISTINCT FROM v_expected_status)
    OR v_signed_order->>'order_type' IS DISTINCT FROM v_type
    OR (v_signed ? 'order_type' AND v_signed->>'order_type' IS DISTINCT FROM v_type)
    OR (v_signed_payload ? 'order_type' AND v_signed_payload->>'order_type' IS DISTINCT FROM v_type)
    OR jsonb_typeof(v_signed_payload) IS DISTINCT FROM 'object'
    OR v_order.recipient_hash IS NULL OR v_order.recipient_hash=''
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  v_signed_usernames := ARRAY_REMOVE(ARRAY[v_signed->>'username',v_signed_order->>'username',
    v_signed_payload->>'username'],NULL);
  v_signed_recipients := ARRAY_REMOVE(ARRAY[v_signed->>'recipient',v_signed->>'recipient_hash',
    v_signed_order->>'recipient',v_signed_order->>'recipient_hash',
    v_signed_payload->>'recipient',v_signed_payload->>'recipient_hash'],NULL);
  v_signed_wallet_types := ARRAY_REMOVE(ARRAY[v_signed->>'wallet_type',v_signed_order->>'wallet_type',
    v_signed_payload->>'wallet_type'],NULL);
  v_signed_quantities := ARRAY_REMOVE(ARRAY[v_signed->>'quantity',v_signed_order->>'quantity',
    v_signed_payload->>'quantity'],NULL);
  v_signed_months := ARRAY_REMOVE(ARRAY[v_signed->>'months',v_signed_order->>'months',
    v_signed_payload->>'months'],NULL);
  v_signed_amounts := ARRAY_REMOVE(ARRAY[v_signed->>'amount',v_signed_order->>'amount',
    v_signed_payload->>'amount'],NULL);
  IF cardinality(v_signed_usernames)=0 OR cardinality(v_signed_recipients)=0
    OR cardinality(v_signed_amounts)=0
    OR EXISTS (SELECT 1 FROM unnest(v_signed_usernames) AS supplied
      WHERE supplied IS DISTINCT FROM v_order.username)
    OR EXISTS (SELECT 1 FROM unnest(v_signed_recipients) AS supplied
      WHERE supplied IS DISTINCT FROM v_order.recipient_hash)
    OR EXISTS (SELECT 1 FROM unnest(v_signed_wallet_types) AS supplied
      WHERE supplied IS DISTINCT FROM v_order.wallet_type)
    OR EXISTS (SELECT 1 FROM unnest(v_signed_amounts) AS supplied
      WHERE supplied !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$')
    OR COALESCE(v_order.istar_amount,0)<=0
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_signed_amounts) AS supplied
      WHERE supplied::numeric IS DISTINCT FROM v_order.istar_amount)
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  IF v_type='star' THEN
    IF cardinality(v_signed_quantities)=0
      OR EXISTS (SELECT 1 FROM unnest(v_signed_quantities) AS supplied
        WHERE supplied !~ '^[0-9]{1,16}$')
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_signed_quantities) AS supplied
      WHERE supplied::numeric IS DISTINCT FROM v_order.quantity)
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  ELSIF v_type='premium' THEN
    IF cardinality(v_signed_months)=0
      OR EXISTS (SELECT 1 FROM unnest(v_signed_months) AS supplied
        WHERE supplied !~ '^[0-9]{1,16}$')
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_signed_months) AS supplied
      WHERE supplied::numeric IS DISTINCT FROM v_order.months)
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  ELSE RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_IDENTITY_UNPROVEN'); END IF;
  IF p_receipt->>'status' IN ('pending','processing') THEN
    RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_NOT_FINAL');
  END IF;
  v_supplier_ids := ARRAY_REMOVE(ARRAY[p_receipt->>'id',p_receipt->>'order_id',
    p_receipt->'payload'->>'order_id'],NULL);
  v_get_amounts := ARRAY_REMOVE(ARRAY[p_receipt->>'amount',p_receipt->'payload'->>'amount'],NULL);
  v_usernames := ARRAY_REMOVE(ARRAY[p_receipt->>'username',p_receipt->'payload'->>'username'],NULL);
  v_recipients := ARRAY_REMOVE(ARRAY[p_receipt->>'recipient_hash',p_receipt->>'recipient',
    p_receipt->'payload'->>'recipient_hash',p_receipt->'payload'->>'recipient'],NULL);
  v_wallet_types := ARRAY_REMOVE(ARRAY[p_receipt->>'wallet_type',p_receipt->'payload'->>'wallet_type'],NULL);
  v_quantity_text := COALESCE(p_receipt->'payload'->>'quantity',p_receipt->>'quantity');
  v_months_text := COALESCE(p_receipt->'payload'->>'months',p_receipt->>'months');
  IF cardinality(v_supplier_ids)=0
    OR (p_receipt ? 'payload' AND jsonb_typeof(p_receipt->'payload') IS DISTINCT FROM 'object')
    OR EXISTS (SELECT 1 FROM unnest(v_supplier_ids) AS supplier_id WHERE supplier_id<>v_event.provider_order_id)
    OR (p_receipt->'payload' ? 'order_id' AND p_receipt->'payload'->>'order_id' IS DISTINCT FROM v_event.provider_order_id)
    OR p_receipt->>'status' IS DISTINCT FROM v_expected_status
    OR (p_receipt->'payload' ? 'status' AND p_receipt->'payload'->>'status' IS DISTINCT FROM v_expected_status)
    OR (p_receipt->>'order_type' IS NOT NULL AND p_receipt->>'order_type' IS DISTINCT FROM v_type
      AND p_receipt->>'order_type' IS DISTINCT FROM v_order.order_type)
    OR (p_receipt->'payload' ? 'order_type' AND p_receipt->'payload'->>'order_type' IS DISTINCT FROM v_type
      AND p_receipt->'payload'->>'order_type' IS DISTINCT FROM v_order.order_type)
    OR cardinality(v_usernames)=0
    OR EXISTS (SELECT 1 FROM unnest(v_usernames) AS supplied WHERE supplied IS DISTINCT FROM v_order.username)
    OR v_order.recipient_hash IS NULL OR v_order.recipient_hash=''
    OR EXISTS (SELECT 1 FROM unnest(v_recipients) AS supplied WHERE supplied IS DISTINCT FROM v_order.recipient_hash)
    OR cardinality(v_wallet_types)=0
    OR EXISTS (SELECT 1 FROM unnest(v_wallet_types) AS supplied WHERE supplied IS DISTINCT FROM v_order.wallet_type)
    OR v_order.wallet_type NOT IN ('USDT','TON')
    OR COALESCE(p_receipt->>'amount','') !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$'
    OR (p_receipt->'payload' ? 'amount' AND (p_receipt->'payload'->>'amount' IS NULL
      OR p_receipt->'payload'->>'amount' !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$'))
    OR COALESCE(v_order.istar_amount,0)<=0
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_get_amounts) AS supplied
    WHERE supplied::numeric IS DISTINCT FROM v_order.istar_amount) THEN
    RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH');
  END IF;
  IF v_type='star' THEN
    IF COALESCE(v_quantity_text,'') !~ '^[0-9]{1,16}$'
      OR (p_receipt ? 'quantity' AND p_receipt->'payload' ? 'quantity'
        AND p_receipt->>'quantity' IS DISTINCT FROM p_receipt->'payload'->>'quantity')
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
    IF v_quantity_text::numeric IS DISTINCT FROM v_order.quantity
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
  ELSIF v_type='premium' THEN
    IF COALESCE(v_months_text,'') !~ '^[0-9]{1,16}$'
      OR (p_receipt ? 'months' AND p_receipt->'payload' ? 'months'
        AND p_receipt->>'months' IS DISTINCT FROM p_receipt->'payload'->>'months')
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
    IF v_months_text::numeric IS DISTINCT FROM v_order.months
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
  ELSE RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_MISMATCH'); END IF;
  IF v_event.event_type='order.failed' THEN
    v_signed_refunded := ARRAY_REMOVE(ARRAY[v_signed->>'refunded',v_signed_order->>'refunded',
      v_signed_payload->>'refunded'],NULL);
    v_signed_refund_amounts := ARRAY_REMOVE(ARRAY[v_signed->>'refund_amount',
      v_signed_order->>'refund_amount',v_signed_payload->>'refund_amount'],NULL);
    v_signed_refund_ids := ARRAY_REMOVE(ARRAY[v_signed->>'refund_transaction_id',
      v_signed_order->>'refund_transaction_id',v_signed_payload->>'refund_transaction_id'],NULL);
    v_get_refund_ids := ARRAY_REMOVE(ARRAY[p_receipt->>'refund_transaction_id',
      p_receipt->'payload'->>'refund_transaction_id'],NULL);
    v_get_refunded := ARRAY_REMOVE(ARRAY[p_receipt->>'refunded',p_receipt->'payload'->>'refunded'],NULL);
    v_get_refund_amounts := ARRAY_REMOVE(ARRAY[p_receipt->>'refund_amount',
      p_receipt->'payload'->>'refund_amount'],NULL);
    IF cardinality(v_signed_refunded)=0 OR cardinality(v_signed_refund_amounts)=0
      OR cardinality(v_signed_refund_ids)=0
      OR EXISTS (SELECT 1 FROM unnest(v_signed_refunded) AS supplied WHERE supplied IS DISTINCT FROM 'true')
      OR EXISTS (SELECT 1 FROM unnest(v_signed_refund_amounts) AS supplied
        WHERE supplied !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$')
      OR EXISTS (SELECT 1 FROM unnest(v_signed_refund_ids) AS supplied
        WHERE supplied !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
          OR supplied IS DISTINCT FROM v_signed_refund_ids[1])
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_REFUND_UNPROVEN'); END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_signed_refund_amounts) AS supplied
      WHERE supplied::numeric IS DISTINCT FROM v_order.istar_amount)
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_SIGNED_REFUND_UNPROVEN'); END IF;
    IF p_receipt->>'refunded' IS DISTINCT FROM 'true'
      OR (p_receipt->'payload' ? 'refunded' AND p_receipt->'payload'->>'refunded' IS DISTINCT FROM 'true')
      OR COALESCE(p_receipt->>'refund_amount','') !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$'
      OR (p_receipt->'payload' ? 'refund_amount' AND (p_receipt->'payload'->>'refund_amount' IS NULL
        OR p_receipt->'payload'->>'refund_amount' !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$'))
      OR EXISTS (SELECT 1 FROM unnest(v_get_refunded) AS supplied WHERE supplied IS DISTINCT FROM 'true')
      OR EXISTS (SELECT 1 FROM unnest(v_get_refund_ids) AS supplied
        WHERE supplied IS DISTINCT FROM v_signed_refund_ids[1])
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_REFUND_UNPROVEN'); END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_get_refund_amounts) AS supplied
      WHERE supplied::numeric IS DISTINCT FROM v_order.istar_amount) THEN
      RETURN jsonb_build_object('success',false,'code','ISTAR_REFUND_UNPROVEN');
    END IF;
  END IF;

  v_cost := v_order.price_ngn;
  v_debit_key := 'telegram:purchase:'||COALESCE(NULLIF(v_order.idempotency_key,''),v_order.reference);
  SELECT * INTO v_debit FROM public.transactions
    WHERE user_id=v_order.user_id AND idempotency_key=v_debit_key FOR UPDATE;
  IF NOT FOUND OR v_cost IS NULL OR v_cost<=0 OR v_debit.type IS DISTINCT FROM 'purchase'
    OR v_debit.status IS DISTINCT FROM 'completed' OR v_debit.amount IS DISTINCT FROM -v_cost
    OR v_debit.currency IS DISTINCT FROM 'NGN' OR v_debit.balance_type IS DISTINCT FROM 'wallet'
    OR v_debit.reference IS DISTINCT FROM v_order.reference
    OR v_debit.balance_before IS NULL OR v_debit.balance_after IS NULL
    OR v_debit.balance_before-v_debit.balance_after IS DISTINCT FROM v_cost
    OR v_debit.metadata->>'source' IS DISTINCT FROM 'telegram-stars'
    OR v_debit.metadata->>'source_order_id' IS DISTINCT FROM v_order.id::text
    OR v_debit.metadata->>'source_order_table' IS DISTINCT FROM 'telegram_orders'
    OR v_debit.metadata->>'source_debit_idempotency_key' IS DISTINCT FROM v_debit_key
    OR v_debit.metadata->>'trusted_principal_authorized' IS DISTINCT FROM 'true'
    OR COALESCE(v_debit.metadata->>'trusted_principal_debit_amount','') !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$'
  THEN RETURN jsonb_build_object('success',false,'code','ISTAR_DEBIT_UNPROVEN'); END IF;
  IF (v_debit.metadata->>'trusted_principal_debit_amount')::numeric<>v_cost THEN
    RETURN jsonb_build_object('success',false,'code','ISTAR_DEBIT_UNPROVEN');
  END IF;

  IF v_event.event_type='order.completed' THEN
    IF v_order.status='completed' AND v_order.refunded_at IS NULL THEN
      NULL;
    ELSIF v_order.status IN ('pending','processing') AND v_order.refunded_at IS NULL THEN
      UPDATE public.telegram_orders SET status='completed',completed_at=now(),updated_at=now()
      WHERE id=v_order.id;
    ELSE RETURN jsonb_build_object('success',false,'code','ISTAR_TERMINAL_CONFLICT'); END IF;
  ELSE
    IF v_order.status IS NULL OR v_order.status='completed' OR v_order.refunded_at IS NOT NULL
      OR (v_order.status='failed' AND v_order.error_message IS DISTINCT FROM 'Supplier confirmed order failure')
      OR v_order.status NOT IN ('pending','processing','failed')
    THEN RETURN jsonb_build_object('success',false,'code','ISTAR_TERMINAL_CONFLICT'); END IF;
    SELECT public.apply_wallet_transaction(
      p_user_id=>v_order.user_id,p_type=>'refund',p_amount=>v_cost,
      p_reference=>'REFUND-'||v_order.reference,
      p_description=>'Refund: Telegram '||v_order.order_type||' order failed',
      p_idempotency_key=>'telegram:refund:'||v_order.id::text,
      p_metadata=>jsonb_build_object(
        'source','webhook-istar','source_order_id',v_order.id,
        'source_order_table','telegram_orders','order_id',v_order.id,
        'original_reference',v_order.reference,
        'source_debit_transaction_id',v_debit.id,
        'source_debit_idempotency_key',v_debit_key,
        'original_purchase_idempotency_key',v_debit_key,
        'provider_refund_transaction_id',v_signed_refund_ids[1]
      ),p_currency=>'NGN',p_balance_type=>'wallet',
      p_external_payment_id=>NULL,p_created_by=>NULL
    ) INTO v_refund;
    IF COALESCE((v_refund->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'istar_wallet_refund_failed';
    END IF;
    UPDATE public.telegram_orders SET
      status='failed',error_message='Supplier confirmed order failure',
      refunded_at=now(),refund_amount_ngn=v_cost,
      refund_reference='REFUND-'||v_order.reference,updated_at=now()
    WHERE id=v_order.id;
  END IF;
  UPDATE private.istar_webhook_inbox SET state='processed',processed_at=now(),
    lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=v_event.id;
  RETURN jsonb_build_object('success',true,'state','processed','order_id',v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_istar_webhook_event(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_istar_webhook_events(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.defer_istar_webhook_event(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_istar_webhook_event(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_istar_webhook_event(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_istar_webhook_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_istar_webhook_event(uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_istar_webhook_event(uuid,uuid,jsonb) TO service_role;
