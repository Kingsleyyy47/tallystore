-- Schedule deterministic Revenue OS maintenance.
-- This runs guardrail checks, feature snapshots, opportunities, forecasts,
-- action-plan generation, drift checks, and a data-quality freeze if needed.
--
-- Do not store service-role keys or custom app.* GUC values in Supabase SQL.
-- Supabase Cloud does not support the current_setting('app.*') pattern used by
-- earlier drafts. Deploy revenue-os-maintenance as a scheduled Edge Function
-- or external cron, with verify_jwt=false and x-cron-secret set to
-- REVENUE_OS_CRON_SECRET.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('cro_maintenance_enabled', 'true', now()),
  ('cro_maintenance_last_status', 'never_run', now()),
  ('cro_maintenance_last_run_at', '', now()),
  ('cro_maintenance_last_summary', '{}', now()),
  ('cro_maintenance_freeze_reason', '', now()),
  ('cro_maintenance_schedule_mode', 'edge_function_schedule', now())
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  PERFORM cron.unschedule('revenue-os-maintenance-job');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- To view all cron jobs:
-- SELECT * FROM cron.job;

-- To manually unschedule this job:
-- SELECT cron.unschedule('revenue-os-maintenance-job');
