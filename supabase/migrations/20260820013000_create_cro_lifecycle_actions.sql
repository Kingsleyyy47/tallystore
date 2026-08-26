-- Permissioned lifecycle/repeat-purchase queue for Revenue OS.
-- The system may identify reactivation or post-purchase opportunities, but it
-- must not send outbound messages unless consent and owner approval are present.

CREATE TABLE IF NOT EXISTS public.cro_lifecycle_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  lifecycle_stage text NOT NULL,
  recommended_action text NOT NULL CHECK (
    recommended_action IN (
      'POST_PURCHASE_RECOMMENDATION',
      'FIRST_PURCHASE_FOLLOWUP',
      'COOLING_REACTIVATION',
      'AT_RISK_REACTIVATION',
      'LAPSED_REACTIVATION',
      'NO_OFFER'
    )
  ),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'push', 'whatsapp', 'onsite')),
  status text NOT NULL DEFAULT 'needs_consent' CHECK (
    status IN ('needs_consent', 'queued', 'approved', 'sent', 'dismissed', 'expired', 'failed')
  ),
  requires_consent boolean NOT NULL DEFAULT true,
  product_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  expected_value numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  pressure_score numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_lifecycle_actions_status
ON public.cro_lifecycle_actions(status, recommended_action, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_cro_lifecycle_actions_user
ON public.cro_lifecycle_actions(user_id, created_at DESC);

ALTER TABLE public.cro_lifecycle_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage lifecycle actions" ON public.cro_lifecycle_actions;
CREATE POLICY "Admins can manage lifecycle actions"
ON public.cro_lifecycle_actions
FOR ALL
USING (public.is_admin_profile())
WITH CHECK (public.is_admin_profile());
