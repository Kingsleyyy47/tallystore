-- Tally Revenue OS 2.0 evaluation layer.
-- Stores experiment outcome analysis, shadow/simulation checks, and drift checks.

CREATE TABLE IF NOT EXISTS public.cro_experiment_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_key text NOT NULL UNIQUE,
  experiment_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  primary_metric text NOT NULL DEFAULT 'revenue_per_visitor',
  control jsonb NOT NULL DEFAULT '{}'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'insufficient_data' CHECK (decision IN ('insufficient_data', 'keep_running', 'promote', 'rollback', 'pause')),
  confidence numeric NOT NULL DEFAULT 0,
  minimum_practical_effect numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_experiment_evaluations_experiment ON public.cro_experiment_evaluations(experiment_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cro_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('shadow', 'historical', 'guardrail')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  sessions_evaluated integer NOT NULL DEFAULT 0,
  decisions_evaluated integer NOT NULL DEFAULT 0,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  concentration jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL DEFAULT 'insufficient_data' CHECK (recommendation IN ('insufficient_data', 'safe', 'watch', 'pause')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_simulation_runs_created ON public.cro_simulation_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.cro_drift_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key text NOT NULL UNIQUE,
  model_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('stable', 'watch', 'drift', 'insufficient_data')),
  drift_score numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cro_drift_checks_model ON public.cro_drift_checks(model_key, created_at DESC);

ALTER TABLE public.cro_experiment_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_simulation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_drift_checks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cro_experiment_evaluations',
    'cro_simulation_runs',
    'cro_drift_checks'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s admin read" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin read" ON public.%I FOR SELECT USING (public.is_admin_profile())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s admin write" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin write" ON public.%I FOR ALL USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile())', table_name, table_name);
  END LOOP;
END $$;
