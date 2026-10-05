import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {customerApiRoute} from '../supabase/functions/_shared/customer-api-route.mjs'

const source=readFileSync('supabase/functions/customer-api/index.ts','utf8').replace(/^import .*$/gm,'')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
const user='10000000-0000-4000-8000-000000000001'
const ownedKey='20000000-0000-4000-8000-000000000001'
const foreignKey='20000000-0000-4000-8000-000000000002'
async function run(path,method='GET',enabled,authenticated=true){
 let handler;let clients=0;const calls=[];let filters={}
 const db={auth:{async getUser(){return{data:{user:authenticated?{id:user}:null},error:null}}},
  from(table){calls.push(table);filters={};return{
   select(){return this},update(value){assert.equal(typeof value.revoked_at,'string');return this},
   eq(key,value){filters[key]=value;return this},is(){return this},
   async single(){assert.equal(table,'profiles');return{data:{is_admin:false,is_staff:false,account_suspended:false},error:null}},
   async maybeSingle(){assert.equal(table,'customer_api_keys');assert.equal(filters.user_id,user);return{data:filters.id===ownedKey?{id:ownedKey}:null,error:null}},
  }},async rpc(){throw Error('Paused API must not mint keys or delegate purchases')}}
 vm.runInNewContext(code,{serve:fn=>{handler=fn},createClient:()=>{clients++;return db},
  customerApiRoute,Deno:{env:{get:name=>({CUSTOMER_API_ENABLED:enabled,TALLYSTORE_OWNER_USER_ID:foreignKey})[name]}},
  Request,Response,URL,TextEncoder,TextDecoder,crypto:webcrypto,AbortSignal,console:{error(){}}})
 const r=await handler(new Request('https://fixture.invalid/functions/v1/customer-api'+path,{
  method,headers:{Authorization:'Bearer FIXTURE_JWT','Content-Type':'application/json'},
  ...(['GET','HEAD'].includes(method)?{}:{body:'{}'})}))
 return{status:r.status,data:await r.json(),clients,calls}
}
for(const enabled of [undefined,'false','TRUE']){
 for(const [path,method] of [['/v1/keys','GET'],['/v1/keys','POST'],['/v1/purchases','POST'],
  ['/v1/catalogue?section=products','GET'],['/v1/orders?section=sms','GET'],['/v1/wallet?section=social_boost','GET']]){
  const r=await run(path,method,enabled);assert.equal(r.status,503);assert.equal(r.data.code,'coming_soon');assert.equal(r.clients,0)
 }
}
let r=await run('/v1/keys/'+ownedKey,'DELETE','false');assert.equal(r.status,200)
r=await run('/v1/keys/'+foreignKey,'DELETE','false');assert.equal(r.status,404)
r=await run('/v1/keys/'+ownedKey,'DELETE','false',false);assert.equal(r.status,401)
r=await run('/v1/admin/access','POST','false');assert.equal(r.status,403);assert.equal(r.data.code,'owner_required')
r=await run('/v1/keys','GET','true',false);assert.equal(r.status,401)
r=await run('/v1/purchases','OPTIONS','false');assert.equal(r.status,200);assert.equal(r.clients,0)
console.log('Customer API launch gate: default/off blocks key issuance, reads and purchases before client creation; authenticated owner-key revocation remains scoped; nonowner controls denied.')
