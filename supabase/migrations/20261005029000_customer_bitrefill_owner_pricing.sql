-- Owner-only airtime, gift-card and SMS pricing. SMS remains on its original
-- margin/manual-price rules until the owner explicitly configures a rule.
CREATE TABLE private.customer_bitrefill_pricing_global (
 kind text PRIMARY KEY CHECK(kind IN ('airtime','gift_card','sms')),
 mode text NOT NULL CHECK(mode IN ('amount','percent')),
 value numeric(18,2) NOT NULL CHECK(value>=0 AND ((mode='amount' AND value<=1000000000) OR (mode='percent' AND value<=1000))),
 owner_configured boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.customer_bitrefill_pricing_overrides (
 selector_hash text PRIMARY KEY CHECK(selector_hash ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('airtime','gift_card','sms')),
 scope text NOT NULL CHECK(scope IN ('product','denomination')),
 product_id text NOT NULL,
 package_id text, unit_value numeric, currency text,
 mode text NOT NULL CHECK(mode IN ('amount','percent')),
 value numeric(18,2) NOT NULL CHECK(value>=0 AND ((mode='amount' AND value<=1000000000) OR (mode='percent' AND value<=1000))),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((scope='product' AND package_id IS NULL AND unit_value IS NULL AND currency IS NULL)
 OR (scope='denomination' AND unit_value>0 AND unit_value<=1000000000 AND currency ~ '^[A-Z]{3}$'))
);
CREATE TABLE private.customer_bitrefill_pricing_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('airtime','gift_card','sms')),
 selector jsonb NOT NULL, old_config jsonb, new_config jsonb,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_bitrefill_pricing_product_lookup ON private.customer_bitrefill_pricing_overrides(kind,product_id,scope);
ALTER TABLE private.customer_bitrefill_pricing_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.customer_bitrefill_pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.customer_bitrefill_pricing_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_bitrefill_pricing_global,private.customer_bitrefill_pricing_overrides,private.customer_bitrefill_pricing_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.customer_bitrefill_pricing_global,private.customer_bitrefill_pricing_overrides,private.customer_bitrefill_pricing_audit TO service_role;
CREATE FUNCTION private.reject_customer_bitrefill_pricing_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'customer_bitrefill_pricing_audit_immutable'; END;
$$;
REVOKE ALL ON FUNCTION private.reject_customer_bitrefill_pricing_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_bitrefill_pricing_audit_immutable BEFORE UPDATE OR DELETE ON private.customer_bitrefill_pricing_audit FOR EACH ROW EXECUTE FUNCTION private.reject_customer_bitrefill_pricing_audit_mutation();
CREATE TRIGGER customer_bitrefill_pricing_audit_no_truncate BEFORE TRUNCATE ON private.customer_bitrefill_pricing_audit FOR EACH STATEMENT EXECUTE FUNCTION private.reject_customer_bitrefill_pricing_audit_mutation();
DO $seed$
DECLARE v_text text; v_value numeric:=0; v_sms_value numeric:=700;
BEGIN
 SELECT btrim(value::text,'" ') INTO v_text FROM public.app_settings WHERE key='bitrefill_markup_pct';
 IF v_text ~ '^[0-9]+(?:\.[0-9]{1,2})?$' AND length(v_text)<=16 THEN
  IF v_text::numeric BETWEEN 0 AND 1000 THEN v_value:=v_text::numeric; END IF;
 END IF;
 INSERT INTO private.customer_bitrefill_pricing_global(kind,mode,value) VALUES('airtime','percent',v_value),('gift_card','percent',v_value);
 SELECT btrim(value::text,'" ') INTO v_text FROM public.app_settings WHERE key='sms_default_margin_ngn';
 IF FOUND AND v_text='' THEN v_sms_value:=0;
 ELSIF v_text ~ '^[0-9]+(?:\.[0-9]+)?$' AND length(v_text)<=32 THEN
  IF v_text::numeric BETWEEN 0 AND 1000000000 THEN v_sms_value:=round(v_text::numeric,0); END IF;
 END IF;
 INSERT INTO private.customer_bitrefill_pricing_global(kind,mode,value,owner_configured) VALUES('sms','amount',v_sms_value,false);
END;
$seed$;

CREATE FUNCTION private.customer_bitrefill_pricing_identity_valid(p_product_id text,p_package_id text,p_unit_value numeric,p_currency text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_product_id IS NOT NULL AND nullif(btrim(p_product_id),'') IS NOT NULL AND length(p_product_id)<=200 AND p_product_id !~ '[[:cntrl:]]'
 AND (p_package_id IS NULL OR (nullif(btrim(p_package_id),'') IS NOT NULL AND length(p_package_id)<=200 AND p_package_id !~ '[[:cntrl:]]'))
 AND p_unit_value IS NOT NULL AND p_unit_value>0 AND p_unit_value<=1000000000 AND p_currency IS NOT NULL AND p_currency ~ '^[A-Z]{3}$';
$$;
REVOKE ALL ON FUNCTION private.customer_bitrefill_pricing_identity_valid(text,text,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_customer_bitrefill_pricing(p_kind text,p_product_id text,p_package_id text,p_unit_value numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_mode text; v_value numeric; v_source text; v_active boolean:=true;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('airtime','gift_card','sms') OR private.customer_bitrefill_pricing_identity_valid(p_product_id,p_package_id,p_unit_value,p_currency) IS DISTINCT FROM true THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_IDENTITY'); END IF;
 SELECT mode,value,scope INTO v_mode,v_value,v_source FROM private.customer_bitrefill_pricing_overrides
 WHERE kind=p_kind AND product_id=p_product_id AND ((scope='denomination' AND package_id IS NOT DISTINCT FROM p_package_id AND unit_value=p_unit_value AND currency=p_currency) OR scope='product')
 ORDER BY CASE WHEN scope='denomination' THEN 0 ELSE 1 END LIMIT 1;
 IF NOT FOUND THEN SELECT mode,value,'global',owner_configured INTO v_mode,v_value,v_source,v_active FROM private.customer_bitrefill_pricing_global WHERE kind=p_kind; END IF;
 IF v_mode IS NULL THEN RETURN jsonb_build_object('success',false,'code','PRICING_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('success',true,'mode',v_mode,'value',v_value,'source',v_source)
  || CASE WHEN p_kind='sms' THEN jsonb_build_object('legacy_pricing',NOT v_active) ELSE '{}'::jsonb END;
END;
$$;

CREATE FUNCTION public.set_customer_bitrefill_pricing(p_owner_user_id uuid,p_kind text,p_scope text,p_product_id text,p_package_id text,p_unit_value numeric,p_currency text,p_mode text,p_value numeric,p_remove boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_selector jsonb; v_hash text; v_old jsonb; v_new jsonb; v_changed boolean;
BEGIN
 IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner_user_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true) THEN
 RETURN jsonb_build_object('success',false,'code','OWNER_DENIED'); END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('airtime','gift_card','sms') OR p_scope IS NULL OR p_scope NOT IN ('global','product','denomination') OR p_remove IS NULL
 OR (p_scope='global' AND (p_product_id IS NOT NULL OR p_package_id IS NOT NULL OR p_unit_value IS NOT NULL OR p_currency IS NOT NULL OR p_remove))
 OR (p_scope='product' AND (p_product_id IS NULL OR nullif(btrim(p_product_id),'') IS NULL OR length(p_product_id)>200 OR p_product_id ~ '[[:cntrl:]]'
  OR p_package_id IS NOT NULL OR p_unit_value IS NOT NULL OR p_currency IS NOT NULL))
 OR (p_scope='denomination' AND private.customer_bitrefill_pricing_identity_valid(p_product_id,p_package_id,p_unit_value,p_currency) IS DISTINCT FROM true)
 OR (NOT p_remove AND (p_mode IS NULL OR p_mode NOT IN ('amount','percent') OR p_value IS NULL OR p_value<0
  OR p_value<>round(p_value,2) OR (p_mode='amount' AND p_value>1000000000) OR (p_mode='percent' AND p_value>1000))) THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_PRICING'); END IF;
 v_selector:=jsonb_build_object('kind',p_kind,'scope',p_scope,'product_id',p_product_id,'package_id',p_package_id,'unit_value',trim_scale(p_unit_value),'currency',p_currency);
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_selector::text,'UTF8')),'hex');
 -- Each kind's global row serializes its configuration and override changes.
 -- Audit and change are one transaction, including insert/delete overrides.
 PERFORM 1 FROM private.customer_bitrefill_pricing_global WHERE kind=p_kind FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PRICING_UNAVAILABLE'); END IF;
 IF p_scope='global' THEN SELECT jsonb_build_object('mode',mode,'value',value,'owner_configured',owner_configured) INTO v_old FROM private.customer_bitrefill_pricing_global WHERE kind=p_kind;
 ELSE SELECT jsonb_build_object('mode',mode,'value',value) INTO v_old FROM private.customer_bitrefill_pricing_overrides WHERE selector_hash=v_hash; END IF;
 v_new:=CASE WHEN p_remove THEN NULL ELSE jsonb_build_object('mode',p_mode,'value',p_value) END;
 IF p_scope='global' THEN v_new:=v_new||jsonb_build_object('owner_configured',true); END IF;
 v_changed:=v_old IS DISTINCT FROM v_new;
 IF NOT v_changed THEN RETURN jsonb_build_object('success',true,'changed',false); END IF;
 BEGIN
  INSERT INTO private.customer_bitrefill_pricing_audit(owner_user_id,kind,selector,old_config,new_config) VALUES(p_owner_user_id,p_kind,v_selector,v_old,v_new);
  IF p_scope='global' THEN UPDATE private.customer_bitrefill_pricing_global SET mode=p_mode,value=p_value,owner_configured=true,updated_at=clock_timestamp() WHERE kind=p_kind;
  ELSIF p_remove THEN DELETE FROM private.customer_bitrefill_pricing_overrides WHERE selector_hash=v_hash;
  ELSE INSERT INTO private.customer_bitrefill_pricing_overrides(selector_hash,kind,scope,product_id,package_id,unit_value,currency,mode,value)
   VALUES(v_hash,p_kind,p_scope,p_product_id,p_package_id,trim_scale(p_unit_value),p_currency,p_mode,p_value)
   ON CONFLICT(selector_hash) DO UPDATE SET mode=EXCLUDED.mode,value=EXCLUDED.value,updated_at=clock_timestamp(); END IF;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','PRICING_UPDATE_FAILED'); END;
 RETURN jsonb_build_object('success',true,'changed',true);
END;
$$;

CREATE FUNCTION public.list_customer_bitrefill_pricing(p_owner_user_id uuid,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_global jsonb; v_overrides jsonb;
BEGIN
 IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner_user_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true) THEN
 RETURN jsonb_build_object('success',false,'code','OWNER_DENIED'); END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('airtime','gift_card','sms') THEN RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_KIND'); END IF;
 SELECT jsonb_build_object('mode',mode,'value',value) INTO v_global FROM private.customer_bitrefill_pricing_global WHERE kind=p_kind;
 SELECT coalesce(jsonb_agg(jsonb_build_object('scope',scope,'product_id',product_id,'package_id',package_id,
 'unit_value',unit_value,'currency',currency,'mode',mode,'value',value) ORDER BY product_id,scope,unit_value,package_id),'[]'::jsonb)
 INTO v_overrides FROM private.customer_bitrefill_pricing_overrides WHERE kind=p_kind;
 RETURN jsonb_build_object('success',true,'global',v_global,'overrides',v_overrides);
END;
$$;
CREATE FUNCTION public.get_customer_bitrefill_pricing_batch(p_kind text,p_selectors jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; r jsonb; v_ids text[]:=ARRAY[]::text[]; v_prices jsonb:='[]'::jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('airtime','gift_card','sms') OR p_selectors IS NULL
 OR jsonb_typeof(p_selectors)<>'array' OR octet_length(p_selectors::text)>262144 THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_SELECTORS'); END IF;
 IF jsonb_array_length(p_selectors)>500 THEN RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_SELECTORS'); END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_selectors) LOOP
  IF jsonb_typeof(s)<>'object' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_SELECTORS'); END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(s))<>4 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('product_id','package_id','unit_value','currency'))
  OR jsonb_typeof(s->'product_id') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'package_id') NOT IN ('string','null')
  OR jsonb_typeof(s->'unit_value') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'currency') IS DISTINCT FROM 'string'
  OR (s->>'product_id')=ANY(v_ids) THEN RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_SELECTORS'); END IF;
  r:=public.get_customer_bitrefill_pricing(p_kind,s->>'product_id',s->>'package_id',(s->>'unit_value')::numeric,s->>'currency');
  IF r->>'success' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('success',false,'code','INVALID_PRICING_SELECTORS'); END IF;
  v_ids:=array_append(v_ids,s->>'product_id');
  v_prices:=v_prices||jsonb_build_array(jsonb_build_object('product_id',s->>'product_id','mode',r->'mode','value',r->'value','source',r->'source',
   'legacy_pricing',coalesce((r->>'legacy_pricing')::boolean,false)));
 END LOOP;
 RETURN jsonb_build_object('success',true,'prices',v_prices);
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_bitrefill_pricing(text,text,text,numeric,text),
 public.set_customer_bitrefill_pricing(uuid,text,text,text,text,numeric,text,text,numeric,boolean),public.list_customer_bitrefill_pricing(uuid,text),public.get_customer_bitrefill_pricing_batch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_bitrefill_pricing(text,text,text,numeric,text),
 public.set_customer_bitrefill_pricing(uuid,text,text,text,text,numeric,text,text,numeric,boolean),public.list_customer_bitrefill_pricing(uuid,text),public.get_customer_bitrefill_pricing_batch(text,jsonb) TO service_role;
