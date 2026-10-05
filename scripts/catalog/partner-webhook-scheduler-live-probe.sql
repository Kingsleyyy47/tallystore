-- Metadata only: do not invoke net.http_post or send an external callback.
DO $probe$
DECLARE j record; v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job
    WHERE jobname='tallystore-partner-webhook-worker-every-min';
  IF v_count<>1 THEN RAISE EXCEPTION 'partner_webhook_scheduler_probe_job_count'; END IF;
  SELECT * INTO j FROM cron.job WHERE jobname='tallystore-partner-webhook-worker-every-min';
  IF j.active IS DISTINCT FROM true OR j.schedule IS DISTINCT FROM '* * * * *'
     OR j.command NOT LIKE '%https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/partner-webhook-worker%'
     OR j.command NOT LIKE '%vault.decrypted_secrets%'
     OR j.command NOT LIKE '%partner_webhook_worker_secret%'
     OR j.command NOT LIKE '%55000%'
     OR j.command NOT LIKE '%{"limit":20}%'
     OR j.command ~ '[0-9a-f]{64}' THEN
    RAISE EXCEPTION 'partner_webhook_scheduler_probe_job_contract';
  END IF;
  IF has_table_privilege('anon','vault.decrypted_secrets','SELECT')
     OR has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
     OR (SELECT count(*) FROM pg_roles WHERE rolname IN('anon','authenticated') AND NOT rolcanlogin)<>2 THEN
    RAISE EXCEPTION 'partner_webhook_scheduler_probe_browser_acl';
  END IF;
END;
$probe$;
SET LOCAL ROLE anon;
DO $$ DECLARE n integer:=0; BEGIN
 BEGIN PERFORM * FROM private.partner_webhook_worker_runs LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 IF n<>1 THEN RAISE EXCEPTION 'partner_webhook_scheduler_probe_anon_reads'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer:=0; BEGIN
 BEGIN PERFORM * FROM private.partner_webhook_worker_runs LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 IF n<>1 THEN RAISE EXCEPTION 'partner_webhook_scheduler_probe_browser_reads'; END IF;
END $$;
RESET ROLE;
