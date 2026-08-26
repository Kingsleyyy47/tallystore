-- First-party attribution and traffic quality for Revenue OS.

ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS traffic_quality text NOT NULL DEFAULT 'human' CHECK (traffic_quality IN ('human', 'suspect', 'bot', 'internal'));

CREATE INDEX IF NOT EXISTS idx_site_visits_traffic_quality_created_at
  ON public.site_visits(traffic_quality, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_visits_attribution_channel
  ON public.site_visits((attribution->>'channel'), created_at DESC);
