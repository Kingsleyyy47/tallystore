-- Harden catalog and inventory authority. Product metadata can be public/readable,
-- but only admins may mutate products or plaintext account inventory.

DO $$
DECLARE
  policy_row record;
BEGIN
  IF to_regclass('public.product_groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY';

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'product_groups'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.product_groups', policy_row.policyname);
    END LOOP;

    EXECUTE 'CREATE POLICY "product_groups public active read"
      ON public.product_groups
      FOR SELECT
      TO anon, authenticated
      USING (is_active = true)';

    EXECUTE 'CREATE POLICY "product_groups admin read all"
      ON public.product_groups
      FOR SELECT
      TO authenticated
      USING (public.is_admin_profile())';

    EXECUTE 'CREATE POLICY "product_groups admin write"
      ON public.product_groups
      FOR ALL
      TO authenticated
      USING (public.is_admin_profile())
      WITH CHECK (public.is_admin_profile())';

    EXECUTE 'GRANT SELECT ON public.product_groups TO anon, authenticated';
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON public.product_groups TO authenticated';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.product_groups FROM anon';
  END IF;

  IF to_regclass('public.individual_accounts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.individual_accounts ENABLE ROW LEVEL SECURITY';

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'individual_accounts'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.individual_accounts', policy_row.policyname);
    END LOOP;

    EXECUTE 'CREATE POLICY "individual_accounts admin all"
      ON public.individual_accounts
      FOR ALL
      TO authenticated
      USING (public.is_admin_profile())
      WITH CHECK (public.is_admin_profile())';

    EXECUTE 'REVOKE ALL ON public.individual_accounts FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.individual_accounts TO authenticated';
  END IF;
END $$;

