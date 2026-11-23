BEGIN;
CREATE TABLE public.sms_routing_preferences (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  international_provider text NOT NULL DEFAULT 'herosms' CHECK(international_provider IN ('herosms','smsbus')),
  changed_by uuid REFERENCES public.profiles(id),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.sms_routing_preferences(singleton) VALUES(true);
ALTER TABLE public.sms_routing_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_routing_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_routing_preferences TO service_role;
CREATE TABLE public.sms_international_selection_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,provider text NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.sms_international_selection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_international_selection_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_international_selection_audit TO service_role;

ALTER FUNCTION public.get_sms_provider_routing_state(text) RENAME TO get_sms_provider_delivery_state;
CREATE FUNCTION public.get_sms_provider_routing_state(p_product_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT public.get_sms_provider_delivery_state(p_product_key) || jsonb_build_object(
    'international_provider',(SELECT international_provider FROM public.sms_routing_preferences WHERE singleton)
  )
$$;
CREATE FUNCTION public.set_sms_international_provider(p_provider text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user<>'postgres' THEN RAISE EXCEPTION 'service_role_required';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true) THEN RAISE EXCEPTION 'admin_access_required';END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('herosms','smsbus') THEN RAISE EXCEPTION 'invalid_international_provider';END IF;
  UPDATE public.sms_routing_preferences SET international_provider=p_provider,changed_by=p_actor,updated_at=now() WHERE singleton;
  INSERT INTO public.sms_international_selection_audit(provider,actor_id) VALUES(p_provider,p_actor);
  RETURN jsonb_build_object('success',true,'international_provider',p_provider);
END $$;
REVOKE ALL ON FUNCTION public.get_sms_provider_routing_state(text),public.set_sms_international_provider(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sms_provider_routing_state(text),public.set_sms_international_provider(text,uuid) TO service_role;
COMMIT;
