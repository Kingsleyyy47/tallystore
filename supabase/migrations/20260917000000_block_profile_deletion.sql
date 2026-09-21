-- Profiles are financial identity records. They must not be removable from the
-- public API, customer sessions, staff sessions, or ordinary service-role code.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE DELETE ON TABLE public.profiles FROM anon, authenticated;

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', policy_record.policyname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.profile_delete_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  email text,
  full_name text,
  wallet_balance numeric,
  is_admin boolean,
  is_staff boolean,
  attempted_by uuid,
  attempted_role text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  row_snapshot jsonb NOT NULL
);

ALTER TABLE public.profile_delete_audit ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.profile_delete_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read profile delete audit" ON public.profile_delete_audit;
CREATE POLICY "Admins can read profile delete audit"
ON public.profile_delete_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

CREATE OR REPLACE FUNCTION public.block_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_delete_audit (
    profile_id,
    email,
    full_name,
    wallet_balance,
    is_admin,
    is_staff,
    attempted_by,
    attempted_role,
    row_snapshot
  )
  VALUES (
    OLD.id,
    OLD.email,
    OLD.full_name,
    OLD.wallet_balance,
    OLD.is_admin,
    OLD.is_staff,
    auth.uid(),
    current_user,
    to_jsonb(OLD)
  );

  IF current_setting('app.allow_profile_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  -- Returning NULL cancels the delete while keeping the audit insert committed.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.block_profile_delete() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_profile_delete ON public.profiles;
CREATE TRIGGER prevent_profile_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.block_profile_delete();
