-- Tally Revenue OS 2.0 product intelligence, experimentation, and safety records.
-- Generic by design: no product names, categories, or platform assumptions are hardcoded.

CREATE TABLE IF NOT EXISTS public.product_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('text', 'number', 'boolean', 'date')),
  allowed_units text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.category_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  attribute_definition_id uuid NOT NULL REFERENCES public.product_attribute_definitions(id) ON DELETE CASCADE,
  is_required boolean NOT NULL DEFAULT false,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, attribute_definition_id)
);

CREATE TABLE IF NOT EXISTS public.product_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  attribute_definition_id uuid NOT NULL REFERENCES public.product_attribute_definitions(id) ON DELETE CASCADE,
  text_value text,
  numeric_value numeric,
  boolean_value boolean,
  date_value timestamptz,
  unit text,
  source text NOT NULL DEFAULT 'ADMIN',
  confidence numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_group_id, attribute_definition_id, unit)
);

CREATE TABLE IF NOT EXISTS public.product_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  to_product_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (
    relationship_type IN (
      'SUBSTITUTE',
      'ALTERNATIVE',
      'UPGRADE',
      'DOWNGRADE',
      'COMPLEMENT',
      'VARIANT',
      'VIEWED_NEXT',
      'PURCHASED_NEXT',
      'SAME_INTENT',
      'COMPATIBLE_WITH',
      'REPLACEMENT_FOR',
      'REQUIRES'
    )
  ),
  strength numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  source text NOT NULL CHECK (source IN ('CATALOGUE', 'BEHAVIOR', 'EXPLICIT', 'EXPERIMENTAL')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_product_group_id <> to_product_group_id),
  UNIQUE (from_product_group_id, to_product_group_id, relationship_type, source)
);

CREATE INDEX IF NOT EXISTS idx_product_relationships_from ON public.product_relationships(from_product_group_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_product_relationships_to ON public.product_relationships(to_product_group_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_product_relationships_strength ON public.product_relationships(strength DESC, confidence DESC);

CREATE TABLE IF NOT EXISTS public.cro_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_key text NOT NULL UNIQUE,
  hypothesis text NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  control jsonb NOT NULL DEFAULT '{}'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_metric text NOT NULL DEFAULT 'revenue_per_visitor',
  guardrail_metrics text[] NOT NULL DEFAULT ARRAY['conversion_rate', 'payment_completion', 'refund_rate'],
  minimum_practical_effect numeric NOT NULL DEFAULT 0,
  confidence_threshold numeric NOT NULL DEFAULT 0.95,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'rolled_back')),
  decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cro_commercial_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  finding text NOT NULL,
  effect numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'retest', 'rejected')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cro_model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL,
  version text NOT NULL,
  model_type text NOT NULL,
  training_period jsonb NOT NULL DEFAULT '{}'::jsonb,
  features text[] NOT NULL DEFAULT '{}',
  performance jsonb NOT NULL DEFAULT '{}'::jsonb,
  deployment_state text NOT NULL DEFAULT 'shadow' CHECK (deployment_state IN ('shadow', 'active', 'paused', 'retired', 'rollback')),
  rollback_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_key, version)
);

CREATE TABLE IF NOT EXISTS public.revenue_data_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'paused')),
  scope text NOT NULL DEFAULT 'global',
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_data_quality_created_at ON public.revenue_data_quality_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_data_quality_status ON public.revenue_data_quality_checks(status, severity, created_at DESC);

ALTER TABLE public.product_attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_commercial_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cro_model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_data_quality_checks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin_profile()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  );
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'product_attribute_definitions',
    'category_attribute_definitions',
    'product_attributes',
    'product_relationships',
    'cro_experiments',
    'cro_commercial_insights',
    'cro_model_registry',
    'revenue_data_quality_checks'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s admin read" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin read" ON public.%I FOR SELECT USING (public.is_admin_profile())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s admin write" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin write" ON public.%I FOR ALL USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile())', table_name, table_name);
  END LOOP;
END $$;

-- Product relationships can be read by the storefront for deterministic recommendations,
-- but only admins can write them.
DROP POLICY IF EXISTS "product_relationships public read" ON public.product_relationships;
CREATE POLICY "product_relationships public read"
ON public.product_relationships
FOR SELECT
USING (true);

GRANT SELECT ON public.product_relationships TO anon, authenticated;
