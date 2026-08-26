-- SMM order status checker should run every 15 minutes.
-- Do not store service-role keys or custom app.* GUC values in Supabase SQL.
-- Deploy smm-check-all-orders as a scheduled Edge Function or external cron,
-- with verify_jwt=false and x-cron-secret set to SMM_CRON_SECRET or
-- REVENUE_OS_CRON_SECRET.

DO $$
BEGIN
  PERFORM cron.unschedule('smm-check-all-orders-job');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- To view all cron jobs:
-- SELECT * FROM cron.job;

-- To manually unschedule this job:
-- SELECT cron.unschedule('smm-check-all-orders-job');
