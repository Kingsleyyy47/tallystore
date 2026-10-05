import {runSourceMigration} from './source-migration-runner.mjs'
const version='20261005028100'
const routine='public.record_customer_airtime_outcome(uuid,uuid,text,jsonb)'
const guards=`SELECT
 NOT has_function_privilege('anon','${routine}','EXECUTE') anon_outcome_denied,
 NOT has_function_privilege('authenticated','${routine}','EXECUTE') browser_outcome_denied,
 has_function_privilege('service_role','${routine}','EXECUTE') service_outcome_allowed,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${routine}'::regprocedure) pinned_outcome,
 strpos(pg_get_functiondef('${routine}'::regprocedure),'j.state NOT IN (''creating'',''bound'',''paying'',''unknown'')')>0 bound_review_allowed,
 strpos(pg_get_functiondef('${routine}'::regprocedure),'j.state NOT IN (''creating'',''paying'',''unknown'')')=0 old_boundary_removed,
 NOT has_table_privilege('anon','public.customer_airtime_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_history_denied,
 NOT has_table_privilege('authenticated','public.customer_airtime_orders','INSERT,UPDATE,DELETE,TRUNCATE') browser_history_mutations_denied,
 has_table_privilege('authenticated','public.customer_airtime_orders','SELECT') own_history_read,
 NOT has_table_privilege('service_role','public.customer_airtime_orders','INSERT,UPDATE,DELETE,TRUNCATE') service_history_mutations_denied,
 NOT has_table_privilege('anon','private.customer_airtime_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_dispatch_denied,
 NOT has_table_privilege('authenticated','private.customer_airtime_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_dispatch_denied,
 NOT has_table_privilege('service_role','private.customer_airtime_dispatch','INSERT,UPDATE,DELETE,TRUNCATE') service_dispatch_mutations_denied,
 (SELECT relrowsecurity FROM pg_class WHERE oid='private.customer_airtime_dispatch'::regclass) dispatch_rls,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.customer_airtime_dispatch'::regclass AND NOT tgisinternal AND tgenabled='O') immutable_dispatch_triggers`
await runSourceMigration({version,name:'customer_airtime_bound_review_state',routine,guards,
 migrationPath:`supabase/migrations/${version}_customer_airtime_bound_review_state.sql`,
 probePath:'scripts/catalog/customer-airtime-bound-review-live-probe.sql',
 cleanup:`SELECT strpos(pg_get_functiondef('${routine}'::regprocedure),'j.state NOT IN (''creating'',''paying'',''unknown'')')>0 original_routine_restored,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') history_unchanged,
 NOT EXISTS(SELECT 1 FROM auth.users WHERE id='9a281000-0000-4000-8000-000000000001') fixture_removed`})
