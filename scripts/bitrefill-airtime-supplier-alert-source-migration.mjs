import {runSourceMigration} from './source-migration-runner.mjs'
const version='20261005029100'
const table='public.supplier_balance_alerts'
const record='public.record_supplier_balance_alert(text,uuid,text)'
const resolve='public.resolve_supplier_balance_alert(text,timestamptz)'
const guards=`SELECT
 NOT has_table_privilege('anon','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_table_denied,
 NOT has_table_privilege('authenticated','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_table_denied,
 has_table_privilege('service_role','${table}','SELECT,INSERT,UPDATE') existing_service_privileges,
 (SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass) alert_rls,
 ${[record,resolve].map((rpc,i)=>`NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_rpc_${i}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_rpc_${i}_denied,
 has_function_privilege('service_role','${rpc}','EXECUTE') service_rpc_${i}_allowed,
 (SELECT prosecdef FROM pg_proc WHERE oid='${rpc}'::regprocedure) definer_rpc_${i}`).join(',')},
 (SELECT count(*)=8 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_balance_alerts') no_private_payload_columns,
 (SELECT strpos(pg_get_constraintdef(oid),'bitrefill')>0 AND strpos(pg_get_constraintdef(oid),'muabanvia')>0
 AND strpos(pg_get_constraintdef(oid),'shopclone')>0 AND strpos(pg_get_constraintdef(oid),'shopviaclone')>0
 FROM pg_constraint WHERE conrelid='${table}'::regclass AND conname='supplier_balance_alerts_provider_check') four_providers,
 (SELECT strpos(pg_get_constraintdef(oid),'customer-airtime')>0 AND strpos(pg_get_constraintdef(oid),'process-purchase')>0
 AND strpos(pg_get_constraintdef(oid),'auto-restock')>0 AND strpos(pg_get_constraintdef(oid),'manual-restock')>0
 FROM pg_constraint WHERE conrelid='${table}'::regclass AND conname='supplier_balance_alerts_source_check') four_sources,
 (SELECT strpos(pg_get_constraintdef(oid),'insufficient_balance')>0 FROM pg_constraint
 WHERE conrelid='${table}'::regclass AND conname='supplier_balance_alerts_alert_code_check') fixed_alert_code`
await runSourceMigration({version,name:'bitrefill_airtime_supplier_balance_alerts',guards,routine:record,
 migrationPath:`supabase/migrations/${version}_bitrefill_airtime_supplier_balance_alerts.sql`,
 probePath:'scripts/catalog/bitrefill-airtime-supplier-alert-live-probe.sql',
 cleanup:`SELECT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') history_unchanged,
 (SELECT strpos(pg_get_constraintdef(oid),'bitrefill')=0 FROM pg_constraint
 WHERE conrelid='${table}'::regclass AND conname='supplier_balance_alerts_provider_check') provider_rolled_back,
 (SELECT strpos(pg_get_constraintdef(oid),'customer-airtime')=0 FROM pg_constraint
 WHERE conrelid='${table}'::regclass AND conname='supplier_balance_alerts_source_check') source_rolled_back`})
