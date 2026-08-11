-- MuaBanVia auto-fulfillment migration
-- Run this once in the Supabase SQL editor.
-- Adds the mapping columns needed to auto-fulfill a product group from MuaBanVia
-- when the pre-stocked individual_accounts inventory runs out.

ALTER TABLE product_groups
  ADD COLUMN IF NOT EXISTS muabanvia_product_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_fulfill_enabled BOOLEAN NOT NULL DEFAULT false;

-- (Optional) track which individual_accounts rows were auto-fulfilled vs pre-stocked,
-- useful for support/debugging.
ALTER TABLE individual_accounts
  ADD COLUMN IF NOT EXISTS fulfillment_source TEXT NOT NULL DEFAULT 'manual';
