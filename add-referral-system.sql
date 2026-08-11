-- Referral system migration
-- Run this once in the Supabase SQL editor.
-- Run create-app-settings-table.sql FIRST (or alongside) if you haven't already,
-- since the referral commission % setting lives there.
-- Adds: referral_code, referred_by, referral_balance to profiles,
-- plus a referral_earnings audit table.

-- 1. Add referral columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS referral_balance NUMERIC NOT NULL DEFAULT 0;

-- 2. Backfill a referral code for any existing users that don't have one yet
UPDATE profiles
SET referral_code = UPPER(SUBSTRING(id::text, 1, 8))
WHERE referral_code IS NULL;

-- 3. Audit table: every time a referred user makes a purchase, log the reward here
CREATE TABLE IF NOT EXISTS referral_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_amount NUMERIC NOT NULL,
  commission_pct NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS disabled, consistent with the rest of this project's tables
ALTER TABLE referral_earnings DISABLE ROW LEVEL SECURITY;

-- Index for fast referral code lookups at signup
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer ON referral_earnings(referrer_id);
