-- Defaults for Admin > Sales.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('sales_recommendation_automation_enabled', 'true', now()),
  ('sales_monthly_target_ngn', '0', now())
ON CONFLICT (key) DO NOTHING;
