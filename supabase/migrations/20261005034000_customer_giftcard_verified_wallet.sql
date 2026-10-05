-- Unlaunched database foundation only; provider pricing units are not assumed
-- verified, and no launch flag or legacy gift-card route is enabled here.
-- Quotes, holds, invoice claims and delivery proof remain server-owned.
CREATE TABLE public.customer_giftcard_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 product_id text NOT NULL, product_name text NOT NULL,
 package_id text, unit_value numeric NOT NULL, currency text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 amount_ngn numeric(18,2) NOT NULL CHECK(amount_ngn>0),
 status text NOT NULL CHECK(status IN ('pending','processing','completed','failed','review_required')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
ALTER TABLE public.customer_giftcard_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_giftcard_orders FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.customer_giftcard_orders TO authenticated,service_role;
CREATE POLICY customer_giftcard_own_read ON public.customer_giftcard_orders FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE INDEX customer_giftcard_user_history ON public.customer_giftcard_orders(user_id,created_at DESC,id);
CREATE TABLE private.customer_giftcard_dispatch (
 order_id uuid PRIMARY KEY REFERENCES public.customer_giftcard_orders(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,
 request_payload jsonb NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 quote jsonb NOT NULL, quote_hash text NOT NULL CHECK(quote_hash ~ '^[a-f0-9]{64}$'),
 reservation_id uuid NOT NULL UNIQUE REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT,
 financial_security_version integer NOT NULL CHECK(financial_security_version>0),
 state text NOT NULL CHECK(state IN ('prepared','creating','bound','paying','unknown','completed','rejected')),
 invoice_id text UNIQUE, creation_claimed_at timestamptz, payment_claimed_at timestamptz,
 delivery_evidence jsonb, evidence_proof_hash text,
 capture_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
 rejection_reason text, settled_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
ALTER TABLE private.customer_giftcard_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_giftcard_dispatch FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.customer_giftcard_dispatch TO service_role;
CREATE FUNCTION private.guard_customer_giftcard_binding() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'customer_giftcard_binding_immutable'; END IF;
 IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
 OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
 OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.quote IS DISTINCT FROM OLD.quote
 OR NEW.quote_hash IS DISTINCT FROM OLD.quote_hash OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
 OR NEW.financial_security_version IS DISTINCT FROM OLD.financial_security_version
 OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id)
 OR (OLD.creation_claimed_at IS NOT NULL AND NEW.creation_claimed_at IS DISTINCT FROM OLD.creation_claimed_at)
 OR (OLD.payment_claimed_at IS NOT NULL AND NEW.payment_claimed_at IS DISTINCT FROM OLD.payment_claimed_at)
 OR (OLD.delivery_evidence IS NOT NULL AND NEW.delivery_evidence IS DISTINCT FROM OLD.delivery_evidence)
 OR (OLD.evidence_proof_hash IS NOT NULL AND NEW.evidence_proof_hash IS DISTINCT FROM OLD.evidence_proof_hash)
 OR (OLD.capture_transaction_id IS NOT NULL AND NEW.capture_transaction_id IS DISTINCT FROM OLD.capture_transaction_id)
 OR (OLD.state IN ('completed','rejected') AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'customer_giftcard_binding_immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER customer_giftcard_binding_immutable BEFORE UPDATE OR DELETE ON private.customer_giftcard_dispatch FOR EACH ROW EXECUTE FUNCTION private.guard_customer_giftcard_binding();
CREATE TRIGGER customer_giftcard_binding_no_truncate BEFORE TRUNCATE ON private.customer_giftcard_dispatch FOR EACH STATEMENT EXECUTE FUNCTION private.guard_customer_giftcard_binding();

CREATE FUNCTION private.customer_giftcard_text_valid(v jsonb,maximum integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_typeof(v)='string' AND nullif(btrim(v#>>'{}'),'') IS NOT NULL AND length(v#>>'{}')<=maximum AND (v#>>'{}') !~ '[[:cntrl:]]';
$$;
CREATE FUNCTION private.customer_giftcard_request_valid(q jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object' OR octet_length(q::text)>2048 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(q))<>5 OR EXISTS(SELECT 1 FROM jsonb_object_keys(q) k WHERE k NOT IN
 ('product_id','package_id','unit_value','quantity','expected_amount_ngn')) THEN RETURN false; END IF;
 IF private.customer_giftcard_text_valid(q->'product_id',180) IS DISTINCT FROM true
 OR q->>'product_id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$'
 OR jsonb_typeof(q->'package_id') NOT IN ('null','string')
 OR (jsonb_typeof(q->'package_id')='string' AND (
 private.customer_giftcard_text_valid(q->'package_id',180) IS DISTINCT FROM true
 OR q->>'package_id' !~ '^[ -~]+$' OR strpos(q->>'package_id','"')>0
 OR strpos(q->>'package_id',chr(39))>0 OR strpos(q->>'package_id',chr(92))>0))
 OR jsonb_typeof(q->'unit_value') IS DISTINCT FROM 'number' OR jsonb_typeof(q->'quantity') IS DISTINCT FROM 'number'
 OR jsonb_typeof(q->'expected_amount_ngn') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (q->>'unit_value')::numeric>0 AND (q->>'unit_value')::numeric<=1000000000
 AND (q->>'unit_value')::numeric=round((q->>'unit_value')::numeric,2)
 AND (q->>'quantity')::numeric BETWEEN 1 AND 20 AND (q->>'quantity')::numeric=trunc((q->>'quantity')::numeric)
 AND (q->>'expected_amount_ngn')::numeric>0 AND (q->>'expected_amount_ngn')::numeric<=1000000000
 AND mod((q->>'expected_amount_ngn')::numeric,10)=0;
END;
$$;
CREATE FUNCTION private.customer_giftcard_quote_valid(q jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF private.customer_giftcard_request_valid(r) IS DISTINCT FROM true OR q IS NULL
 OR jsonb_typeof(q)<>'object' OR octet_length(q::text)>4096 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(q))<>9 OR EXISTS(SELECT 1 FROM jsonb_object_keys(q) k WHERE k NOT IN
 ('product_id','product_name','package_id','unit_value','currency','quantity','amount_ngn','provider_price','billing_currency')) THEN RETURN false; END IF;
 IF q->'product_id' IS DISTINCT FROM r->'product_id' OR q->'package_id' IS DISTINCT FROM r->'package_id'
 OR q->'unit_value' IS DISTINCT FROM r->'unit_value' OR q->'quantity' IS DISTINCT FROM r->'quantity'
 OR q->'amount_ngn' IS DISTINCT FROM r->'expected_amount_ngn'
 OR private.customer_giftcard_text_valid(q->'product_name',120) IS DISTINCT FROM true
 OR jsonb_typeof(q->'currency') IS DISTINCT FROM 'string' OR q->>'currency' !~ '^[A-Z]{3}$'
 OR jsonb_typeof(q->'billing_currency') IS DISTINCT FROM 'string' OR q->>'billing_currency' NOT IN ('USD','NGN','BTC')
 OR jsonb_typeof(q->'provider_price') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (q->>'provider_price')::numeric>0 AND (q->>'provider_price')::numeric<=1000000000
 AND (q->>'billing_currency'<>'BTC' OR (q->>'provider_price')::numeric=trunc((q->>'provider_price')::numeric));
END;
$$;
CREATE FUNCTION private.customer_giftcard_hold_valid(j private.customer_giftcard_dispatch) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.customer_giftcard_quote_valid(j.quote,j.request_payload)
 AND j.request_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(j.request_payload::text,'UTF8')),'hex')
 AND j.quote_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(j.quote::text,'UTF8')),'hex')
 AND EXISTS(SELECT 1 FROM public.wallet_reservations r WHERE r.id=j.reservation_id AND r.user_id=j.user_id
 AND r.order_table='customer_giftcard_orders' AND r.order_id=j.order_id AND r.currency='NGN'
 AND r.amount=(j.quote->>'amount_ngn')::numeric AND r.financial_security_version=j.financial_security_version
 AND r.metadata->>'giftcard_quote_hash'=j.quote_hash AND r.metadata->>'giftcard_request_hash'=j.request_hash AND r.expires_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.customer_giftcard_orders o WHERE o.id=j.order_id AND o.user_id=j.user_id
 AND to_jsonb(o.product_id)=j.quote->'product_id' AND to_jsonb(o.product_name)=j.quote->'product_name'
 AND coalesce(to_jsonb(o.package_id),'null'::jsonb)=j.quote->'package_id' AND to_jsonb(o.unit_value)=j.quote->'unit_value'
 AND to_jsonb(o.currency)=j.quote->'currency' AND to_jsonb(o.quantity)=j.quote->'quantity' AND to_jsonb(o.amount_ngn)=j.quote->'amount_ngn');
$$;
-- All mutations lock profile -> dispatch -> reservation, with no network work
-- in the transaction. Creation and payment claims commit before each POST.
CREATE FUNCTION private.lock_customer_giftcard_order(p_user_id uuid,p_order_id uuid) RETURNS private.customer_giftcard_dispatch LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 SELECT * INTO j FROM private.customer_giftcard_dispatch WHERE order_id=p_order_id AND user_id=p_user_id FOR UPDATE;
 RETURN j;
END;
$$;
CREATE FUNCTION public.get_customer_giftcard_replay(p_user_id uuid,p_idempotency_key text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch;
BEGIN
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR private.customer_giftcard_request_valid(p_request) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST'); END IF;
 SELECT * INTO j FROM private.customer_giftcard_dispatch WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'existing',false); END IF;
 IF j.request_payload IS DISTINCT FROM p_request THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_REQUEST_CONFLICT'); END IF;
 IF private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','BINDING_REQUIRES_REVIEW'); END IF;
 RETURN jsonb_build_object('success',true,'existing',true,'order_id',j.order_id,'state',j.state,'idempotent_replay',true);
END;
$$;
CREATE FUNCTION public.authorize_customer_giftcard_purchase(p_user_id uuid,p_idempotency_key text,p_request jsonb,p_quote jsonb,p_expected_amount_ngn numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; j private.customer_giftcard_dispatch; r jsonb; oid uuid; qhash text; rhash text;
BEGIN
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR private.customer_giftcard_request_valid(p_request) IS DISTINCT FROM true OR p_expected_amount_ngn IS NULL
 OR to_jsonb(p_expected_amount_ngn) IS DISTINCT FROM p_request->'expected_amount_ngn' THEN RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PROFILE_NOT_FOUND'); END IF;
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_ONLY'); END IF;
 IF p.account_suspended IS TRUE THEN RETURN jsonb_build_object('success',false,'code','WALLET_NOT_ACTIVE'); END IF;
 SELECT * INTO j FROM private.customer_giftcard_dispatch WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF j.request_payload IS DISTINCT FROM p_request THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_REQUEST_CONFLICT'); END IF;
  IF private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','BINDING_REQUIRES_REVIEW'); END IF;
  RETURN jsonb_build_object('success',true,'order_id',j.order_id,'reservation_id',j.reservation_id,'state',j.state,'idempotent_replay',true);
 END IF;
 IF private.customer_giftcard_quote_valid(p_quote,p_request) IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','INVALID_QUOTE'); END IF;
 oid:=gen_random_uuid(); qhash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_quote::text,'UTF8')),'hex');
 rhash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_request::text,'UTF8')),'hex');
 r:=public.create_wallet_reservation(p_user_id,p_expected_amount_ngn,'customer_giftcard_orders',oid,
 'giftcard:hold:'||p_user_id::text||':'||p_idempotency_key,jsonb_build_object('giftcard_quote_hash',qhash,'giftcard_request_hash',rhash),
 'NGN',p.financial_security_version,NULL);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('success',false,'code',coalesce(r->>'code','WALLET_AUTHORIZATION_FAILED')); END IF;
 INSERT INTO public.customer_giftcard_orders(id,user_id,product_id,product_name,package_id,unit_value,currency,quantity,amount_ngn,status)
 VALUES(oid,p_user_id,p_quote->>'product_id',p_quote->>'product_name',p_quote->>'package_id',(p_quote->>'unit_value')::numeric,
 p_quote->>'currency',(p_quote->>'quantity')::integer,p_expected_amount_ngn,'pending');
 INSERT INTO private.customer_giftcard_dispatch(order_id,user_id,idempotency_key,request_payload,request_hash,quote,quote_hash,reservation_id,financial_security_version,state)
 VALUES(oid,p_user_id,p_idempotency_key,p_request,rhash,p_quote,qhash,(r->>'reservation_id')::uuid,p.financial_security_version,'prepared');
 RETURN jsonb_build_object('success',true,'order_id',oid,'reservation_id',(r->>'reservation_id')::uuid,'state','prepared','idempotent_replay',false);
END;
$$;


CREATE FUNCTION public.claim_customer_giftcard_dispatch(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch; p public.profiles%ROWTYPE; truth jsonb;
BEGIN
 j:=private.lock_customer_giftcard_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF j.state<>'prepared' THEN RETURN jsonb_build_object('success',true,'send_allowed',false,'state',j.state); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id;
 truth:=public.wallet_financial_truth_internal(p_user_id);
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE OR p.account_suspended IS TRUE
 OR p.financial_security_version IS DISTINCT FROM j.financial_security_version
 OR coalesce((truth->>'spending_blocked')::boolean,true) OR NOT private.customer_giftcard_hold_valid(j)
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN
 RETURN jsonb_build_object('success',false,'code','WALLET_AUTHORIZATION_STALE','send_allowed',false); END IF;
 UPDATE private.customer_giftcard_dispatch SET state='creating',creation_claimed_at=clock_timestamp() WHERE order_id=p_order_id;
 UPDATE public.customer_giftcard_orders SET status='processing' WHERE id=p_order_id;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','creating','send_allowed',true);
END;
$$;

CREATE FUNCTION public.bind_customer_giftcard_invoice(p_user_id uuid,p_order_id uuid,p_invoice_id text,p_quote jsonb,p_provider_status text DEFAULT 'unpaid')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch;
BEGIN
 j:=private.lock_customer_giftcard_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF p_invoice_id IS NULL OR p_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' OR p_provider_status IS DISTINCT FROM 'unpaid'
 OR p_quote IS DISTINCT FROM j.quote OR NOT private.customer_giftcard_hold_valid(j) THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_MISMATCH'); END IF;
 IF j.invoice_id IS NOT NULL THEN
  IF j.invoice_id IS DISTINCT FROM p_invoice_id THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',true,'state',j.state);
 END IF;
 IF j.state<>'creating' OR j.creation_claimed_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_ELIGIBLE'); END IF;
 UPDATE private.customer_giftcard_dispatch SET invoice_id=p_invoice_id,state='bound' WHERE order_id=p_order_id;
 RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',false,'state','bound');
END;
$$;

CREATE FUNCTION public.claim_customer_giftcard_payment(p_user_id uuid,p_order_id uuid,p_invoice_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch; p public.profiles%ROWTYPE; truth jsonb;
BEGIN
 j:=private.lock_customer_giftcard_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND','pay_allowed',false); END IF;
 IF j.invoice_id IS NULL OR j.invoice_id IS DISTINCT FROM p_invoice_id THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_MISMATCH','pay_allowed',false); END IF;
 IF j.state<>'bound' OR j.payment_claimed_at IS NOT NULL THEN RETURN jsonb_build_object('success',true,'state',j.state,'pay_allowed',false); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id;
 truth:=public.wallet_financial_truth_internal(p_user_id);
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE OR p.account_suspended IS TRUE
 OR p.financial_security_version IS DISTINCT FROM j.financial_security_version
 OR coalesce((truth->>'spending_blocked')::boolean,true) OR NOT private.customer_giftcard_hold_valid(j)
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN
 RETURN jsonb_build_object('success',false,'code','WALLET_AUTHORIZATION_STALE','pay_allowed',false); END IF;
 UPDATE private.customer_giftcard_dispatch SET state='paying',payment_claimed_at=clock_timestamp() WHERE order_id=p_order_id;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','paying','pay_allowed',true);
END;
$$;

CREATE FUNCTION private.customer_giftcard_evidence_valid(j private.customer_giftcard_dispatch,e jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE unit jsonb; field text; ids text[]:=ARRAY[]::text[]; link text;
BEGIN
 IF e IS NULL OR jsonb_typeof(e)<>'object' OR octet_length(e::text)>65536 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(e))<>8 OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN
 ('invoice_id','item_id','package_id','unit_value','currency','quantity','provider_status','redemptions')) THEN RETURN false; END IF;
 IF j.invoice_id IS NULL OR e->'invoice_id' IS DISTINCT FROM to_jsonb(j.invoice_id)
 OR e->'item_id' IS DISTINCT FROM j.quote->'product_id' OR e->'package_id' IS DISTINCT FROM j.quote->'package_id'
 OR e->'unit_value' IS DISTINCT FROM j.quote->'unit_value' OR e->'currency' IS DISTINCT FROM j.quote->'currency'
 OR e->'quantity' IS DISTINCT FROM j.quote->'quantity' OR e->>'provider_status' IS DISTINCT FROM 'complete'
 OR jsonb_typeof(e->'redemptions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(e->'redemptions')<>(j.quote->>'quantity')::integer THEN RETURN false; END IF;
 FOR unit IN SELECT value FROM jsonb_array_elements(e->'redemptions') LOOP
  IF jsonb_typeof(unit)<>'object' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(unit) k WHERE k NOT IN ('order_id','code','pin','link','instructions','expiration_date'))
  OR jsonb_typeof(unit->'order_id') IS DISTINCT FROM 'string'
  OR unit->>'order_id' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' OR (unit->>'order_id')=ANY(ids) THEN RETURN false; END IF;
  ids:=array_append(ids,unit->>'order_id');
  FOREACH field IN ARRAY ARRAY['code','pin','link','instructions','expiration_date'] LOOP
   IF unit ? field AND private.customer_giftcard_text_valid(unit->field,CASE WHEN field='instructions' THEN 1000 WHEN field='link' THEN 500 ELSE 300 END) IS DISTINCT FROM true THEN RETURN false; END IF;
  END LOOP;
  IF NOT(unit ? 'code') AND NOT(unit ? 'link') THEN RETURN false; END IF;
  IF unit ? 'link' THEN
   link:=unit->>'link';
   -- The authority cannot contain userinfo, controls or a non-HTTPS scheme.
   IF link !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$' THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END;
$$;
CREATE FUNCTION private.customer_giftcard_proof_hash(j private.customer_giftcard_dispatch,e jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('order_id',j.order_id,'user_id',j.user_id,
 'request_hash',j.request_hash,'quote_hash',j.quote_hash,'reservation_id',j.reservation_id,'invoice_id',j.invoice_id,'delivery',e)::text,'UTF8')),'hex');
$$;
CREATE FUNCTION private.customer_giftcard_capture_valid(j private.customer_giftcard_dispatch) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT j.state='completed' AND j.payment_claimed_at IS NOT NULL AND private.customer_giftcard_hold_valid(j)
 AND private.customer_giftcard_evidence_valid(j,j.delivery_evidence)
 AND j.evidence_proof_hash=private.customer_giftcard_proof_hash(j,j.delivery_evidence)
 AND EXISTS(SELECT 1 FROM public.customer_giftcard_orders o WHERE o.id=j.order_id AND o.user_id=j.user_id AND o.status='completed' AND o.completed_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM public.wallet_reservations r JOIN public.transactions t ON t.id=j.capture_transaction_id
 WHERE r.id=j.reservation_id AND r.status='captured' AND r.metadata->>'capture_transaction_id'=t.id::text
 AND t.user_id=j.user_id AND t.type='purchase' AND t.status='completed' AND t.amount=-r.amount
 AND t.balance_type='wallet' AND t.currency='NGN' AND t.idempotency_key='giftcard:capture:'||j.order_id::text
 AND t.metadata->>'wallet_reservation_id'=j.reservation_id::text AND t.metadata->>'source_order_table'='customer_giftcard_orders'
 AND t.metadata->>'source_order_id'=j.order_id::text AND t.metadata->>'giftcard_quote_hash'=j.quote_hash
 AND t.metadata->>'giftcard_request_hash'=j.request_hash AND t.metadata->>'giftcard_evidence_proof_hash'=j.evidence_proof_hash);
$$;
CREATE FUNCTION public.record_customer_giftcard_outcome(p_user_id uuid,p_order_id uuid,p_outcome text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch; r public.wallet_reservations%ROWTYPE; v_capture jsonb; v_hash text; v_release jsonb;
BEGIN
 j:=private.lock_customer_giftcard_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('unknown','completed','rejected') OR p_evidence IS NULL
 OR jsonb_typeof(p_evidence)<>'object' OR octet_length(p_evidence::text)>65536 OR private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_EVIDENCE'); END IF;
 SELECT * INTO r FROM public.wallet_reservations WHERE id=j.reservation_id FOR UPDATE;
 IF p_outcome='unknown' THEN
  IF p_evidence<>'{}'::jsonb OR j.state NOT IN ('creating','bound','paying','unknown') OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','UNKNOWN_NOT_ELIGIBLE'); END IF;
  IF j.state<>'unknown' THEN UPDATE private.customer_giftcard_dispatch SET state='unknown' WHERE order_id=p_order_id;
   UPDATE public.customer_giftcard_orders SET status='review_required' WHERE id=p_order_id; END IF;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','unknown','funds_held',true);
 ELSIF p_outcome='rejected' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>1 OR NOT(p_evidence ? 'reason_code')
  OR jsonb_typeof(p_evidence->'reason_code') IS DISTINCT FROM 'string'
  OR p_evidence->>'reason_code' NOT IN ('NO_STOCK','INSUFFICIENT_BALANCE','PRICE_CHANGED','INVALID_RECIPIENT') THEN RETURN jsonb_build_object('success',false,'code','REJECTION_NOT_CONFIRMED'); END IF;
  IF j.state='rejected' AND j.rejection_reason=p_evidence->>'reason_code' AND r.status='released' THEN
   RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','rejected','idempotent_replay',true); END IF;
  IF j.state NOT IN ('prepared','creating','bound') OR j.payment_claimed_at IS NOT NULL OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','PAID_OUTCOME_REQUIRES_REVIEW'); END IF;
  v_release:=public.release_wallet_reservation(j.reservation_id,p_evidence->>'reason_code','giftcard:release:'||p_order_id::text);
  IF v_release->>'success' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('success',false,'code','RELEASE_FAILED'); END IF;
  UPDATE private.customer_giftcard_dispatch SET state='rejected',rejection_reason=p_evidence->>'reason_code',settled_at=clock_timestamp() WHERE order_id=p_order_id;
  UPDATE public.customer_giftcard_orders SET status='failed' WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','rejected','idempotent_replay',false);
 END IF;
 IF private.customer_giftcard_evidence_valid(j,p_evidence) IS DISTINCT FROM true OR j.payment_claimed_at IS NULL THEN RETURN jsonb_build_object('success',false,'code','DELIVERY_BINDING_MISMATCH'); END IF;
 v_hash:=private.customer_giftcard_proof_hash(j,p_evidence);
 IF j.state='completed' THEN
  IF j.delivery_evidence=p_evidence AND j.evidence_proof_hash=v_hash AND private.customer_giftcard_capture_valid(j) IS TRUE THEN
   RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','completed','idempotent_replay',true); END IF;
  RETURN jsonb_build_object('success',false,'code','COMPLETION_CONFLICT'); END IF;
 IF j.state NOT IN ('paying','unknown') OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','DELIVERY_NOT_ELIGIBLE'); END IF;
 BEGIN
  v_capture:=public.capture_wallet_reservation(j.reservation_id,'GIFTCARD-'||p_order_id::text,'Gift card purchase',
  'giftcard:capture:'||p_order_id::text,jsonb_build_object('source','customer_giftcard','giftcard_request_hash',j.request_hash,
  'giftcard_quote_hash',j.quote_hash,'giftcard_evidence_proof_hash',v_hash),NULL);
  IF v_capture->>'success' IS DISTINCT FROM 'true' OR v_capture#>>'{transaction,id}' IS NULL THEN RAISE EXCEPTION 'giftcard_capture_failed'; END IF;
  UPDATE private.customer_giftcard_dispatch SET state='completed',delivery_evidence=p_evidence,evidence_proof_hash=v_hash,
   capture_transaction_id=(v_capture#>>'{transaction,id}')::uuid,settled_at=clock_timestamp() WHERE order_id=p_order_id;
  UPDATE public.customer_giftcard_orders SET status='completed',completed_at=clock_timestamp() WHERE id=p_order_id;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','CAPTURE_REQUIRES_REVIEW','funds_held',true); END;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','completed','idempotent_replay',false);
END;
$$;
CREATE FUNCTION public.get_customer_giftcard_reconciliation(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('success',true,'order_id',j.order_id,'quote',j.quote,'invoice_id',j.invoice_id,
 'state',j.state,'payment_claimed',j.payment_claimed_at IS NOT NULL) FROM private.customer_giftcard_dispatch j
 WHERE j.order_id=p_order_id AND j.user_id=p_user_id),jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'));
$$;
CREATE FUNCTION public.get_customer_giftcard_order(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('success',true,'order',to_jsonb(o),'state',j.state)
 || CASE WHEN private.customer_giftcard_capture_valid(j) IS TRUE THEN jsonb_build_object('redemptions',j.delivery_evidence->'redemptions') ELSE '{}'::jsonb END
 FROM public.customer_giftcard_orders o JOIN private.customer_giftcard_dispatch j ON j.order_id=o.id
 WHERE o.id=p_order_id AND o.user_id=p_user_id AND j.user_id=p_user_id),jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'));
$$;
CREATE FUNCTION public.get_my_customer_giftcard_order(p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.get_customer_giftcard_order(auth.uid(),p_order_id);
$$;
CREATE FUNCTION public.get_my_customer_giftcard_history() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(row ORDER BY created_at DESC,id),'[]'::jsonb) FROM (
 SELECT public.get_customer_giftcard_order(auth.uid(),o.id) row,o.created_at,o.id FROM public.customer_giftcard_orders o
 WHERE o.user_id=auth.uid() ORDER BY o.created_at DESC,o.id LIMIT 50) history;
$$;

REVOKE ALL ON FUNCTION private.guard_customer_giftcard_binding(),private.customer_giftcard_text_valid(jsonb,integer),
 private.customer_giftcard_request_valid(jsonb),private.customer_giftcard_quote_valid(jsonb,jsonb),private.customer_giftcard_hold_valid(private.customer_giftcard_dispatch),
 private.lock_customer_giftcard_order(uuid,uuid),private.customer_giftcard_evidence_valid(private.customer_giftcard_dispatch,jsonb),
 private.customer_giftcard_proof_hash(private.customer_giftcard_dispatch,jsonb),private.customer_giftcard_capture_valid(private.customer_giftcard_dispatch)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb),public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric),
 public.claim_customer_giftcard_dispatch(uuid,uuid),public.bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text),public.claim_customer_giftcard_payment(uuid,uuid,text),
 public.record_customer_giftcard_outcome(uuid,uuid,text,jsonb),public.get_customer_giftcard_order(uuid,uuid),public.get_customer_giftcard_reconciliation(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb),public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric),
 public.claim_customer_giftcard_dispatch(uuid,uuid),public.bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text),public.claim_customer_giftcard_payment(uuid,uuid,text),
 public.record_customer_giftcard_outcome(uuid,uuid,text,jsonb),public.get_customer_giftcard_order(uuid,uuid),public.get_customer_giftcard_reconciliation(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_my_customer_giftcard_order(uuid),public.get_my_customer_giftcard_history() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_customer_giftcard_order(uuid),public.get_my_customer_giftcard_history() TO authenticated;
