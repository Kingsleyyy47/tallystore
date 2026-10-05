import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const mode = process.argv[2] || 'verify'
assert.ok(['dry','apply','verify'].includes(mode))
const sourceRef = 'dssvvswvqnxanyzfhixf'
const version = '20261005028000'
const migration = readFileSync(`supabase/migrations/${version}_customer_bitrefill_airtime_wallet.sql`,'utf8')
const digest = createHash('sha256').update(migration).digest('hex')
const proofPath = 'scripts/crypto-review.local/customer-airtime-wallet-dry-pass.json'
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
    const category=message.match(/(?:airtime|recovery)_probe_[a-z_]+|dispatch_recovery_probe_fixture_collision|Financial rows changed during receipt verification|Receipt access guard failed|permission denied|does not exist|syntax error|violates [a-z ]+ constraint/)?.[0]||'unclassified database rejection'
    throw Error(`Source airtime verification HTTP ${response.status}: ${category}`)
  }
  return response.json()
}
const rpcs = [
 'public.authorize_customer_airtime_purchase(uuid,text,jsonb,numeric)',
 'public.claim_customer_airtime_dispatch(uuid,uuid)',
 'public.bind_customer_airtime_invoice(uuid,uuid,text,jsonb,text)',
 'public.claim_customer_airtime_payment(uuid,uuid,text)',
 'public.record_customer_airtime_outcome(uuid,uuid,text,jsonb)',
 'public.get_customer_airtime_order(uuid,uuid)',
 'public.get_customer_airtime_reconciliation(uuid,uuid)',
]
const guards = `SELECT
 NOT has_table_privilege('anon','public.customer_airtime_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anonymous_history_denied,
 NOT has_table_privilege('authenticated','public.customer_airtime_orders','INSERT,UPDATE,DELETE,TRUNCATE') AS browser_history_mutations_denied,
 has_table_privilege('authenticated','public.customer_airtime_orders','SELECT') AS browser_own_history_read,
 NOT has_table_privilege('service_role','public.customer_airtime_orders','INSERT,UPDATE,DELETE,TRUNCATE') AS service_history_mutations_denied,
 NOT has_table_privilege('anon','private.customer_airtime_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anonymous_dispatch_denied,
 NOT has_table_privilege('authenticated','private.customer_airtime_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS browser_dispatch_denied,
 NOT has_table_privilege('service_role','private.customer_airtime_dispatch','INSERT,UPDATE,DELETE,TRUNCATE') AS service_dispatch_mutations_denied,
 has_table_privilege('service_role','private.customer_airtime_dispatch','SELECT') AS service_dispatch_read,
 (SELECT relrowsecurity FROM pg_class WHERE oid='private.customer_airtime_dispatch'::regclass) AS dispatch_rls,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.customer_airtime_orders'::regclass) AS history_rls,
 (SELECT count(*)=1 FROM pg_policy WHERE polrelid='public.customer_airtime_orders'::regclass AND polname='customer_airtime_own_read') AS own_history_policy,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='private.customer_airtime_dispatch'::regclass AND NOT tgisinternal) AS immutable_dispatch_triggers,
 ${rpcs.map((rpc,i)=>`NOT has_function_privilege('anon','${rpc}','EXECUTE') AS anon_rpc_${i}_denied,
 NOT has_function_privilege('authenticated','${rpc}','EXECUTE') AS browser_rpc_${i}_denied,
 has_function_privilege('service_role','${rpc}','EXECUTE') AS service_rpc_${i}_allowed,
 (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${rpc}'::regprocedure) AS pinned_rpc_${i}`).join(',\n')}`
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
 UNION ALL SELECT 'wallet_reservations',md5(to_jsonb(r)::text) FROM public.wallet_reservations r
 UNION ALL SELECT 'crypto_transactions',md5(to_jsonb(c)::text) FROM public.crypto_transactions c
 UNION ALL SELECT 'auth_users',md5(to_jsonb(u)::text) FROM auth.users u`
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
  const probe=readFileSync('scripts/catalog/customer-airtime-wallet-live-probe.sql','utf8')
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    ${snapshot}
    ${migration}
    ${probe}
    ${assertFinancialRows}
    ${assertGuards} ${guards}; ROLLBACK;`)
  allTrue(rows)
  const clean=await query(`BEGIN READ ONLY; SELECT
    to_regclass('public.customer_airtime_orders') IS NULL AS rolled_back,
    to_regclass('private.customer_airtime_dispatch') IS NULL AS dispatch_rolled_back,
    NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS history_unchanged; COMMIT;`)
  allTrue(clean)
  writeFileSync(proofPath,JSON.stringify({digest,probeDigest:createHash('sha256').update(probe).digest('hex'),verifiedAt:new Date().toISOString(),sourceRef}))
  console.log(JSON.stringify({mode,sourceRef,sourceDryRunPassed:true,financialRowsUnchanged:true,...rows[0],...clean[0]}))
} else if(mode==='apply') {
  assert.equal(recorded,false,'Migration already applied')
  const proof=JSON.parse(readFileSync(proofPath,'utf8'))
  assert.equal(proof.digest,digest,'Migration changed since dry run')
  assert.equal(proof.sourceRef,sourceRef)
  assert.equal(proof.probeDigest,createHash('sha256').update(readFileSync('scripts/catalog/customer-airtime-wallet-live-probe.sql','utf8')).digest('hex'),'Probe changed since dry run')
  const escaped=migration.replace(/'/g,"''")
  allTrue(await query(`BEGIN; ${migration}
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES ('${version}','customer_bitrefill_airtime_wallet',ARRAY['${escaped}']);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.customer_airtime_orders)
      OR EXISTS(SELECT 1 FROM private.customer_airtime_dispatch)
      THEN RAISE EXCEPTION 'Unexpected receipt rows'; END IF; END $$;
    ${assertGuards} ${guards}; COMMIT;`))
  console.log(JSON.stringify({mode,sourceRef,applied:true}))
} else {
  assert.equal(recorded,true,'Migration not recorded')
  const probe=readFileSync('scripts/catalog/customer-airtime-wallet-live-probe.sql','utf8')
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    ${snapshot} ${probe} ${assertFinancialRows} ${assertGuards} ${guards}; ROLLBACK;`)
  allTrue(rows)
  console.log(JSON.stringify({mode,sourceRef,recorded:true,sourceRollbackProbePassed:true,financialRowsUnchanged:true,...rows[0]}))
}
