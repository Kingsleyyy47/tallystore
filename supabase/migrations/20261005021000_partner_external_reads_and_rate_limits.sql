-- Partner read/status traffic is independently scoped and rate limited. Status
-- polling never captures, releases, refunds or changes a customer wallet.
ALTER TABLE public.api_partners ADD COLUMN IF NOT EXISTS rate_limit_per_minute integer NOT NULL DEFAULT 60;
ALTER TABLE public.api_partners ADD CONSTRAINT api_partner_request_limit_valid CHECK(rate_limit_per_minute BETWEEN 1 AND 10000);
ALTER TABLE public.api_partner_keys ADD COLUMN request_window timestamptz,
  ADD COLUMN request_count integer NOT NULL DEFAULT 0 CHECK(request_count>=0);

CREATE FUNCTION public.authorize_api_partner_request(p_hash text,p_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key public.api_partner_keys%ROWTYPE; v_partner public.api_partners%ROWTYPE;
  v_window timestamptz:=date_trunc('minute',now()); v_count integer;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_scope IS NULL
    OR p_scope NOT IN ('catalogue:read','orders:create','orders:read','wallet:read') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_KEY');
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE key_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','INVALID_KEY'); END IF;
  -- No partner row lock is needed for read admission. Paid operations recheck
  -- it under a lock, and this avoids reversing the key->partner write order.
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_key.partner_id;
  IF NOT FOUND OR v_partner.is_active IS DISTINCT FROM true OR v_partner.owner_reviewed_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','PARTNER_DISABLED');
  END IF;
  IF (p_scope=ANY(v_key.scopes)) IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',false,'code','SCOPE_DENIED'); END IF;
  v_count:=CASE WHEN v_key.request_window=v_window THEN v_key.request_count ELSE 0 END;
  IF v_count>=v_partner.rate_limit_per_minute THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  UPDATE public.api_partner_keys SET request_window=v_window,request_count=v_count+1,last_used_at=now() WHERE id=v_key.id;
  RETURN jsonb_build_object('ok',true,'key_id',v_key.id,'partner_id',v_partner.id);
END;
$$;

CREATE FUNCTION public.update_api_partner_external_status(
  p_key_id uuid,p_order_id uuid,p_source text,p_fulfillment_id text,p_status text,p_payload_delta jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key public.api_partner_keys%ROWTYPE; v_partner public.api_partners%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE; v_order public.api_partner_orders%ROWTYPE;
  v_delta jsonb:=coalesce(p_payload_delta,'{}'::jsonb); v_payload jsonb;
  v_allowed text[]; v_field text; v_value jsonb; v_redemption jsonb;
  v_card jsonb; v_card_id text; v_card_ids text[] := ARRAY[]::text[];
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active','processing','completed')
    OR jsonb_typeof(v_delta)<>'object' OR octet_length(v_delta::text)>16384 THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_STATUS');
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=p_key_id FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID_KEY'); END IF;
  IF ('orders:read'=ANY(v_key.scopes)) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','SCOPE_DENIED'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_key.partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.is_active IS DISTINCT FROM true OR v_partner.owner_reviewed_at IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','PARTNER_DISABLED');
  END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id<>v_partner.id THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id<>v_partner.id OR v_order.item_type<>v_journal.section
    OR (v_journal.section=ANY(v_partner.allowed_sections)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
  IF v_journal.state<>'accepted' OR v_journal.fulfillment_source IS DISTINCT FROM p_source
    OR v_journal.fulfillment_id IS DISTINCT FROM p_fulfillment_id OR p_fulfillment_id IS NULL
    OR v_order.fulfillment_source IS DISTINCT FROM p_source OR v_order.fulfillment_id IS DISTINCT FROM p_fulfillment_id
    OR v_order.amount_ngn IS DISTINCT FROM v_journal.amount_ngn
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_obligations obligation WHERE obligation.order_id=p_order_id
      AND obligation.partner_id=v_partner.id AND obligation.amount_ngn=v_journal.amount_ngn
      AND obligation.funding_type=v_journal.funding_type)
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events event WHERE event.order_id=p_order_id AND event.event_type='capture'
      AND event.partner_id=v_partner.id AND event.amount_ngn=v_journal.amount_ngn AND event.funding_type=v_journal.funding_type) THEN
    RETURN jsonb_build_object('success',false,'code','ACCEPTANCE_REQUIRED');
  END IF;
  IF NOT ((v_journal.section='sms' AND p_source='daisy' AND p_status IN ('active','completed'))
    OR (v_journal.section='social_boost' AND p_source='smm' AND p_status IN ('processing','completed'))
    OR (v_journal.section='bills_airtime' AND p_source='sagecloud' AND p_status='completed')
    OR (v_journal.section='giftcards' AND p_source='bitrefill' AND p_status IN ('processing','completed'))
    OR (v_journal.section='telegram_stars' AND p_source='istar' AND p_status IN ('processing','completed'))) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_STATUS');
  END IF;
  IF (v_order.status='completed' OR v_journal.outcome_status='completed') AND p_status<>'completed' THEN
    RETURN jsonb_build_object('success',false,'code','TERMINAL_STATUS');
  END IF;
  v_allowed:=CASE v_journal.section
    WHEN 'sms' THEN ARRAY['provider_status','code','completed_at']
    WHEN 'social_boost' THEN ARRAY['provider_status','start_count','remains','completed_at']
    WHEN 'giftcards' THEN ARRAY['provider_status','redemption','redemptions','completed_at']
    ELSE ARRAY['provider_status','completed_at'] END;
  FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_delta) LOOP
    IF NOT(v_field=ANY(v_allowed)) THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
    IF v_field IN ('start_count','remains') THEN
      IF jsonb_typeof(v_value)<>'number' OR v_value::text !~ '^[0-9]{1,12}$' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
    ELSIF v_field='redemption' THEN
      IF jsonb_typeof(v_value)<>'object' OR v_value='{}'::jsonb THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
      FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_delta->'redemption') LOOP
        IF v_field NOT IN ('code','pin','link','instructions','expiration_date') OR jsonb_typeof(v_value)<>'string'
          OR length(v_value#>>'{}')>8192 OR (v_field='link' AND (v_value#>>'{}') !~ '^https://') THEN
          RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD');
        END IF;
      END LOOP;
    ELSIF v_field='redemptions' THEN
      IF jsonb_typeof(v_value)<>'array' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
      IF jsonb_array_length(v_value) IS DISTINCT FROM v_order.quantity
        OR v_order.quantity NOT BETWEEN 1 AND 20 THEN RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
      FOR v_card IN SELECT value FROM jsonb_array_elements(v_value) LOOP
        IF jsonb_typeof(v_card)<>'object' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
        v_card_id:=v_card->>'order_id';
        IF jsonb_typeof(v_card->'order_id') IS DISTINCT FROM 'string' OR v_card_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
          OR v_card_id=ANY(v_card_ids) THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
        v_card_ids:=array_append(v_card_ids,v_card_id);
        IF NOT EXISTS(SELECT 1 FROM jsonb_each_text(v_card) item WHERE item.key IN ('code','pin','link','instructions') AND length(btrim(item.value))>0)
          THEN RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
        FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_card) LOOP
          IF v_field NOT IN ('order_id','code','pin','link','instructions','expiration_date') OR jsonb_typeof(v_value)<>'string'
            OR length(v_value#>>'{}')>8192 OR (v_field='link' AND (v_value#>>'{}') !~ '^https://') THEN
            RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD');
          END IF;
        END LOOP;
      END LOOP;
    ELSE
      IF jsonb_typeof(v_value)<>'string' OR length(v_value#>>'{}')>1024 OR (v_value#>>'{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' THEN
        RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD');
      END IF;
    END IF;
  END LOOP;
  v_payload:=coalesce(v_order.response_payload,'{}'::jsonb)||v_delta;
  IF octet_length(v_payload::text)>16384 THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
  IF p_status='completed' AND v_journal.section='sms'
    AND (jsonb_typeof(v_payload->'code') IS DISTINCT FROM 'string' OR length(btrim(v_payload->>'code'))=0) THEN
    RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED');
  END IF;
  v_redemption:=v_payload->'redemption';
  IF p_status='completed' AND v_journal.section='giftcards' AND v_payload ? 'redemptions' THEN
    IF jsonb_typeof(v_payload->'redemptions') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_payload->'redemptions') IS DISTINCT FROM v_order.quantity THEN
      RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED');
    END IF;
    v_card_ids:=ARRAY[]::text[];
    FOR v_card IN SELECT value FROM jsonb_array_elements(v_payload->'redemptions') LOOP
      IF jsonb_typeof(v_card)<>'object' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
      v_card_id:=v_card->>'order_id';
      IF jsonb_typeof(v_card->'order_id') IS DISTINCT FROM 'string' OR v_card_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
        OR v_card_id=ANY(v_card_ids) THEN RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD'); END IF;
      v_card_ids:=array_append(v_card_ids,v_card_id);
      IF NOT EXISTS(SELECT 1 FROM jsonb_each_text(v_card) item WHERE item.key IN ('code','pin','link','instructions') AND length(btrim(item.value))>0)
        THEN RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
      FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_card) LOOP
        IF v_field NOT IN ('order_id','code','pin','link','instructions','expiration_date') OR jsonb_typeof(v_value)<>'string'
          OR length(v_value#>>'{}')>8192 OR (v_field='link' AND (v_value#>>'{}') !~ '^https://') THEN
          RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD');
        END IF;
      END LOOP;
    END LOOP;
  ELSIF p_status='completed' AND v_journal.section='giftcards' THEN
    IF v_order.quantity IS DISTINCT FROM 1 THEN RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
    IF jsonb_typeof(v_redemption) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED'); END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_each_text(v_redemption) item WHERE item.key IN ('code','pin','link','instructions') AND length(btrim(item.value))>0) THEN
      RETURN jsonb_build_object('success',false,'code','COMPLETION_EVIDENCE_REQUIRED');
    END IF;
    FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_redemption) LOOP
      IF v_field NOT IN ('code','pin','link','instructions','expiration_date') OR jsonb_typeof(v_value)<>'string'
        OR length(v_value#>>'{}')>8192 OR (v_field='link' AND (v_value#>>'{}') !~ '^https://') THEN
        RETURN jsonb_build_object('success',false,'code','INVALID_PAYLOAD');
      END IF;
    END LOOP;
  END IF;
  IF v_order.status IS DISTINCT FROM p_status OR v_order.response_payload IS DISTINCT FROM v_payload THEN
    UPDATE public.api_partner_orders SET status=p_status,response_payload=v_payload,updated_at=now() WHERE id=p_order_id;
    UPDATE public.api_partner_external_orders SET outcome_status=p_status,public_payload=v_payload WHERE order_id=p_order_id;
  END IF;
  RETURN jsonb_build_object('success',true,'data',jsonb_build_object('id',p_order_id,'status',p_status,
    'amount_ngn',v_journal.amount_ngn,'response_payload',v_payload));
END;
$$;

CREATE FUNCTION public.cancel_prepared_api_partner_external_order(p_order_id uuid,p_key_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_journal public.api_partner_external_orders%ROWTYPE; v_partner public.api_partners%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE; v_before numeric; v_after numeric;
BEGIN
  -- Service cleanup may release a revoked key's never-dispatched reservation.
  -- Caller owns authorization; exact journal key still prevents cross-key use.
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  IF NOT FOUND OR v_journal.key_id IS DISTINCT FROM p_key_id THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_journal.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PARTNER_NOT_FOUND'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id OR v_journal.key_id IS DISTINCT FROM p_key_id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id IS DISTINCT FROM v_partner.id THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  IF v_journal.state='rejected' AND v_journal.reason_code='PREPARED_CANCELLED'
    AND EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='release') THEN
    RETURN jsonb_build_object('success',true,'idempotent_replay',true);
  END IF;
  IF v_journal.state<>'prepared' OR v_journal.claimed_at IS NOT NULL OR v_order.status<>'pending'
    OR v_journal.fulfillment_id IS NOT NULL OR v_order.fulfillment_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type IN ('capture','release')) THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_ALREADY_CLAIMED');
  END IF;
  v_before:=v_partner.balance_ngn; v_after:=v_before;
  IF v_journal.funding_type='prepaid' THEN
    v_after:=v_before+v_journal.amount_ngn;
    UPDATE public.api_partners SET balance_ngn=v_after,updated_at=now() WHERE id=v_partner.id;
  END IF;
  INSERT INTO public.api_partner_external_events(order_id,partner_id,event_type,amount_ngn,funding_type,balance_before,balance_after)
    VALUES(p_order_id,v_partner.id,'release',v_journal.amount_ngn,v_journal.funding_type,v_before,v_after);
  UPDATE public.api_partner_external_orders SET state='rejected',outcome_status='failed',reason_code='PREPARED_CANCELLED',
    public_payload='{}'::jsonb,settled_at=now() WHERE order_id=p_order_id;
  UPDATE public.api_partner_orders SET status='failed',response_payload='{}'::jsonb,
    refunded_at=CASE WHEN v_journal.funding_type='prepaid' THEN now() ELSE NULL END,
    refund_amount_ngn=CASE WHEN v_journal.funding_type='prepaid' THEN v_journal.amount_ngn ELSE NULL END,
    updated_at=now() WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true,'idempotent_replay',false);
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_api_partner_request(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_api_partner_external_status(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_prepared_api_partner_external_order(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_api_partner_request(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_api_partner_external_status(uuid,uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_prepared_api_partner_external_order(uuid,uuid) TO service_role;
