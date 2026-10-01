-- Staff actions must go through permission-checked server functions. A staff
-- flag alone must never grant broad table writes or customer profile reads.
DO $preflight$
BEGIN
  IF to_regclass('public.app_settings') IS NULL
    OR to_regclass('public.categories') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
    OR to_regclass('public.staff_pending_actions') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'implicit_staff_access_required_object_missing';
  END IF;
END;
$preflight$;

-- The old ALL policies admitted every staff user, including one with zero
-- enabled permissions. Existing admin-only and public-read policies remain.
DROP POLICY IF EXISTS app_settings_write ON public.app_settings;
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_admin_select ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_admin_profile());

DROP POLICY IF EXISTS staff_admin_categories_write ON public.categories;

-- The staff customer-search function returns a limited, permission-checked
-- result. Direct PostgREST access to every customer profile is unnecessary.
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
CREATE POLICY "Admin can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin_profile());

-- Remove legacy email-based and self-insert policies left by earlier staff
-- migrations. Staff history is read-only and restricted by the current role
-- and permission policy installed in the preceding migration.
DROP POLICY IF EXISTS pending_actions_insert ON public.staff_pending_actions;
DROP POLICY IF EXISTS pending_actions_select ON public.staff_pending_actions;
DROP POLICY IF EXISTS pending_actions_admin_update ON public.staff_pending_actions;
DROP POLICY IF EXISTS staff_permissions_admin_write ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_select ON public.staff_permissions;
