-- Harden Revenue OS event capture so browser clients cannot attribute events
-- to another authenticated user. Anonymous events remain allowed with null user_id.

DROP POLICY IF EXISTS "Anyone can record revenue events" ON public.revenue_events;
DROP POLICY IF EXISTS "Clients can record own revenue events" ON public.revenue_events;
CREATE POLICY "Clients can record own revenue events"
ON public.revenue_events
FOR INSERT
WITH CHECK (
  user_id IS NULL
  OR auth.uid() = user_id
);

DROP POLICY IF EXISTS "Anyone can record cro decisions" ON public.cro_decision_audit;
DROP POLICY IF EXISTS "Clients can record own cro decisions" ON public.cro_decision_audit;
CREATE POLICY "Clients can record own cro decisions"
ON public.cro_decision_audit
FOR INSERT
WITH CHECK (
  user_id IS NULL
  OR auth.uid() = user_id
);

DROP POLICY IF EXISTS "Anyone can record site visits" ON public.site_visits;
DROP POLICY IF EXISTS "Clients can record own site visits" ON public.site_visits;
CREATE POLICY "Clients can record own site visits"
ON public.site_visits
FOR INSERT
WITH CHECK (
  user_id IS NULL
  OR auth.uid() = user_id
);
