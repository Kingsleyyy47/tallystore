-- Pending payment recovery should run every 10 minutes.
-- Do not store service-role keys or custom app.* GUC values in Supabase SQL.
-- Deploy check-pending-payments as a scheduled Edge Function or external cron,
-- with verify_jwt=false and x-cron-secret set to PAYMENT_RECOVERY_CRON_SECRET
-- or REVENUE_OS_CRON_SECRET.

DO $$
BEGIN
  PERFORM cron.unschedule('check-pending-payments-job');
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- To view all cron jobs:
-- SELECT * FROM cron.job;

-- To manually unschedule this job:
-- SELECT cron.unschedule('check-pending-payments-job');
