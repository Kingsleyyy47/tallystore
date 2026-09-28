-- The old profile SELECT policy queried profiles from its own policy, and
-- is_admin_profile() did the same as an invoker. Keep the admin decision bound
-- to auth.uid(), but evaluate it under a trusted table-owning function.
DO $preflight$
DECLARE
  v_safe_owner boolean;
  v_select_policy_count integer;
  v_original_policy boolean;
  v_live_admin_policy boolean;
  v_live_staff_policy boolean;
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'profile admin reader objects missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'account_suspended' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'profiles.account_suspended missing; review schema first';
  END IF;

  SELECT (f.proowner = c.relowner AND NOT c.relforcerowsecurity)
    OR owner_role.rolbypassrls
  INTO v_safe_owner
  FROM pg_catalog.pg_proc f
  JOIN pg_catalog.pg_class c ON c.oid = 'public.profiles'::regclass
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = f.proowner
  WHERE f.oid = 'public.is_admin_profile()'::regprocedure;

  IF NOT COALESCE(v_safe_owner, false) THEN
    RAISE EXCEPTION 'is_admin_profile owner cannot bypass profiles RLS; review ownership first';
  END IF;
  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
    AND cmd IN ('SELECT', 'ALL');
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Admin can read all profiles' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
  ) INTO v_original_policy;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Users and admins can read profiles' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND permissive = 'PERMISSIVE' AND qual LIKE '%is_admin()%'
  ) INTO v_live_admin_policy;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_select' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND permissive = 'PERMISSIVE' AND qual LIKE '%is_staff_or_admin()%'
  ) INTO v_live_staff_policy;
  IF NOT (
    (v_select_policy_count = 1 AND v_original_policy)
    OR (v_select_policy_count = 2 AND v_live_admin_policy AND v_live_staff_policy)
  ) THEN
    RAISE EXCEPTION 'unexpected profile SELECT policy layout; review deployed policies first';
  END IF;
  IF to_regprocedure('public.wallet_active_staff_profile_reader()') IS NOT NULL THEN
    IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.wallet_active_staff_profile_reader()'::regprocedure
      ), 'COALESCE(p.is_staff, false)'
    ) = 0 THEN
      RAISE EXCEPTION 'existing staff profile reader has an unexpected definition';
    END IF;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_admin_profile()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_admin, false)
      AND NOT COALESCE(p.account_suspended, false)
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_profile() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wallet_active_staff_profile_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_staff, false)
      AND NOT COALESCE(p.account_suspended, false)
  );
$$;

REVOKE ALL ON FUNCTION public.wallet_active_staff_profile_reader()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_active_staff_profile_reader()
  TO authenticated, service_role;

DO $swap$
DECLARE
  v_allow_staff boolean;
  v_safe_owner boolean;
  v_select_policy_count integer;
BEGIN
  SELECT (f.proowner = c.relowner AND NOT c.relforcerowsecurity)
    OR owner_role.rolbypassrls
  INTO v_safe_owner
  FROM pg_catalog.pg_proc f
  JOIN pg_catalog.pg_class c ON c.oid = 'public.profiles'::regclass
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = f.proowner
  WHERE f.oid = 'public.wallet_active_staff_profile_reader()'::regprocedure;
  IF NOT COALESCE(v_safe_owner, false) THEN
    RAISE EXCEPTION 'staff profile reader owner cannot bypass profiles RLS';
  END IF;

  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
    AND cmd IN ('SELECT', 'ALL');
  v_allow_staff := EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND cmd = 'SELECT'
      AND (
        policyname = 'profiles_select'
        OR (policyname = 'Admin can read all profiles'
          AND qual LIKE '%wallet_active_staff_profile_reader()%')
      )
  );
  IF NOT (
    (v_select_policy_count = 1 AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
        AND policyname = 'Admin can read all profiles' AND cmd = 'SELECT'
    ))
    OR (v_select_policy_count = 2 AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
        AND policyname = 'Users and admins can read profiles' AND cmd = 'SELECT'
    ) AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
        AND policyname = 'profiles_select' AND cmd = 'SELECT'
    ))
  ) THEN
    RAISE EXCEPTION 'profile SELECT policies changed during migration';
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Users and admins can read profiles" ON public.profiles';
  EXECUTE 'DROP POLICY IF EXISTS profiles_select ON public.profiles';
  EXECUTE 'DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles';
  IF v_allow_staff THEN
    EXECUTE 'CREATE POLICY "Admin can read all profiles" ON public.profiles '
      || 'FOR SELECT TO authenticated USING ('
      || 'id = auth.uid() OR public.is_admin_profile() '
      || 'OR public.wallet_active_staff_profile_reader())';
  ELSE
    EXECUTE 'CREATE POLICY "Admin can read all profiles" ON public.profiles '
      || 'FOR SELECT TO authenticated USING ('
      || 'id = auth.uid() OR public.is_admin_profile())';
  END IF;
END;
$swap$;
