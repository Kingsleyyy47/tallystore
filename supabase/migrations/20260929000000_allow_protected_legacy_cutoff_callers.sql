-- A view does not bypass its caller's EXECUTE check for functions in its SELECT.
-- Inline the fixed cutoff in this customer-readable view; keep the helper private.
DO $preflight$
DECLARE
  v_definition text;
  v_truth_owner text;
  v_truth_is_definer boolean;
BEGIN
  IF to_regprocedure('public.wallet_legacy_funding_cutoff()') IS NULL
    OR to_regclass('public.orders_safe_history') IS NULL
    OR to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'protected_legacy_cutoff_dependency_missing';
  END IF;

  SELECT pg_catalog.pg_get_viewdef(c.oid)
  INTO v_definition
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.orders_safe_history'::regclass
    AND c.relkind = 'v';

  IF v_definition IS NULL
    OR (
      pg_catalog.strpos(v_definition, 'wallet_legacy_funding_cutoff()') = 0
      AND pg_catalog.strpos(v_definition, '2026-09-19 00:00:00+00') = 0
    )
    OR pg_catalog.strpos(v_definition, 'financial_authorization_status') = 0
    OR pg_catalog.strpos(v_definition, 'is_admin_profile()') = 0
  THEN
    RAISE EXCEPTION 'protected_order_history_definition_unexpected';
  END IF;

  SELECT r.rolname, p.prosecdef
  INTO v_truth_owner, v_truth_is_definer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.wallet_financial_truth_internal(uuid)'::regprocedure;

  IF v_truth_owner IS NULL OR NOT v_truth_is_definer
    OR v_truth_owner IN ('anon', 'authenticated')
  THEN
    RAISE EXCEPTION 'protected_financial_truth_configuration_unexpected';
  END IF;
END;
$preflight$;

CREATE OR REPLACE VIEW public.orders_safe_history AS
SELECT o.id, o.user_id, o.product_group_id, o.amount, o.status, o.created_at,
  CASE
    WHEN o.user_id = (SELECT auth.uid())
      AND lower(COALESCE(o.status, '')) = 'completed'
      AND (
        o.created_at < '2026-09-19 00:00:00+00'::timestamptz
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
WHERE o.user_id = (SELECT auth.uid()) OR public.is_admin_profile();

ALTER VIEW public.orders_safe_history
  SET (security_invoker = false, security_barrier = true);

DO $grant_protected_truth_owner$
DECLARE
  v_truth_owner text;
BEGIN
  SELECT r.rolname INTO v_truth_owner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.wallet_financial_truth_internal(uuid)'::regprocedure;

  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION public.wallet_legacy_funding_cutoff() TO %I',
    v_truth_owner
  );

  IF NOT pg_catalog.has_function_privilege(
    v_truth_owner,
    'public.wallet_legacy_funding_cutoff()'::regprocedure,
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.wallet_legacy_funding_cutoff()'::regprocedure,
    'EXECUTE'
  )
  THEN
    RAISE EXCEPTION 'protected_legacy_cutoff_grant_failed';
  END IF;
END;
$grant_protected_truth_owner$;
