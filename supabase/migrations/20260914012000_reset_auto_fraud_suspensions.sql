-- Clear the false-positive automatic fraud suspensions created by the old
-- credit/spend audit, without touching manual admin suspensions.

UPDATE public.profiles
SET account_suspended = false,
    suspension_reason = NULL,
    suspension_reinstated_at = now(),
    reinstated_by = NULL,
    updated_at = now()
WHERE COALESCE(account_suspended, false) = true
  AND COALESCE(is_admin, false) = false
  AND COALESCE(is_staff, false) = false
  AND COALESCE(suspension_reason, '') LIKE 'Auto-suspended:%';

UPDATE public.fraud_device_bans
SET active = false,
    deactivated_at = now(),
    deactivated_by = NULL
WHERE active = true
  AND COALESCE(reason, '') LIKE 'Auto-suspended:%';
