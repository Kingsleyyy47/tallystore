-- PostgreSQL table-level SELECT revocation also cleared the older catalog
-- column privileges in production. Restore only the customer-safe projection.
GRANT SELECT (
  id, category_id, name, description, price, stock_count, is_active, created_at,
  availability_status, is_sellable, features, quantity_discount_tiers
) ON public.product_groups TO anon, authenticated;
-- Supplier mappings, readiness, circuits and configuration stay service-only.
NOTIFY pgrst, 'reload schema';
