-- Tally Revenue OS 2.0 explicit feature store.
-- These tables give CRO, ranking, chat, experiments, and maintenance one
-- canonical place to read/write deterministic feature definitions.

CREATE TABLE IF NOT EXISTS public.customer_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id text,
  feature_key text NOT NULL,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  window_start timestamptz,
  window_end timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'DETERMINISTIC',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL),
  UNIQUE (subject_key, feature_key)
);

CREATE TABLE IF NOT EXISTS public.product_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  window_start timestamptz,
  window_end timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'DETERMINISTIC',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_group_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.session_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  visitor_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature_key text NOT NULL,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  expires_at timestamptz,
  source text NOT NULL DEFAULT 'DETERMINISTIC',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.business_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'store',
  feature_key text NOT NULL,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  window_start timestamptz,
  window_end timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'DETERMINISTIC',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_features_user ON public.customer_features(user_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_customer_features_visitor ON public.customer_features(visitor_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_customer_features_subject_key ON public.customer_features(subject_key, feature_key);
CREATE INDEX IF NOT EXISTS idx_product_features_product ON public.product_features(product_group_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_session_features_session ON public.session_features(session_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_session_features_expires ON public.session_features(expires_at);
CREATE INDEX IF NOT EXISTS idx_business_features_scope ON public.business_features(scope, feature_key);

ALTER TABLE public.customer_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_features ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customer_features',
    'product_features',
    'session_features',
    'business_features'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s admin read" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin read" ON public.%I FOR SELECT USING (public.is_admin_profile())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s admin write" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s admin write" ON public.%I FOR ALL USING (public.is_admin_profile()) WITH CHECK (public.is_admin_profile())', table_name, table_name);
  END LOOP;
END $$;
