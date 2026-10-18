-- SOURCE ONLY. The Source project URL and active migration phase are checked
-- before installation and again before every pg_net enqueue. The Edge action
-- performs provider status checks and calls the atomic cancellation/refund RPC;
-- this scheduler never contacts Daisy or changes a wallet itself.
DO $preflight$
DECLARE
  v_url text;
  v_token text;
  v_url_count integer;
  v_token_count integer;
  v_phase text;
  v_schedule text;
  v_command text;
  v_active boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regclass('private.migration_write_freeze_control') IS NULL
    OR to_regclass('migration_setup.destination_write_admission') IS NOT NULL
    OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'sms_sweep_prerequisites_missing';
  END IF;
  SELECT count(*)::integer, min(decrypted_secret) INTO v_url_count, v_url
  FROM vault.decrypted_secrets WHERE name = 'tallystore_project_url';
  SELECT count(*)::integer, min(decrypted_secret) INTO v_token_count, v_token
  FROM vault.decrypted_secrets WHERE name = 'payment_recovery_cron_secret';
  IF v_url_count <> 1
    OR v_url IS DISTINCT FROM 'https://dssvvswvqnxanyzfhixf.supabase.co'
    OR v_token_count <> 1 OR length(COALESCE(v_token, '')) < 40 THEN
    RAISE EXCEPTION 'sms_sweep_source_vault_configuration_invalid';
  END IF;
  SELECT phase INTO v_phase
  FROM private.migration_write_freeze_control WHERE singleton IS TRUE;
  IF v_phase IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'sms_sweep_source_not_active';
  END IF;
  SELECT schedule, command, active INTO v_schedule, v_command, v_active
  FROM cron.job WHERE jobname = 'tallystore-sms-cancellation-recovery';
  IF FOUND AND (v_schedule IS DISTINCT FROM '* * * * *'
    OR btrim(v_command) IS DISTINCT FROM 'SELECT private.enqueue_sms_cancellation_sweep();'
    OR v_active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'sms_sweep_existing_schedule_mismatch';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION private.enqueue_sms_cancellation_sweep()
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_phase text;
  v_url text;
  v_token text;
  v_url_count integer;
  v_token_count integer;
  v_request_id bigint;
BEGIN
  -- Match the Source maintenance fence. If draining/frozen, do not place an
  -- asynchronous HTTP request that might start after the website is closed.
  IF current_setting('transaction_isolation') <> 'read committed'
    OR to_regclass('migration_setup.destination_write_admission') IS NOT NULL
    OR NOT pg_catalog.pg_try_advisory_xact_lock_shared(1413565516, 1497780826) THEN
    RETURN NULL;
  END IF;
  SELECT phase INTO v_phase
  FROM private.migration_write_freeze_control WHERE singleton IS TRUE;
  IF v_phase IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer, min(decrypted_secret) INTO v_url_count, v_url
  FROM vault.decrypted_secrets WHERE name = 'tallystore_project_url';
  SELECT count(*)::integer, min(decrypted_secret) INTO v_token_count, v_token
  FROM vault.decrypted_secrets WHERE name = 'payment_recovery_cron_secret';
  IF v_url_count <> 1
    OR v_url IS DISTINCT FROM 'https://dssvvswvqnxanyzfhixf.supabase.co'
    OR v_token_count <> 1 OR length(COALESCE(v_token, '')) < 40 THEN
    RAISE EXCEPTION 'sms_sweep_source_vault_configuration_invalid';
  END IF;
  SELECT net.http_post(
    url := 'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/smsbus',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', v_token),
    body := '{"action":"sweep_stale_sms"}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.enqueue_sms_cancellation_sweep()
  FROM PUBLIC, anon, authenticated, service_role;

-- cron.schedule(name, ...) updates a named job, but do not overwrite an
-- unexpected schedule. Reapplying this migration leaves a matching job intact.
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job
    WHERE jobname = 'tallystore-sms-cancellation-recovery') THEN
    PERFORM cron.schedule(
      'tallystore-sms-cancellation-recovery',
      '* * * * *',
      'SELECT private.enqueue_sms_cancellation_sweep();'
    );
  END IF;
END;
$schedule$;
