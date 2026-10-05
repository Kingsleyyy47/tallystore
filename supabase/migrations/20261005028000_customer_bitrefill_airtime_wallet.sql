-- Customer international airtime: canonical wallet hold, separate one-use
-- invoice creation/payment claims, bound unpaid invoice, verified delivery.
-- This does not enable any provider route or change legacy gift-card orders.
CREATE TABLE public.customer_airtime_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 product_id text NOT NULL, product_name text NOT NULL,
 operator_id text NOT NULL, operator_name text NOT NULL, country_code text NOT NULL,
 recipient_phone text NOT NULL, unit_value numeric NOT NULL, currency text NOT NULL,
 amount_ngn numeric(18,2) NOT NULL CHECK(amount_ngn>0),
 status text NOT NULL CHECK(status IN ('pending','processing','completed','failed','review_required')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
ALTER TABLE public.customer_airtime_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_airtime_orders FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.customer_airtime_orders TO authenticated,service_role;
CREATE POLICY customer_airtime_own_read ON public.customer_airtime_orders FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE INDEX customer_airtime_user_history ON public.customer_airtime_orders(user_id,created_at DESC,id);
CREATE TABLE private.customer_airtime_dispatch (
 order_id uuid PRIMARY KEY REFERENCES public.customer_airtime_orders(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,
 quote jsonb NOT NULL CHECK(jsonb_typeof(quote)='object'),
 quote_hash text NOT NULL CHECK(quote_hash ~ '^[a-f0-9]{64}$'),
 reservation_id uuid NOT NULL UNIQUE REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT,
 financial_security_version integer NOT NULL CHECK(financial_security_version>0),
 state text NOT NULL CHECK(state IN ('prepared','creating','bound','paying','unknown','completed','rejected')),
 invoice_id text UNIQUE, creation_claimed_at timestamptz, payment_claimed_at timestamptz,
 delivery_evidence jsonb, evidence_proof_hash text,
 capture_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
 rejection_reason text, settled_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
ALTER TABLE private.customer_airtime_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_airtime_dispatch FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.customer_airtime_dispatch TO service_role;
CREATE FUNCTION private.guard_customer_airtime_binding() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'customer_airtime_binding_immutable'; END IF;
 IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
 OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.quote IS DISTINCT FROM OLD.quote
 OR NEW.quote_hash IS DISTINCT FROM OLD.quote_hash OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
 OR NEW.financial_security_version IS DISTINCT FROM OLD.financial_security_version
 OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id)
 OR (OLD.creation_claimed_at IS NOT NULL AND NEW.creation_claimed_at IS DISTINCT FROM OLD.creation_claimed_at)
 OR (OLD.payment_claimed_at IS NOT NULL AND NEW.payment_claimed_at IS DISTINCT FROM OLD.payment_claimed_at)
 OR (OLD.delivery_evidence IS NOT NULL AND NEW.delivery_evidence IS DISTINCT FROM OLD.delivery_evidence)
 OR (OLD.evidence_proof_hash IS NOT NULL AND NEW.evidence_proof_hash IS DISTINCT FROM OLD.evidence_proof_hash)
 OR (OLD.capture_transaction_id IS NOT NULL AND NEW.capture_transaction_id IS DISTINCT FROM OLD.capture_transaction_id)
 OR (OLD.state IN ('completed','rejected') AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'customer_airtime_binding_immutable'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_customer_airtime_binding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_airtime_binding_immutable BEFORE UPDATE OR DELETE ON private.customer_airtime_dispatch FOR EACH ROW EXECUTE FUNCTION private.guard_customer_airtime_binding();
CREATE TRIGGER customer_airtime_binding_no_truncate BEFORE TRUNCATE ON private.customer_airtime_dispatch FOR EACH STATEMENT EXECUTE FUNCTION private.guard_customer_airtime_binding();

CREATE FUNCTION private.customer_airtime_quote_valid(q jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE f text;
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object' OR octet_length(q::text)>4096 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(q))<>10 OR EXISTS(SELECT 1 FROM jsonb_object_keys(q) k WHERE k NOT IN
 ('product_id','product_name','operator_id','operator_name','country_code','recipient_phone','package_id','unit_value','currency','amount_ngn')) THEN RETURN false; END IF;
 FOREACH f IN ARRAY ARRAY['product_id','product_name','operator_id','operator_name','country_code','recipient_phone','currency'] LOOP
  IF jsonb_typeof(q->f) IS DISTINCT FROM 'string' OR nullif(btrim(q->>f),'') IS NULL OR length(q->>f)>200 OR (q->>f) ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 END LOOP;
 IF q->>'product_id' !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$' OR q->>'operator_id' !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$'
 OR q->>'country_code' !~ '^[A-Z]{2}$' OR q->>'recipient_phone' !~ '^\+[1-9][0-9]{7,14}$'
 OR q->>'currency' !~ '^[A-Z]{3}$' OR jsonb_typeof(q->'package_id') NOT IN ('null','string')
 OR (jsonb_typeof(q->'package_id')='string' AND (nullif(btrim(q->>'package_id'),'') IS NULL OR length(q->>'package_id')>200 OR (q->>'package_id') ~ '[[:cntrl:]]'))
 OR jsonb_typeof(q->'unit_value') IS DISTINCT FROM 'number' OR jsonb_typeof(q->'amount_ngn') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (q->>'unit_value')::numeric>0 AND (q->>'unit_value')::numeric<=1000000000
 AND (q->>'amount_ngn')::numeric>0 AND (q->>'amount_ngn')::numeric<=1000000000
 AND (q->>'amount_ngn')::numeric=round((q->>'amount_ngn')::numeric,2);
END;
$$;
REVOKE ALL ON FUNCTION private.customer_airtime_quote_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.customer_airtime_hold_valid(j private.customer_airtime_dispatch) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.wallet_reservations r WHERE r.id=j.reservation_id AND r.user_id=j.user_id
 AND r.order_table='customer_airtime_orders' AND r.order_id=j.order_id AND r.currency='NGN'
 AND r.amount=(j.quote->>'amount_ngn')::numeric AND r.financial_security_version=j.financial_security_version
 AND r.metadata->>'airtime_quote_hash'=j.quote_hash AND r.expires_at IS NULL)
 AND j.quote_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(j.quote::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION private.customer_airtime_hold_valid(private.customer_airtime_dispatch) FROM PUBLIC,anon,authenticated,service_role;
-- Every mutation acquires profile -> order dispatch -> reservation. No waiting
-- provider request is made in a database transaction; claims commit first.
CREATE FUNCTION private.lock_customer_airtime_order(p_user_id uuid,p_order_id uuid) RETURNS private.customer_airtime_dispatch LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_airtime_dispatch;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 SELECT * INTO j FROM private.customer_airtime_dispatch WHERE order_id=p_order_id AND user_id=p_user_id FOR UPDATE;
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_customer_airtime_order(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.authorize_customer_airtime_purchase(p_user_id uuid,p_idempotency_key text,p_quote jsonb,p_expected_amount_ngn numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; j private.customer_airtime_dispatch; r jsonb; oid uuid; qhash text;
BEGIN
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR NOT private.customer_airtime_quote_valid(p_quote) OR p_expected_amount_ngn IS NULL
 OR p_expected_amount_ngn IS DISTINCT FROM (p_quote->>'amount_ngn')::numeric THEN RETURN jsonb_build_object('success',false,'code','INVALID_QUOTE'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PROFILE_NOT_FOUND'); END IF;
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_ONLY'); END IF;
 IF p.account_suspended IS TRUE THEN RETURN jsonb_build_object('success',false,'code','WALLET_NOT_ACTIVE'); END IF;
 SELECT * INTO j FROM private.customer_airtime_dispatch WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF j.quote IS DISTINCT FROM p_quote THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'order_id',j.order_id,'reservation_id',j.reservation_id,'state',j.state,'idempotent_replay',true);
 END IF;
 oid:=gen_random_uuid(); qhash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_quote::text,'UTF8')),'hex');
 r:=public.create_wallet_reservation(p_user_id,(p_quote->>'amount_ngn')::numeric,'customer_airtime_orders',oid,
 'airtime:hold:'||p_user_id::text||':'||p_idempotency_key,jsonb_build_object('airtime_quote_hash',qhash),
 'NGN',p.financial_security_version,NULL);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('success',false,'code',coalesce(r->>'code','WALLET_AUTHORIZATION_FAILED')); END IF;
 INSERT INTO public.customer_airtime_orders(id,user_id,product_id,product_name,operator_id,operator_name,country_code,recipient_phone,unit_value,currency,amount_ngn,status)
 VALUES(oid,p_user_id,p_quote->>'product_id',p_quote->>'product_name',p_quote->>'operator_id',p_quote->>'operator_name',p_quote->>'country_code',p_quote->>'recipient_phone',
 (p_quote->>'unit_value')::numeric,p_quote->>'currency',(p_quote->>'amount_ngn')::numeric,'pending');
 INSERT INTO private.customer_airtime_dispatch(order_id,user_id,idempotency_key,quote,quote_hash,reservation_id,financial_security_version,state)
 VALUES(oid,p_user_id,p_idempotency_key,p_quote,qhash,(r->>'reservation_id')::uuid,p.financial_security_version,'prepared');
 RETURN jsonb_build_object('success',true,'order_id',oid,'reservation_id',(r->>'reservation_id')::uuid,'state','prepared','idempotent_replay',false);
END;
$$;

CREATE FUNCTION public.claim_customer_airtime_dispatch(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_airtime_dispatch; p public.profiles%ROWTYPE; truth jsonb;
BEGIN
 j:=private.lock_customer_airtime_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF j.state<>'prepared' THEN RETURN jsonb_build_object('success',true,'send_allowed',false,'state',j.state); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id;
 truth:=public.wallet_financial_truth_internal(p_user_id);
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE OR p.account_suspended IS TRUE
 OR p.financial_security_version IS DISTINCT FROM j.financial_security_version
 OR coalesce((truth->>'spending_blocked')::boolean,true) OR NOT private.customer_airtime_hold_valid(j)
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN
 RETURN jsonb_build_object('success',false,'code','WALLET_AUTHORIZATION_STALE','send_allowed',false); END IF;
 UPDATE private.customer_airtime_dispatch SET state='creating',creation_claimed_at=clock_timestamp() WHERE order_id=p_order_id;
 UPDATE public.customer_airtime_orders SET status='processing' WHERE id=p_order_id;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','creating','send_allowed',true);
END;
$$;

CREATE FUNCTION public.bind_customer_airtime_invoice(p_user_id uuid,p_order_id uuid,p_invoice_id text,p_quote jsonb,p_provider_status text DEFAULT 'unpaid')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_airtime_dispatch;
BEGIN
 j:=private.lock_customer_airtime_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF p_invoice_id IS NULL OR p_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' OR p_provider_status IS DISTINCT FROM 'unpaid'
 OR p_quote IS DISTINCT FROM j.quote OR NOT private.customer_airtime_hold_valid(j) THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_MISMATCH'); END IF;
 IF j.invoice_id IS NOT NULL THEN
  IF j.invoice_id IS DISTINCT FROM p_invoice_id THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',true,'state',j.state);
 END IF;
 IF j.state<>'creating' OR j.creation_claimed_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_ELIGIBLE'); END IF;
 UPDATE private.customer_airtime_dispatch SET invoice_id=p_invoice_id,state='bound' WHERE order_id=p_order_id;
 RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',false,'state','bound');
END;
$$;

CREATE FUNCTION public.claim_customer_airtime_payment(p_user_id uuid,p_order_id uuid,p_invoice_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_airtime_dispatch; p public.profiles%ROWTYPE; truth jsonb;
BEGIN
 j:=private.lock_customer_airtime_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND','pay_allowed',false); END IF;
 IF j.invoice_id IS NULL OR j.invoice_id IS DISTINCT FROM p_invoice_id THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_MISMATCH','pay_allowed',false); END IF;
 IF j.state<>'bound' OR j.payment_claimed_at IS NOT NULL THEN RETURN jsonb_build_object('success',true,'state',j.state,'pay_allowed',false); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id;
 truth:=public.wallet_financial_truth_internal(p_user_id);
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE OR p.account_suspended IS TRUE
 OR p.financial_security_version IS DISTINCT FROM j.financial_security_version
 OR coalesce((truth->>'spending_blocked')::boolean,true) OR NOT private.customer_airtime_hold_valid(j)
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN
 RETURN jsonb_build_object('success',false,'code','WALLET_AUTHORIZATION_STALE','pay_allowed',false); END IF;
 UPDATE private.customer_airtime_dispatch SET state='paying',payment_claimed_at=clock_timestamp() WHERE order_id=p_order_id;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','paying','pay_allowed',true);
END;
$$;

CREATE FUNCTION public.record_customer_airtime_outcome(p_user_id uuid,p_order_id uuid,p_outcome text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_airtime_dispatch; r public.wallet_reservations%ROWTYPE; v_capture jsonb; v_hash text; v_release jsonb;
BEGIN
 j:=private.lock_customer_airtime_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('unknown','completed','rejected') OR p_evidence IS NULL
 OR jsonb_typeof(p_evidence)<>'object' OR octet_length(p_evidence::text)>4096 OR NOT private.customer_airtime_hold_valid(j) THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_EVIDENCE'); END IF;
 SELECT * INTO r FROM public.wallet_reservations WHERE id=j.reservation_id FOR UPDATE;
 IF p_outcome='unknown' THEN
  IF p_evidence<>'{}'::jsonb OR j.state NOT IN ('creating','paying','unknown') OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','UNKNOWN_NOT_ELIGIBLE'); END IF;
  IF j.state<>'unknown' THEN UPDATE private.customer_airtime_dispatch SET state='unknown' WHERE order_id=p_order_id;
   UPDATE public.customer_airtime_orders SET status='review_required' WHERE id=p_order_id; END IF;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','unknown','funds_held',true);
 ELSIF p_outcome='rejected' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>1 OR NOT(p_evidence ? 'reason_code')
  OR p_evidence->>'reason_code' NOT IN ('NO_STOCK','INSUFFICIENT_BALANCE','PRICE_CHANGED','INVALID_RECIPIENT') THEN RETURN jsonb_build_object('success',false,'code','REJECTION_NOT_CONFIRMED'); END IF;
  IF j.state='rejected' AND j.rejection_reason=p_evidence->>'reason_code' AND r.status='released' THEN
   RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','rejected','idempotent_replay',true); END IF;
  -- Once payment may have been sent, even a timeout or vendor error cannot
  -- release the hold. Refunds require a separate reviewed financial proof.
  IF j.state NOT IN ('prepared','creating','bound') OR j.payment_claimed_at IS NOT NULL OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','PAID_OUTCOME_REQUIRES_REVIEW'); END IF;
  v_release:=public.release_wallet_reservation(j.reservation_id,p_evidence->>'reason_code','airtime:release:'||p_order_id::text);
  IF v_release->>'success' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('success',false,'code','RELEASE_FAILED'); END IF;
  UPDATE private.customer_airtime_dispatch SET state='rejected',rejection_reason=p_evidence->>'reason_code',settled_at=clock_timestamp() WHERE order_id=p_order_id;
  UPDATE public.customer_airtime_orders SET status='failed' WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','rejected','idempotent_replay',false);
 END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>10 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k NOT IN
 ('invoice_id','product_id','operator_id','recipient_phone','package_id','unit_value','currency','quantity','provider_order_id','provider_status'))
 OR p_evidence->'invoice_id' IS DISTINCT FROM to_jsonb(j.invoice_id) OR j.invoice_id IS NULL
 OR p_evidence->'product_id' IS DISTINCT FROM j.quote->'product_id'
 OR p_evidence->'operator_id' IS DISTINCT FROM j.quote->'operator_id'
 OR p_evidence->'recipient_phone' IS DISTINCT FROM j.quote->'recipient_phone'
 OR p_evidence->'package_id' IS DISTINCT FROM j.quote->'package_id'
 OR p_evidence->'unit_value' IS DISTINCT FROM j.quote->'unit_value' OR p_evidence->'currency' IS DISTINCT FROM j.quote->'currency'
 OR p_evidence->'quantity' IS DISTINCT FROM '1'::jsonb OR p_evidence->>'provider_status' IS DISTINCT FROM 'complete'
 OR jsonb_typeof(p_evidence->'provider_order_id') IS DISTINCT FROM 'string'
 OR p_evidence->>'provider_order_id' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' OR j.payment_claimed_at IS NULL THEN
 RETURN jsonb_build_object('success',false,'code','DELIVERY_BINDING_MISMATCH'); END IF;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('order_id',p_order_id,'user_id',p_user_id,
 'quote_hash',j.quote_hash,'reservation_id',j.reservation_id,'invoice_id',j.invoice_id,'delivery',p_evidence)::text,'UTF8')),'hex');
 IF j.state='completed' THEN
  IF j.delivery_evidence=p_evidence AND j.evidence_proof_hash=v_hash AND r.status='captured'
  AND EXISTS(SELECT 1 FROM public.transactions t WHERE t.id=j.capture_transaction_id AND t.user_id=p_user_id
   AND t.type='purchase' AND t.status='completed' AND t.amount=-r.amount AND t.balance_type='wallet' AND t.currency='NGN'
   AND t.idempotency_key='airtime:capture:'||p_order_id::text AND t.metadata->>'wallet_reservation_id'=j.reservation_id::text) THEN
   RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','completed','idempotent_replay',true); END IF;
  RETURN jsonb_build_object('success',false,'code','COMPLETION_CONFLICT'); END IF;
 IF j.state NOT IN ('paying','unknown') OR r.status<>'active' THEN RETURN jsonb_build_object('success',false,'code','DELIVERY_NOT_ELIGIBLE'); END IF;
 -- Capture and delivery proof are atomic. A failed capture retains the hold
 -- and requires review; no automated debit retry or refund is permitted.
 BEGIN
  v_capture:=public.capture_wallet_reservation(j.reservation_id,'AIRTIME-'||p_order_id::text,'International airtime purchase',
  'airtime:capture:'||p_order_id::text,jsonb_build_object('source','customer_airtime','airtime_quote_hash',j.quote_hash,'airtime_evidence_proof_hash',v_hash),NULL);
  IF v_capture->>'success' IS DISTINCT FROM 'true' OR v_capture#>>'{transaction,id}' IS NULL THEN RAISE EXCEPTION 'airtime_capture_failed'; END IF;
  UPDATE private.customer_airtime_dispatch SET state='completed',delivery_evidence=p_evidence,evidence_proof_hash=v_hash,
   capture_transaction_id=(v_capture#>>'{transaction,id}')::uuid,settled_at=clock_timestamp() WHERE order_id=p_order_id;
  UPDATE public.customer_airtime_orders SET status='completed',completed_at=clock_timestamp() WHERE id=p_order_id;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','CAPTURE_REQUIRES_REVIEW','funds_held',true); END;
 RETURN jsonb_build_object('success',true,'order_id',p_order_id,'state','completed','idempotent_replay',false);
END;
$$;

CREATE FUNCTION public.get_customer_airtime_order(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('success',true,'data',to_jsonb(o),'state',j.state)
 FROM public.customer_airtime_orders o JOIN private.customer_airtime_dispatch j ON j.order_id=o.id
 WHERE o.id=p_order_id AND o.user_id=p_user_id),jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'));
$$;
-- Private continuation data for the authenticated customer's Edge handler.
-- HTTP responses must retain the safe public order whitelist, not this quote
-- or provider invoice identifier. This RPC never grants payment authority.
CREATE FUNCTION public.get_customer_airtime_reconciliation(p_user_id uuid,p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('success',true,'order_id',j.order_id,'quote',j.quote,
 'invoice_id',j.invoice_id,'state',j.state,'payment_claimed',j.payment_claimed_at IS NOT NULL)
 FROM private.customer_airtime_dispatch j WHERE j.order_id=p_order_id AND j.user_id=p_user_id),
 jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'));
$$;
REVOKE ALL ON FUNCTION public.authorize_customer_airtime_purchase(uuid,text,jsonb,numeric),public.claim_customer_airtime_dispatch(uuid,uuid),
 public.bind_customer_airtime_invoice(uuid,uuid,text,jsonb,text),public.claim_customer_airtime_payment(uuid,uuid,text),
 public.record_customer_airtime_outcome(uuid,uuid,text,jsonb),public.get_customer_airtime_order(uuid,uuid),public.get_customer_airtime_reconciliation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_customer_airtime_purchase(uuid,text,jsonb,numeric),public.claim_customer_airtime_dispatch(uuid,uuid),
 public.bind_customer_airtime_invoice(uuid,uuid,text,jsonb,text),public.claim_customer_airtime_payment(uuid,uuid,text),
 public.record_customer_airtime_outcome(uuid,uuid,text,jsonb),public.get_customer_airtime_order(uuid,uuid),public.get_customer_airtime_reconciliation(uuid,uuid) TO service_role;
