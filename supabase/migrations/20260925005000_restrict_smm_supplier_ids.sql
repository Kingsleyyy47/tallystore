-- Expand phase: deploy the admin RPCs before switching the browser build.
-- The grant restriction follows in 20260925006000 after the new build is live.
DO $preflight$
BEGIN
  IF to_regclass('public.smm_services') IS NULL
    OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'smm_catalog_security_required_table_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_admin_smm_services(p_query text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'admin_smm_services_required' USING ERRCODE = '42501';
  END IF;
  IF length(COALESCE(p_query, '')) > 100 THEN
    RAISE EXCEPTION 'smm_service_search_too_long';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'external_id', s.external_id, 'name', s.name,
    'platform', s.platform, 'price_ngn', s.price_ngn,
    'is_active', s.is_active
  ) ORDER BY s.platform, s.name), '[]'::jsonb)
  INTO v_rows
  FROM public.smm_services s
  WHERE NULLIF(btrim(COALESCE(p_query, '')), '') IS NULL
    OR s.name ILIKE '%' || btrim(p_query) || '%';

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_smm_service_active(
  p_service_id bigint DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'admin_smm_services_required' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS NULL OR (p_service_id IS NOT NULL AND p_platform IS NOT NULL)
    OR (p_service_id IS NOT NULL AND p_service_id <= 0)
    OR length(COALESCE(p_platform, '')) > 100 THEN
    RAISE EXCEPTION 'invalid_smm_service_toggle';
  END IF;

  UPDATE public.smm_services s
  SET is_active = p_is_active
  WHERE (p_service_id IS NOT NULL AND s.id = p_service_id)
    OR (p_service_id IS NULL AND p_platform IS NOT NULL AND s.platform = p_platform)
    OR (p_service_id IS NULL AND p_platform IS NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_smm_services(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_smm_services(text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_admin_smm_service_active(bigint,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_smm_service_active(bigint,text,boolean)
  TO authenticated;
