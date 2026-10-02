-- Owner-enabled staff capabilities can apply immediately. Balance adjustments
-- always require a separate owner review, even if an old client requests auto approval.
DO $preflight$
BEGIN
  IF to_regclass('public.staff_permissions') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.staff_permissions'::regclass
        AND conname = 'staff_permissions_review_only'
    )
  THEN
    RAISE EXCEPTION 'Expected staff permission review guard is missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.staff_permissions
  DROP CONSTRAINT staff_permissions_review_only;

UPDATE public.staff_permissions
SET auto_approve = is_enabled AND permission_key <> 'action_adjust_balance',
    updated_at = now()
WHERE auto_approve IS DISTINCT FROM (is_enabled AND permission_key <> 'action_adjust_balance');

ALTER TABLE public.staff_permissions
  ADD CONSTRAINT staff_permissions_auto_approval_scope
  CHECK (auto_approve = false OR (is_enabled = true AND permission_key <> 'action_adjust_balance'));
