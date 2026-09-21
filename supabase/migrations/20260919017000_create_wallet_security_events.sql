-- Durable forensic event ledger for wallet/security decisions.
--
-- This table is not a source of spendable value. It is a restricted audit sink
-- for integrity freezes, denied wallet operations, protected-field write
-- attempts, payment-verification failures, dispatch denials, and owner review
-- actions. Browser roles must not write it.

CREATE TABLE IF NOT EXISTS public.wallet_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  profile_id uuid,
  wallet_user_id uuid,
  actor_user_id uuid,
  actor_role text,
  source text,
  route text,
  db_function text,
  request_id text,
  idempotency_key text,
  operation_reference text,
  ip_address text,
  user_agent text,
  device_fingerprint text,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text,
  denial_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT wallet_security_events_event_type_not_blank CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT wallet_security_events_severity_valid CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT wallet_security_events_old_values_object CHECK (jsonb_typeof(old_values) = 'object'),
  CONSTRAINT wallet_security_events_new_values_object CHECK (jsonb_typeof(new_values) = 'object'),
  CONSTRAINT wallet_security_events_financial_snapshot_object CHECK (jsonb_typeof(financial_snapshot) = 'object'),
  CONSTRAINT wallet_security_events_evidence_object CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT wallet_security_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS wallet_security_events_profile_created_idx
  ON public.wallet_security_events (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_security_events_wallet_user_created_idx
  ON public.wallet_security_events (wallet_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_security_events_type_created_idx
  ON public.wallet_security_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_security_events_request_idx
  ON public.wallet_security_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_security_events_idempotency_idx
  ON public.wallet_security_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.wallet_security_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallet_security_events FROM PUBLIC;
REVOKE ALL ON public.wallet_security_events FROM anon;
REVOKE ALL ON public.wallet_security_events FROM authenticated;
GRANT SELECT ON public.wallet_security_events TO authenticated;
GRANT SELECT, INSERT ON public.wallet_security_events TO service_role;

DROP POLICY IF EXISTS "Admins can read wallet security events" ON public.wallet_security_events;
CREATE POLICY "Admins can read wallet security events"
ON public.wallet_security_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.is_admin = true
        OR p.email = 'admin@tallystore.org'
      )
  )
);

DROP POLICY IF EXISTS "Service role can read wallet security events" ON public.wallet_security_events;
CREATE POLICY "Service role can read wallet security events"
ON public.wallet_security_events
FOR SELECT
TO service_role
USING (true);

DROP POLICY IF EXISTS "Service role can insert wallet security events" ON public.wallet_security_events;
CREATE POLICY "Service role can insert wallet security events"
ON public.wallet_security_events
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.record_wallet_security_event(
  p_event_type text,
  p_severity text DEFAULT 'warning',
  p_profile_id uuid DEFAULT NULL,
  p_wallet_user_id uuid DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_db_function text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_operation_reference text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_device_fingerprint text DEFAULT NULL,
  p_old_values jsonb DEFAULT '{}'::jsonb,
  p_new_values jsonb DEFAULT '{}'::jsonb,
  p_financial_snapshot jsonb DEFAULT '{}'::jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_result text DEFAULT NULL,
  p_denial_code text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
BEGIN
  INSERT INTO public.wallet_security_events (
    event_type,
    severity,
    profile_id,
    wallet_user_id,
    actor_user_id,
    actor_role,
    source,
    route,
    db_function,
    request_id,
    idempotency_key,
    operation_reference,
    ip_address,
    user_agent,
    device_fingerprint,
    old_values,
    new_values,
    financial_snapshot,
    evidence,
    result,
    denial_code,
    metadata
  )
  VALUES (
    p_event_type,
    COALESCE(NULLIF(p_severity, ''), 'warning'),
    p_profile_id,
    p_wallet_user_id,
    p_actor_user_id,
    p_actor_role,
    p_source,
    p_route,
    p_db_function,
    p_request_id,
    p_idempotency_key,
    p_operation_reference,
    NULLIF(p_ip_address, ''),
    NULLIF(p_user_agent, ''),
    NULLIF(p_device_fingerprint, ''),
    COALESCE(p_old_values, '{}'::jsonb),
    COALESCE(p_new_values, '{}'::jsonb),
    COALESCE(p_financial_snapshot, '{}'::jsonb),
    COALESCE(p_evidence, '{}'::jsonb),
    p_result,
    p_denial_code,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_wallet_security_event(
  text, text, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_wallet_security_event(
  text, text, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb
) TO service_role;

COMMENT ON TABLE public.wallet_security_events IS
  'Restricted forensic ledger for wallet integrity, payment verification, dispatch denial, and owner review events.';

COMMENT ON FUNCTION public.record_wallet_security_event(
  text, text, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb
) IS
  'Service-role-only helper for durable wallet/security event capture. This function never creates spendable value.';
