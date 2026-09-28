-- Site visits are telemetry, not authenticated IP/device evidence. Browser
-- clients must not insert a row that can later be mistaken for edge evidence.
DROP POLICY IF EXISTS "Anyone can record site visits" ON public.site_visits;
DROP POLICY IF EXISTS "Anyone can insert site visits" ON public.site_visits;
DROP POLICY IF EXISTS "Clients can record own site visits" ON public.site_visits;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.site_visits
  FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.site_visits TO service_role;
