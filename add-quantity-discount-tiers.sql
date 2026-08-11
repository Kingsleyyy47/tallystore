-- "Buy more, save more" quantity discount tiers
-- Run this once in the Supabase SQL editor.
--
-- This is the practical version of "bundle deals" for this store: since
-- checkout here is single-product-group + quantity (no multi-item cart),
-- a cross-product bundle would require rebuilding checkout into a real cart
-- system. Quantity tiers deliver the same "buy more, save more" incentive
-- using the existing architecture - increase quantity on one product, the
-- per-unit price drops at configured thresholds.
--
-- tiers shape: [{"min_qty": 5, "discount_pct": 10}, {"min_qty": 10, "discount_pct": 20}]
-- Empty array ([]) means no discount tiers configured - price is unaffected.
-- The HIGHEST tier whose min_qty the purchased quantity meets or exceeds applies.

ALTER TABLE product_groups
  ADD COLUMN IF NOT EXISTS quantity_discount_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;
