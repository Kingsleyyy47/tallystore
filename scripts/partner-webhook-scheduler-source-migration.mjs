import {runSourceMigration} from './source-migration-runner.mjs'
import {verifySourceNetApiBoundary} from './partner-webhook-data-api-boundary.mjs'
await verifySourceNetApiBoundary()
await runSourceMigration({
 version:'20261005031000',name:'schedule_partner_webhook_worker',
 migrationPath:'supabase/migrations/20261005031000_schedule_partner_webhook_worker.sql',
 probePath:'scripts/catalog/partner-webhook-scheduler-live-probe.sql',
 guards:`SELECT
 (SELECT count(*)=1 FROM cron.job WHERE jobname='tallystore-partner-webhook-worker-every-min'
   AND active AND schedule='* * * * *'
   AND command LIKE '%https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/partner-webhook-worker%'
   AND command LIKE '%partner_webhook_worker_secret%'
   AND command LIKE '%vault.decrypted_secrets%'
   AND command LIKE '%55000%'
   AND command LIKE '%{"limit":20}%'
   AND command !~ '[0-9a-f]{64}') scheduler_contract,
 (SELECT count(*)=1 AND bool_and(decrypted_secret ~ '^[0-9a-f]{64}$')
  FROM vault.decrypted_secrets WHERE name='partner_webhook_worker_secret') vault_configured,
 NOT has_table_privilege('anon','vault.decrypted_secrets','SELECT') anon_vault_denied,
 NOT has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') browser_vault_denied,
 (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='anon') anon_database_login_denied,
 (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='authenticated') browser_database_login_denied,
 NOT has_table_privilege('anon','private.partner_webhook_worker_runs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_run_records_denied,
 NOT has_table_privilege('authenticated','private.partner_webhook_worker_runs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_run_records_denied,
 NOT has_table_privilege('service_role','private.partner_webhook_worker_runs','INSERT,UPDATE,DELETE,TRUNCATE') service_run_mutation_denied,
 has_table_privilege('service_role','private.partner_webhook_worker_runs','SELECT') service_run_audit,
 (SELECT relrowsecurity FROM pg_class WHERE oid='private.partner_webhook_worker_runs'::regclass) run_records_rls`,
 cleanup:`SELECT NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='tallystore-partner-webhook-worker-every-min') no_worker_job,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261005031000') no_migration_record,
 to_regclass('private.partner_webhook_worker_runs') IS NULL no_worker_run_records`,
})
