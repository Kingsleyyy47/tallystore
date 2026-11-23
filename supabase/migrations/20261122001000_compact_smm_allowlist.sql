-- One compact JSON result avoids PostgREST's row cap and repeated page reads.
-- Approval data stays private and is read fresh for every catalogue request.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_enabled_smm_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',s.id,'external_id',s.external_id,'is_active',true,
    'supplier_routing',s.supplier_routing,
    'supplier_routes',CASE WHEN s.supplier_routing THEN r.routes ELSE NULL END
  ) ORDER BY s.id),'[]'::jsonb)
  FROM public.smm_services s
  LEFT JOIN public.supplier_product_routes r ON r.family='smm' AND r.product_key=s.external_id::text
  WHERE s.is_active IS TRUE
$$;
REVOKE ALL ON FUNCTION public.get_enabled_smm_catalog() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_enabled_smm_catalog() TO service_role;
COMMIT;
