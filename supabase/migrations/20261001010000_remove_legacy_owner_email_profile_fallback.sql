-- A current database role, not a JWT email string, controls profile access.
-- Owner and staff administration already use separately authorized server RPCs.
DO $guard$
DECLARE
  v_policy pg_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
    AND policyname = 'profiles_update';

  IF NOT FOUND
     OR v_policy.cmd <> 'UPDATE'
     OR pg_catalog.strpos(COALESCE(v_policy.qual, ''), 'auth.jwt()') = 0
     OR pg_catalog.strpos(COALESCE(v_policy.with_check, ''), 'auth.jwt()') = 0
  THEN
    RAISE EXCEPTION 'Unexpected profile update policy; review before removing email fallback';
  END IF;
END;
$guard$;

DROP POLICY profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

-- No current policy or app caller uses this legacy role helper. Retain a
-- current-role definition for server compatibility but remove browser access.
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND (p.is_staff IS TRUE OR p.is_admin IS TRUE)
      AND p.account_suspended IS NOT TRUE
  );
$function$;

REVOKE ALL ON FUNCTION public.is_staff_or_admin()
FROM PUBLIC, anon, authenticated;
