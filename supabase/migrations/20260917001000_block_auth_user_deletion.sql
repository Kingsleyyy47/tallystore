-- Auth users are financial identity roots. If an auth user is deleted, related
-- rows with ON DELETE CASCADE can disappear too. Block that by default.

CREATE TABLE IF NOT EXISTS public.auth_user_delete_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  attempted_by uuid,
  attempted_role text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  row_snapshot jsonb NOT NULL
);

ALTER TABLE public.auth_user_delete_audit ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.auth_user_delete_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read auth user delete audit" ON public.auth_user_delete_audit;
CREATE POLICY "Admins can read auth user delete audit"
ON public.auth_user_delete_audit
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

CREATE OR REPLACE FUNCTION public.block_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.auth_user_delete_audit (
    user_id,
    email,
    attempted_by,
    attempted_role,
    row_snapshot
  )
  VALUES (
    OLD.id,
    OLD.email,
    auth.uid(),
    current_user,
    jsonb_build_object(
      'id', OLD.id,
      'aud', OLD.aud,
      'role', OLD.role,
      'email', OLD.email,
      'phone', OLD.phone,
      'created_at', OLD.created_at,
      'updated_at', OLD.updated_at,
      'last_sign_in_at', OLD.last_sign_in_at,
      'email_confirmed_at', OLD.email_confirmed_at,
      'phone_confirmed_at', OLD.phone_confirmed_at,
      'is_anonymous', OLD.is_anonymous
    )
  );

  IF current_setting('app.allow_auth_user_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  -- Returning NULL cancels the delete while keeping the audit insert committed.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.block_auth_user_delete() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_auth_user_delete ON auth.users;
CREATE TRIGGER prevent_auth_user_delete
BEFORE DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.block_auth_user_delete();
