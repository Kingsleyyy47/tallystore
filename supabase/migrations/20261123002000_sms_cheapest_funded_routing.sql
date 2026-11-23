-- Automatic routing now applies independently to every country/service card.
-- Keep former international choices and their audit trail as historical settings.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_sms_provider_routing_state(p_product_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT public.get_sms_provider_delivery_state(p_product_key)||jsonb_build_object(
    'routing_strategy','cheapest_funded','international_provider','auto',
    'markup_by_country',jsonb_build_object('US',700,'CA',600,'default',500)
  )
$$;
REVOKE ALL ON FUNCTION public.get_sms_provider_routing_state(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sms_provider_routing_state(text) TO service_role;
COMMIT;
