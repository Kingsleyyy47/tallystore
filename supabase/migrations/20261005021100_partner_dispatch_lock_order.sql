-- Preserve applied journal decisions while aligning all mutation locks.
-- Claim: key share -> partner -> journal -> order.
-- Outcome: unlocked journal discovery -> partner -> journal recheck -> order.
-- Paid outcomes must still be stored after the sending key is revoked.

CREATE OR REPLACE FUNCTION public.claim_api_partner_external_dispatch(
  p_order_id uuid, p_key_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_key public.api_partner_keys%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=p_key_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','INVALID_KEY'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_key.partner_id FOR UPDATE;
  SELECT * INTO v_journal FROM public.api_partner_external_orders
    WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.key_id IS DISTINCT FROM p_key_id
    OR v_journal.partner_id IS DISTINCT FROM v_partner.id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
  IF v_journal.state <> 'prepared' THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_ALREADY_CLAIMED',
      'dispatch_state',v_journal.state);
  END IF;
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

CREATE OR REPLACE FUNCTION public.record_api_partner_external_outcome(
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
    WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_partner FROM public.api_partners
    WHERE id=v_journal.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PARTNER_NOT_FOUND'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders
    WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND');
  END IF;
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
