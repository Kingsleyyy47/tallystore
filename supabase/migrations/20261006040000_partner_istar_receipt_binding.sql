-- Post-baseline, service-only observation of a single claimed iStar create.
-- No provider request, capture, release, refund or wallet mutation occurs here.
CREATE TABLE private.api_partner_istar_receipt_bindings (
  order_id uuid PRIMARY KEY REFERENCES public.api_partner_external_orders(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  funding_type text NOT NULL CHECK(funding_type IN('prepaid','unlimited_credit')),
  amount_ngn numeric(18,2) NOT NULL CHECK(amount_ngn>0),
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  request_payload jsonb NOT NULL CHECK(jsonb_typeof(request_payload)='object'),
  provider_order_id text NOT NULL UNIQUE CHECK(provider_order_id ~ '^[1-9][0-9]{0,19}$'
    OR provider_order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  provider_amount numeric NOT NULL CHECK(provider_amount>0),
  wallet_type text NOT NULL CHECK(wallet_type IN('USDT','TON')),
  provider_receipt jsonb NOT NULL CHECK(jsonb_typeof(provider_receipt)='object'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.api_partner_istar_receipt_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_partner_istar_receipt_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER api_partner_istar_binding_immutable BEFORE UPDATE OR DELETE
  ON private.api_partner_istar_receipt_bindings FOR EACH ROW
  EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER api_partner_istar_binding_no_truncate BEFORE TRUNCATE
  ON private.api_partner_istar_receipt_bindings FOR EACH STATEMENT
  EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
ALTER TABLE private.api_partner_istar_receipt_bindings ENABLE ALWAYS TRIGGER api_partner_istar_binding_immutable;
ALTER TABLE private.api_partner_istar_receipt_bindings ENABLE ALWAYS TRIGGER api_partner_istar_binding_no_truncate;

-- Reject unknown fields, floats/exponents and subtype substitutions. Currency
-- amounts remain decimal strings; normalization never passes through float8.
CREATE FUNCTION private.normalize_api_partner_istar_receipt(
  p_receipt jsonb,p_request jsonb,p_quantity integer,p_completed boolean
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_type text; v_status text; v_amount numeric; v_decimal text; v_id text; v_result jsonb;
BEGIN
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR octet_length(p_receipt::text)>4096 OR octet_length(p_request::text)>16384
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_receipt) k
      WHERE k NOT IN('order_id','status','order_type','username','quantity','months','amount','wallet_type','recipient_hash'))
    OR jsonb_typeof(p_receipt->'order_id') IS DISTINCT FROM 'string'
    OR NOT ((p_receipt->>'order_id') ~ '^[0-9]{1,20}$'
      OR (p_receipt->>'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR jsonb_typeof(p_receipt->'status') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receipt->'order_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receipt->'username') IS DISTINCT FROM 'string'
    OR (p_receipt->>'username') !~ '^[A-Za-z0-9_]{1,64}$'
    OR jsonb_typeof(p_request->'username') IS DISTINCT FROM 'string'
    OR p_receipt->'username' IS DISTINCT FROM p_request->'username'
    OR jsonb_typeof(p_request->'recipient_hash') IS DISTINCT FROM 'string'
    OR length(p_request->>'recipient_hash') NOT BETWEEN 1 AND 500
    OR (p_request->>'recipient_hash') ~ '[\x00-\x20\x7f]'
    OR jsonb_typeof(p_receipt->'wallet_type') IS DISTINCT FROM 'string'
    OR p_receipt->>'wallet_type' NOT IN('USDT','TON')
    OR p_receipt->'wallet_type' IS DISTINCT FROM p_request->'wallet_type'
    OR jsonb_typeof(p_receipt->'amount') IS DISTINCT FROM 'string'
    OR (p_receipt->>'amount') !~ '^[0-9]{1,32}(\.[0-9]{1,18})?$'
    OR jsonb_typeof(p_request->'quantity') IS DISTINCT FROM 'number'
    OR p_request->'quantity' IS DISTINCT FROM to_jsonb(p_quantity)
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000000
    OR jsonb_typeof(p_request->'telegram_type') IS DISTINCT FROM 'string'
    OR p_request->>'telegram_type' NOT IN('stars','premium') THEN RETURN NULL; END IF;
  IF p_receipt ? 'recipient_hash' AND (jsonb_typeof(p_receipt->'recipient_hash') IS DISTINCT FROM 'string'
    OR p_receipt->'recipient_hash' IS DISTINCT FROM p_request->'recipient_hash') THEN RETURN NULL; END IF;
  v_type:=CASE p_request->>'telegram_type' WHEN 'stars' THEN 'star' ELSE 'premium' END;
  IF p_receipt->>'order_type' IS DISTINCT FROM v_type THEN RETURN NULL; END IF;
  v_status:=p_receipt->>'status';
  IF (p_completed IS TRUE AND v_status IS DISTINCT FROM 'completed')
    OR (p_completed IS DISTINCT FROM true AND v_status NOT IN('pending','processing','completed')) THEN RETURN NULL; END IF;
  IF v_type='star' THEN
    IF p_receipt ? 'months' OR p_request ? 'months'
      OR jsonb_typeof(p_receipt->'quantity') IS DISTINCT FROM 'number'
      OR p_receipt->'quantity' IS DISTINCT FROM to_jsonb(p_quantity)
      OR p_quantity<50 THEN RETURN NULL; END IF;
  ELSE
    IF p_receipt ? 'quantity' OR p_quantity<>1
      OR jsonb_typeof(p_request->'months') IS DISTINCT FROM 'number'
      OR p_request->'months' NOT IN('3'::jsonb,'6'::jsonb,'12'::jsonb)
      OR p_receipt->'months' IS DISTINCT FROM p_request->'months' THEN RETURN NULL; END IF;
  END IF;
  v_amount:=(p_receipt->>'amount')::numeric;
  IF v_amount<=0 THEN RETURN NULL; END IF;
  v_id:=lower(p_receipt->>'order_id');
  IF v_id ~ '^[0-9]{1,20}$' THEN
    IF v_id::numeric<=0 THEN RETURN NULL; END IF;
    v_id:=(v_id::numeric)::text;
  END IF;
  v_decimal:=v_amount::text;
  IF strpos(v_decimal,'.')>0 THEN v_decimal:=rtrim(rtrim(v_decimal,'0'),'.'); END IF;
  v_result:=p_receipt||jsonb_build_object('amount',v_decimal,'order_id',v_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_api_partner_istar_receipt(jsonb,jsonb,integer,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bind_api_partner_istar_receipt(
  p_order_id uuid,p_partner_id uuid,p_provider_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_discovery public.api_partner_external_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE; v_key public.api_partner_keys%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE; v_order public.api_partner_orders%ROWTYPE;
  v_bound private.api_partner_istar_receipt_bindings%ROWTYPE; v_receipt jsonb;
BEGIN
  IF p_order_id IS NULL OR p_partner_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT'); END IF;
  SELECT * INTO v_discovery FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_discovery.partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.id IS DISTINCT FROM p_partner_id THEN RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id
    OR v_journal.section IS DISTINCT FROM 'telegram_stars' THEN RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=v_journal.key_id;
  IF v_order.id IS NULL OR v_key.id IS NULL OR v_key.partner_id IS DISTINCT FROM v_partner.id
    OR v_order.partner_id IS DISTINCT FROM v_partner.id OR v_order.item_type IS DISTINCT FROM 'telegram_stars'
    OR v_order.currency IS DISTINCT FROM 'NGN' OR v_order.amount_ngn IS DISTINCT FROM v_journal.amount_ngn
    OR v_journal.request_fingerprint !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  v_receipt:=private.normalize_api_partner_istar_receipt(p_provider_receipt,v_order.request_payload,v_order.quantity,false);
  IF v_receipt IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT'); END IF;
  SELECT * INTO v_bound FROM private.api_partner_istar_receipt_bindings WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_bound.partner_id=v_partner.id AND v_bound.key_id=v_journal.key_id
      AND v_bound.request_fingerprint=v_journal.request_fingerprint AND v_bound.funding_type=v_journal.funding_type
      AND v_bound.amount_ngn=v_journal.amount_ngn AND v_bound.item_id=v_order.item_id AND v_bound.quantity=v_order.quantity
      AND v_bound.request_payload=v_order.request_payload AND v_bound.provider_receipt=v_receipt THEN
      RETURN jsonb_build_object('success',true,'order_id',p_order_id,'idempotent_replay',true);
    END IF;
    RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_CONFLICT');
  END IF;
  IF v_journal.state IS DISTINCT FROM 'sending' OR v_journal.claimed_at IS NULL
    OR v_order.status IS DISTINCT FROM 'processing'
    OR v_journal.amount_ngn<=0
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='reserve')<>1
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=p_order_id
      AND e.event_type='reserve' AND e.partner_id=v_partner.id AND e.amount_ngn=v_journal.amount_ngn
      AND e.funding_type=v_journal.funding_type AND e.balance_before=v_journal.balance_before AND e.balance_after=v_journal.balance_after)
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type IN('capture','release'))
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=p_order_id) THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_ELIGIBLE');
  END IF;
  -- This records a paid observation even if the key was revoked after POST.
  -- It grants no send permission; read/completion authorization is independent.
  IF EXISTS(SELECT 1 FROM private.api_partner_istar_receipt_bindings WHERE provider_order_id=v_receipt->>'order_id') THEN
    RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_CONFLICT'); END IF;
  INSERT INTO private.api_partner_istar_receipt_bindings(order_id,partner_id,key_id,request_fingerprint,
    funding_type,amount_ngn,item_id,quantity,request_payload,provider_order_id,provider_amount,wallet_type,provider_receipt)
  VALUES(p_order_id,v_partner.id,v_journal.key_id,v_journal.request_fingerprint,v_journal.funding_type,
    v_journal.amount_ngn,v_order.item_id,v_order.quantity,v_order.request_payload,v_receipt->>'order_id',
    (v_receipt->>'amount')::numeric,v_receipt->>'wallet_type',v_receipt)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'idempotent_replay',false);
END;
$$;

CREATE FUNCTION public.get_api_partner_istar_receipt(p_key_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key public.api_partner_keys%ROWTYPE; v_partner public.api_partners%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE; v_order public.api_partner_orders%ROWTYPE;
  v_bound private.api_partner_istar_receipt_bindings%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=p_key_id FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID_KEY'); END IF;
  IF ('orders:read'=ANY(v_key.scopes)) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','SCOPE_DENIED'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_key.partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.is_active IS DISTINCT FROM true OR v_partner.owner_reviewed_at IS NULL
    OR ('telegram_stars'=ANY(v_partner.allowed_sections)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','PARTNER_DISABLED'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id OR v_journal.key_id IS DISTINCT FROM p_key_id
    OR v_journal.section IS DISTINCT FROM 'telegram_stars' THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO v_bound FROM private.api_partner_istar_receipt_bindings WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ISTAR_RECEIPT_REVIEW_REQUIRED'); END IF;
  IF v_order.id IS NULL OR v_order.partner_id IS DISTINCT FROM v_partner.id OR v_order.item_type IS DISTINCT FROM 'telegram_stars'
    OR v_order.currency IS DISTINCT FROM 'NGN' OR v_bound.partner_id IS DISTINCT FROM v_partner.id
    OR v_bound.key_id IS DISTINCT FROM p_key_id OR v_bound.request_fingerprint IS DISTINCT FROM v_journal.request_fingerprint
    OR v_bound.funding_type IS DISTINCT FROM v_journal.funding_type OR v_bound.amount_ngn IS DISTINCT FROM v_journal.amount_ngn
    OR v_bound.amount_ngn IS DISTINCT FROM v_order.amount_ngn OR v_bound.item_id IS DISTINCT FROM v_order.item_id
    OR v_bound.quantity IS DISTINCT FROM v_order.quantity OR v_bound.request_payload IS DISTINCT FROM v_order.request_payload
    OR v_bound.provider_receipt IS DISTINCT FROM private.normalize_api_partner_istar_receipt(v_bound.provider_receipt,v_bound.request_payload,v_bound.quantity,false)
    OR v_bound.provider_order_id IS DISTINCT FROM v_bound.provider_receipt->>'order_id'
    OR v_bound.provider_amount IS DISTINCT FROM (v_bound.provider_receipt->>'amount')::numeric
    OR v_bound.wallet_type IS DISTINCT FROM v_bound.provider_receipt->>'wallet_type' THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'provider_receipt',v_bound.provider_receipt,'request_payload',v_bound.request_payload);
END;
$$;

CREATE FUNCTION public.complete_api_partner_istar_order(
  p_key_id uuid,p_order_id uuid,p_provider_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_read jsonb; v_receipt jsonb; v_bound private.api_partner_istar_receipt_bindings%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE; v_order public.api_partner_orders%ROWTYPE;
BEGIN
  -- The reader acquires key SHARE then partner, journal and order locks and
  -- rechecks current authorization. The locks persist through this function.
  v_read:=public.get_api_partner_istar_receipt(p_key_id,p_order_id);
  IF (v_read->>'success')::boolean IS DISTINCT FROM true THEN RETURN v_read; END IF;
  SELECT * INTO v_bound FROM private.api_partner_istar_receipt_bindings WHERE order_id=p_order_id;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id;
  v_receipt:=private.normalize_api_partner_istar_receipt(p_provider_receipt,v_bound.request_payload,v_bound.quantity,true);
  IF v_receipt IS NULL OR (v_receipt-'status'-'recipient_hash') IS DISTINCT FROM (v_bound.provider_receipt-'status'-'recipient_hash')
    OR (v_receipt->>'amount')::numeric IS DISTINCT FROM v_bound.provider_amount THEN
    RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
  IF v_journal.state IS DISTINCT FROM 'accepted' OR v_journal.fulfillment_source IS DISTINCT FROM 'istar'
    OR v_order.fulfillment_source IS DISTINCT FROM 'istar' OR v_journal.fulfillment_id IS DISTINCT FROM v_bound.provider_order_id
    OR v_order.fulfillment_id IS DISTINCT FROM v_bound.provider_order_id
    OR v_journal.outcome_status NOT IN('processing','completed') OR v_order.status NOT IN('processing','completed')
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='capture')<>1
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=p_order_id AND e.event_type='capture'
      AND e.partner_id=v_bound.partner_id AND e.amount_ngn=v_bound.amount_ngn AND e.funding_type=v_bound.funding_type
      AND e.balance_before=v_journal.balance_before AND e.balance_after=v_journal.balance_after)
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='reserve')<>1
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=p_order_id AND e.event_type='reserve'
      AND e.partner_id=v_bound.partner_id AND e.amount_ngn=v_bound.amount_ngn AND e.funding_type=v_bound.funding_type
      AND e.balance_before=v_journal.balance_before AND e.balance_after=v_journal.balance_after)
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='release')
    OR (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=p_order_id)<>1
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_obligations o WHERE o.order_id=p_order_id
      AND o.partner_id=v_bound.partner_id AND o.amount_ngn=v_bound.amount_ngn AND o.funding_type=v_bound.funding_type
      AND o.balance_before=v_journal.balance_before AND o.balance_after=v_journal.balance_after) THEN
    RETURN jsonb_build_object('success',false,'code','ACCEPTANCE_REQUIRED'); END IF;
  RETURN public.update_api_partner_external_status(p_key_id,p_order_id,'istar',v_bound.provider_order_id,
    'completed',jsonb_build_object('provider_status','completed'));
END;
$$;
REVOKE ALL ON FUNCTION public.bind_api_partner_istar_receipt(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_api_partner_istar_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_api_partner_istar_order(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_api_partner_istar_receipt(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_api_partner_istar_receipt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_api_partner_istar_order(uuid,uuid,jsonb) TO service_role;
