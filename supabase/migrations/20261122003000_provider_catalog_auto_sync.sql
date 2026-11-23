BEGIN;
CREATE TABLE public.provider_catalog_sync_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,status text NOT NULL DEFAULT 'running',stats jsonb NOT NULL DEFAULT '{}');
CREATE TABLE private.provider_catalog_sync_lease(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),run_id uuid,until_at timestamptz NOT NULL DEFAULT '-infinity');
INSERT INTO private.provider_catalog_sync_lease(singleton) VALUES(true);
ALTER TABLE public.provider_catalog_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_catalog_sync_runs,private.provider_catalog_sync_lease FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.provider_catalog_sync_runs TO service_role;
CREATE FUNCTION public.claim_provider_catalog_sync() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid:=gen_random_uuid();
BEGIN
  UPDATE private.provider_catalog_sync_lease SET run_id=id,until_at=now()+interval '10 minutes' WHERE singleton AND until_at<now();
  IF NOT FOUND THEN RETURN NULL;END IF;
  INSERT INTO public.provider_catalog_sync_runs(id) VALUES(id);RETURN id;
END $$;
CREATE FUNCTION public.finish_provider_catalog_sync(p_id uuid,p_status text,p_stats jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_status NOT IN ('success','partial','failed') THEN RAISE EXCEPTION 'invalid_sync_status';END IF;
  UPDATE public.provider_catalog_sync_runs SET status=p_status,stats=p_stats,finished_at=now() WHERE id=p_id AND status='running';
  UPDATE private.provider_catalog_sync_lease SET until_at='-infinity' WHERE run_id=p_id;
  DELETE FROM public.sms_provider_routing_events WHERE created_at<now()-interval '14 days';
  DELETE FROM public.sms_provider_delivery_receipts WHERE allocated_at<now()-interval '14 days';
  DELETE FROM public.provider_catalog_sync_runs WHERE finished_at<now()-interval '30 days';
END $$;
CREATE FUNCTION public.get_smm_catalog_sync_keys() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_key',product_key,'match_key',match_key)),'[]'::jsonb) FROM public.supplier_product_routes WHERE family='smm'
$$;
CREATE FUNCTION public.upsert_smm_provider_catalog_batch(p_routes jsonb,p_services jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE services_changed integer;routes_changed integer;
BEGIN
  IF jsonb_typeof(p_routes) IS DISTINCT FROM 'array' OR jsonb_typeof(p_services) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_services)>1000 OR jsonb_array_length(p_services)<>jsonb_array_length(p_routes) THEN RAISE EXCEPTION 'invalid_catalog_batch';END IF;
  INSERT INTO public.supplier_product_routes AS old(family,product_key,match_key,routes,synced_at)
  SELECT 'smm',r->>'product_key',r->>'match_key',r->'routes',(r->>'synced_at')::timestamptz FROM jsonb_array_elements(p_routes) r
  ON CONFLICT(family,product_key) DO UPDATE SET match_key=excluded.match_key,routes=excluded.routes,synced_at=excluded.synced_at
  WHERE old.match_key IS DISTINCT FROM excluded.match_key OR old.routes IS DISTINCT FROM excluded.routes;
  GET DIAGNOSTICS routes_changed=ROW_COUNT;
  INSERT INTO public.smm_services AS old(external_id,name,category,platform,service_type,rate_usd,price_ngn,min_quantity,max_quantity,has_refill,has_cancel,supplier_routing,last_synced_at,is_active)
  SELECT (r->>'external_id')::integer,r->>'name',r->>'category',r->>'platform',r->>'service_type',(r->>'rate_usd')::numeric,(r->>'price_ngn')::numeric,
    (r->>'min_quantity')::integer,(r->>'max_quantity')::integer,COALESCE((r->>'has_refill')::boolean,false),COALESCE((r->>'has_cancel')::boolean,false),true,(r->>'last_synced_at')::timestamptz,false
  FROM jsonb_array_elements(p_services) r
  ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,category=excluded.category,platform=excluded.platform,service_type=excluded.service_type,
    rate_usd=excluded.rate_usd,price_ngn=excluded.price_ngn,min_quantity=excluded.min_quantity,max_quantity=excluded.max_quantity,has_refill=excluded.has_refill,
    has_cancel=excluded.has_cancel,supplier_routing=true,last_synced_at=excluded.last_synced_at
  WHERE (old.name,old.category,old.platform,old.service_type,old.rate_usd,old.price_ngn,old.min_quantity,old.max_quantity,old.has_refill,old.has_cancel,old.supplier_routing)
    IS DISTINCT FROM (excluded.name,excluded.category,excluded.platform,excluded.service_type,excluded.rate_usd,excluded.price_ngn,excluded.min_quantity,excluded.max_quantity,excluded.has_refill,excluded.has_cancel,true);
  GET DIAGNOSTICS services_changed=ROW_COUNT;
  RETURN jsonb_build_object('success',true,'services_changed',services_changed,'routes_changed',routes_changed);
END $$;
REVOKE ALL ON FUNCTION public.claim_provider_catalog_sync(),public.finish_provider_catalog_sync(uuid,text,jsonb),public.get_smm_catalog_sync_keys(),public.upsert_smm_provider_catalog_batch(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_provider_catalog_sync(),public.finish_provider_catalog_sync(uuid,text,jsonb),public.get_smm_catalog_sync_keys(),public.upsert_smm_provider_catalog_batch(jsonb,jsonb) TO service_role;
COMMIT;
