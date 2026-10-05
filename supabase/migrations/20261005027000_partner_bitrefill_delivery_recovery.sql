-- Independent, owner-reviewed delivery evidence for already claimed and held
-- Bitrefill invoices. No provider payment, refund, or additional debit occurs.
CREATE TABLE private.api_partner_bitrefill_delivery_evidence (
  order_id uuid PRIMARY KEY REFERENCES public.api_partner_external_orders(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  request_payload jsonb NOT NULL,
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  amount_ngn numeric(18,2) NOT NULL CHECK(amount_ngn>0),
  funding_type text NOT NULL CHECK(funding_type IN ('prepaid','unlimited_credit')),
  balance_before numeric(18,2) NOT NULL,
  balance_after numeric(18,2) NOT NULL,
  invoice_id text NOT NULL REFERENCES private.api_partner_bitrefill_invoice_bindings(invoice_id) ON DELETE RESTRICT,
  delivery jsonb NOT NULL CHECK(jsonb_typeof(delivery)='object'),
  public_payload jsonb NOT NULL CHECK(jsonb_typeof(public_payload)='object'),
  evidence_proof_hash text NOT NULL CHECK(evidence_proof_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.api_partner_bitrefill_delivery_decisions (
  order_id uuid PRIMARY KEY REFERENCES private.api_partner_bitrefill_delivery_evidence(order_id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  evidence_proof_hash text NOT NULL CHECK(evidence_proof_hash ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.api_partner_bitrefill_delivery_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_partner_bitrefill_delivery_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_partner_bitrefill_delivery_evidence, private.api_partner_bitrefill_delivery_decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.api_partner_bitrefill_delivery_evidence, private.api_partner_bitrefill_delivery_decisions TO service_role;
CREATE TRIGGER bitrefill_delivery_evidence_immutable BEFORE UPDATE OR DELETE ON private.api_partner_bitrefill_delivery_evidence FOR EACH ROW EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER bitrefill_delivery_evidence_no_truncate BEFORE TRUNCATE ON private.api_partner_bitrefill_delivery_evidence FOR EACH STATEMENT EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER bitrefill_delivery_decisions_immutable BEFORE UPDATE OR DELETE ON private.api_partner_bitrefill_delivery_decisions FOR EACH ROW EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER bitrefill_delivery_decisions_no_truncate BEFORE TRUNCATE ON private.api_partner_bitrefill_delivery_decisions FOR EACH STATEMENT EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();

-- Rechecked at confirmation and by the journal guard. Revocation/partner
-- disablement cannot erase a previously claimed financial hold.
CREATE FUNCTION private.bitrefill_delivery_binding_valid(p_order_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.api_partner_bitrefill_delivery_evidence e
 JOIN public.api_partner_external_orders j ON j.order_id=e.order_id
 JOIN public.api_partner_orders o ON o.id=e.order_id
 JOIN public.api_partner_keys k ON k.id=e.key_id AND k.partner_id=e.partner_id
 JOIN private.api_partner_bitrefill_invoice_bindings b ON b.order_id=e.order_id
 WHERE e.order_id=p_order_id AND j.section='giftcards' AND j.claimed_at IS NOT NULL
 AND e.observed_at>=j.claimed_at AND e.partner_id=j.partner_id AND e.key_id=j.key_id
 AND e.request_fingerprint=j.request_fingerprint AND e.amount_ngn=j.amount_ngn
 AND e.funding_type=j.funding_type AND e.balance_before=j.balance_before AND e.balance_after=j.balance_after
 AND o.partner_id=e.partner_id AND o.item_type='giftcards' AND o.item_id=e.item_id
 AND o.quantity=e.quantity AND o.amount_ngn=e.amount_ngn AND o.request_payload=e.request_payload
 AND b.partner_id=e.partner_id AND b.key_id=e.key_id AND b.request_fingerprint=e.request_fingerprint
 AND b.item_id=e.item_id AND b.quantity=e.quantity AND b.amount_ngn=e.amount_ngn
 AND b.funding_type=e.funding_type AND b.invoice_id=e.invoice_id AND b.created_status='unpaid'
 AND (SELECT count(*) FROM public.api_partner_external_events r WHERE r.order_id=e.order_id AND r.event_type='reserve')=1
 AND EXISTS(SELECT 1 FROM public.api_partner_external_events r WHERE r.order_id=e.order_id AND r.event_type='reserve'
 AND r.partner_id=e.partner_id AND r.amount_ngn=e.amount_ngn AND r.funding_type=e.funding_type
 AND r.balance_before=e.balance_before AND r.balance_after=e.balance_after)
 AND ((e.funding_type='prepaid' AND e.balance_after=e.balance_before-e.amount_ngn)
   OR (e.funding_type='unlimited_credit' AND e.balance_after=e.balance_before))
 AND NOT EXISTS(SELECT 1 FROM private.api_partner_dispatch_receipts r WHERE r.order_id=e.order_id
  AND (r.partner_id IS DISTINCT FROM e.partner_id OR r.key_id IS DISTINCT FROM e.key_id
   OR r.request_fingerprint IS DISTINCT FROM e.request_fingerprint OR r.amount_ngn IS DISTINCT FROM e.amount_ngn
   OR r.funding_type IS DISTINCT FROM e.funding_type OR r.outcome='rejected'
   OR (r.outcome='accepted' AND (r.fulfillment_source IS DISTINCT FROM 'bitrefill' OR r.fulfillment_id IS DISTINCT FROM e.invoice_id)))));
$$;
REVOKE ALL ON FUNCTION private.bitrefill_delivery_binding_valid(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_api_partner_bitrefill_delivery_evidence(
 p_order_id uuid,p_owner_user_id uuid,p_invoice_id text,p_delivery jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 j public.api_partner_external_orders%ROWTYPE; o public.api_partner_orders%ROWTYPE;
 b private.api_partner_bitrefill_invoice_bindings%ROWTYPE;
 e private.api_partner_bitrefill_delivery_evidence%ROWTYPE;
 r private.api_partner_dispatch_receipts%ROWTYPE;
 v_partner uuid; v_entry jsonb; v_field text; v_ids text[] := ARRAY[]::text[];
 v_payload jsonb; v_hash text; v_replay boolean := false;
BEGIN
 IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner_user_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true) THEN
 RETURN jsonb_build_object('success',false,'code','OWNER_DENIED'); END IF;
 IF p_order_id IS NULL OR p_invoice_id IS NULL OR p_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
 OR p_delivery IS NULL OR jsonb_typeof(p_delivery)<>'object' OR octet_length(p_delivery::text)>16384
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_delivery) k WHERE k NOT IN ('item_id','quantity','unit_value','currency','provider_status','redemptions'))
 OR (SELECT count(*) FROM jsonb_object_keys(p_delivery))<>6
 OR jsonb_typeof(p_delivery->'item_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_delivery->'quantity') IS DISTINCT FROM 'number'
 OR (p_delivery->>'quantity') !~ '^(?:[1-9]|1[0-9]|20)$'
 OR jsonb_typeof(p_delivery->'unit_value') IS DISTINCT FROM 'number'
 OR jsonb_typeof(p_delivery->'currency') IS DISTINCT FROM 'string'
 OR p_delivery->>'currency' NOT IN ('USD','NGN')
 OR p_delivery->>'provider_status' IS DISTINCT FROM 'complete'
 OR jsonb_typeof(p_delivery->'redemptions') IS DISTINCT FROM 'array' THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
 IF (p_delivery->>'unit_value')::numeric<=0
 OR jsonb_array_length(p_delivery->'redemptions')<>(p_delivery->>'quantity')::integer THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_delivery->'redemptions') LOOP
  IF jsonb_typeof(v_entry)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_entry) k WHERE k NOT IN ('order_id','code','pin','link','instructions','expiration_date'))
  OR jsonb_typeof(v_entry->'order_id') IS DISTINCT FROM 'string'
  OR (v_entry->>'order_id') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
  OR (v_entry->>'order_id')=ANY(v_ids) THEN RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
  v_ids:=array_append(v_ids,v_entry->>'order_id');
  FOREACH v_field IN ARRAY ARRAY['code','pin','link','instructions','expiration_date'] LOOP
   IF v_entry ? v_field AND (jsonb_typeof(v_entry->v_field) IS DISTINCT FROM 'string'
    OR length(v_entry->>v_field)>CASE WHEN v_field='instructions' THEN 4096 ELSE 2048 END
    OR (v_entry->>v_field) ~ '[[:cntrl:]]') THEN RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
  END LOOP;
  IF v_entry ? 'link' AND (v_entry->>'link') !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]\\]*)?$' THEN
   RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
  IF nullif(btrim(v_entry->>'code'),'') IS NULL AND nullif(btrim(v_entry->>'link'),'') IS NULL THEN
   RETURN jsonb_build_object('success',false,'code','INVALID_DELIVERY'); END IF;
 END LOOP;
 SELECT partner_id INTO v_partner FROM public.api_partner_external_orders WHERE order_id=p_order_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 PERFORM 1 FROM public.api_partners WHERE id=v_partner FOR UPDATE;
 SELECT * INTO j FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
 SELECT * INTO o FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO b FROM private.api_partner_bitrefill_invoice_bindings WHERE order_id=p_order_id;
 IF j.partner_id IS DISTINCT FROM v_partner OR j.section<>'giftcards' OR o.partner_id IS DISTINCT FROM v_partner
 OR o.item_type<>'giftcards' OR o.amount_ngn IS DISTINCT FROM j.amount_ngn
 OR b.order_id IS NULL OR b.partner_id IS DISTINCT FROM v_partner OR b.key_id IS DISTINCT FROM j.key_id
 OR b.request_fingerprint IS DISTINCT FROM j.request_fingerprint OR b.amount_ngn IS DISTINCT FROM j.amount_ngn
 OR b.funding_type IS DISTINCT FROM j.funding_type OR b.invoice_id IS DISTINCT FROM p_invoice_id
 OR b.item_id IS DISTINCT FROM o.item_id OR b.quantity IS DISTINCT FROM o.quantity
 OR NOT EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=j.key_id AND partner_id=v_partner)
 OR p_delivery->>'item_id' IS DISTINCT FROM o.item_id
 OR p_delivery->'quantity' IS DISTINCT FROM to_jsonb(o.quantity)
 OR o.request_payload->>'product_id' IS DISTINCT FROM o.item_id
 OR o.request_payload->'quantity' IS DISTINCT FROM to_jsonb(o.quantity)
 OR jsonb_typeof(o.request_payload->'value') IS DISTINCT FROM 'number'
 OR o.request_payload->'value' IS DISTINCT FROM p_delivery->'unit_value'
 OR o.request_payload->>'provider_currency' IS DISTINCT FROM p_delivery->>'currency' THEN
 RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
 SELECT * INTO r FROM private.api_partner_dispatch_receipts WHERE order_id=p_order_id;
 IF r.order_id IS NOT NULL AND (r.partner_id IS DISTINCT FROM v_partner OR r.key_id IS DISTINCT FROM j.key_id
 OR r.request_fingerprint IS DISTINCT FROM j.request_fingerprint OR r.amount_ngn IS DISTINCT FROM j.amount_ngn
 OR r.funding_type IS DISTINCT FROM j.funding_type OR r.outcome='rejected'
 OR (r.outcome='accepted' AND (r.fulfillment_source IS DISTINCT FROM 'bitrefill' OR r.fulfillment_id IS DISTINCT FROM p_invoice_id))) THEN
 RETURN jsonb_build_object('success',false,'code','RECEIPT_CONFLICT'); END IF;
 v_payload:=jsonb_build_object('invoice_id',p_invoice_id,'provider_status','complete','redemptions',p_delivery->'redemptions');
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
 'order_id',p_order_id,'partner_id',v_partner,'key_id',j.key_id,'request_fingerprint',j.request_fingerprint,
 'request_payload',o.request_payload,'item_id',o.item_id,'quantity',o.quantity,'amount_ngn',j.amount_ngn,
 'funding_type',j.funding_type,'balance_before',j.balance_before,'balance_after',j.balance_after,
 'invoice_id',p_invoice_id,'delivery',p_delivery)::text,'UTF8')),'hex');
 SELECT * INTO e FROM private.api_partner_bitrefill_delivery_evidence WHERE order_id=p_order_id;
 IF FOUND THEN
  IF e.evidence_proof_hash IS DISTINCT FROM v_hash OR e.delivery IS DISTINCT FROM p_delivery
  OR NOT private.bitrefill_delivery_binding_valid(p_order_id) THEN RETURN jsonb_build_object('success',false,'code','EVIDENCE_CONFLICT'); END IF;
  v_replay:=true;
 ELSE
  IF j.state NOT IN ('sending','unknown') OR j.claimed_at IS NULL OR o.status<>'processing'
  OR o.refunded_at IS NOT NULL OR o.refund_amount_ngn IS NOT NULL
  OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='reserve')<>1
  OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='reserve'
   AND partner_id=v_partner AND amount_ngn=j.amount_ngn AND funding_type=j.funding_type AND balance_before=j.balance_before AND balance_after=j.balance_after)
  OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type IN ('capture','release'))
  OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=p_order_id) THEN RETURN jsonb_build_object('success',false,'code','NOT_RECOVERABLE'); END IF;
  INSERT INTO private.api_partner_bitrefill_delivery_evidence(order_id,partner_id,key_id,owner_user_id,request_fingerprint,
  request_payload,item_id,quantity,amount_ngn,funding_type,balance_before,balance_after,invoice_id,delivery,public_payload,evidence_proof_hash)
  VALUES(p_order_id,v_partner,j.key_id,p_owner_user_id,j.request_fingerprint,o.request_payload,o.item_id,o.quantity,
  j.amount_ngn,j.funding_type,j.balance_before,j.balance_after,p_invoice_id,p_delivery,v_payload,v_hash);
 END IF;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'evidence_proof_hash',v_hash,
 'quantity',o.quantity,'amount_ngn',j.amount_ngn,'funding_type',j.funding_type,'idempotent_replay',v_replay);
END;
$$;
REVOKE ALL ON FUNCTION public.record_api_partner_bitrefill_delivery_evidence(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_partner_bitrefill_delivery_evidence(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.reconcile_api_partner_bitrefill_delivery(p_order_id uuid,p_owner_user_id uuid,p_evidence_proof_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_partner uuid; j public.api_partner_external_orders%ROWTYPE; o public.api_partner_orders%ROWTYPE;
 e private.api_partner_bitrefill_delivery_evidence%ROWTYPE; d private.api_partner_bitrefill_delivery_decisions%ROWTYPE;
BEGIN
 IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner_user_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true) THEN
 RETURN jsonb_build_object('success',false,'code','OWNER_DENIED'); END IF;
 SELECT partner_id INTO v_partner FROM public.api_partner_external_orders WHERE order_id=p_order_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 PERFORM 1 FROM public.api_partners WHERE id=v_partner FOR UPDATE;
 SELECT * INTO j FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
 SELECT * INTO o FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO e FROM private.api_partner_bitrefill_delivery_evidence WHERE order_id=p_order_id;
 IF j.partner_id IS DISTINCT FROM v_partner OR e.order_id IS NULL
 OR e.evidence_proof_hash IS DISTINCT FROM p_evidence_proof_hash OR NOT private.bitrefill_delivery_binding_valid(p_order_id) THEN
 RETURN jsonb_build_object('success',false,'code','EVIDENCE_MISMATCH'); END IF;
 SELECT * INTO d FROM private.api_partner_bitrefill_delivery_decisions WHERE order_id=p_order_id;
 IF FOUND THEN
  IF d.owner_user_id=p_owner_user_id AND d.evidence_proof_hash=p_evidence_proof_hash
  AND j.state='accepted' AND j.fulfillment_source='bitrefill' AND j.fulfillment_id=e.invoice_id
  AND j.outcome_status='completed' AND j.reason_code IS NULL AND j.public_payload=e.public_payload
  AND o.status='completed' AND o.fulfillment_source='bitrefill' AND o.fulfillment_id=e.invoice_id AND o.response_payload=e.public_payload
  AND o.refunded_at IS NULL AND o.refund_amount_ngn IS NULL
  AND (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='capture')=1
  AND EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='capture'
   AND partner_id=e.partner_id AND amount_ngn=e.amount_ngn AND funding_type=e.funding_type AND balance_before=e.balance_before AND balance_after=e.balance_after)
  AND NOT EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type='release')
  AND (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=p_order_id)=1
  AND EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=p_order_id AND partner_id=e.partner_id
   AND amount_ngn=e.amount_ngn AND funding_type=e.funding_type AND balance_before=e.balance_before AND balance_after=e.balance_after) THEN
   RETURN jsonb_build_object('success',true,'order_id',p_order_id,'idempotent_replay',true,'decision','accepted','status','completed'); END IF;
  RETURN jsonb_build_object('success',false,'code','DECISION_CONFLICT');
 END IF;
 IF j.state NOT IN ('sending','unknown') OR o.status<>'processing' OR o.refunded_at IS NOT NULL OR o.refund_amount_ngn IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=p_order_id AND event_type IN ('capture','release'))
 OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=p_order_id) THEN RETURN jsonb_build_object('success',false,'code','NOT_RECOVERABLE'); END IF;
 BEGIN
  INSERT INTO private.api_partner_bitrefill_delivery_decisions(order_id,owner_user_id,evidence_proof_hash) VALUES(p_order_id,p_owner_user_id,p_evidence_proof_hash);
  INSERT INTO public.api_partner_obligations(partner_id,order_id,amount_ngn,funding_type,balance_before,balance_after)
   VALUES(e.partner_id,p_order_id,e.amount_ngn,e.funding_type,e.balance_before,e.balance_after);
  INSERT INTO public.api_partner_external_events(order_id,partner_id,event_type,amount_ngn,funding_type,balance_before,balance_after)
   VALUES(p_order_id,e.partner_id,'capture',e.amount_ngn,e.funding_type,e.balance_before,e.balance_after);
  UPDATE public.api_partner_external_orders SET state='accepted',fulfillment_source='bitrefill',fulfillment_id=e.invoice_id,
   outcome_status='completed',reason_code=NULL,public_payload=e.public_payload,settled_at=now() WHERE order_id=p_order_id;
  UPDATE public.api_partner_orders SET status='completed',fulfillment_source='bitrefill',fulfillment_id=e.invoice_id,
   response_payload=e.public_payload,updated_at=now() WHERE id=p_order_id;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','FINALIZATION_FAILED'); END;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'idempotent_replay',false,'decision','accepted','status','completed');
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_api_partner_bitrefill_delivery(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_api_partner_bitrefill_delivery(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION private.guard_bound_bitrefill_financial_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bound text; v_receipt private.api_partner_dispatch_receipts%ROWTYPE; e private.api_partner_bitrefill_delivery_evidence%ROWTYPE;
BEGIN
 IF NEW.section='giftcards' THEN
  IF OLD.state='accepted' THEN
   IF NEW.state IS DISTINCT FROM 'accepted' OR NEW.fulfillment_source IS DISTINCT FROM OLD.fulfillment_source
   OR NEW.fulfillment_id IS DISTINCT FROM OLD.fulfillment_id THEN RAISE EXCEPTION 'bitrefill_accepted_identity_immutable'; END IF;
  ELSIF NEW.state='accepted' THEN
   SELECT invoice_id INTO v_bound FROM private.api_partner_bitrefill_invoice_bindings WHERE order_id=NEW.order_id;
   SELECT * INTO v_receipt FROM private.api_partner_dispatch_receipts WHERE order_id=NEW.order_id;
   IF v_bound IS NOT NULL AND NEW.fulfillment_source='bitrefill' AND NEW.fulfillment_id=v_bound
   AND v_receipt.order_id IS NOT NULL AND v_receipt.outcome='accepted' AND v_receipt.fulfillment_source='bitrefill'
   AND v_receipt.fulfillment_id=v_bound AND v_receipt.outcome_status IS NOT DISTINCT FROM NEW.outcome_status
   AND v_receipt.reason_code IS NOT DISTINCT FROM NEW.reason_code AND v_receipt.public_payload IS NOT DISTINCT FROM NEW.public_payload
   AND v_receipt.partner_id=NEW.partner_id AND v_receipt.key_id=NEW.key_id AND v_receipt.request_fingerprint=NEW.request_fingerprint
   AND v_receipt.amount_ngn=NEW.amount_ngn AND v_receipt.funding_type=NEW.funding_type THEN RETURN NEW; END IF;
   SELECT * INTO e FROM private.api_partner_bitrefill_delivery_evidence WHERE order_id=NEW.order_id;
   IF e.order_id IS NOT NULL AND private.bitrefill_delivery_binding_valid(NEW.order_id)
   AND EXISTS(SELECT 1 FROM private.api_partner_bitrefill_delivery_decisions d WHERE d.order_id=NEW.order_id
    AND d.owner_user_id=e.owner_user_id AND d.evidence_proof_hash=e.evidence_proof_hash)
   AND NEW.partner_id=e.partner_id AND NEW.key_id=e.key_id AND NEW.request_fingerprint=e.request_fingerprint
   AND NEW.amount_ngn=e.amount_ngn AND NEW.funding_type=e.funding_type AND NEW.balance_before=e.balance_before AND NEW.balance_after=e.balance_after
   AND NEW.fulfillment_source='bitrefill' AND NEW.fulfillment_id=e.invoice_id AND NEW.outcome_status='completed'
   AND NEW.reason_code IS NULL AND NEW.public_payload=e.public_payload
   AND (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=NEW.order_id AND event_type='capture')=1
   AND EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=NEW.order_id AND event_type='capture'
    AND partner_id=e.partner_id AND amount_ngn=e.amount_ngn AND funding_type=e.funding_type AND balance_before=e.balance_before AND balance_after=e.balance_after)
   AND NOT EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=NEW.order_id AND event_type='release')
   AND (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=NEW.order_id)=1
   AND EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=NEW.order_id AND partner_id=e.partner_id
    AND amount_ngn=e.amount_ngn AND funding_type=e.funding_type AND balance_before=e.balance_before AND balance_after=e.balance_after)
   THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'bitrefill_invoice_receipt_required';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_bound_bitrefill_financial_outcome() FROM PUBLIC,anon,authenticated,service_role;
