import { runSourceMigration } from './source-migration-runner.mjs'

const version = '20261005034000'
const serviceRpcs = [
  'public.get_customer_giftcard_replay(uuid,text,jsonb)',
  'public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)',
  'public.claim_customer_giftcard_dispatch(uuid,uuid)',
  'public.bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text)',
  'public.claim_customer_giftcard_payment(uuid,uuid,text)',
  'public.record_customer_giftcard_outcome(uuid,uuid,text,jsonb)',
  'public.get_customer_giftcard_order(uuid,uuid)',
  'public.get_customer_giftcard_reconciliation(uuid,uuid)',
]
const ownRpcs = ['public.get_my_customer_giftcard_order(uuid)', 'public.get_my_customer_giftcard_history()']
const privateRpcs = [
  'private.guard_customer_giftcard_binding()', 'private.customer_giftcard_text_valid(jsonb,integer)',
  'private.customer_giftcard_request_valid(jsonb)', 'private.customer_giftcard_quote_valid(jsonb,jsonb)',
  'private.customer_giftcard_hold_valid(private.customer_giftcard_dispatch)',
  'private.lock_customer_giftcard_order(uuid,uuid)',
  'private.customer_giftcard_evidence_valid(private.customer_giftcard_dispatch,jsonb)',
  'private.customer_giftcard_proof_hash(private.customer_giftcard_dispatch,jsonb)',
  'private.customer_giftcard_capture_valid(private.customer_giftcard_dispatch)',
]
const guards = `SELECT
 NOT has_table_privilege('anon','public.customer_giftcard_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anonymous_orders_denied,
 NOT has_table_privilege('authenticated','public.customer_giftcard_orders','INSERT,UPDATE,DELETE,TRUNCATE') browser_mutation_denied,
 NOT has_table_privilege('service_role','public.customer_giftcard_orders','INSERT,UPDATE,DELETE,TRUNCATE') service_direct_mutation_denied,
 NOT has_table_privilege('anon','private.customer_giftcard_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anonymous_dispatch_denied,
 NOT has_table_privilege('authenticated','private.customer_giftcard_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') browser_dispatch_denied,
 NOT has_table_privilege('service_role','private.customer_giftcard_dispatch','INSERT,UPDATE,DELETE,TRUNCATE') service_dispatch_mutation_denied,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_giftcard_orders'::regclass) orders_rls,
 (SELECT relrowsecurity FROM pg_class WHERE oid='private.customer_giftcard_dispatch'::regclass) dispatch_rls,
 (SELECT count(*)=12 AND bool_and(column_name IN ('id','user_id','product_id','product_name','package_id','unit_value','currency','quantity','amount_ngn','status','created_at','completed_at')) FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_giftcard_orders') public_columns_whitelisted,
 (SELECT count(*)=1 AND bool_and(polname='customer_giftcard_own_read' AND polcmd='r' AND pg_get_expr(polqual,polrelid) LIKE '%auth.uid()%') FROM pg_policy WHERE polrelid='public.customer_giftcard_orders'::regclass) own_read_policy,
 has_table_privilege('authenticated','public.customer_giftcard_orders','SELECT') browser_safe_history_allowed,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.customer_giftcard_dispatch'::regclass AND NOT tgisinternal) immutable_dispatch_triggers,
 ${serviceRpcs.map((rpc, index) => `NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_service_${index}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_service_${index}_denied,
 has_function_privilege('service_role','${rpc}','EXECUTE') service_${index}_allowed,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) service_${index}_pinned`).join(',')},
 ${ownRpcs.map((rpc, index) => `NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_own_${index}_denied,
 has_function_privilege('authenticated','${rpc}','EXECUTE') browser_own_${index}_allowed,
 NOT has_function_privilege('service_role','${rpc}','EXECUTE') service_own_${index}_denied,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) own_${index}_pinned`).join(',')},
 ${privateRpcs.map((rpc, index) => `NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_private_${index}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_private_${index}_denied,
 NOT has_function_privilege('service_role','${rpc}','EXECUTE') service_private_${index}_denied`).join(',')}`

// Snapshot the new relations after dry-run DDL exists. The probe must restore
// every pre-existing row, including private redemption evidence, before return.
const giftRows = `SELECT 'orders' relation,md5(to_jsonb(o)::text) row_hash FROM public.customer_giftcard_orders o
 UNION ALL SELECT 'dispatch',md5(to_jsonb(d)::text) FROM private.customer_giftcard_dispatch d`
const beforeProbe = `CREATE TEMP TABLE giftcard_rows_before ON COMMIT DROP AS
 SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM (${giftRows}) r GROUP BY relation;`
const afterProbe = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM giftcard_rows_before b FULL JOIN
 (SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM (${giftRows}) r GROUP BY relation) a USING(relation)
 WHERE b.digest IS DISTINCT FROM a.digest) THEN RAISE EXCEPTION 'Financial rows changed'; END IF; END $$;`
const cleanup = `SELECT
 to_regclass('public.customer_giftcard_orders') IS NULL orders_rolled_back,
 to_regclass('private.customer_giftcard_dispatch') IS NULL dispatch_rolled_back,
 ${[...serviceRpcs, ...ownRpcs].map((rpc, i) => `to_regprocedure('${rpc}') IS NULL rpc_${i}_rolled_back`).join(',')},
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') migration_history_unchanged,
 NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN ('9a340000-0000-4000-8000-000000000101','9a340000-0000-4000-8000-000000000102')) fixture_users_absent`

await runSourceMigration({
  version, name: 'customer_giftcard_verified_wallet',
  migrationPath: `supabase/migrations/${version}_customer_giftcard_verified_wallet.sql`,
  probePath: 'scripts/catalog/customer-giftcard-wallet-live-probe.sql',
  guards, cleanup, beforeProbe, afterProbe,
})
