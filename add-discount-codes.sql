-- Discount codes / flash sales migration
-- Run this once in the Supabase SQL editor.
--
-- A code can be store-wide (category_id and product_group_id both null) or
-- scoped to one category or one specific product. percent_off is 1-100.
-- max_uses null = unlimited. expires_at null = never expires.
-- used_count is incremented server-side (process-purchase edge function)
-- every time the code is successfully applied to a completed order - never
-- incremented client-side, so it can't be gamed by retrying failed requests.

CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  percent_off SMALLINT NOT NULL CHECK (percent_off >= 1 AND percent_off <= 100),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  product_group_id UUID REFERENCES product_groups(id) ON DELETE CASCADE,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes (code);

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;

-- Anyone can read active, non-expired codes (needed so checkout can validate
-- and preview the discount before the purchase edge function re-validates
-- it server-side for the actual charge).
DROP POLICY IF EXISTS "Anyone can read active discount codes" ON discount_codes;
CREATE POLICY "Anyone can read active discount codes"
ON discount_codes FOR SELECT
TO authenticated, anon
USING (is_active = true);

-- Only admins can create/update/delete codes
DROP POLICY IF EXISTS "Admin can manage discount codes" ON discount_codes;
CREATE POLICY "Admin can manage discount codes"
ON discount_codes FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
);

-- Track which order used which code, for reporting and to prevent a single
-- user re-using a one-per-customer code (not enforced yet, but the data is
-- here if you want to add that rule later).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id);
