-- Owner approval is separate from live provider details. Existing choices and
-- all financial rows are preserved; only future imports default to disabled.
BEGIN;
ALTER TABLE public.smm_services ALTER COLUMN is_active SET DEFAULT false;
CREATE OR REPLACE FUNCTION public.get_enabled_smm_catalog_page(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT to_jsonb(s)||jsonb_build_object('supplier_routes',CASE WHEN s.supplier_routing THEN r.routes ELSE NULL END)
  FROM public.smm_services s
  LEFT JOIN public.supplier_product_routes r ON r.family='smm' AND r.product_key=s.external_id::text
  WHERE s.is_active IS TRUE AND (p_after IS NULL OR s.id>p_after)
  ORDER BY s.id LIMIT LEAST(GREATEST(COALESCE(p_limit,1000),1),1000)
$$;
REVOKE ALL ON FUNCTION public.get_enabled_smm_catalog_page(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_enabled_smm_catalog_page(uuid,integer) TO service_role;
COMMIT;
