-- Product suggestions migration
-- Run this once in the Supabase SQL editor.
--
-- Powers an admin-facing "trending category, want to add a product?" panel.
-- Trigger is your OWN store's sales velocity (units sold per category, this
-- week vs last week) - not a live scan of MuaBanVia/ShopClone/ShopViaClone22
-- yet, since we haven't confirmed what their products.php catalog endpoint
-- actually returns. That can be layered in later without touching this table.
--
-- Flow:
--   1. Admin opens the Suggestions panel -> client computes trending
--      categories from `orders`, and upserts a 'pending' row here for any
--      newly-trending category that doesn't already have an active
--      suggestion (pending or snoozed-but-still-cooling-down).
--   2. Admin clicks "Not now" -> status set to 'dismissed', snoozed_until set
--      a few days out. Won't resurface until that date even if the trend
--      continues, but will resurface fresh once it passes.
--   3. Admin clicks "Add product" -> status set to 'accepted', a new DRAFT
--      product_group row is created (cloning name/description/price/category
--      from the based_on template, provider ID fields left blank) and linked
--      via created_product_group_id. The actual stock purchase is a separate,
--      explicit action the admin takes afterwards (filling in a provider ID
--      and clicking "Test Stock") - accepting a suggestion never spends money
--      by itself.

CREATE TABLE IF NOT EXISTS product_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  based_on_product_group_id UUID REFERENCES product_groups(id) ON DELETE SET NULL,
  created_product_group_id UUID REFERENCES product_groups(id) ON DELETE SET NULL,
  suggested_name TEXT NOT NULL,
  reason TEXT,
  velocity_recent NUMERIC,
  velocity_previous NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE product_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage product suggestions" ON product_suggestions;
CREATE POLICY "Admin can manage product suggestions"
ON product_suggestions FOR ALL
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
