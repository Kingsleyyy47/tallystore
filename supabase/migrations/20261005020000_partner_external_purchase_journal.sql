-- Financial journal for future partner external purchases. This migration does
-- not call providers or open partner-api purchase routes.
CREATE TABLE public.api_partner_external_orders (
  order_id uuid PRIMARY KEY REFERENCES public.api_partner_orders(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  section text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  balance_before numeric(18,2) NOT NULL,
  balance_after numeric(18,2) NOT NULL,
  state text NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared','sending','accepted','rejected','unknown')),
  fulfillment_source text,
  fulfillment_id text,
  outcome_status text,
  reason_code text,
  public_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  settled_at timestamptz
);
CREATE INDEX api_partner_external_orders_partner_created_idx
  ON public.api_partner_external_orders(partner_id, created_at DESC);
CREATE UNIQUE INDEX api_partner_external_provider_delivery_unique
  ON public.api_partner_external_orders(fulfillment_source,fulfillment_id)
  WHERE state='accepted';
ALTER TABLE public.api_partner_external_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_partner_external_orders FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.api_partner_external_orders TO service_role;

CREATE TABLE public.api_partner_external_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.api_partner_external_orders(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('reserve','capture','release')),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  balance_before numeric(18,2) NOT NULL,
  balance_after numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,event_type)
);
CREATE INDEX api_partner_external_events_partner_created_idx
  ON public.api_partner_external_events(partner_id, created_at DESC);
ALTER TABLE public.api_partner_external_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_partner_external_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.api_partner_external_events TO service_role;
CREATE FUNCTION public.guard_api_partner_external_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'partner_external_event_is_immutable';
END;
$$;
CREATE TRIGGER api_partner_external_event_immutable
BEFORE UPDATE OR DELETE ON public.api_partner_external_events
FOR EACH ROW EXECUTE FUNCTION public.guard_api_partner_external_event_immutable();
REVOKE ALL ON FUNCTION public.guard_api_partner_external_event_immutable()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reserve_api_partner_external_order(
  p_key_id uuid, p_section text, p_item_type text, p_item_id text,
  p_item_name text, p_quantity integer, p_amount_ngn numeric,
  p_expected_amount_ngn numeric, p_idempotency_key text,
  p_request_fingerprint text, p_request_payload jsonb,
  p_partner_reference text DEFAULT NULL, p_customer_email text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key public.api_partner_keys%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_order_id uuid := gen_random_uuid();
  v_before numeric(18,2);
  v_after numeric(18,2);
  v_funding text;
BEGIN
  IF p_key_id IS NULL OR p_section IS NULL OR p_item_type IS NULL
    OR p_section NOT IN ('sms','social_boost','bills_airtime','giftcards','telegram_stars')
    OR p_item_type IS DISTINCT FROM p_section
    OR length(btrim(coalesce(p_item_id,''))) < 1 OR length(p_item_id) > 180
    OR length(btrim(coalesce(p_item_name,''))) < 1 OR length(p_item_name) > 180
    OR p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000000
    OR (p_item_type IN ('sms','bills_airtime') AND p_quantity <> 1)
    OR (p_item_type='giftcards' AND p_quantity > 20)
    OR p_amount_ngn IS NULL OR p_amount_ngn <= 0 OR p_amount_ngn > 1000000000
    OR p_amount_ngn <> round(p_amount_ngn,2)
    OR length(btrim(coalesce(p_idempotency_key,''))) < 10 OR length(p_idempotency_key) > 160
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_request_payload IS NULL OR jsonb_typeof(p_request_payload) <> 'object'
    OR octet_length(p_request_payload::text) > 16384
    OR length(coalesce(p_partner_reference,'')) > 180
    OR length(coalesce(p_customer_email,'')) > 254
    OR length(coalesce(p_customer_phone,'')) > 80 THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST');
  END IF;
  IF p_expected_amount_ngn IS DISTINCT FROM p_amount_ngn THEN
    RETURN jsonb_build_object('success',false,'code','PRICE_CHANGED');
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=p_key_id FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL
    OR NOT ('orders:create' = ANY(v_key.scopes)) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_KEY');
  END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_key.partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.is_active IS DISTINCT FROM true
    OR v_partner.owner_reviewed_at IS NULL
    OR NOT (p_section = ANY(v_partner.allowed_sections)) THEN
    RETURN jsonb_build_object('success',false,'code','PARTNER_DISABLED');
  END IF;
  SELECT * INTO v_order FROM public.api_partner_orders
    WHERE partner_id=v_partner.id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_journal FROM public.api_partner_external_orders
      WHERE order_id=v_order.id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','LEGACY_ORDER_REVIEW_REQUIRED'); END IF;
    IF v_journal.key_id IS DISTINCT FROM p_key_id
      OR v_journal.section IS DISTINCT FROM p_section
      OR v_journal.request_fingerprint IS DISTINCT FROM p_request_fingerprint
      OR v_order.item_type IS DISTINCT FROM p_item_type
      OR v_order.item_id IS DISTINCT FROM p_item_id
      OR v_order.item_name IS DISTINCT FROM p_item_name
      OR v_order.quantity IS DISTINCT FROM p_quantity
      OR v_order.amount_ngn IS DISTINCT FROM p_amount_ngn
      OR v_order.partner_reference IS DISTINCT FROM p_partner_reference
      OR v_order.customer_email IS DISTINCT FROM p_customer_email
      OR v_order.customer_phone IS DISTINCT FROM p_customer_phone
      OR v_order.request_payload IS DISTINCT FROM p_request_payload THEN
      RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('success',true,'idempotent_replay',true,
      'order_id',v_order.id,'dispatch_state',v_journal.state,
      'data',jsonb_build_object('id',v_order.id,'status',v_order.status,
        'amount_ngn',v_order.amount_ngn,'item_type',v_order.item_type,
        'item_id',v_order.item_id,'quantity',v_order.quantity,
        'response_payload',v_order.response_payload));
  END IF;
  v_before := v_partner.balance_ngn;
  IF v_partner.unlimited_credit IS TRUE THEN
    v_funding := 'unlimited_credit'; v_after := v_before;
  ELSE
    IF v_before < p_amount_ngn THEN
      RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_PARTNER_BALANCE');
    END IF;
    v_funding := 'prepaid'; v_after := v_before-p_amount_ngn;
    UPDATE public.api_partners SET balance_ngn=v_after,updated_at=now()
      WHERE id=v_partner.id;
  END IF;
  INSERT INTO public.api_partner_orders(
    id,partner_id,partner_reference,idempotency_key,item_type,item_id,
    item_name,quantity,amount_ngn,status,customer_email,customer_phone,
    request_payload,response_payload
  ) VALUES (
    v_order_id,v_partner.id,p_partner_reference,p_idempotency_key,
    p_item_type,p_item_id,p_item_name,p_quantity,p_amount_ngn,'pending',
    p_customer_email,p_customer_phone,p_request_payload,'{}'::jsonb
  );
  INSERT INTO public.api_partner_external_orders(
    order_id,partner_id,key_id,section,request_fingerprint,amount_ngn,
    funding_type,balance_before,balance_after,state
  ) VALUES (
    v_order_id,v_partner.id,p_key_id,p_section,p_request_fingerprint,p_amount_ngn,
    v_funding,v_before,v_after,'prepared'
  );
  INSERT INTO public.api_partner_external_events(order_id,partner_id,event_type,
    amount_ngn,funding_type,balance_before,balance_after)
  VALUES(v_order_id,v_partner.id,'reserve',p_amount_ngn,v_funding,v_before,v_after);
  RETURN jsonb_build_object('success',true,'idempotent_replay',false,
    'order_id',v_order_id,'dispatch_state','prepared',
    'data',jsonb_build_object('id',v_order_id,'status','pending',
      'amount_ngn',p_amount_ngn,'item_type',p_item_type,
      'item_id',p_item_id,'quantity',p_quantity,'response_payload','{}'::jsonb));
END;
$$;

CREATE FUNCTION public.claim_api_partner_external_dispatch(
  p_order_id uuid, p_key_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_key public.api_partner_keys%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_journal FROM public.api_partner_external_orders
    WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.key_id IS DISTINCT FROM p_key_id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
  IF v_journal.state <> 'prepared' THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_ALREADY_CLAIMED',
      'dispatch_state',v_journal.state);
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=p_key_id FOR SHARE;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_journal.partner_id FOR UPDATE;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF v_key.id IS NULL OR v_key.partner_id IS DISTINCT FROM v_journal.partner_id
    OR v_key.revoked_at IS NOT NULL OR NOT ('orders:create'=ANY(v_key.scopes))
    OR v_partner.id IS NULL OR v_partner.is_active IS DISTINCT FROM true
    OR v_partner.owner_reviewed_at IS NULL
    OR NOT (v_journal.section=ANY(v_partner.allowed_sections))
    OR v_partner.unlimited_credit IS DISTINCT FROM (v_journal.funding_type='unlimited_credit')
    OR v_order.id IS NULL OR v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_AUTHORIZATION_STALE');
  END IF;
  UPDATE public.api_partner_external_orders SET state='sending',claimed_at=now()
    WHERE order_id=p_order_id;
  UPDATE public.api_partner_orders SET status='processing',updated_at=now()
    WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,
    'dispatch_state','sending','send_allowed',true);
END;
$$;

CREATE FUNCTION public.record_api_partner_external_outcome(
  p_order_id uuid, p_outcome text, p_fulfillment_source text,
  p_fulfillment_id text, p_public_payload jsonb, p_status text,
  p_reason_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_source text := nullif(btrim(coalesce(p_fulfillment_source,'')),'');
  v_external_id text := nullif(btrim(coalesce(p_fulfillment_id,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason_code,'')),'');
  v_payload jsonb := coalesce(p_public_payload,'{}'::jsonb);
  v_status text;
  v_balance_before numeric(18,2);
  v_balance_after numeric(18,2);
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','rejected','unknown')
    OR jsonb_typeof(v_payload)<>'object' OR octet_length(v_payload::text)>16384
    OR length(coalesce(p_fulfillment_source,''))>40
    OR length(coalesce(p_fulfillment_id,''))>200 THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_OUTCOME');
  END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders
    WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id IS DISTINCT FROM v_journal.partner_id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
  IF p_outcome='accepted' THEN
    IF v_external_id IS NULL OR v_source IS NULL OR v_reason IS NOT NULL OR p_status IS NULL
      OR NOT ((v_order.item_type='sms' AND v_source='daisy' AND p_status IN ('active','completed'))
        OR (v_order.item_type='social_boost' AND v_source='smm' AND p_status IN ('processing','completed'))
        OR (v_order.item_type='bills_airtime' AND v_source='sagecloud' AND p_status='completed')
        OR (v_order.item_type='giftcards' AND v_source='bitrefill' AND p_status IN ('processing','completed'))
        OR (v_order.item_type='telegram_stars' AND v_source='istar' AND p_status IN ('processing','completed'))) THEN
      RETURN jsonb_build_object('success',false,'code','ACCEPTANCE_EVIDENCE_INVALID');
    END IF;
    v_status := p_status;
  ELSIF p_outcome='rejected' THEN
    IF v_source IS NOT NULL OR v_external_id IS NOT NULL OR p_status IS DISTINCT FROM 'failed'
      OR v_payload <> '{}'::jsonb
      OR v_reason IS NULL
      OR v_reason NOT IN ('NO_STOCK','INSUFFICIENT_BALANCE','PRICE_CHANGED','INVALID_RECIPIENT') THEN
      RETURN jsonb_build_object('success',false,'code','REJECTION_NOT_CONFIRMED');
    END IF;
    v_status := 'failed';
  ELSE
    IF v_source IS NOT NULL OR v_external_id IS NOT NULL OR v_reason IS NOT NULL
      OR p_status IS DISTINCT FROM 'processing' OR v_payload <> '{}'::jsonb THEN
      RETURN jsonb_build_object('success',false,'code','UNKNOWN_EVIDENCE_INVALID');
    END IF;
    v_status := 'processing';
  END IF;
  IF v_journal.state IN ('accepted','rejected','unknown') THEN
    IF v_journal.state=p_outcome
      AND v_journal.fulfillment_source IS NOT DISTINCT FROM v_source
      AND v_journal.fulfillment_id IS NOT DISTINCT FROM v_external_id
      AND v_journal.outcome_status IS NOT DISTINCT FROM v_status
      AND v_journal.reason_code IS NOT DISTINCT FROM v_reason
      AND v_journal.public_payload IS NOT DISTINCT FROM v_payload THEN
      RETURN jsonb_build_object('success',true,'idempotent_replay',true,
        'order_id',p_order_id,'dispatch_state',v_journal.state,
        'data',jsonb_build_object('id',v_order.id,'status',v_order.status,
          'amount_ngn',v_order.amount_ngn,'response_payload',v_order.response_payload));
    END IF;
    RETURN jsonb_build_object('success',false,'code','OUTCOME_CONFLICT');
  END IF;
  IF v_journal.state <> 'sending' OR v_order.status <> 'processing' THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_CLAIMED');
  END IF;
  SELECT * INTO v_partner FROM public.api_partners
    WHERE id=v_journal.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PARTNER_NOT_FOUND'); END IF;
  IF p_outcome='accepted' THEN
    INSERT INTO public.api_partner_obligations(partner_id,order_id,amount_ngn,
      funding_type,balance_before,balance_after)
    VALUES(v_journal.partner_id,p_order_id,v_journal.amount_ngn,
      v_journal.funding_type,v_journal.balance_before,v_journal.balance_after);
    INSERT INTO public.api_partner_external_events(order_id,partner_id,event_type,
      amount_ngn,funding_type,balance_before,balance_after)
    VALUES(p_order_id,v_journal.partner_id,'capture',v_journal.amount_ngn,
      v_journal.funding_type,v_journal.balance_before,v_journal.balance_after);
  ELSIF p_outcome='rejected' THEN
    v_balance_before := v_partner.balance_ngn;
    v_balance_after := v_balance_before;
    IF v_journal.funding_type='prepaid' THEN
      v_balance_after := v_balance_before+v_journal.amount_ngn;
      UPDATE public.api_partners SET balance_ngn=v_balance_after,updated_at=now()
        WHERE id=v_journal.partner_id;
    END IF;
    INSERT INTO public.api_partner_external_events(order_id,partner_id,event_type,
      amount_ngn,funding_type,balance_before,balance_after)
    VALUES(p_order_id,v_journal.partner_id,'release',v_journal.amount_ngn,
      v_journal.funding_type,v_balance_before,v_balance_after);
  END IF;
  UPDATE public.api_partner_external_orders SET state=p_outcome,
    fulfillment_source=v_source,fulfillment_id=v_external_id,
    outcome_status=v_status,reason_code=v_reason,public_payload=v_payload,
    settled_at=now() WHERE order_id=p_order_id;
  UPDATE public.api_partner_orders SET status=v_status,
    fulfillment_source=v_source,fulfillment_id=v_external_id,
    response_payload=v_payload,
    refunded_at=CASE WHEN p_outcome='rejected' AND v_journal.funding_type='prepaid' THEN now() ELSE NULL END,
    refund_amount_ngn=CASE WHEN p_outcome='rejected' AND v_journal.funding_type='prepaid' THEN v_journal.amount_ngn ELSE NULL END,
    updated_at=now() WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true,'idempotent_replay',false,
    'order_id',p_order_id,'dispatch_state',p_outcome,
    'data',jsonb_build_object('id',p_order_id,'status',v_status,
      'amount_ngn',v_journal.amount_ngn,'response_payload',v_payload));
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_partner_external_order(
  uuid,text,text,text,text,integer,numeric,numeric,text,text,jsonb,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_api_partner_external_dispatch(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_api_partner_external_outcome(
  uuid,text,text,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_partner_external_order(
  uuid,text,text,text,text,integer,numeric,numeric,text,text,jsonb,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_api_partner_external_dispatch(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_api_partner_external_outcome(
  uuid,text,text,text,jsonb,text,text)
  TO service_role;
