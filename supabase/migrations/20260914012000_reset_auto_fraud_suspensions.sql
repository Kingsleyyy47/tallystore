-- Incident update: automatic fraud suspensions are no longer cleared by
-- migration. Reinstatement must go through the admin review workflow after
-- wallet backing, provider evidence, and undispatched order state are checked.
--
-- This file intentionally performs no data mutation.
DO $$
BEGIN
  RAISE NOTICE 'reset_auto_fraud_suspensions skipped: owner review is required for reinstatement';
END $$;
