// Authorized empty-queue smoke, unauthorized probes, and database ACL checks.
// Refuses to run a worker if a real event could be sent. No provider purchases.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sourceRef='dssvvswvqnxanyzfhixf'
const line=readFileSync('.env','utf8').split(/\r?\n/).find(v=>v.startsWith('SUPABASE_ACCESS_TOKEN='))
const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
assert.ok(token)
async function management(path,body) {
 const response=await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`,{
  method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 assert.ok(response.ok,`Source smoke HTTP ${response.status}`)
 return response.json()
}
const query=sql=>management('/database/query',{query:`BEGIN READ ONLY;${sql};COMMIT;`})
const before=(await query(`SELECT (SELECT count(*) FROM private.partner_webhook_events) events,
 (SELECT count(*) FROM public.api_partner_webhook_deliveries) deliveries,
 (SELECT count(*) FROM public.api_partner_orders) orders,
 (SELECT count(*) FROM public.api_partner_obligations) obligations`))[0]
assert.equal(Number(before.events),0,'Do not use real partner events as a smoke test')
const stored=await query(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='partner_webhook_worker_secret'`)
assert.equal(stored.length,1)
const keys=await management('/api-keys')
const anon=keys.find(k=>k.name==='anon')?.api_key
assert.ok(anon)
async function invoke(bearer,body,method='POST') {
 const r=await fetch(`https://${sourceRef}.supabase.co/functions/v1/partner-webhook-worker`,{
  method,headers:{Authorization:`Bearer ${bearer}`,apikey:anon,'Content-Type':'application/json'},
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(55000)})
 return {status:r.status,body:await r.json()}
}
for(const bearer of [anon,'invalid-worker-secret']) assert.equal((await invoke(bearer,{limit:20})).status,401)
assert.equal((await invoke(stored[0].decrypted_secret,{limit:21})).status,400)
assert.equal((await invoke(stored[0].decrypted_secret,{limit:1,url:'https://example.com'})).status,400)
assert.equal((await invoke(stored[0].decrypted_secret,{},'GET')).status,405)
const valid=await invoke(stored[0].decrypted_secret,{limit:20})
assert.equal(valid.status,200)
assert.deepEqual(valid.body,{code:'OK',delivered:0,rejected:0,outcome_unknown:0,skipped:0})
for(const [rpc,body] of [
 ['list_queued_api_partner_webhook_events',{p_limit:20}],
 ['claim_api_partner_webhook_event',{p_event_id:'00000000-0000-4000-8000-000000000001'}],
 ['finish_api_partner_webhook_event',{p_event_id:'00000000-0000-4000-8000-000000000001',p_claim_nonce:'00000000-0000-4000-8000-000000000002',p_outcome:'delivered',p_code:'WEBHOOK_DELIVERED',p_http_status:200}],
]) {
 const r=await fetch(`https://${sourceRef}.supabase.co/rest/v1/rpc/${rpc}`,{method:'POST',
  headers:{Authorization:`Bearer ${anon}`,apikey:anon,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
 assert.equal(r.status,401,`Anonymous ${rpc} denied`)
}
const after=(await query(`SELECT (SELECT count(*) FROM private.partner_webhook_events) events,
 (SELECT count(*) FROM public.api_partner_webhook_deliveries) deliveries,
 (SELECT count(*) FROM public.api_partner_orders) orders,
 (SELECT count(*) FROM public.api_partner_obligations) obligations`))[0]
assert.deepEqual(after,before)
const fn=(await management('/functions')).find(f=>f.slug==='partner-webhook-worker')
assert.equal(fn?.status,'ACTIVE')
console.log(JSON.stringify({sourceRef,status:fn.status,version:fn.version,unauthorizedDenied:2,
 invalidRequestsDenied:3,privateRpcsDenied:3,authorizedEmptyRun:true,rowsUnchanged:true,callbackSends:0,paidCalls:0}))
