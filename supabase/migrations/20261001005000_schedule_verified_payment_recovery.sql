-- Retry recent Ercas checkouts whose customer did not return to the site.
-- Provision the project URL and a random cron token in Supabase Vault first;
-- set the same token as the PAYMENT_RECOVERY_CRON_SECRET Edge secret.
-- No credential appears in cron.job or this migration.
DO $preflight$
DECLARE
  v_url text;
  v_token text;
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
  THEN
    RAISE EXCEPTION 'Payment recovery scheduler extensions are unavailable';
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'tallystore_project_url';
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'payment_recovery_cron_secret';
  IF v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$'
     OR length(COALESCE(v_token, '')) < 40
  THEN
    RAISE EXCEPTION 'Payment recovery Vault configuration is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'tallystore-check-pending-payments-every-10-min'
  ) THEN
    RAISE EXCEPTION 'Payment recovery job already exists';
  END IF;
END;
$preflight$;

SELECT cron.schedule(
  'tallystore-check-pending-payments-every-10-min',
  '*/10 * * * *',
  $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'tallystore_project_url')
             || '/functions/v1/check-pending-payments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'payment_recovery_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
