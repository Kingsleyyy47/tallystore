// SOURCE only. Creates/recovers one dedicated secret in Supabase, never on disk.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
const sourceRef='dssvvswvqnxanyzfhixf'
const mode=process.argv[2]
assert.ok(['provision','enable'].includes(mode),'Explicit provision or enable required')
const line=readFileSync('.env','utf8').split(/\r?\n/).find(v=>v.startsWith('SUPABASE_ACCESS_TOKEN='))
const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
assert.ok(token)
async function management(path,body) {
 const response=await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`,{
  method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 assert.ok(response.ok,`Source configuration HTTP ${response.status}`)
 const raw=await response.text()
 if(!raw) return null
 try {return JSON.parse(raw)} catch {throw Error('Source configuration returned an invalid response')}
}
const functions=await management('/functions')
assert.equal(functions.find(f=>f.slug==='partner-webhook-worker')?.status,'ACTIVE','Deploy verified worker before configuration')
const state=(await management('/database/query',{query:`BEGIN READ ONLY;
 SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261005030000') outbox_applied,
 (SELECT count(*) FROM private.partner_webhook_events) event_count,
 (SELECT count(*) FROM vault.secrets WHERE name='partner_webhook_worker_secret') secret_count;
 COMMIT;`}))?.[0]
assert.equal(state?.outbox_applied,true)
assert.equal(Number(state.event_count),0,'First activation requires an empty queue; inspect existing events separately')
assert.ok(Number(state.secret_count)<=1,'Duplicate private worker secrets')
if(mode==='provision' && Number(state.secret_count)===0) {
 const generated=randomBytes(32).toString('hex')
 const result=await management('/database/query',{query:`BEGIN;
 SELECT vault.create_secret('${generated}','partner_webhook_worker_secret','Dedicated partner notification worker bearer');
 COMMIT;`})
 assert.ok(Array.isArray(result))
}
const stored=(await management('/database/query',{query:`BEGIN READ ONLY;
 SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='partner_webhook_worker_secret';COMMIT;`}))
assert.equal(stored.length,1)
const workerSecret=stored[0].decrypted_secret
assert.match(workerSecret,/^[0-9a-f]{64}$/)
await management('/secrets',[
 {name:'PARTNER_WEBHOOK_WORKER_SECRET',value:workerSecret},
 {name:'PARTNER_WEBHOOK_WORKER_ENABLED',value:mode==='enable'?'true':'false'},
])
console.log(JSON.stringify({sourceRef,mode,secretStoredInSupabaseOnly:true,enabled:mode==='enable',queueEmpty:true}))
