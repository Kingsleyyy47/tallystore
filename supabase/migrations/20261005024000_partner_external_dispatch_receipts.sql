-- Durable post-dispatch observation only. This migration neither settles money
-- nor permits a provider send. It must be applied before the runner that calls it.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE private.api_partner_dispatch_receipts (
  order_id uuid PRIMARY KEY REFERENCES public.api_partner_external_orders(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','unknown')),
  fulfillment_source text,
  fulfillment_id text,
  outcome_status text NOT NULL,
  reason_code text,
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(public_payload)='object'),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.api_partner_dispatch_receipts ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX api_partner_dispatch_receipt_provider_unique
  ON private.api_partner_dispatch_receipts(fulfillment_source,fulfillment_id)
  WHERE outcome='accepted';
CREATE INDEX api_partner_dispatch_receipt_partner_idx
  ON private.api_partner_dispatch_receipts(partner_id,observed_at DESC);
REVOKE ALL ON private.api_partner_dispatch_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.api_partner_dispatch_receipts TO service_role;

CREATE FUNCTION private.reject_api_partner_dispatch_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'partner_dispatch_receipt_immutable';
END;
$$;
CREATE TRIGGER api_partner_dispatch_receipt_immutable
  BEFORE UPDATE OR DELETE ON private.api_partner_dispatch_receipts
  FOR EACH ROW EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER api_partner_dispatch_receipt_no_truncate
  BEFORE TRUNCATE ON private.api_partner_dispatch_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
REVOKE ALL ON FUNCTION private.reject_api_partner_dispatch_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_api_partner_dispatch_receipt(
  p_order_id uuid, p_key_id uuid, p_partner_id uuid,
  p_request_fingerprint text, p_amount_ngn numeric,
  p_outcome text, p_fulfillment_source text, p_fulfillment_id text,
  p_status text, p_reason_code text, p_public_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_discovery public.api_partner_external_orders%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_existing private.api_partner_dispatch_receipts%ROWTYPE;
  v_source text:=nullif(btrim(coalesce(p_fulfillment_source,'')),'');
  v_provider_id text:=nullif(btrim(coalesce(p_fulfillment_id,'')),'');
  v_reason text:=nullif(btrim(coalesce(p_reason_code,'')),'');
  v_payload jsonb:=coalesce(p_public_payload,'{}'::jsonb);
  v_allowed text[];
  v_field text;
  v_value jsonb;
  v_proof_hash text;
BEGIN
  IF p_order_id IS NULL OR p_key_id IS NULL OR p_partner_id IS NULL
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_amount_ngn IS NULL OR p_amount_ngn <= 0 OR p_amount_ngn > 1000000000
    OR p_amount_ngn::text IN ('NaN','Infinity','-Infinity') OR p_amount_ngn<>round(p_amount_ngn,2)
    OR p_outcome IS NULL OR p_outcome NOT IN ('accepted','rejected','unknown')
    OR jsonb_typeof(v_payload)<>'object' OR octet_length(v_payload::text)>4096
    OR length(coalesce(p_fulfillment_source,''))>40
    OR length(coalesce(p_fulfillment_id,''))>160
    OR length(coalesce(p_reason_code,''))>50 THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT');
  END IF;
  SELECT * INTO v_discovery FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_discovery.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id
    OR v_journal.partner_id IS DISTINCT FROM p_partner_id
    OR v_journal.key_id IS DISTINCT FROM p_key_id
    OR v_journal.request_fingerprint IS DISTINCT FROM p_request_fingerprint
    OR v_journal.amount_ngn IS DISTINCT FROM p_amount_ngn THEN
    RETURN jsonb_build_object('success',false,'code','RECEIPT_BINDING_MISMATCH');
  END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id IS DISTINCT FROM v_journal.partner_id
    OR v_order.item_type IS DISTINCT FROM v_journal.section
    OR v_order.amount_ngn IS DISTINCT FROM v_journal.amount_ngn THEN
    RETURN jsonb_build_object('success',false,'code','RECEIPT_BINDING_MISMATCH');
  END IF;
  IF p_outcome='accepted' THEN
    IF v_source IS NULL OR v_provider_id IS NULL
      OR v_provider_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
      OR p_status IS NULL
      OR v_reason IS NOT NULL
      OR NOT ((v_journal.section='sms' AND v_source='daisy' AND p_status IN ('active','completed'))
        OR (v_journal.section='social_boost' AND v_source='smm' AND p_status IN ('processing','completed'))
        OR (v_journal.section='bills_airtime' AND v_source='sagecloud' AND p_status='completed')
        OR (v_journal.section='giftcards' AND v_source='bitrefill' AND p_status IN ('processing','completed'))
        OR (v_journal.section='telegram_stars' AND v_source='istar' AND p_status IN ('processing','completed'))) THEN
      RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT');
    END IF;
    v_allowed:=CASE v_journal.section
      WHEN 'sms' THEN ARRAY['service_name','phone_number','raw_phone_number','provider_order_id']
      WHEN 'social_boost' THEN ARRAY['provider_order_id']
      WHEN 'bills_airtime' THEN ARRAY['provider_reference','provider_status','transaction_type']
      WHEN 'giftcards' THEN ARRAY['invoice_id','provider_order_id','provider_status']
      WHEN 'telegram_stars' THEN ARRAY['provider_order_id','provider_status','telegram_type']
      ELSE ARRAY[]::text[] END;
    FOR v_field,v_value IN SELECT key,value FROM jsonb_each(v_payload) LOOP
      IF NOT(v_field=ANY(v_allowed))
        OR (jsonb_typeof(v_value)<>'string'
          AND NOT (v_journal.section='giftcards' AND v_field='provider_order_id'
            AND jsonb_typeof(v_value)='null'))
        OR length(v_value#>>'{}')>512
        OR (v_value#>>'{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]'
        OR (v_field=CASE v_journal.section
              WHEN 'bills_airtime' THEN 'provider_reference'
              WHEN 'giftcards' THEN 'invoice_id'
              ELSE 'provider_order_id' END
            AND v_value#>>'{}' IS DISTINCT FROM v_provider_id) THEN
        RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT');
      END IF;
    END LOOP;
  ELSIF p_outcome='rejected' THEN
    IF v_source IS NOT NULL OR v_provider_id IS NOT NULL
      OR p_status IS DISTINCT FROM 'failed' OR v_payload<>'{}'::jsonb
      OR v_reason IS NULL
      OR v_reason NOT IN ('NO_STOCK','INSUFFICIENT_BALANCE','PRICE_CHANGED','INVALID_RECIPIENT') THEN
      RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT');
    END IF;
  ELSE
    IF v_source IS NOT NULL OR v_provider_id IS NOT NULL OR v_reason IS NOT NULL
      OR p_status IS DISTINCT FROM 'processing' OR v_payload<>'{}'::jsonb THEN
      RETURN jsonb_build_object('success',false,'code','INVALID_RECEIPT');
    END IF;
  END IF;
  v_proof_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    jsonb_build_object('order_id',p_order_id,'partner_id',p_partner_id,'key_id',p_key_id,
      'fingerprint',p_request_fingerprint,'amount_ngn',p_amount_ngn,
      'funding_type',v_journal.funding_type,'outcome',p_outcome,
      'source',v_source,'provider_id',v_provider_id,'status',p_status,
      'reason',v_reason,'payload',v_payload)::text,'UTF8')),'hex');
  SELECT * INTO v_existing FROM private.api_partner_dispatch_receipts WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_existing.partner_id=p_partner_id AND v_existing.key_id=p_key_id
      AND v_existing.request_fingerprint=p_request_fingerprint
      AND v_existing.amount_ngn=p_amount_ngn AND v_existing.funding_type=v_journal.funding_type
      AND v_existing.outcome=p_outcome
      AND v_existing.fulfillment_source IS NOT DISTINCT FROM v_source
      AND v_existing.fulfillment_id IS NOT DISTINCT FROM v_provider_id
      AND v_existing.outcome_status=p_status
      AND v_existing.reason_code IS NOT DISTINCT FROM v_reason
      AND v_existing.public_payload=v_payload AND v_existing.proof_hash=v_proof_hash THEN
      RETURN jsonb_build_object('success',true,'idempotent_replay',true,'proof_hash',v_proof_hash);
    END IF;
    RETURN jsonb_build_object('success',false,'code','RECEIPT_CONFLICT');
  END IF;
  IF v_journal.state<>'sending' OR v_journal.claimed_at IS NULL
    OR v_order.status<>'processing'
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e
      WHERE e.order_id=p_order_id AND e.partner_id=v_partner.id
        AND e.event_type='reserve' AND e.amount_ngn=v_journal.amount_ngn
        AND e.funding_type=v_journal.funding_type)
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events e
      WHERE e.order_id=p_order_id AND e.event_type IN ('capture','release'))
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations o WHERE o.order_id=p_order_id) THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_CLAIMED');
  END IF;
  INSERT INTO private.api_partner_dispatch_receipts(order_id,partner_id,key_id,
    request_fingerprint,amount_ngn,funding_type,outcome,fulfillment_source,
    fulfillment_id,outcome_status,reason_code,public_payload,proof_hash)
  VALUES(p_order_id,p_partner_id,p_key_id,p_request_fingerprint,p_amount_ngn,
    v_journal.funding_type,p_outcome,v_source,v_provider_id,p_status,v_reason,v_payload,v_proof_hash);
  RETURN jsonb_build_object('success',true,'idempotent_replay',false,'proof_hash',v_proof_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.record_api_partner_dispatch_receipt(
  uuid,uuid,uuid,text,numeric,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_partner_dispatch_receipt(
  uuid,uuid,uuid,text,numeric,text,text,text,text,text,jsonb)
  TO service_role;
