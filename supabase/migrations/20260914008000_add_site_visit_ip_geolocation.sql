-- Approximate, consent-free IP geolocation for fraud review.
-- This is not GPS and should be treated as approximate city/region/country evidence.

ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS ip_country_code text,
  ADD COLUMN IF NOT EXISTS ip_country text,
  ADD COLUMN IF NOT EXISTS ip_region text,
  ADD COLUMN IF NOT EXISTS ip_city text,
  ADD COLUMN IF NOT EXISTS ip_timezone text,
  ADD COLUMN IF NOT EXISTS ip_isp text,
  ADD COLUMN IF NOT EXISTS ip_asn text,
  ADD COLUMN IF NOT EXISTS ip_geo_source text;

CREATE INDEX IF NOT EXISTS idx_site_visits_user_geo_created_at
  ON public.site_visits(user_id, ip_country_code, ip_region, ip_city, created_at DESC)
  WHERE ip_country_code IS NOT NULL;
