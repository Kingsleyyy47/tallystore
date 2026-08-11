-- App settings table migration
-- Run this once in the Supabase SQL editor (separate from add-referral-system.sql).
-- Used for: referral commission %, NGN/USD rate override, and any future toggles.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;

-- Default referral commission percentage (5%)
INSERT INTO app_settings (key, value)
VALUES ('referral_commission_pct', '5')
ON CONFLICT (key) DO NOTHING;
