-- Reward discount codes migration
-- Run this once in the Supabase SQL editor.
--
-- Adds three columns to discount_codes:
--   max_order_amount  — code only applies when the order total is at or below this (NGN)
--   user_id           — restricts a code to one specific customer (null = store-wide)
--   is_reward         — true for auto-generated loyalty rewards, false for admin-created codes
--
-- Also tightens the RLS SELECT policy so user-specific codes are only visible
-- to their owner (prevents "code not for you" confusion in checkout UX).

ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS max_order_amount INTEGER,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_reward BOOLEAN NOT NULL DEFAULT false;

-- Re-create SELECT policy: store-wide codes visible to all; user-specific codes only to their owner
DROP POLICY IF EXISTS "Anyone can read active discount codes" ON discount_codes;
CREATE POLICY "Anyone can read active discount codes"
ON discount_codes FOR SELECT
TO authenticated, anon
USING (
  is_active = true
  AND (user_id IS NULL OR user_id = auth.uid())
);
