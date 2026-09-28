-- The storefront needs a small public configuration subset. Internal cost,
-- provider, and operational settings must not be enumerable by browser roles.
DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_public_keys" ON public.app_settings;

CREATE POLICY "app_settings_public_keys"
ON public.app_settings
FOR SELECT
TO anon, authenticated
USING (
  key IN (
    'ngn_usd_rate',
    'ercas_enabled',
    'bitrefill_markup_pct',
    'sales_favorite_product_group_ids',
    'sales_recommendation_automation_enabled',
    'support_whatsapp_url',
    'support_telegram_url',
    'support_channel_url',
    'support_popup_message',
    'cro_global_enabled',
    'cro_shadow_mode_enabled',
    'cro_autonomy_level',
    'cro_exploration_pct',
    'cro_pressure_limit',
    'cro_global_holdout_pct',
    'cro_experimentation_enabled',
    'cro_maintenance_freeze_reason'
  )
  OR (
    key = 'referral_commission_pct'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_staff = true
    )
  )
);

-- The existing admin-write policy also permits current admins to read all
-- settings. No anonymous or ordinary-customer policy exposes other keys.
