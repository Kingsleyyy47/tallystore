-- Base financial history must not remain cross-customer readable through a
-- suspended admin's old JWT. Customer self-history remains permitted.
DO $policy_patch$
DECLARE
  v_target record;
  v_policy record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('public.is_admin_profile()')
      AND p.prosecdef
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),
        'NOT COALESCE(p.account_suspended, false)') > 0
      AND EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS setting
        WHERE setting IN ('search_path=', 'search_path=""')
      )
  ) THEN
    RAISE EXCEPTION 'financial_history_active_admin_helper_missing';
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('orders', 'Admin can read all orders',
        'Users and admins can read orders', 'orders_customer_active_admin_limit'),
      ('transactions', 'Admin can read all transactions',
        'Users and admins can read transactions',
        'transactions_customer_active_admin_limit')
    ) AS target(table_name, original_policy, live_policy, guard_policy)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', v_target.table_name))
        AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'financial_history_rls_missing: %', v_target.table_name;
    END IF;

    SELECT policyname, roles, permissive, qual INTO v_policy
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = v_target.table_name
      AND cmd = 'SELECT'
      AND policyname IN (v_target.original_policy, v_target.live_policy);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'financial_history_admin_policy_missing: %', v_target.table_name;
    END IF;
    IF v_policy.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
      OR v_policy.permissive IS DISTINCT FROM 'PERMISSIVE'
      OR (v_policy.policyname = v_target.live_policy
        AND NOT (
          (COALESCE(v_policy.qual LIKE '%auth.uid() = user_id%', false)
            OR COALESCE(v_policy.qual LIKE '%user_id = auth.uid()%', false))
          AND (COALESCE(v_policy.qual LIKE '%is_admin()%', false)
            OR COALESCE(v_policy.qual LIKE '%is_admin_profile()%', false))
        ))
    THEN
      RAISE EXCEPTION 'financial_history_admin_policy_missing: %', v_target.table_name;
    END IF;
    IF (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = v_target.table_name
        AND cmd IN ('SELECT', 'ALL')
        AND policyname <> v_target.guard_policy
    ) <> 1 OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = v_target.table_name
        AND policyname = v_target.guard_policy
        AND NOT (
          cmd = 'SELECT' AND permissive = 'RESTRICTIVE'
          AND roles = ARRAY['authenticated']::name[]
        )
    ) THEN
      RAISE EXCEPTION 'unexpected financial history read policies: %', v_target.table_name;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER POLICY %I ON public.%I USING (user_id = auth.uid() OR public.is_admin_profile())',
      v_policy.policyname, v_target.table_name
    );
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON public.%I',
      v_target.guard_policy, v_target.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
      || 'USING (user_id = auth.uid() OR public.is_admin_profile())',
      v_target.guard_policy, v_target.table_name
    );
  END LOOP;
END;
$policy_patch$;
