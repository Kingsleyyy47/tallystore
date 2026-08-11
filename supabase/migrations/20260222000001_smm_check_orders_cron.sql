-- Schedule SMM order status checker to run every 15 minutes
-- This automatically polls the SMM panel for status updates on all active orders
-- and handles auto-refunds for cancelled/partial/failed orders

SELECT cron.schedule(
  'smm-check-all-orders-job',              -- Job name
  '*/15 * * * *',                          -- Every 15 minutes
  $$ 
    SELECT
      net.http_post(
        url:=current_setting('app.supabase_url') || '/functions/v1/smm-check-all-orders',
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
        ),
        body:='{}'::jsonb
      );
  $$
);

-- To view all cron jobs:
-- SELECT * FROM cron.job;

-- To manually unschedule this job:
-- SELECT cron.unschedule('smm-check-all-orders-job');
