import {runSourceMigration} from './source-migration-runner.mjs'
const version='20261005030000'
const tables=['private.partner_webhook_start','private.partner_webhook_events']
const rpcs=['public.list_queued_api_partner_webhook_events(integer)','public.claim_api_partner_webhook_event(uuid)','public.finish_api_partner_webhook_event(uuid,uuid,text,text,integer)']
const guards=`SELECT ${tables.map((table,i)=>`
 NOT has_table_privilege('anon','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_table_${i},
 NOT has_table_privilege('authenticated','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_table_${i},
 NOT has_table_privilege('service_role','${table}','INSERT,UPDATE,DELETE,TRUNCATE') service_mutation_${i},
 has_table_privilege('service_role','${table}','SELECT') service_read_${i},
 (SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass) table_rls_${i}`).join(',')},
 ${rpcs.map((rpc,i)=>`NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_rpc_${i},
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_rpc_${i},
 has_function_privilege('service_role','${rpc}','EXECUTE') service_rpc_${i},
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) pinned_rpc_${i}`).join(',')},
 NOT has_table_privilege('anon','public.api_partner_webhook_deliveries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_delivery,
 NOT has_table_privilege('authenticated','public.api_partner_webhook_deliveries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_delivery,
 NOT has_table_privilege('service_role','public.api_partner_webhook_deliveries','INSERT,UPDATE,DELETE,TRUNCATE') service_delivery_mutation,
 has_table_privilege('service_role','public.api_partner_webhook_deliveries','SELECT') service_delivery_audit,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.partner_webhook_start'::regclass AND NOT tgisinternal AND tgenabled='O') immutable_watermark,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.partner_webhook_events'::regclass AND NOT tgisinternal AND tgenabled='O') guarded_outbox,
 (SELECT count(*)=4 FROM pg_trigger WHERE tgname IN('partner_webhook_order_event','partner_webhook_obligation_event','partner_webhook_financial_event','partner_webhook_journal_event') AND tgenabled='O') automatic_future_events,
 (SELECT count(*)=1 FROM private.partner_webhook_start) singleton_watermark,
 NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='partner_webhook_events'
  AND column_name IN('webhook_url','webhook_secret','payload','response_payload','request_payload','credentials','target_url')) queue_contains_no_secrets,
 strpos(pg_get_functiondef('public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)'::regprocedure),'''api_key_id'',p_key_id')>0 local_original_key_bound`
const rows=`SELECT 'events' relation,md5(to_jsonb(r)::text) row_hash FROM private.partner_webhook_events r
 UNION ALL SELECT 'start' relation,md5(to_jsonb(r)::text) row_hash FROM private.partner_webhook_start r`
await runSourceMigration({version,name:'partner_webhook_event_outbox',guards,
 routine:'public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)',
 migrationPath:`supabase/migrations/${version}_partner_webhook_event_outbox.sql`,
 probePath:'scripts/catalog/partner-webhook-outbox-live-probe.sql',
 extraFinancialTables:[['public.api_partner_webhook_deliveries','webhook_delivery_audit']],
 beforeProbe:`CREATE TEMP TABLE webhook_probe_snapshot ON COMMIT DROP AS SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM(${rows})r GROUP BY relation;`,
 afterProbe:`DO $$ BEGIN IF EXISTS(SELECT 1 FROM webhook_probe_snapshot b FULL JOIN(SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM(${rows})r GROUP BY relation)a USING(relation) WHERE b.digest IS DISTINCT FROM a.digest) THEN RAISE EXCEPTION 'Source webhook evidence changed';END IF;END $$;`,
 cleanup:`SELECT to_regclass('private.partner_webhook_events') IS NULL queue_rolled_back,
 to_regclass('private.partner_webhook_start') IS NULL watermark_rolled_back,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') history_unchanged,
 strpos(pg_get_functiondef('public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)'::regprocedure),'''api_key_id'',p_key_id')=0 local_patch_rolled_back,
 NOT EXISTS(SELECT 1 FROM public.api_partners WHERE id='9a300000-0000-4000-8000-000000000001') fixtures_rolled_back`})
