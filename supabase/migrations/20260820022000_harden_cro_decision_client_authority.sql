-- Browser-side ranking can record observed CRO decisions for diagnostics, but
-- it must not be allowed to forge server-authoritative decision evidence.

DROP POLICY IF EXISTS "Anyone can record cro decisions" ON public.cro_decision_audit;
DROP POLICY IF EXISTS "Clients can record own cro decisions" ON public.cro_decision_audit;
DROP POLICY IF EXISTS "Clients can record observed cro decisions" ON public.cro_decision_audit;

CREATE POLICY "Clients can record observed cro decisions"
ON public.cro_decision_audit
FOR INSERT
WITH CHECK (
  (user_id IS NULL OR auth.uid() = user_id)
  AND coalesce(metadata->>'authoritative', 'false') <> 'true'
  AND coalesce(metadata->>'server_authoritative', 'false') <> 'true'
  AND coalesce(guardrails->>'server_authoritative', 'false') <> 'true'
);
