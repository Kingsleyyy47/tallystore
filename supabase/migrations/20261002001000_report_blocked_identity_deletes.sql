-- A BEFORE DELETE trigger that returns NULL makes Supabase Auth's admin
-- deleteUser call report success while leaving the user and sessions active.
-- Fail explicitly instead. Keep the audit snapshot for authorized deletions.
CREATE OR REPLACE FUNCTION public.block_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF current_setting('app.allow_auth_user_delete', true) IS DISTINCT FROM 'true' THEN
    RAISE LOG 'Blocked auth user deletion requested by session role %', session_user;
    RAISE EXCEPTION 'Auth user deletion requires an explicit database override'
      USING ERRCODE = 'P2001';
  END IF;

  INSERT INTO public.auth_user_delete_audit (
    user_id, email, attempted_by, attempted_role, row_snapshot
  )
  VALUES (
    OLD.id, OLD.email, auth.uid(), current_user,
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
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_profile_delete', true) IS DISTINCT FROM 'true' THEN
    RAISE LOG 'Blocked profile deletion requested by session role %', session_user;
    RAISE EXCEPTION 'Profile deletion requires an explicit database override'
      USING ERRCODE = 'P2002';
  END IF;

  INSERT INTO public.profile_delete_audit (
    profile_id, email, full_name, wallet_balance, is_admin, is_staff,
    attempted_by, attempted_role, row_snapshot
  )
  VALUES (
    OLD.id, OLD.email, OLD.full_name, OLD.wallet_balance, OLD.is_admin,
    OLD.is_staff, auth.uid(), current_user, to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$;
