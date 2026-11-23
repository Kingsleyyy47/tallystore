-- Provider catalogue metadata only. This migration never moves customer funds.
BEGIN;
CREATE TABLE IF NOT EXISTS public.supplier_product_routes (
  family text NOT NULL CHECK (family IN ('sms','smm','rental','digital')),
  product_key text NOT NULL,
  match_key text NOT NULL,
  routes jsonb NOT NULL CHECK (jsonb_typeof(routes) = 'array'),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family, product_key)
);
ALTER TABLE public.supplier_product_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_product_routes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_product_routes TO service_role;
CREATE TABLE public.supplier_dispatch_journal (
  order_id uuid PRIMARY KEY,family text NOT NULL CHECK(family IN ('sms','smm')),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_dispatch_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_dispatch_journal FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.supplier_dispatch_journal TO service_role;
ALTER TABLE public.smm_services ADD COLUMN IF NOT EXISTS supplier_routing boolean NOT NULL DEFAULT false;
-- Existing column-level catalogue grants are intentionally preserved.
REVOKE SELECT (supplier_routing) ON public.smm_services FROM anon, authenticated;
COMMIT;
