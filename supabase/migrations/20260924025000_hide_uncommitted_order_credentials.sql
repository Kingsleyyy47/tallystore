-- Customer order credentials must not depend on browser-side redaction.
-- The view owner reads base rows, then explicitly scopes each row to its
-- customer or an administrator. Only the owning customer can see completed
-- credentials; admin history needs order facts, not stored passwords.
DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.product_groups') IS NULL
    OR to_regclass('public.categories') IS NULL
  THEN
    RAISE EXCEPTION 'order_history_required_table_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE VIEW public.orders_safe_history AS
SELECT o.id, o.user_id, o.product_group_id, o.amount, o.status, o.created_at,
  CASE
    WHEN o.user_id = (SELECT auth.uid())
      AND lower(COALESCE(o.status, '')) = 'completed'
      AND (
        o.created_at < public.wallet_legacy_funding_cutoff()
        OR o.financial_authorization_status = 'captured'
      )
    THEN o.account_details
    ELSE jsonb_build_object(
      'product_name', o.account_details->>'product_name',
      'category', o.account_details->>'category',
      'category_id', o.account_details->>'category_id',
      'quantity', o.account_details->'quantity',
      'price_per_unit', o.account_details->'price_per_unit',
      'original_total', o.account_details->'original_total'
    )
  END AS account_details,
  CASE WHEN pg.id IS NULL THEN NULL ELSE jsonb_build_object(
    'name', pg.name,
    'price', pg.price,
    'category_id', pg.category_id,
    'categories', CASE WHEN c.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', c.name) END
  ) END AS product_groups
FROM public.orders o
LEFT JOIN public.product_groups pg ON pg.id = o.product_group_id
LEFT JOIN public.categories c ON c.id = pg.category_id
WHERE o.user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND COALESCE(p.is_admin, false)
  );

ALTER VIEW public.orders_safe_history
  SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.orders_safe_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orders_safe_history TO authenticated;

REVOKE SELECT ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE SELECT (account_details) ON TABLE public.orders
  FROM PUBLIC, anon, authenticated;
