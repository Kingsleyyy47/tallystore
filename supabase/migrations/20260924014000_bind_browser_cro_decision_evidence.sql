-- Browser CRO decisions are observations, not server-authoritative evidence.
-- Never let a client attribute one to another signed-in user or set an
-- authoritative marker that could later be mistaken for verified activity.
DO $preflight$
BEGIN
  IF to_regclass('public.cro_decision_audit') IS NULL THEN
    RAISE EXCEPTION 'cro_decision_audit table missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.cro_decision_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can record cro decisions"
  ON public.cro_decision_audit;
DROP POLICY IF EXISTS "Clients can record own cro decisions"
  ON public.cro_decision_audit;

CREATE POLICY "Clients can record own cro decisions"
ON public.cro_decision_audit
FOR INSERT TO anon, authenticated
WITH CHECK (
  (user_id IS NULL OR auth.uid() = user_id)
  AND COALESCE(metadata->>'client_observed', 'false') = 'true'
  AND COALESCE(metadata->>'authoritative', 'false') = 'false'
  AND COALESCE(guardrails->>'server_authoritative', 'false') = 'false'
);

REVOKE UPDATE, DELETE, TRUNCATE ON public.cro_decision_audit
  FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.cro_decision_audit TO anon, authenticated;
