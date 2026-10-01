-- A revoked staff account must not regain old permissions or queued actions
-- when its staff role is granted again.
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.staff_permissions') IS NULL
    OR to_regclass('public.staff_pending_actions') IS NULL
    OR to_regprocedure('public.set_staff_role(uuid,boolean,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'Required staff authority objects are missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.staff_permissions
  ALTER COLUMN auto_approve SET DEFAULT false;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_permissions
  FROM PUBLIC, anon, authenticated;

-- Staff only need the label and status of their own requests in the browser.
-- The payload may contain uploaded account credentials and stays server-only.
ALTER TABLE public.staff_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON TABLE public.staff_pending_actions
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_pending_actions
  FROM PUBLIC, anon, authenticated;
DO $revoke_staff_queue_columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.staff_pending_actions'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.staff_pending_actions FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$revoke_staff_queue_columns$;
GRANT SELECT (id, staff_id, action_label, status, created_at)
  ON TABLE public.staff_pending_actions TO authenticated;

DROP POLICY IF EXISTS "Staff can read own pending actions"
  ON public.staff_pending_actions;
CREATE POLICY "Staff can read own pending actions"
  ON public.staff_pending_actions FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.is_staff, false) = true
        AND COALESCE(p.is_admin, false) = false
        AND COALESCE(p.account_suspended, false) = false
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_permissions sp
      WHERE sp.user_id = auth.uid()
        AND sp.permission_key = staff_pending_actions.permission_key
        AND COALESCE(sp.is_enabled, false) = true
    )
  );

-- Existing permissions and requests belonging to former staff cannot become
-- active again simply because the role is granted later.
UPDATE public.staff_permissions sp
SET is_enabled = false,
    auto_approve = false,
    updated_at = now()
FROM public.profiles p
WHERE p.id = sp.user_id
  AND (COALESCE(p.is_staff, false) = false OR COALESCE(p.is_admin, false) = true)
  AND (sp.is_enabled = true OR sp.auto_approve = true);

UPDATE public.staff_pending_actions a
SET status = 'rejected',
    reviewed_at = now()
FROM public.profiles p
WHERE p.id = a.staff_id
  AND (COALESCE(p.is_staff, false) = false OR COALESCE(p.is_admin, false) = true)
  AND a.status = 'pending';

CREATE OR REPLACE FUNCTION public.set_staff_role(
  p_target_user_id uuid,
  p_is_staff boolean,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_profile record;
  target_profile record;
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_required';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'profile_actor_required';
  END IF;

  SELECT id, is_admin
  INTO actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;
  IF NOT FOUND OR NOT COALESCE(actor_profile.is_admin, false) THEN
    RAISE EXCEPTION 'profile_admin_actor_required';
  END IF;

  SELECT id, is_admin, is_staff
  INTO target_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF COALESCE(target_profile.is_admin, false) THEN
    RAISE EXCEPTION 'cannot_change_admin_staff_role';
  END IF;

  -- Reset authority on every revoke and on a new grant. Repeating a grant for
  -- an existing staff member preserves permissions already reviewed by owner.
  IF NOT COALESCE(p_is_staff, false) OR NOT COALESCE(target_profile.is_staff, false) THEN
    UPDATE public.staff_permissions
    SET is_enabled = false,
        auto_approve = false,
        updated_at = now()
    WHERE user_id = p_target_user_id
      AND (is_enabled = true OR auto_approve = true);

    UPDATE public.staff_pending_actions
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = p_actor_id
    WHERE staff_id = p_target_user_id
      AND status = 'pending';
  END IF;

  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'true', true);
  UPDATE public.profiles
  SET is_staff = COALESCE(p_is_staff, false),
      updated_at = now()
  WHERE id = p_target_user_id;
  PERFORM pg_catalog.set_config('app.tally_profile_privileged_authorized', 'false', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_staff_role(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_role(uuid, boolean, uuid)
  TO service_role;
