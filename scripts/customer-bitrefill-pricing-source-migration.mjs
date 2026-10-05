import {runSourceMigration} from './source-migration-runner.mjs'
const version='20261005029000'
const tables=['global','overrides','audit'].map(name=>`private.customer_bitrefill_pricing_${name}`)
const rpcs=['public.get_customer_bitrefill_pricing(text,text,text,numeric,text)',
 'public.set_customer_bitrefill_pricing(uuid,text,text,text,text,numeric,text,text,numeric,boolean)',
 'public.list_customer_bitrefill_pricing(uuid,text)','public.get_customer_bitrefill_pricing_batch(text,jsonb)']
const guards=`SELECT ${tables.map((table,i)=>`
 NOT has_table_privilege('anon','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_table_${i}_denied,
 NOT has_table_privilege('authenticated','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_table_${i}_denied,
 NOT has_table_privilege('service_role','${table}','INSERT,UPDATE,DELETE,TRUNCATE') service_mutation_${i}_denied,
 has_table_privilege('service_role','${table}','SELECT') service_read_${i}_allowed,
 (SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass) table_${i}_rls`).join(',')},
 ${rpcs.map((rpc,i)=>`NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_rpc_${i}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_rpc_${i}_denied,
 has_function_privilege('service_role','${rpc}','EXECUTE') service_rpc_${i}_allowed,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) pinned_rpc_${i}`).join(',')},
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.customer_bitrefill_pricing_audit'::regclass AND NOT tgisinternal AND tgenabled='O') immutable_audit_triggers,
 strpos(pg_get_functiondef('${rpcs[1]}'::regprocedure),'c1396bda-86e2-4dfc-94bb-0d95469d1d36')>0 fixed_owner_setter,
 strpos(pg_get_functiondef('${rpcs[2]}'::regprocedure),'c1396bda-86e2-4dfc-94bb-0d95469d1d36')>0 fixed_owner_listing,
 (SELECT count(*)=3 FROM private.customer_bitrefill_pricing_global) separate_kind_globals,
 (SELECT count(*)=1 FROM pg_indexes WHERE schemaname='private' AND tablename='customer_bitrefill_pricing_overrides' AND indexname='customer_bitrefill_pricing_product_lookup') indexed_batch_lookup`
const seedGuard=`WITH s AS(SELECT
 (SELECT btrim(value::text,'" ') FROM public.app_settings WHERE key='bitrefill_markup_pct') b,
 (SELECT btrim(value::text,'" ') FROM public.app_settings WHERE key='sms_default_margin_ngn') m,
 EXISTS(SELECT 1 FROM public.app_settings WHERE key='sms_default_margin_ngn') sms_setting_exists),
 e AS(SELECT CASE WHEN b ~ '^[0-9]+(?:\\.[0-9]{1,2})?$' AND length(b)<=16 THEN CASE WHEN b::numeric BETWEEN 0 AND 1000 THEN b::numeric ELSE 0 END ELSE 0 END bitrefill,
 CASE WHEN sms_setting_exists AND m='' THEN 0 WHEN m ~ '^[0-9]+(?:\\.[0-9]+)?$' AND length(m)<=32 THEN CASE WHEN m::numeric BETWEEN 0 AND 1000000000 THEN round(m::numeric,0) ELSE 700 END ELSE 700 END sms FROM s)
 SELECT (SELECT count(*)=2 FROM private.customer_bitrefill_pricing_global g,e WHERE g.kind IN('airtime','gift_card') AND g.mode='percent' AND g.value=e.bitrefill AND g.owner_configured) bitrefill_seed_verified,
 EXISTS(SELECT 1 FROM private.customer_bitrefill_pricing_global g,e WHERE g.kind='sms' AND g.mode='amount' AND g.value=e.sms AND g.owner_configured=false) sms_seed_inactive_verified,
 (public.get_customer_bitrefill_pricing('sms','TEST_ONLY_SEED_SELECTOR_290',NULL,1,'USD')->>'legacy_pricing')::boolean sms_legacy_retained,
 NOT EXISTS(SELECT 1 FROM private.customer_bitrefill_pricing_overrides) no_unreviewed_overrides,
 NOT EXISTS(SELECT 1 FROM private.customer_bitrefill_pricing_audit) no_live_owner_changes`
await runSourceMigration({version,name:'customer_bitrefill_owner_pricing',guards,seedGuard,
 migrationPath:`supabase/migrations/${version}_customer_bitrefill_owner_pricing.sql`,
 probePath:'scripts/catalog/customer-bitrefill-pricing-live-probe.sql',
 cleanup:`SELECT to_regclass('private.customer_bitrefill_pricing_global') IS NULL global_rolled_back,
 to_regclass('private.customer_bitrefill_pricing_overrides') IS NULL overrides_rolled_back,
 to_regclass('private.customer_bitrefill_pricing_audit') IS NULL audit_rolled_back,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') history_unchanged`})
