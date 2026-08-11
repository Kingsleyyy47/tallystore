-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cron job to check pending payments every 10 minutes
-- This will automatically credit stuck payments without user intervention
SELECT cron.schedule(
  'check-pending-payments-job',           -- Job name
  '*/10 * * * *',                         -- Every 10 minutes
  $$ 
    SELECT
      net.http_post(
        url:=current_setting('app.supabase_url') || '/functions/v1/check-pending-payments',
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
        ),
        body:='{}'::jsonb
      );
  $$
);

-- Note: You need to set these configuration parameters in Supabase Dashboard:
-- 1. Go to Project Settings > Database > Configuration
-- 2. Add: app.supabase_url = https://your-project.supabase.co
-- 3. Add: app.supabase_service_role_key = your_service_role_key

-- To view all cron jobs:
-- SELECT * FROM cron.job;

-- To manually unschedule this job:
-- SELECT cron.unschedule('check-pending-payments-job');
