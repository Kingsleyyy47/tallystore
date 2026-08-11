-- ShopClone + ShopViaClone22 auto-fulfillment migration
-- Run this once in the Supabase SQL editor.
-- Adds the mapping columns needed to auto-fulfill a product group from ShopClone
-- and ShopViaClone22, used as fallback providers alongside MuaBanVia (e.g. when
-- MuaBanVia is having issues, or as a per-product alternative).
--
-- A provider is "active" for a product simply by filling in its product-id column.
-- Leave a column blank to skip that provider entirely for that product. At purchase
-- time, process-purchase tries MuaBanVia first (if auto_fulfill_enabled + configured),
-- then ShopClone (if configured), then ShopViaClone22 (if configured) - stopping as
-- soon as the stock shortfall is covered. If none are configured or all fail, the
-- purchase fails with the normal out-of-stock error.

ALTER TABLE product_groups
  ADD COLUMN IF NOT EXISTS shopclone_product_id TEXT,
  ADD COLUMN IF NOT EXISTS shopviaclone_product_id TEXT;
