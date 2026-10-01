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
  auto_approve BOOLEAN NOT NULL DEFAULT false,
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_pending_status ON staff_pending_actions(status);

ALTER TABLE staff_pending_actions ENABLE ROW LEVEL SECURITY;

-- Only the manage-staff Edge Function may create pending actions. A browser
-- insert would bypass the server-side permission and action checks.
DROP POLICY IF EXISTS "Staff can insert own pending actions" ON staff_pending_actions;

REVOKE ALL ON TABLE staff_pending_actions FROM PUBLIC, anon, authenticated;
DO $restrict_staff_queue_columns$
DECLARE v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.staff_pending_actions'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.staff_pending_actions FROM PUBLIC, anon, authenticated',
      v_column, v_column, v_column, v_column
    );
  END LOOP;
END;
$restrict_staff_queue_columns$;
GRANT SELECT ON TABLE staff_pending_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE staff_pending_actions TO service_role;

DROP POLICY IF EXISTS "Staff can read own pending actions" ON staff_pending_actions;
CREATE POLICY "Staff can read own pending actions"
ON staff_pending_actions FOR SELECT
TO authenticated
USING (staff_id = auth.uid());

-- Admins read/update all pending actions via service role key
