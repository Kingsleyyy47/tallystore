-- Future-only callbacks are committed with financial evidence, then claimed
-- once before any HTTP POST. Ambiguous delivery is never automatically retried.
CREATE TABLE private.partner_webhook_start (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 started_at timestamptz NOT NULL
);
INSERT INTO private.partner_webhook_start VALUES(true,clock_timestamp());
CREATE TABLE private.partner_webhook_events (
 event_id uuid PRIMARY KEY,
 partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.api_partner_orders(id) ON DELETE RESTRICT,
 key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
 event_type text NOT NULL CHECK(event_type IN('partner.order.completed','partner.order.refunded')),
 item_type text NOT NULL,
 amount_ngn numeric(18,2) NOT NULL CHECK(amount_ngn>0),
 funding_type text NOT NULL CHECK(funding_type IN('prepaid','unlimited_credit')),
 proof_id uuid NOT NULL,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 order_identity_hash text NOT NULL CHECK(order_identity_hash ~ '^[a-f0-9]{64}$'),
 order_created_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','claimed','delivered','rejected','outcome_unknown')),
 claim_nonce uuid,
 result_code text,
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 finished_at timestamptz,
 UNIQUE(order_id,event_type)
);
CREATE INDEX partner_webhook_events_queued ON private.partner_webhook_events(created_at,event_id) WHERE state='queued';
ALTER TABLE private.partner_webhook_start ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.partner_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.partner_webhook_start,private.partner_webhook_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.partner_webhook_start,private.partner_webhook_events TO service_role;
-- Existing delivery audit remains readable through the owner-only Edge route.
REVOKE ALL ON public.api_partner_webhook_deliveries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.api_partner_webhook_deliveries TO service_role;

CREATE FUNCTION private.guard_partner_webhook_start() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'partner_webhook_start_is_immutable'; END $$;
CREATE TRIGGER partner_webhook_start_immutable BEFORE INSERT OR UPDATE OR DELETE ON private.partner_webhook_start
 FOR EACH ROW EXECUTE FUNCTION private.guard_partner_webhook_start();
CREATE TRIGGER partner_webhook_start_no_truncate BEFORE TRUNCATE ON private.partner_webhook_start
 FOR EACH STATEMENT EXECUTE FUNCTION private.guard_partner_webhook_start();
CREATE FUNCTION private.guard_partner_webhook_event() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'partner_webhook_event_is_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','claim_nonce','result_code','http_status','claimed_at','finished_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claim_nonce','result_code','http_status','claimed_at','finished_at'])
 OR NOT ((OLD.state='queued' AND NEW.state IN('claimed','rejected'))
  OR (OLD.state='claimed' AND NEW.state IN('delivered','rejected','outcome_unknown')))
 OR (OLD.state='claimed' AND (NEW.claim_nonce IS DISTINCT FROM OLD.claim_nonce OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at))
 OR (NEW.state='claimed' AND (NEW.claim_nonce IS NULL OR NEW.claimed_at IS NULL OR NEW.result_code IS NOT NULL OR NEW.finished_at IS NOT NULL))
 OR (NEW.state<>'claimed' AND (NEW.result_code IS NULL OR NEW.finished_at IS NULL))
 THEN RAISE EXCEPTION 'partner_webhook_event_transition_denied'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER partner_webhook_event_guard BEFORE UPDATE OR DELETE ON private.partner_webhook_events
 FOR EACH ROW EXECUTE FUNCTION private.guard_partner_webhook_event();
CREATE TRIGGER partner_webhook_event_no_truncate BEFORE TRUNCATE ON private.partner_webhook_events
 FOR EACH STATEMENT EXECUTE FUNCTION private.guard_partner_webhook_event();

CREATE FUNCTION private.partner_webhook_event_id(p_partner uuid,p_order uuid,p_event text) RETURNS uuid
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE h text;
BEGIN
 h:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('partner-webhook-v2:'||p_partner::text||':'||p_order::text||':'||p_event,'UTF8')),'hex');
 RETURN (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-'||
 substr('89ab',((('x'||substr(h,17,1))::bit(4)::integer)&3)+1,1)||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
END $$;

-- A single exact proof selector is used both at enqueue and immediately before
-- delivery; it cannot expose request bodies, credentials or callback settings.
CREATE FUNCTION private.partner_webhook_candidate(p_order uuid,p_event text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.api_partner_orders%ROWTYPE; j public.api_partner_external_orders%ROWTYPE;
 b public.api_partner_obligations%ROWTYPE; r public.api_partner_external_events%ROWTYPE;
 k uuid; f text; identity_hash text;
BEGIN
 SELECT * INTO o FROM public.api_partner_orders WHERE id=p_order;
 IF NOT FOUND OR o.created_at<(SELECT started_at FROM private.partner_webhook_start WHERE singleton)
 OR o.amount_ngn<=0 OR o.currency IS DISTINCT FROM 'NGN'
 OR o.item_type NOT IN('product','sms','social_boost','bills_airtime','giftcards','telegram_stars') THEN RETURN NULL; END IF;
 SELECT * INTO j FROM public.api_partner_external_orders WHERE order_id=o.id;
 IF FOUND THEN
  IF j.partner_id IS DISTINCT FROM o.partner_id OR j.amount_ngn IS DISTINCT FROM o.amount_ngn
   OR j.section IS DISTINCT FROM o.item_type OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e
    WHERE e.order_id=o.id AND e.partner_id=o.partner_id AND e.event_type='reserve' AND e.amount_ngn=o.amount_ngn
    AND e.funding_type=j.funding_type AND e.balance_before=j.balance_before AND e.balance_after=j.balance_after
    AND ((e.funding_type='prepaid' AND e.balance_before-e.balance_after=e.amount_ngn)
      OR(e.funding_type='unlimited_credit' AND e.balance_before=e.balance_after))) THEN RETURN NULL; END IF;
  k:=j.key_id; f:=j.request_fingerprint;
 ELSE
  IF o.item_type<>'product' OR coalesce(o.request_payload->>'api_key_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  THEN RETURN NULL; END IF;
  k:=(o.request_payload->>'api_key_id')::uuid;
  f:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(o.request_payload::text,'UTF8')),'hex');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=k AND partner_id=o.partner_id) THEN RETURN NULL; END IF;
 identity_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(o.partner_id,o.item_type,o.item_id,
  o.item_name,o.quantity,o.amount_ngn,o.currency,o.partner_reference,o.request_payload,extract(epoch FROM o.created_at))::text,'UTF8')),'hex');
 IF p_event='partner.order.completed' AND o.status='completed' THEN
  SELECT * INTO b FROM public.api_partner_obligations WHERE order_id=o.id AND partner_id=o.partner_id AND amount_ngn=o.amount_ngn;
  IF NOT FOUND OR (j.order_id IS NOT NULL AND (j.state<>'accepted' OR j.outcome_status IS DISTINCT FROM 'completed' OR j.funding_type<>b.funding_type
   OR b.balance_before IS DISTINCT FROM j.balance_before OR b.balance_after IS DISTINCT FROM j.balance_after
   OR o.fulfillment_source IS DISTINCT FROM j.fulfillment_source OR o.fulfillment_id IS DISTINCT FROM j.fulfillment_id
   OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e WHERE e.order_id=o.id AND e.partner_id=o.partner_id
    AND e.event_type='capture' AND e.amount_ngn=o.amount_ngn AND e.funding_type=b.funding_type
    AND e.balance_before=j.balance_before AND e.balance_after=j.balance_after)))
   OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=o.id AND event_type='release')
   OR (j.order_id IS NULL AND NOT ((b.funding_type='prepaid' AND b.balance_before-b.balance_after=b.amount_ngn)
    OR(b.funding_type='unlimited_credit' AND b.balance_before=b.balance_after))) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('partner_id',o.partner_id,'order_id',o.id,'key_id',k,'event_type',p_event,
   'item_type',o.item_type,'amount_ngn',o.amount_ngn,'funding_type',b.funding_type,'proof_id',b.id,
   'request_fingerprint',f,'order_identity_hash',identity_hash,'order_created_at',o.created_at);
 ELSIF p_event='partner.order.refunded' AND o.status='failed' AND o.refunded_at IS NOT NULL
  AND o.refund_amount_ngn=o.amount_ngn AND j.state='rejected' AND j.funding_type='prepaid' THEN
  SELECT * INTO r FROM public.api_partner_external_events WHERE order_id=o.id AND partner_id=o.partner_id AND event_type='release'
   AND amount_ngn=o.amount_ngn AND funding_type='prepaid' AND balance_after-balance_before=amount_ngn;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.api_partner_obligations WHERE order_id=o.id)
   OR EXISTS(SELECT 1 FROM public.api_partner_external_events WHERE order_id=o.id AND event_type='capture') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('partner_id',o.partner_id,'order_id',o.id,'key_id',k,'event_type',p_event,
   'item_type',o.item_type,'amount_ngn',o.amount_ngn,'funding_type',r.funding_type,'proof_id',r.id,
   'request_fingerprint',f,'order_identity_hash',identity_hash,'order_created_at',o.created_at);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION private.enqueue_partner_webhook_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; event text; c jsonb;
BEGIN
 IF TG_TABLE_NAME='api_partner_orders' THEN oid:=NEW.id; ELSE oid:=NEW.order_id; END IF;
 FOREACH event IN ARRAY ARRAY['partner.order.completed','partner.order.refunded'] LOOP
  c:=private.partner_webhook_candidate(oid,event);
  IF c IS NOT NULL THEN
   INSERT INTO private.partner_webhook_events(event_id,partner_id,order_id,key_id,event_type,item_type,amount_ngn,funding_type,proof_id,request_fingerprint,order_identity_hash,order_created_at)
   VALUES(private.partner_webhook_event_id((c->>'partner_id')::uuid,oid,event),(c->>'partner_id')::uuid,oid,(c->>'key_id')::uuid,event,
    c->>'item_type',(c->>'amount_ngn')::numeric,c->>'funding_type',(c->>'proof_id')::uuid,c->>'request_fingerprint',c->>'order_identity_hash',(c->>'order_created_at')::timestamptz)
   ON CONFLICT(order_id,event_type) DO NOTHING;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER partner_webhook_order_event AFTER INSERT OR UPDATE ON public.api_partner_orders FOR EACH ROW EXECUTE FUNCTION private.enqueue_partner_webhook_event();
CREATE TRIGGER partner_webhook_obligation_event AFTER INSERT ON public.api_partner_obligations FOR EACH ROW EXECUTE FUNCTION private.enqueue_partner_webhook_event();
CREATE TRIGGER partner_webhook_financial_event AFTER INSERT ON public.api_partner_external_events FOR EACH ROW EXECUTE FUNCTION private.enqueue_partner_webhook_event();
-- Status polling210 updates the public order before its journal status.
CREATE TRIGGER partner_webhook_journal_event AFTER UPDATE ON public.api_partner_external_orders FOR EACH ROW EXECUTE FUNCTION private.enqueue_partner_webhook_event();

-- Anchor only the exact local-product request object; do not rewrite applied120.
DO $patch$ DECLARE original text; old text:= $old$jsonb_build_object('product_group_id',p_product_group_id,'quantity',p_quantity,
      'expected_amount_ngn',p_expected_amount)$old$;
 new text:=$new$jsonb_build_object('product_group_id',p_product_group_id,'quantity',p_quantity,
      'expected_amount_ngn',p_expected_amount,'api_key_id',p_key_id)$new$;
BEGIN
 original:=pg_get_functiondef('public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)'::regprocedure);
 IF length(original)-length(replace(original,old,''))<>length(old) THEN RAISE EXCEPTION 'partner_webhook_local_binding_patch_boundary'; END IF;
 EXECUTE replace(original,old,new);
END $patch$;

CREATE FUNCTION public.list_queued_api_partner_webhook_events(p_limit integer DEFAULT 20) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>20 THEN RETURN jsonb_build_object('success',false,'code','INVALID_LIMIT'); END IF;
 RETURN jsonb_build_object('success',true,'events',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'event_id',q.event_id,'partner_id',q.partner_id,'order_id',q.order_id,'key_id',q.key_id,'event_type',q.event_type) ORDER BY q.created_at,q.event_id)
  FROM(SELECT * FROM private.partner_webhook_events WHERE state='queued' ORDER BY created_at,event_id LIMIT p_limit)q),'[]'::jsonb));
END $$;

CREATE FUNCTION public.claim_api_partner_webhook_event(p_event_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.partner_webhook_events%ROWTYPE; k public.api_partner_keys%ROWTYPE;
 p public.api_partners%ROWTYPE; o public.api_partner_orders%ROWTYPE; c jsonb; nonce uuid; inserted uuid;
BEGIN
 SELECT * INTO e FROM private.partner_webhook_events WHERE event_id=p_event_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','EVENT_NOT_FOUND'); END IF;
 SELECT * INTO k FROM public.api_partner_keys WHERE id=e.key_id FOR SHARE;
 SELECT * INTO p FROM public.api_partners WHERE id=e.partner_id FOR UPDATE;
 SELECT * INTO o FROM public.api_partner_orders WHERE id=e.order_id FOR UPDATE;
 SELECT * INTO e FROM private.partner_webhook_events WHERE event_id=p_event_id FOR UPDATE;
 IF e.state<>'queued' THEN RETURN jsonb_build_object('success',true,'send_allowed',false,'state',e.state); END IF;
 c:=private.partner_webhook_candidate(e.order_id,e.event_type);
 IF k.id IS NULL OR k.partner_id IS DISTINCT FROM e.partner_id OR k.revoked_at IS NOT NULL
  OR NOT coalesce('orders:read'=ANY(k.scopes),false) OR p.is_active IS DISTINCT FROM true OR p.owner_reviewed_at IS NULL
  OR NOT coalesce((CASE WHEN e.item_type='product' THEN 'products' ELSE e.item_type END)=ANY(p.allowed_sections),false)
  OR c IS DISTINCT FROM jsonb_build_object('partner_id',e.partner_id,'order_id',e.order_id,'key_id',e.key_id,'event_type',e.event_type,
   'item_type',e.item_type,'amount_ngn',e.amount_ngn,'funding_type',e.funding_type,'proof_id',e.proof_id,
   'request_fingerprint',e.request_fingerprint,'order_identity_hash',e.order_identity_hash,'order_created_at',e.order_created_at)
  OR p.webhook_url IS NULL OR length(p.webhook_url) NOT BETWEEN 12 AND 500
  OR p.webhook_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:443)?(/[^[:space:]#]*)?$'
  OR p.webhook_url ~ '[[:cntrl:]]' OR strpos(p.webhook_url,chr(92))>0
  OR split_part(split_part(p.webhook_url,'/',3),':',1) NOT LIKE '%.%'
  OR split_part(split_part(p.webhook_url,'/',3),':',1) ~ '^[0-9.]+$'
  OR split_part(split_part(p.webhook_url,'/',3),':',1) ~* '\.(localhost|local|internal|lan|home|corp|invalid|test)$'
  OR p.webhook_secret IS NULL OR p.webhook_secret !~ '^tly_whsec_[a-f0-9]{64}$' THEN
  UPDATE private.partner_webhook_events SET state='rejected',result_code='WEBHOOK_NOT_AUTHORIZED',finished_at=now() WHERE event_id=e.event_id;
  RETURN jsonb_build_object('success',false,'send_allowed',false,'code','WEBHOOK_NOT_AUTHORIZED');
 END IF;
 INSERT INTO public.api_partner_webhook_deliveries(id,partner_id,order_id,event_type,target_url,payload,status,attempts)
 VALUES(e.event_id,e.partner_id,e.order_id,e.event_type,p.webhook_url,jsonb_build_object('event',e.event_type,'order_id',e.order_id),'pending',1)
 ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN
  UPDATE private.partner_webhook_events SET state='rejected',result_code='WEBHOOK_ALREADY_CLAIMED',finished_at=now() WHERE event_id=e.event_id;
  RETURN jsonb_build_object('success',true,'send_allowed',false,'code','WEBHOOK_ALREADY_CLAIMED');
 END IF;
 nonce:=gen_random_uuid();
 UPDATE private.partner_webhook_events SET state='claimed',claim_nonce=nonce,claimed_at=now() WHERE event_id=e.event_id;
 RETURN jsonb_build_object('success',true,'send_allowed',true,'event_id',e.event_id,'event_type',e.event_type,'claim_nonce',nonce,
  'partner',jsonb_build_object('id',p.id,'is_active',p.is_active,'owner_reviewed_at',p.owner_reviewed_at,'webhook_url',p.webhook_url,'webhook_secret',p.webhook_secret),
  'order',jsonb_build_object('id',o.id,'partner_id',o.partner_id,'partner_reference',o.partner_reference,'status',o.status,
   'item_type',o.item_type,'amount_ngn',o.amount_ngn,'currency',o.currency),'key_scopes',k.scopes);
END $$;

CREATE FUNCTION public.finish_api_partner_webhook_event(p_event_id uuid,p_claim_nonce uuid,p_outcome text,p_code text,p_http_status integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.partner_webhook_events%ROWTYPE;
BEGIN
 IF p_outcome IS NULL OR p_code IS NULL OR p_outcome NOT IN('delivered','rejected','outcome_unknown')
  OR p_code NOT IN('WEBHOOK_DELIVERED','WEBHOOK_NOT_AUTHORIZED','WEBHOOK_SECRET_MISSING','PINNED_EGRESS_REQUIRED','WEBHOOK_DNS_UNSAFE',
   'WEBHOOK_REDIRECT_REFUSED','WEBHOOK_RESPONSE_TOO_LARGE','WEBHOOK_HTTP_FAILURE','WEBHOOK_TRANSPORT_UNAVAILABLE')
  OR (p_outcome='delivered' AND (p_code<>'WEBHOOK_DELIVERED' OR p_http_status IS NULL OR p_http_status NOT BETWEEN 200 AND 299))
  OR (p_outcome<>'delivered' AND p_code='WEBHOOK_DELIVERED') OR (p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599)
 THEN RETURN jsonb_build_object('success',false,'code','INVALID_OUTCOME'); END IF;
 SELECT * INTO e FROM private.partner_webhook_events WHERE event_id=p_event_id FOR UPDATE;
 IF NOT FOUND OR p_claim_nonce IS NULL OR e.claim_nonce IS DISTINCT FROM p_claim_nonce THEN RETURN jsonb_build_object('success',false,'code','INVALID_CLAIM'); END IF;
 IF e.state IN('delivered','rejected','outcome_unknown') THEN
  IF e.state IS DISTINCT FROM p_outcome OR e.result_code IS DISTINCT FROM p_code OR e.http_status IS DISTINCT FROM p_http_status
   THEN RETURN jsonb_build_object('success',false,'code','OUTCOME_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'idempotent_replay',true,'state',e.state);
 END IF;
 IF e.state<>'claimed' THEN RETURN jsonb_build_object('success',false,'code','INVALID_CLAIM'); END IF;
 UPDATE public.api_partner_webhook_deliveries SET status=CASE WHEN p_outcome='delivered' THEN 'delivered' ELSE 'failed' END,
  status_code=p_http_status,response_body=NULL,error_message=CASE WHEN p_outcome='delivered' THEN NULL ELSE p_code END,
  delivered_at=CASE WHEN p_outcome='delivered' THEN now() ELSE NULL END,updated_at=now() WHERE id=e.event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'partner_webhook_delivery_claim_missing'; END IF;
 UPDATE private.partner_webhook_events SET state=p_outcome,result_code=p_code,http_status=p_http_status,finished_at=now() WHERE event_id=e.event_id;
 RETURN jsonb_build_object('success',true,'idempotent_replay',false,'state',p_outcome);
END $$;

REVOKE ALL ON FUNCTION private.guard_partner_webhook_start(),private.guard_partner_webhook_event(),private.partner_webhook_event_id(uuid,uuid,text),
 private.partner_webhook_candidate(uuid,text),private.enqueue_partner_webhook_event() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_queued_api_partner_webhook_events(integer),public.claim_api_partner_webhook_event(uuid),
 public.finish_api_partner_webhook_event(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_queued_api_partner_webhook_events(integer),public.claim_api_partner_webhook_event(uuid),
 public.finish_api_partner_webhook_event(uuid,uuid,text,text,integer) TO service_role;
