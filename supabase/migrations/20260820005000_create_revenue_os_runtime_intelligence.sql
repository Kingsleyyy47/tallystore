-- Tally Revenue OS 2.0 runtime intelligence.
-- Stores deterministic feature snapshots, opportunity diagnostics, and forecasts.

CREATE TABLE IF NOT EXISTS public.revenue_feature_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL UNIQUE,
  scope_type text NOT NULL CHECK (scope_type IN ('store', 'product', 'category', 'customer', 'session')),
  scope_id text NOT NULL DEFAULT 'global',
  window_start timestamptz,
  window_end timestamptz NOT NULL DEFAULT now(),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'DETERMINISTIC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_feature_snapshots_scope ON public.revenue_feature_snapshots(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_revenue_feature_snapshots_window ON public.revenue_feature_snapshots(window_end DESC);

CREATE TABLE IF NOT EXISTS public.cro_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_key text NOT NULL UNIQUE,
  type text NOT NULL,
  scope text NOT NULL DEFAULT 'store',
  expected_value numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  risk numeric NOT NULL DEFAULT 0,
  effort numeric NOT NULL DEFAULT 0,
  priority numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'watching', 'testing', 'resolved', 'dismissed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_opportunities_priority ON public.cro_opportunities(status, priority DESC, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_cro_opportunities_type ON public.cro_opportunities(type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.revenue_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_key text NOT NULL UNIQUE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metric text NOT NULL,
  median_value numeric NOT NULL DEFAULT 0,
  lower_bound numeric NOT NULL DEFAULT 0,
  upper_bound numeric NOT NULL DEFAULT 0,
  probability_to_target numeric,
  method text NOT NULL DEFAULT 'DETERMINISTIC_TRAILING_RATE',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_metric ON public.revenue_forecasts(metric, period_end DESC);

ALTER TABLE public.revenue_feature_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_forecasts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'revenue_feature_snapshots',
    'cro_opportunities',
    'revenue_forecasts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s admin read" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin read" ON public.%I FOR SELECT USING (public.is_admin_profile())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s admin write" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin write" ON public.%I FOR ALL USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile())', table_name, table_name);
  END LOOP;
END $$;
