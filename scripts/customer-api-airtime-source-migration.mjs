import { runSourceMigration } from './source-migration-runner.mjs'

const version = '20261005033000'
const routines = [
  'public.customer_api_authorize(text,text,integer)',
  'public.customer_api_consume_capability(uuid,uuid,text,uuid)',
  'public.customer_api_create_key(uuid,text,text,text,text)',
]
const baselineHashes = [
  '901f833f6e54605fffc20fc660b53b8309b2f8033693bfb73dcabaa94bdfd220',
  'b867d976a19c1d52b92c569a9d04d4e52c31fd9e04b1fea6818412df14f621b2',
  'a6feb8c402d22670d64315417f5d6d4702662770c03d6ae3b8797e0443eaf2be',
]
const guards = `SELECT
 (SELECT pg_get_constraintdef(oid) LIKE '%airtime%' FROM pg_constraint WHERE conrelid='public.customer_api_keys'::regclass AND conname='customer_api_keys_section_check') key_section_extended,
 (SELECT pg_get_constraintdef(oid) LIKE '%airtime%' FROM pg_constraint WHERE conrelid='public.customer_api_access'::regclass AND conname='customer_api_sections_valid') access_section_extended,
 ${routines.map((rpc, index) => `
 NOT has_function_privilege('anon','${rpc}','EXECUTE') anon_rpc_${index}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') browser_rpc_${index}_denied,
 has_function_privilege('service_role','${rpc}','EXECUTE') service_rpc_${index}_allowed,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] ${index === 1 ? '' : "AND pg_get_functiondef(oid) LIKE '%airtime%'"} FROM pg_proc WHERE oid='${rpc}'::regprocedure) routine_${index}_pinned`).join(',')},
 NOT has_table_privilege('anon','public.customer_api_access','SELECT,INSERT,UPDATE,DELETE') anonymous_access_denied,
 NOT has_table_privilege('authenticated','public.customer_api_access','INSERT,UPDATE,DELETE') browser_access_mutation_denied,
 NOT has_table_privilege('anon','public.customer_api_keys','SELECT,INSERT,UPDATE,DELETE') anonymous_keys_denied,
 NOT has_table_privilege('authenticated','public.customer_api_keys','INSERT,UPDATE,DELETE') browser_keys_mutation_denied,
 NOT has_table_privilege('anon','public.customer_api_capability_nonces','SELECT,INSERT,UPDATE,DELETE') anonymous_nonces_denied,
 NOT has_table_privilege('authenticated','public.customer_api_capability_nonces','SELECT,INSERT,UPDATE,DELETE') browser_nonces_denied,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_api_access'::regclass) access_rls,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_api_keys'::regclass) key_rls,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_api_capability_nonces'::regclass) nonce_rls`
const cleanup = `SELECT
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') history_unchanged,
 (SELECT pg_get_constraintdef(oid) NOT LIKE '%airtime%' FROM pg_constraint WHERE conrelid='public.customer_api_keys'::regclass AND conname='customer_api_keys_section_check') key_constraint_rolled_back,
 (SELECT pg_get_constraintdef(oid) NOT LIKE '%airtime%' FROM pg_constraint WHERE conrelid='public.customer_api_access'::regclass AND conname='customer_api_sections_valid') access_constraint_rolled_back,
 ${routines.map((rpc,index) => `(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef('${rpc}'::regprocedure),'UTF8')),'hex')='${baselineHashes[index]}') routine_${index}_restored`).join(',')},
 NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='9a330000-0000-4000-8000-000000000001') no_probe_profile,
 NOT EXISTS(SELECT 1 FROM public.customer_api_keys WHERE id='9a330000-0000-4000-8000-000000000011') no_probe_key`

await runSourceMigration({
  version, name: 'customer_api_airtime_section',
  migrationPath: `supabase/migrations/${version}_customer_api_airtime_section.sql`,
  probePath: 'scripts/catalog/customer-api-airtime-live-probe.sql',
  routine: routines[0], guards, cleanup,
  extraFinancialTables: [
    ['public.customer_api_access','customer_api_access'],
    ['public.customer_api_keys','customer_api_keys'],
    ['public.customer_api_capability_nonces','customer_api_capability_nonces'],
  ],
})
