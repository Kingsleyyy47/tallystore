-- POST a bounded selector list instead of placing the entire catalogue in a URL.
-- Return a JSON array so PostgREST's row limit cannot truncate owner controls.
BEGIN;
CREATE FUNCTION public.get_sms_catalog_settings(p_service_codes text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF cardinality(p_service_codes)>5000 THEN RAISE EXCEPTION 'sms_catalog_too_large'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'service_code',service_code,'service_name',service_name,'is_enabled',is_enabled,
    'is_favorite',is_favorite,'price_override_ngn',price_override_ngn,
    'auto_markup_enabled',auto_markup_enabled,'margin_ngn',margin_ngn
  )) FROM public.sms_product_settings WHERE service_code=ANY(p_service_codes)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_sms_catalog_settings(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sms_catalog_settings(text[]) TO service_role;
COMMIT;
