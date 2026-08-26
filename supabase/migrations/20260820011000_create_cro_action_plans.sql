-- Structured, bounded strategy/action queue for Revenue OS.
-- Opportunities become approved action plans; they do not become arbitrary code
-- or free-form website changes.

CREATE TABLE IF NOT EXISTS public.cro_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL UNIQUE,
  opportunity_key text,
  action_type text NOT NULL CHECK (
    action_type IN (
      'REORDER_PRODUCTS',
      'FEATURE_PRODUCT',
      'SUPPRESS_PRODUCT',
      'SHOW_RECOMMENDATION',
      'CHANGE_RECOMMENDATION_POSITION',
      'CHANGE_TEMPLATE_VARIANT',
      'SHOW_POST_PURCHASE_OFFER',
      'CHANGE_OFFER_SEQUENCE',
      'CHANGE_PROMOTION_EXPOSURE',
      'CHANGE_CHAT_OPENING',
      'CHANGE_CTA_COPY_VARIANT',
      'AUDIT_TRAFFIC_SOURCE',
      'DIAGNOSE_FUNNEL',
      'RESTOCK_PRODUCT',
      'DO_NOTHING'
    )
  ),
  surface text NOT NULL DEFAULT 'products',
  scope text NOT NULL DEFAULT 'store',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'running', 'paused', 'completed', 'rejected')),
  priority numeric NOT NULL DEFAULT 0,
  expected_value numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  risk numeric NOT NULL DEFAULT 0,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_action_plans_status_priority
ON public.cro_action_plans(status, priority DESC, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_cro_action_plans_opportunity
ON public.cro_action_plans(opportunity_key);

ALTER TABLE public.cro_action_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage cro action plans" ON public.cro_action_plans;
CREATE POLICY "Admins can manage cro action plans"
ON public.cro_action_plans
FOR ALL
USING (public.is_admin_profile())
WITH CHECK (public.is_admin_profile());
