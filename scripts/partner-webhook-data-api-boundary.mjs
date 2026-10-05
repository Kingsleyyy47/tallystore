// The managed pg_net schema is not a browser API schema. Verify the actual
// project configuration and HTTP denial rather than assuming a REVOKE worked.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
export async function verifySourceNetApiBoundary() {
 const sourceRef='dssvvswvqnxanyzfhixf'
 const line=readFileSync('.env','utf8').split(/\r?\n/).find(v=>v.startsWith('SUPABASE_ACCESS_TOKEN='))
 const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
 assert.ok(token)
 const get=async path=>{
  const r=await fetch(`https://api.supabase.com/v1/projects/${sourceRef}${path}`,{
   headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})
  assert.ok(r.ok,`Source API boundary metadata HTTP ${r.status}`)
  return r.json()
 }
 const config=await get('/postgrest')
 const raw=config.db_schema??config.db_schemas
 assert.ok(typeof raw==='string'||Array.isArray(raw),'Exposed schemas unavailable')
 const schemas=(Array.isArray(raw)?raw:raw.split(',')).map(v=>String(v).trim())
 for(const forbidden of ['net','vault','private']) assert.ok(!schemas.includes(forbidden),`${forbidden} must stay outside the Data API`)
 const anon=(await get('/api-keys')).find(k=>k.name==='anon')?.api_key
 assert.ok(anon)
 for(const table of ['http_request_queue','_http_response']) {
  const r=await fetch(`https://${sourceRef}.supabase.co/rest/v1/${table}?select=*&limit=0`,{
   headers:{apikey:anon,Authorization:`Bearer ${anon}`,'Accept-Profile':'net'},signal:AbortSignal.timeout(30000)})
  assert.equal(r.status,406,`Browser net/${table} must be unavailable`)
  assert.equal((await r.json()).code,'PGRST106')
 }
 console.log(JSON.stringify({sourceRef,exposedSchemas:schemas,privateSchemasExcluded:true,browserNetReadsDenied:2}))
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/partner-webhook-data-api-boundary.mjs')) await verifySourceNetApiBoundary()
