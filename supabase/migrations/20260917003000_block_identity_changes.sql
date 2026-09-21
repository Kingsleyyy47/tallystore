-- Block and audit identity changes that could let a fraud user hide by changing
-- account email, profile email, username when present, or display name.

CREATE TABLE IF NOT EXISTS public.auth_user_identity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  old_email text,
  new_email text,
  old_phone text,
  new_phone text,
  old_email_change text,
  new_email_change text,
  changed_by uuid,
  changed_role text,
  blocked boolean NOT NULL DEFAULT true,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_user_identity_audit ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.auth_user_identity_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read auth user identity audit" ON public.auth_user_identity_audit;
CREATE POLICY "Admins can read auth user identity audit"
ON public.auth_user_identity_audit
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

CREATE OR REPLACE FUNCTION public.block_auth_user_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allow_change boolean := current_setting('app.allow_auth_identity_change', true) = 'true';
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email
    OR OLD.phone IS DISTINCT FROM NEW.phone
    OR COALESCE(OLD.email_change, '') IS DISTINCT FROM COALESCE(NEW.email_change, '')
  THEN
    INSERT INTO public.auth_user_identity_audit (
      user_id,
      old_email,
      new_email,
      old_phone,
      new_phone,
      old_email_change,
      new_email_change,
      changed_by,
      changed_role,
      blocked
    )
    VALUES (
      OLD.id,
      OLD.email,
      NEW.email,
      OLD.phone,
      NEW.phone,
      OLD.email_change,
      NEW.email_change,
      auth.uid(),
      current_user,
      NOT allow_change
    );

    IF NOT allow_change THEN
      NEW.email := OLD.email;
      NEW.phone := OLD.phone;
      NEW.email_change := OLD.email_change;
      NEW.email_change_token_new := OLD.email_change_token_new;
      NEW.email_change_token_current := OLD.email_change_token_current;
      NEW.email_change_confirm_status := OLD.email_change_confirm_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_auth_user_identity_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_auth_user_identity_change ON auth.users;
CREATE TRIGGER prevent_auth_user_identity_change
BEFORE UPDATE OF email, phone, email_change, email_change_token_new, email_change_token_current, email_change_confirm_status ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.block_auth_user_identity_change();

CREATE TABLE IF NOT EXISTS public.profile_identity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  old_email text,
  new_email text,
  old_username text,
  new_username text,
  old_full_name text,
  new_full_name text,
  changed_by uuid,
  changed_role text,
  blocked boolean NOT NULL DEFAULT true,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_identity_audit ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.profile_identity_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read profile identity audit" ON public.profile_identity_audit;
CREATE POLICY "Admins can read profile identity audit"
ON public.profile_identity_audit
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

CREATE OR REPLACE FUNCTION public.block_profile_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allow_change boolean := current_setting('app.allow_profile_identity_change', true) = 'true';
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
BEGIN
  IF COALESCE(old_row->>'email', '') IS DISTINCT FROM COALESCE(new_row->>'email', '')
    OR COALESCE(old_row->>'username', '') IS DISTINCT FROM COALESCE(new_row->>'username', '')
    OR COALESCE(old_row->>'full_name', '') IS DISTINCT FROM COALESCE(new_row->>'full_name', '')
  THEN
    INSERT INTO public.profile_identity_audit (
      profile_id,
      old_email,
      new_email,
      old_username,
      new_username,
      old_full_name,
      new_full_name,
      changed_by,
      changed_role,
      blocked
    )
    VALUES (
      OLD.id,
      old_row->>'email',
      new_row->>'email',
      old_row->>'username',
      new_row->>'username',
      old_row->>'full_name',
      new_row->>'full_name',
      auth.uid(),
      current_user,
      NOT allow_change
    );

    IF NOT allow_change THEN
      NEW := jsonb_populate_record(
        NEW,
        jsonb_build_object(
          'email', old_row->'email',
          'username', old_row->'username',
          'full_name', old_row->'full_name'
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_profile_identity_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_profile_identity_change ON public.profiles;
CREATE TRIGGER prevent_profile_identity_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.block_profile_identity_change();
