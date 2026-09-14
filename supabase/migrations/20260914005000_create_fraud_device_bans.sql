-- IP/device bans created when an admin suspends a fraud-risk customer.
-- Purchase functions check this table server-side.

CREATE TABLE IF NOT EXISTS public.fraud_device_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address text,
  user_agent_hash text,
  user_agent_excerpt text,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ip_address IS NOT NULL OR user_agent_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_device_bans_active_ip_user
  ON public.fraud_device_bans (banned_user_id, ip_address)
  WHERE active = true AND ip_address IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_device_bans_active_device_user
  ON public.fraud_device_bans (banned_user_id, user_agent_hash)
  WHERE active = true AND user_agent_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fraud_device_bans_ip_active
  ON public.fraud_device_bans (ip_address, active)
  WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fraud_device_bans_device_active
  ON public.fraud_device_bans (user_agent_hash, active)
  WHERE user_agent_hash IS NOT NULL;

ALTER TABLE public.fraud_device_bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read fraud device bans" ON public.fraud_device_bans;
CREATE POLICY "Admins can read fraud device bans"
ON public.fraud_device_bans
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.fraud_device_bans FROM anon, authenticated;
