-- Tally Revenue OS 2.0 foundation.
-- Deterministic event pipeline, decision audit, and owner control defaults.

CREATE TABLE IF NOT EXISTS public.revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  visitor_id text,
  session_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  surface text,
  path text,
  referrer text,
  device text,
  experiment_id text,
  variant_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.revenue_events
  DROP CONSTRAINT IF EXISTS revenue_events_event_type_check;

ALTER TABLE public.revenue_events
  ADD CONSTRAINT revenue_events_event_type_check CHECK (
    event_type IN (
      'SESSION_STARTED',
      'PAGE_VIEWED',
      'PRODUCT_IMPRESSION',
      'PRODUCT_VIEWED',
      'SEARCHED',
      'FILTER_USED',
      'SORT_USED',
      'PRODUCT_CLICKED',
      'BUY_CLICKED',
      'PAYMENT_STARTED',
      'PAYMENT_PROVIDER_LOADED',
      'PAYMENT_ATTEMPTED',
      'PAYMENT_COMPLETED',
      'PAYMENT_FAILED',
      'PRODUCT_PURCHASED',
      'PRODUCT_PURCHASE_REVERSED',
      'PRODUCT_REJECTED',
      'SMS_ORDER_CANCELLED',
      'SMS_ORDER_COMPLETED',
      'SMS_ORDER_REFUNDED',
      'RECOMMENDATION_SHOWN',
      'RECOMMENDATION_CLICKED',
      'RECOMMENDATION_DISMISSED',
      'PROMOTION_SHOWN',
      'PROMOTION_CLICKED',
      'OFFER_SHOWN',
      'OFFER_ACCEPTED',
      'OFFER_DISMISSED',
      'CHAT_OPENED',
      'CHAT_MESSAGE',
      'CHAT_INTENT',
      'CHAT_PRODUCT_SHOWN',
      'SUPPORT_HANDOFF',
      'CHECKOUT_ABANDONED',
      'RETURN_VISIT'
    )
  );

CREATE INDEX IF NOT EXISTS idx_revenue_events_created_at ON public.revenue_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_event_type_created_at ON public.revenue_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_user_created_at ON public.revenue_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_visitor_created_at ON public.revenue_events(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_events_product_created_at ON public.revenue_events(product_group_id, created_at DESC);

ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record revenue events" ON public.revenue_events;
CREATE POLICY "Anyone can record revenue events"
ON public.revenue_events
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read revenue events" ON public.revenue_events;
CREATE POLICY "Admins can read revenue events"
ON public.revenue_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

CREATE TABLE IF NOT EXISTS public.cro_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id text NOT NULL UNIQUE,
  visitor_id text,
  session_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  surface text NOT NULL,
  selected_action text NOT NULL,
  selected_product_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  score numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_decision_audit_created_at ON public.cro_decision_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cro_decision_audit_user_created_at ON public.cro_decision_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cro_decision_audit_surface_created_at ON public.cro_decision_audit(surface, created_at DESC);

ALTER TABLE public.cro_decision_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record cro decisions" ON public.cro_decision_audit;
CREATE POLICY "Anyone can record cro decisions"
ON public.cro_decision_audit
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read cro decisions" ON public.cro_decision_audit;
CREATE POLICY "Admins can read cro decisions"
ON public.cro_decision_audit
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('cro_global_enabled', 'false', now()),
  ('cro_shadow_mode_enabled', 'true', now()),
  ('cro_autonomy_level', '0', now()),
  ('cro_exploration_pct', '5', now()),
  ('cro_pressure_limit', '2', now())
ON CONFLICT (key) DO NOTHING;
