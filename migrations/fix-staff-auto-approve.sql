-- ============================================================
-- Fix: Set auto_approve = true for all existing staff permissions
-- Previously staff had to wait for admin approval on every action
-- even when the permission was enabled. This makes ON = full access.
-- Run in Supabase SQL Editor.
-- ============================================================

UPDATE public.staff_permissions
SET auto_approve = true
WHERE is_enabled = true;

-- Also fix any disabled ones so they default to auto_approve when re-enabled
UPDATE public.staff_permissions
SET auto_approve = true;

-- Confirm
SELECT user_id, permission_key, is_enabled, auto_approve
FROM public.staff_permissions
ORDER BY user_id, permission_key;
