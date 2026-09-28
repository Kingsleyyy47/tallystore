-- Admin-only investigation telemetry. IPs and user agents are not proof of
-- wallet ownership, funding, or fraud and must not affect authorization.
CREATE OR REPLACE FUNCTION public.get_admin_fraud_latest_visits(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  ip_address text,
  ip_source text,
  observed_at timestamptz,
  user_agent text,
  ip_country text,
  ip_region text,
  ip_city text,
  ip_isp text,
  ip_addresses text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'fraud_visit_telemetry_admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) > 100 THEN
    RAISE EXCEPTION 'fraud_visit_telemetry_user_limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT ids.user_id, latest.ip_address, latest.ip_source,
    latest.created_at, latest.user_agent, latest.ip_country,
    latest.ip_region, latest.ip_city, latest.ip_isp,
    COALESCE((
      SELECT array_agg(DISTINCT recent.ip_address)
      FROM (
        SELECT s.ip_address
        FROM public.site_visits s
        WHERE s.user_id = ids.user_id AND s.ip_address IS NOT NULL
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 25
      ) recent
    ), ARRAY[]::text[])
  FROM (SELECT DISTINCT unnest(p_user_ids) AS user_id) ids
  LEFT JOIN LATERAL (
    SELECT s.ip_address, s.ip_source, s.created_at, s.user_agent,
      s.ip_country, s.ip_region, s.ip_city, s.ip_isp
    FROM public.site_visits s
    WHERE s.user_id = ids.user_id AND s.ip_address IS NOT NULL
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 1
  ) latest ON true
  WHERE ids.user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_fraud_latest_visits(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_fraud_latest_visits(uuid[])
  TO authenticated;
