-- Only manage-staff may submit or review queued staff actions. Browser users
-- may read their own history, but must not manufacture approval requests.
DO $restrict$
DECLARE
  v_column text;
BEGIN
  IF to_regclass('public.staff_pending_actions') IS NULL THEN
    RAISE EXCEPTION 'staff_pending_actions_required_before_wallet_security_migration';
  END IF;

  DROP POLICY IF EXISTS "Staff can insert own pending actions"
    ON public.staff_pending_actions;

  REVOKE ALL ON TABLE public.staff_pending_actions
    FROM PUBLIC, anon, authenticated;
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.staff_pending_actions'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.staff_pending_actions FROM PUBLIC, anon, authenticated',
      v_column, v_column, v_column, v_column
    );
  END LOOP;

  GRANT SELECT ON TABLE public.staff_pending_actions TO authenticated;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_pending_actions TO service_role;

  DROP POLICY IF EXISTS "Staff can read own pending actions"
    ON public.staff_pending_actions;
  CREATE POLICY "Staff can read own pending actions"
    ON public.staff_pending_actions FOR SELECT TO authenticated
    USING (staff_id = auth.uid());

  ALTER TABLE public.staff_pending_actions
    DROP CONSTRAINT IF EXISTS staff_pending_actions_status_check;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.staff_pending_actions'::regclass
      AND c.contype = 'c'
      AND position('status' IN lower(pg_catalog.pg_get_constraintdef(c.oid))) > 0
      AND position('failed' IN lower(pg_catalog.pg_get_constraintdef(c.oid))) = 0
  ) THEN
    RAISE EXCEPTION 'staff_pending_actions_unrecognized_status_constraint';
  END IF;
  ALTER TABLE public.staff_pending_actions
    ADD CONSTRAINT staff_pending_actions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'failed'));
END;
$restrict$;
