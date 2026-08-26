-- Revenue OS promotion guardrails.
-- These keep autonomous promotion logic bounded and auditable.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('cro_promotion_max_discount_pct', '20', now()),
  ('cro_promotion_monthly_budget_ngn', '0', now()),
  ('cro_promotion_min_purchase_intent_for_suppression', '0.85', now()),
  ('cro_promotion_autonomy_enabled', 'false', now())
ON CONFLICT (key) DO NOTHING;
