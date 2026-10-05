// Source-only management migration boundary. Never accepts a destination ref.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
const hash=value=>createHash('sha256').update(value).digest('hex')
const sourceRef='dssvvswvqnxanyzfhixf'
const safe=value=>value.replace(/'/g,"''")
export async function runSourceMigration(config) {
 const mode=process.argv[2]||'verify'
 assert.ok(['dry','apply','verify'].includes(mode),'Invalid migration operation')
 const migration=readFileSync(config.migrationPath,'utf8'),probe=readFileSync(config.probePath,'utf8')
 const digest=hash(migration),probeDigest=hash(probe),guardDigest=hash(JSON.stringify([config.guards,config.seedGuard,config.cleanup,config.routine]))
 const runnerDigest=hash(readFileSync(new URL(import.meta.url),'utf8'))
 const line=readFileSync('.env','utf8').split(/\r?\n/).find(value=>value.startsWith('SUPABASE_ACCESS_TOKEN='))
 const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
 assert.ok(token,'Source management credential required')
 const query=async sql=>{
  let response
  try {response=await fetch(`https://api.supabase.com/v1/projects/${sourceRef}/database/query`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)})}
  catch {throw Error('Source management request failed or timed out; check recorded state before retrying')}
  if(!response.ok) {
   const data=await response.json().catch(()=>({}))
   const category=String(data.message||data.error||'').match(/(?:bound_review|bitrefill_pricing|sms_pricing)_probe_[a-z_]+|unexpected_airtime_unknown_state_boundary|Financial rows changed|Source privilege guard failed|Source seed guard failed|Source routine changed|permission denied|does not exist|syntax error|violates [a-z ]+ constraint/)?.[0]||'unclassified database rejection'
   throw Error(`Source migration HTTP ${response.status}: ${category}`)
  }
  return response.json()
 }
 const allTrue=rows=>{assert.equal(rows.length,1,'Expected one metadata result');for(const [key,value]of Object.entries(rows[0]))assert.equal(value,true,key)}
 const recorded=(await query(`BEGIN READ ONLY;SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${config.version}') applied;COMMIT;`))[0].applied
 const financialRows=[['public.profiles','profiles'],['public.transactions','transactions'],['public.orders','orders'],['public.wallet_reservations','reservations'],
  ['public.crypto_transactions','crypto'],['auth.users','auth_users'],['public.api_partners','partners'],['public.api_partner_orders','partner_orders'],
  ['public.api_partner_external_events','partner_events'],['public.api_partner_obligations','partner_obligations'],
  ['public.customer_airtime_orders','airtime_orders'],['private.customer_airtime_dispatch','airtime_dispatch']]
  .map(([table,label])=>`SELECT '${label}' relation,md5(to_jsonb(r)::text) row_hash FROM ${table} r`).join('\nUNION ALL\n')
 const snapshot=`CREATE TEMP TABLE source_financial_snapshot ON COMMIT DROP AS SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM (${financialRows}) rows GROUP BY relation;`
 const unchanged=`DO $$ BEGIN IF EXISTS(SELECT 1 FROM source_financial_snapshot b FULL JOIN(SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) digest FROM(${financialRows}) rows GROUP BY relation)a USING(relation) WHERE b.digest IS DISTINCT FROM a.digest) THEN RAISE EXCEPTION 'Financial rows changed'; END IF;END $$;`
 const assertGuards=`DO $$ DECLARE checks jsonb;BEGIN SELECT to_jsonb(g) INTO checks FROM(${config.guards})g;IF checks IS NULL OR EXISTS(SELECT 1 FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Source privilege guard failed';END IF;END $$;`
 const assertSeed=config.seedGuard?`DO $$ DECLARE checks jsonb;BEGIN SELECT to_jsonb(g) INTO checks FROM(${config.seedGuard})g;IF checks IS NULL OR EXISTS(SELECT 1 FROM jsonb_each(checks) WHERE value IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Source seed guard failed';END IF;END $$;`:''
 const proofPath=`scripts/crypto-review.local/${config.name}-dry-pass.json`
 let baselineRoutineHash
 if(mode==='dry') {
  assert.equal(recorded,false,'Migration already recorded')
  if(config.routine)baselineRoutineHash=(await query(`BEGIN READ ONLY;SELECT md5(pg_get_functiondef('${config.routine}'::regprocedure)) digest;COMMIT;`))[0].digest
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;${snapshot}${migration}\n${probe}\n${unchanged}${assertSeed}${assertGuards}${config.guards};ROLLBACK;`)
  allTrue(rows)
  allTrue(await query(`BEGIN READ ONLY;${config.cleanup};COMMIT;`))
  mkdirSync('scripts/crypto-review.local',{recursive:true})
  writeFileSync(proofPath,JSON.stringify({sourceRef,digest,probeDigest,guardDigest,runnerDigest,baselineRoutineHash,verifiedAt:new Date().toISOString()}))
  console.log(JSON.stringify({mode,sourceRef,version:config.version,sourceDryRunPassed:true,rollbackProbePassed:true,financialRowsUnchanged:true,cleanupPassed:true,guardChecks:Object.keys(rows[0]).length}))
 } else if(mode==='apply') {
  assert.equal(recorded,false,'Migration already recorded')
  const proof=JSON.parse(readFileSync(proofPath,'utf8'))
  assert.equal(proof.sourceRef,sourceRef);assert.equal(proof.digest,digest,'Migration changed since dry run');assert.equal(proof.probeDigest,probeDigest,'Probe changed since dry run');assert.equal(proof.guardDigest,guardDigest,'Guards changed since dry run')
  assert.equal(proof.runnerDigest,runnerDigest,'Runner changed since dry run')
  assert.ok(Date.now()-Date.parse(proof.verifiedAt)<60*60*1000,'Dry proof expired')
  const routineGuard=config.routine?`DO $$ BEGIN IF md5(pg_get_functiondef('${config.routine}'::regprocedure)) IS DISTINCT FROM '${proof.baselineRoutineHash}' THEN RAISE EXCEPTION 'Source routine changed';END IF;END $$;`:''
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;${snapshot}${routineGuard}${migration}
   INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${config.version}','${config.name}',ARRAY['${safe(migration)}']);
   ${unchanged}${assertSeed}${assertGuards}${config.guards};COMMIT;`)
  allTrue(rows)
  console.log(JSON.stringify({mode,sourceRef,version:config.version,applied:true,financialRowsUnchanged:true,guardChecks:Object.keys(rows[0]).length}))
 } else {
  assert.equal(recorded,true,'Migration not recorded')
  allTrue(await query(`BEGIN READ ONLY;SELECT (SELECT statements[1]='${safe(migration)}' FROM supabase_migrations.schema_migrations WHERE version='${config.version}') exact_recorded_migration;COMMIT;`))
  const rows=await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;${snapshot}${probe}${unchanged}${assertSeed}${assertGuards}${config.guards};ROLLBACK;`)
  allTrue(rows)
  console.log(JSON.stringify({mode,sourceRef,version:config.version,recorded:true,exactRecordedMigration:true,rollbackProbePassed:true,financialRowsUnchanged:true,guardChecks:Object.keys(rows[0]).length}))
 }
}
