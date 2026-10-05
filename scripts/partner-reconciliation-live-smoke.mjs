import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ref='dssvvswvqnxanyzfhixf'
const line=readFileSync('.env','utf8').split(/\r?\n/).find(value=>value.startsWith('SUPABASE_ACCESS_TOKEN='))
const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
assert.ok(token,'Source management credential required')
const management=`https://api.supabase.com/v1/projects/${ref}`
async function metadata(path) {
  const response=await fetch(management+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`Metadata HTTP ${response.status}`)
  return response.json()
}
async function financialSnapshot() {
  const response=await fetch(management+'/database/query',{method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT
      (SELECT count(*) FROM public.api_partner_orders) AS orders,
      (SELECT count(*) FROM public.api_partner_external_events) AS events,
      (SELECT count(*) FROM public.api_partner_obligations) AS obligations,
      (SELECT count(*) FROM private.api_partner_dispatch_receipts) AS receipts,
      (SELECT count(*) FROM private.api_partner_receipt_reconciliation_decisions) AS decisions,
      (SELECT md5(coalesce(string_agg(id::text||':'||balance_ngn::text,',' ORDER BY id),'')) FROM public.api_partners) AS partner_balances;
      COMMIT;`}),signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`Snapshot HTTP ${response.status}`)
  return (await response.json())[0]
}
const deployed=(await metadata('/functions')).find(value=>value.slug==='partner-api')
assert.equal(deployed?.status,'ACTIVE')
assert.ok(deployed.version>=37,'Updated receipt recovery function required')
console.log(JSON.stringify({source:ref,function:deployed.slug,version:deployed.version,status:deployed.status}))
const anon=(await metadata('/api-keys')).find(value=>value.name==='anon')?.api_key
assert.ok(anon)
const origin=`https://${ref}.supabase.co`
const headers={apikey:anon,Authorization:`Bearer ${anon}`,'Content-Type':'application/json'}
const before=await financialSnapshot()
for(const action of ['admin_reconciliation_cases','admin_reconciliation_probe','admin_reconcile_dispatch_receipt']) {
  const response=await fetch(origin+'/functions/v1/partner-api',{method:'POST',headers,
    body:JSON.stringify({action,order_id:'30000000-0000-4000-8000-000000000001',receipt_proof_hash:'a'.repeat(64)}),signal:AbortSignal.timeout(30000)})
  assert.equal(response.status,401,`${action} anonymous access`)
  const data=await response.json()
  assert.equal(data.success,false)
  assert.equal(data.cases,undefined)
  assert.equal(data.case,undefined)
  console.log(JSON.stringify({case:action,anonymousDenied:true,status:response.status}))
}
const response=await fetch(origin+'/rest/v1/rpc/record_api_partner_dispatch_receipt',{method:'POST',headers,
  body:JSON.stringify({p_order_id:'30000000-0000-4000-8000-000000000001',
    p_key_id:'10000000-0000-4000-8000-000000000001',p_partner_id:'20000000-0000-4000-8000-000000000001',
    p_request_fingerprint:'a'.repeat(64),p_amount_ngn:100,p_outcome:'unknown',p_fulfillment_source:null,
    p_fulfillment_id:null,p_status:'processing',p_reason_code:null,p_public_payload:{}}),signal:AbortSignal.timeout(30000)})
assert.ok([401,403,404].includes(response.status),'Anonymous receipt setter must be inaccessible')
await response.arrayBuffer()
console.log(JSON.stringify({case:'receipt_rpc',anonymousDenied:true,status:response.status}))
for(const [name,args] of [
  ['reconcile_api_partner_dispatch_receipt',{p_order_id:'30000000-0000-4000-8000-000000000001',
    p_owner_user_id:'c1396bda-86e2-4dfc-94bb-0d95469d1d36',p_receipt_proof_hash:'a'.repeat(64)}],
  ['get_api_partner_dispatch_receipt_review',{p_owner_user_id:'c1396bda-86e2-4dfc-94bb-0d95469d1d36',
    p_order_ids:['30000000-0000-4000-8000-000000000001']}],
]) {
  const denied=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',headers,
    body:JSON.stringify(args),signal:AbortSignal.timeout(30000)})
  assert.ok([401,403,404].includes(denied.status),'Anonymous recovery RPC must be inaccessible')
  await denied.arrayBuffer()
  console.log(JSON.stringify({case:name,anonymousDenied:true,status:denied.status}))
}
assert.deepEqual(await financialSnapshot(),before,'Denied probes changed partner finance')
console.log('Live anonymous denial checks passed; partner balances, orders, receipts, decisions, obligations and events unchanged. No authorized purchase or provider request was made.')
