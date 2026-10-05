-- Future partner events only. The worker secret remains in Supabase Vault/Edge
-- secrets; cron.job contains no bearer value. No provider purchase is scheduled.
DO $preflight$
DECLARE v_count integer; v_valid boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regclass('net.http_request_queue') IS NULL
     OR to_regclass('net._http_response') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                    WHERE version = '20261005030000')
  THEN RAISE EXCEPTION 'Partner webhook scheduler prerequisites missing'; END IF;
  SELECT count(*), bool_and(decrypted_secret ~ '^[0-9a-f]{64}$')
    INTO v_count, v_valid FROM vault.decrypted_secrets
    WHERE name = 'partner_webhook_worker_secret';
  IF v_count <> 1 OR v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Partner webhook scheduler Vault configuration missing';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN('anon','authenticated') AND NOT rolcanlogin)<>2 THEN
    RAISE EXCEPTION 'Partner webhook scheduler browser role boundary missing';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job
             WHERE jobname = 'tallystore-partner-webhook-worker-every-min') THEN
    RAISE EXCEPTION 'Partner webhook scheduler already exists';
  END IF;
END;
$preflight$;

-- Supabase owns pg_net and its grants; a postgres REVOKE can silently do
-- nothing. The source runner verifies net/vault/private are not Data API
-- schemas and actual browser net reads return PGRST106 before this is applied.
-- anon/authenticated are NOLOGIN. Do not expose net through the Data API.

-- Record only the pg_net request identity so a scheduled HTTP result can be
-- correlated without copying its Authorization header or response body.
CREATE TABLE private.partner_webhook_worker_runs (
  request_id bigint PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.partner_webhook_worker_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.partner_webhook_worker_runs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.partner_webhook_worker_runs TO service_role;

SELECT cron.schedule(
  'tallystore-partner-webhook-worker-every-min',
  '* * * * *',
  $job$
    INSERT INTO private.partner_webhook_worker_runs(request_id)
    SELECT net.http_post(
      url := 'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/partner-webhook-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' ||
          (SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'partner_webhook_worker_secret')
      ),
      body := '{"limit":20}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$
);
