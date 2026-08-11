-- Auto-restock migration
-- Run this once in the Supabase SQL editor.
--
-- Adds what's needed for the proactive auto-restock system: a per-product
-- on/off switch + buffer-days override, and a log table so every restock
-- attempt (success or failure) is visible after the fact since this runs
-- unattended on a schedule.

ALTER TABLE product_groups
  ADD COLUMN IF NOT EXISTS auto_restock_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS restock_buffer_days NUMERIC NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS auto_restock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_group_id UUID REFERENCES product_groups(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  daily_velocity NUMERIC,
  target_stock INTEGER,
  stock_before INTEGER,
  requested_qty INTEGER,
  fulfilled_qty INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auto_restock_logs DISABLE ROW LEVEL SECURITY;

-- Tunable caps, editable any time without redeploying (same key/value table
-- already used for referral_commission_pct and the NGN/USD rate override).
-- max_per_product = most units auto-restock will buy for a single product in
-- one run. max_total_per_run = most units it will buy across ALL products in
-- one run, as a runaway-spend safety net.
INSERT INTO app_settings (key, value) VALUES
  ('auto_restock_max_per_product', '30'),
  ('auto_restock_max_total_per_run', '150'),
  ('auto_restock_safety_multiplier', '1.15')
ON CONFLICT (key) DO NOTHING;
