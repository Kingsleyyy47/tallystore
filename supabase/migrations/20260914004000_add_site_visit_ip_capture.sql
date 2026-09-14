-- Server-side IP capture for admin fraud review.
-- Existing browser-written visits cannot reliably include a real client IP.

ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS ip_source text NOT NULL DEFAULT 'client'
    CHECK (ip_source IN ('edge', 'client', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_site_visits_user_ip_created_at
  ON public.site_visits(user_id, ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_site_visits_ip_created_at
  ON public.site_visits(ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;
