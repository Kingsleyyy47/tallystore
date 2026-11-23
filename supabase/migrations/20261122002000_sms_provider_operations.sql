-- Provider controls and delivery telemetry only; customer funds are untouched.
BEGIN;
CREATE TABLE public.sms_provider_controls(
  provider text PRIMARY KEY CHECK(provider IN ('getatext','daisysms_io','daisysms_com','daisysim','herosms','textverify','smsbus')),
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(),changed_by uuid REFERENCES public.profiles(id)
);
INSERT INTO public.sms_provider_controls(provider) VALUES('getatext'),('daisysms_io'),('daisysms_com'),('daisysim'),('herosms'),('textverify'),('smsbus');
CREATE TABLE public.sms_provider_control_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,provider text NOT NULL,enabled boolean NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.sms_provider_delivery_receipts(
  activation_ref text PRIMARY KEY CHECK(length(activation_ref)<=512),provider text NOT NULL REFERENCES public.sms_provider_controls(provider),product_key text NOT NULL CHECK(length(product_key)<=512),
  allocated_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,cancelled_at timestamptz
);
CREATE INDEX sms_provider_receipt_product_time ON public.sms_provider_delivery_receipts(product_key,allocated_at DESC);
CREATE TABLE public.sms_provider_routing_events(
  event_id text PRIMARY KEY CHECK(length(event_id)<=128),provider text NOT NULL REFERENCES public.sms_provider_controls(provider),product_key text NOT NULL CHECK(length(product_key)<=512),
  kind text NOT NULL CHECK(kind IN ('no_stock','declined','unknown')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_provider_routing_product_time ON public.sms_provider_routing_events(product_key,created_at DESC);
ALTER TABLE public.sms_provider_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_provider_control_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_provider_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_provider_routing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_provider_controls,public.sms_provider_control_audit,public.sms_provider_delivery_receipts,public.sms_provider_routing_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_provider_controls,public.sms_provider_control_audit,public.sms_provider_delivery_receipts,public.sms_provider_routing_events TO service_role;

CREATE FUNCTION public.set_sms_provider_enabled(p_provider text,p_enabled boolean,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user<>'postgres' THEN RAISE EXCEPTION 'service_role_required';END IF;
  IF p_enabled IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND (is_admin IS TRUE OR is_staff IS TRUE) AND account_suspended IS DISTINCT FROM true) THEN RAISE EXCEPTION 'staff_access_required';END IF;
  UPDATE public.sms_provider_controls SET enabled=p_enabled,updated_at=now(),changed_by=p_actor WHERE provider=p_provider;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_sms_provider';END IF;
  INSERT INTO public.sms_provider_control_audit(provider,enabled,actor_id) VALUES(p_provider,p_enabled,p_actor);
  RETURN jsonb_build_object('success',true,'provider',p_provider,'enabled',p_enabled);
END $$;

CREATE FUNCTION public.record_sms_provider_delivery(p_provider text,p_product_key text,p_kind text,p_activation_ref text DEFAULT NULL,p_event_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user<>'postgres' THEN RAISE EXCEPTION 'service_role_required';END IF;
  IF p_kind='accepted' THEN
    IF p_activation_ref IS NULL OR split_part(p_activation_ref,':',2) IS DISTINCT FROM p_provider THEN RAISE EXCEPTION 'invalid_provider_receipt';END IF;
    INSERT INTO public.sms_provider_delivery_receipts(activation_ref,provider,product_key) VALUES(p_activation_ref,p_provider,p_product_key) ON CONFLICT DO NOTHING;
  ELSIF p_kind='delivered' THEN
    UPDATE public.sms_provider_delivery_receipts SET delivered_at=now() WHERE activation_ref=p_activation_ref AND provider=p_provider AND delivered_at IS NULL;
  ELSIF p_kind='cancelled' THEN
    UPDATE public.sms_provider_delivery_receipts SET cancelled_at=now() WHERE activation_ref=p_activation_ref AND provider=p_provider AND cancelled_at IS NULL AND delivered_at IS NULL;
  ELSIF p_kind IN ('no_stock','declined','unknown') THEN
    INSERT INTO public.sms_provider_routing_events(event_id,provider,product_key,kind) VALUES(p_event_id,p_provider,p_product_key,p_kind) ON CONFLICT DO NOTHING;
  ELSE RAISE EXCEPTION 'invalid_provider_event';END IF;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.get_sms_provider_routing_state(p_product_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH deliveries AS (
    SELECT provider,product_key,count(*) AS accepted,
      count(*) FILTER(WHERE delivered_at IS NOT NULL) AS delivered,
      count(*) FILTER(WHERE delivered_at IS NULL AND allocated_at<now()-interval '20 minutes' AND (cancelled_at IS NULL OR cancelled_at>allocated_at+interval '2 minutes')) AS failed,
      COALESCE(avg(GREATEST(0,extract(epoch FROM delivered_at-allocated_at)*1000)) FILTER(WHERE delivered_at IS NOT NULL),60000) AS mean_delivery_ms
    FROM public.sms_provider_delivery_receipts WHERE allocated_at>now()-interval '7 days' AND (p_product_key IS NULL OR product_key=p_product_key) GROUP BY provider,product_key
  ),events AS (
    SELECT provider,product_key,count(*) FILTER(WHERE kind='no_stock') AS no_stock,count(*) FILTER(WHERE kind='declined') AS declined,count(*) FILTER(WHERE kind='unknown') AS unknown,
      GREATEST(max(created_at+interval '60 seconds') FILTER(WHERE kind='no_stock'),max(created_at+interval '5 minutes') FILTER(WHERE kind='unknown')) AS circuit_until
    FROM public.sms_provider_routing_events WHERE created_at>now()-interval '7 days' AND (p_product_key IS NULL OR product_key=p_product_key) GROUP BY provider,product_key
  ),metrics AS (
    SELECT COALESCE(d.provider,e.provider) AS provider,COALESCE(d.product_key,e.product_key) AS product_key,COALESCE(d.accepted,0) AS accepted,COALESCE(d.delivered,0) AS delivered,
      COALESCE(d.failed,0) AS failed,COALESCE(d.mean_delivery_ms,60000) AS mean_delivery_ms,COALESCE(e.no_stock,0) AS no_stock,COALESCE(e.declined,0) AS declined,COALESCE(e.unknown,0) AS unknown,e.circuit_until
    FROM deliveries d FULL JOIN events e USING(provider,product_key)
  ) SELECT jsonb_build_object('controls',(SELECT jsonb_object_agg(provider,enabled) FROM public.sms_provider_controls),'metrics',COALESCE((SELECT jsonb_agg(to_jsonb(metrics)) FROM metrics),'[]'::jsonb))
$$;

-- Seed confirmed history only where the supplier is unambiguously pinned.
INSERT INTO public.sms_provider_delivery_receipts(activation_ref,provider,product_key,allocated_at,delivered_at,cancelled_at)
SELECT provider_request_id,split_part(provider_request_id,':',2),service_id,created_at,
  CASE WHEN status='completed' THEN COALESCE(completed_at,updated_at) END,
  CASE WHEN status='cancelled' AND refunded_at IS NOT NULL THEN refunded_at END
FROM public.sms_orders WHERE provider_request_id LIKE 'p1:%' AND service_id IS NOT NULL
AND split_part(provider_request_id,':',2) IN ('getatext','daisysms_io','daisysms_com','daisysim','herosms','textverify','smsbus')
ON CONFLICT DO NOTHING;

REVOKE ALL ON FUNCTION public.set_sms_provider_enabled(text,boolean,uuid),public.record_sms_provider_delivery(text,text,text,text,text),public.get_sms_provider_routing_state(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_sms_provider_enabled(text,boolean,uuid),public.record_sms_provider_delivery(text,text,text,text,text),public.get_sms_provider_routing_state(text) TO service_role;
COMMIT;
