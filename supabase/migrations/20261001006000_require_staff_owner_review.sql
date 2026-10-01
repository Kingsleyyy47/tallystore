-- Staff can propose permitted changes, but only the owner may apply them.
-- Keep the old column for compatibility with existing clients while making
-- auto approval impossible at the database boundary.
DO $preflight$
BEGIN
  IF to_regclass('public.staff_permissions') IS NULL THEN
    RAISE EXCEPTION 'Staff permissions table is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.staff_permissions'::regclass
      AND conname = 'staff_permissions_review_only'
  ) THEN
    RAISE EXCEPTION 'Staff owner review constraint already exists';
  END IF;
END;
$preflight$;

UPDATE public.staff_permissions SET auto_approve = false
WHERE auto_approve IS DISTINCT FROM false;

ALTER TABLE public.staff_permissions
  ALTER COLUMN auto_approve SET DEFAULT false,
  ADD CONSTRAINT staff_permissions_review_only CHECK (auto_approve = false);
