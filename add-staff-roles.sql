-- Staff roles migration
-- Run once in the Supabase SQL editor.
--
-- Adds a lightweight staff role layer on top of the existing user/admin system.
-- Staff members are normal users who have been granted limited admin access.
-- Their capabilities are individually toggled per-user in staff_permissions.
-- Actions that are not set to auto_approve go into staff_pending_actions for
-- the super-admin to review and apply.

-- 1. Mark a profile as staff
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_staff BOOLEAN NOT NULL DEFAULT false;

-- 2. Per-user, per-permission settings
CREATE TABLE IF NOT EXISTS staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_approve BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_permissions_user ON staff_permissions(user_id);

ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;

-- Staff can read their own permissions
DROP POLICY IF EXISTS "Staff can read own permissions" ON staff_permissions;
CREATE POLICY "Staff can read own permissions"
ON staff_permissions FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins manage via service role (edge function / direct SQL)

-- 3. Pending actions queue
CREATE TABLE IF NOT EXISTS staff_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_email TEXT,
  permission_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_label TEXT NOT NULL,
  action_data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_pending_status ON staff_pending_actions(status);

ALTER TABLE staff_pending_actions ENABLE ROW LEVEL SECURITY;

-- Staff can insert their own pending actions and read their own history
DROP POLICY IF EXISTS "Staff can insert own pending actions" ON staff_pending_actions;
CREATE POLICY "Staff can insert own pending actions"
ON staff_pending_actions FOR INSERT
TO authenticated
WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read own pending actions" ON staff_pending_actions;
CREATE POLICY "Staff can read own pending actions"
ON staff_pending_actions FOR SELECT
TO authenticated
USING (staff_id = auth.uid());

-- Admins read/update all pending actions via service role key
