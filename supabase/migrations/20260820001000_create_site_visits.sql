-- Lightweight first-party visitor trend tracking for Admin > Sales.

CREATE TABLE IF NOT EXISTS public.site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  path text NOT NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_created_at ON public.site_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_visitor_created_at ON public.site_visits(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_user_created_at ON public.site_visits(user_id, created_at DESC);

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record site visits" ON public.site_visits;
CREATE POLICY "Anyone can record site visits"
ON public.site_visits
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read site visits" ON public.site_visits;
CREATE POLICY "Admins can read site visits"
ON public.site_visits
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = true
  )
);
