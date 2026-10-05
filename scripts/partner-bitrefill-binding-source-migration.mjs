import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const mode = process.argv[2] || 'verify'
assert.ok(['dry','apply','verify'].includes(mode))
const sourceRef = 'dssvvswvqnxanyzfhixf'
const version = '20261005026000'
const migration = readFileSync(`supabase/migrations/${version}_partner_bitrefill_invoice_binding.sql`,'utf8')
const digest = createHash('sha256').update(migration).digest('hex')
const proofPath = 'scripts/crypto-review.local/partner-bitrefill-binding-dry-pass.json'
const line = readFileSync('.env','utf8').split(/\r?\n/).find(value=>value.startsWith('SUPABASE_ACCESS_TOKEN='))
const token = line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
assert.ok(token,'Source management credential required')
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${sourceRef}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000),
  })
  if(!response.ok) {
    const data=await response.json().catch(()=>({}))
    const message=String(data.message||data.error||'')
    // Report only known diagnostic categories; never print query errors or row data.
    const category=message.match(/binding_probe_[a-z_]+|bitrefill_binding_probe_[a-z_]+|Financial rows changed during receipt verification|Receipt access guard failed|permission denied|does not exist|syntax error|violates [a-z ]+ constraint/)?.[0]||'unclassified database rejection'
    throw Error(`Source Bitrefill binding verification HTTP ${response.status}: ${category}`)
  }
  return response.json()
}
const rpc = 'public.bind_api_partner_bitrefill_invoice(uuid,uuid,text,text,text,integer,numeric)'
const reviewRpc = 'public.get_api_partner_bitrefill_bound_invoice(uuid,uuid)'
const batchRpc = 'public.get_api_partner_bitrefill_bound_invoices(uuid,uuid[])'
const guards = `SELECT
  NOT has_table_privilege('anon','private.api_partner_bitrefill_invoice_bindings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anonymous_table_denied,
  NOT has_table_privilege('authenticated','private.api_partner_bitrefill_invoice_bindings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS browser_table_denied,
  NOT has_table_privilege('service_role','private.api_partner_bitrefill_invoice_bindings','INSERT,UPDATE,DELETE,TRUNCATE') AS service_mutations_denied,
  has_table_privilege('service_role','private.api_partner_bitrefill_invoice_bindings','SELECT') AS service_read_allowed,
  NOT has_function_privilege('anon','${rpc}','EXECUTE') AS anonymous_rpc_denied,
  NOT has_function_privilege('authenticated','${rpc}','EXECUTE') AS browser_rpc_denied,
  has_function_privilege('service_role','${rpc}','EXECUTE') AS service_rpc_allowed,
  NOT has_function_privilege('anon','${reviewRpc}','EXECUTE') AS anonymous_review_denied,
  NOT has_function_privilege('authenticated','${reviewRpc}','EXECUTE') AS browser_review_denied,
  has_function_privilege('service_role','${reviewRpc}','EXECUTE') AS service_review_allowed,
  NOT has_function_privilege('anon','${batchRpc}','EXECUTE') AS anonymous_batch_denied,
  NOT has_function_privilege('authenticated','${batchRpc}','EXECUTE') AS browser_batch_denied,
  has_function_privilege('service_role','${batchRpc}','EXECUTE') AS service_batch_allowed,
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${batchRpc}'::regprocedure) AS pinned_batch_search_path,
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${reviewRpc}'::regprocedure) AS pinned_review_search_path,
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) AS pinned_search_path,
  (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.api_partner_bitrefill_invoice_bindings'::regclass AND NOT tgisinternal) AS immutable_triggers,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='private.api_partner_dispatch_receipts'::regclass AND tgname='api_partner_bitrefill_receipt_requires_binding' AND tgenabled='O') AS receipt_binding_trigger,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.api_partner_external_orders'::regclass AND tgname='api_partner_bitrefill_financial_outcome_requires_receipt' AND tgenabled='O') AS outcome_binding_trigger`
const assertGuards = `DO $$ DECLARE checks jsonb; BEGIN
  SELECT to_jsonb(g) INTO checks FROM (${guards}) g;
  IF checks IS NULL OR EXISTS(SELECT 1 FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb)
    THEN RAISE EXCEPTION 'Receipt access guard failed'; END IF;
END $$;`
function allTrue(rows) {
  assert.equal(rows.length,1,'Expected one verification result')
  for(const [name,value] of Object.entries(rows[0]))assert.equal(value,true,name)
}
const recorded=(await query(`BEGIN READ ONLY; SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS applied; COMMIT;`))[0].applied
const financialRows = `
  SELECT 'profiles' AS relation,md5(to_jsonb(p)::text) AS row_hash FROM public.profiles p
  UNION ALL SELECT 'transactions',md5(to_jsonb(t)::text) FROM public.transactions t
  UNION ALL SELECT 'orders',md5(to_jsonb(o)::text) FROM public.orders o
  UNION ALL SELECT 'partners',md5(to_jsonb(p)::text) FROM public.api_partners p
  UNION ALL SELECT 'partner_orders',md5(to_jsonb(o)::text) FROM public.api_partner_orders o
  UNION ALL SELECT 'partner_events',md5(to_jsonb(e)::text) FROM public.api_partner_external_events e
  UNION ALL SELECT 'partner_obligations',md5(to_jsonb(o)::text) FROM public.api_partner_obligations o`
const snapshot = `CREATE TEMP TABLE receipt_financial_snapshot ON COMMIT DROP AS
  SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) AS digest FROM (${financialRows}) rows GROUP BY relation;`
const assertFinancialRows = `DO $$ BEGIN IF EXISTS (
  SELECT 1 FROM receipt_financial_snapshot before_snapshot FULL JOIN (
    SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) AS digest FROM (${financialRows}) rows GROUP BY relation
  ) after_snapshot USING(relation)
  WHERE before_snapshot.digest IS DISTINCT FROM after_snapshot.digest
) THEN RAISE EXCEPTION 'Financial rows changed during receipt verification'; END IF; END $$;`
if(mode==='dry') {
  assert.equal(recorded,false,'Migration already applied')
  const probe=readFileSync('scripts/catalog/partner-bitrefill-binding-live-probe.sql','utf8')
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    ${snapshot}
    ${migration}
    ${probe}
    ${assertFinancialRows}
    ${assertGuards} ${guards}; ROLLBACK;`)
  allTrue(rows)
  const clean=await query(`BEGIN READ ONLY; SELECT
    to_regclass('private.api_partner_bitrefill_invoice_bindings') IS NULL AS rolled_back,
    NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS history_unchanged; COMMIT;`)
  allTrue(clean)
  writeFileSync(proofPath,JSON.stringify({digest,probeDigest:createHash('sha256').update(probe).digest('hex'),verifiedAt:new Date().toISOString(),sourceRef}))
  console.log(JSON.stringify({mode,sourceRef,sourceDryRunPassed:true,financialRowsUnchanged:true,...rows[0],...clean[0]}))
} else if(mode==='apply') {
  assert.equal(recorded,false,'Migration already applied')
  const proof=JSON.parse(readFileSync(proofPath,'utf8'))
  assert.equal(proof.digest,digest,'Migration changed since dry run')
  assert.equal(proof.sourceRef,sourceRef)
  assert.equal(proof.probeDigest,createHash('sha256').update(readFileSync('scripts/catalog/partner-bitrefill-binding-live-probe.sql','utf8')).digest('hex'),'Probe changed since dry run')
  const escaped=migration.replace(/'/g,"''")
  allTrue(await query(`BEGIN; ${migration}
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES ('${version}','partner_bitrefill_invoice_binding',ARRAY['${escaped}']);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.api_partner_bitrefill_invoice_bindings) THEN RAISE EXCEPTION 'Unexpected receipt rows'; END IF; END $$;
    ${assertGuards} ${guards}; COMMIT;`))
  console.log(JSON.stringify({mode,sourceRef,applied:true}))
} else {
  assert.equal(recorded,true,'Migration not recorded')
  const probe=readFileSync('scripts/catalog/partner-bitrefill-binding-live-probe.sql','utf8')
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    ${snapshot} ${probe} ${assertFinancialRows} ${assertGuards} ${guards}; ROLLBACK;`)
  allTrue(rows)
  console.log(JSON.stringify({mode,sourceRef,recorded:true,sourceRollbackProbePassed:true,financialRowsUnchanged:true,...rows[0]}))
}
