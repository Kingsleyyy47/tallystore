-- Both Revenue OS writers already emit separate commerce-section snapshots.
-- Preserve that scope rather than mixing section analytics into store totals.
-- This adds one accepted type; it changes no grants, policies or existing data.
BEGIN;

ALTER TABLE public.revenue_feature_snapshots
  DROP CONSTRAINT revenue_feature_snapshots_scope_type_check;

ALTER TABLE public.revenue_feature_snapshots
  ADD CONSTRAINT revenue_feature_snapshots_scope_type_check
  CHECK (scope_type IN ('store', 'product', 'category', 'customer', 'session', 'commerce_section'));

COMMIT;
