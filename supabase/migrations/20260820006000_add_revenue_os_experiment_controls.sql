-- Tally Revenue OS 2.0 experiment controls.
-- Keeps a permanent holdout and lets admins pause experiment assignment independently.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('cro_global_holdout_pct', '5', now()),
  ('cro_experimentation_enabled', 'false', now())
ON CONFLICT (key) DO NOTHING;
