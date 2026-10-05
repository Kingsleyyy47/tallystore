// Executes the bundled handler and real capability verifier. All identities,
// grants and provider reads are synthetic; no network or paid POST is allowed.
import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID,webcrypto} from 'node:crypto'
import vm from 'node:vm'
import esbuild from 'esbuild'

const built=await esbuild.build({entryPoints:['supabase/functions/customer-airtime/index.ts'],bundle:true,
 platform:'node',format:'cjs',write:false,plugins:[{name:'synthetic-supabase',setup(api){
  api.onResolve({filter:/^https:\/\/esm\.sh\//},()=>({path:'supabase',namespace:'mock'}))
  api.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=globalThis.__createClient',loader:'js'}))
 }}]})
const secret='test-only-airtime-delegation-secret-abcdefghijklmnopqrstuvwxyz'
const identity={key_id:'20000000-0000-4000-8000-000000000001',user_id:'10000000-0000-4000-8000-000000000001',section:'airtime'}
const orderId='30000000-0000-4000-8000-000000000001'
const phone='+15551234567',productId='test-airtime-us',packageId='test-airtime-us<&>25'
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})
function sign(raw,delta={}){
 const payload={...identity,target:'customer-airtime',body_hash:createHash('sha256').update(raw).digest('hex'),nonce:randomUUID(),expires_at:Date.now()+30000,...delta}
 const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url')
 return encoded+'.'+createHmac('sha256',secret).update(encoded).digest('hex')
}
function harness({enabled=true,revoked=false,grant=true,funds=true}={}){
 let handler
 const used=new Set(),calls={consume:0,webAuth:0,providerConstruct:0,providerGet:0,providerPost:0,reserve:0,ownerRpc:0}
 const admin={
  from(table){
   if(table==='app_settings'){
    let setting
    return{select(){return this},eq(_field,value){setting=value;return this},async maybeSingle(){return{data:setting==='ngn_usd_rate'?{value:1500}:null,error:null}}}
   }
   if(table==='customer_airtime_orders'){
    let customer,requestedOrder
    return{select(){return this},eq(field,value){if(field==='user_id')customer=value;if(field==='id')requestedOrder=value;return this},order(){return this},async limit(){assert.equal(customer,identity.user_id);return{data:[],error:null}},
     async maybeSingle(){assert.equal(customer,identity.user_id);return{data:requestedOrder===orderId?{id:orderId,status:'completed',recipient_phone:phone,product_name:'Test airtime',amount_ngn:3000,currency:'USD',created_at:'2026-10-05T00:00:00Z'}:null,error:null}}}
   }
   throw Error('Unexpected synthetic table')
  },
  async rpc(name,args){
   if(name==='customer_api_consume_capability'){
    calls.consume++
    const ok=grant&&!revoked&&args.p_key_id===identity.key_id&&args.p_user_id===identity.user_id&&args.p_section==='airtime'&&!used.has(args.p_nonce)
    if(ok)used.add(args.p_nonce)
    return{data:ok,error:null}
   }
   if(name==='get_customer_bitrefill_pricing')return{data:{success:true,mode:'percent',value:0,source:'global'},error:null}
   if(name==='authorize_customer_airtime_purchase'){
    calls.reserve++;assert.equal(args.p_user_id,identity.user_id);assert.equal(args.p_quote.amount_ngn,3000)
    return{data:{success:false,code:funds?'TEST_PURCHASE_NOT_PERMITTED':'INSUFFICIENT_FUNDS'},error:null}
   }
   if(name.startsWith('list_customer_bitrefill_pricing')||name.startsWith('set_customer_bitrefill_pricing')){
    calls.ownerRpc++;return{data:{success:false,code:'OWNER_DENIED'},error:null}
   }
   throw Error('Unexpected synthetic RPC')
  },
 }
 const context={module:{exports:{}},exports:{},Response,Request,ReadableStream,AbortSignal,URL,Date,TextEncoder,TextDecoder,Uint8Array,
  crypto:webcrypto,atob,btoa,setTimeout,clearTimeout,console,
  Deno:{serve(fn){handler=fn},env:{get(name){
   if(name==='BITREFILL_API_KEY')calls.providerConstruct++
   return({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
    BITREFILL_API_KEY:'synthetic-provider-only',CUSTOMER_API_DELEGATION_SECRET:secret,CUSTOMER_API_ENABLED:enabled?'true':'false',CUSTOMER_AIRTIME_ENABLED:'true'})[name]||''
  }}},
  async fetch(input,options={}){
   if(options.method==='POST'){calls.providerPost++;throw Error('No synthetic provider POST permitted')}
   calls.providerGet++
   const url=new URL(String(input))
   if(url.pathname.endsWith('/check_phone_number'))return response({operator_found:true,data:[{id:productId,name:'Test airtime',country:'US',recipient_type:'phone_number'}]})
   if(url.pathname.endsWith('/products/'+productId))return response({data:{id:productId,name:'Test airtime',recipient_type:'phone_number',currency:'USD',country:'US',packages:[{id:packageId,value:25,amount:25,price:2}]}})
   if(url.pathname.endsWith('/accounts/balance'))return response({data:{currency:'USD',balance:100}})
   throw Error('Unexpected synthetic provider read')
  },
 }
 context.globalThis=context
 context.__createClient=(_url,key)=>key==='synthetic-anon'?{auth:{async getUser(jwt){
  calls.webAuth++;return jwt==='synthetic-user-jwt'?{data:{user:{id:identity.user_id}},error:null}:{data:{user:null},error:{message:'Unauthorized'}}
 }}}:admin
 vm.runInNewContext(built.outputFiles[0].text,context,{timeout:5000})
 async function invoke(raw,cap,extraHeaders={}){
  const req=new Request('https://synthetic.invalid/functions/v1/customer-airtime',{method:'POST',headers:{'Content-Type':'application/json',...(cap!==undefined?{'x-tally-api-capability':cap}:{}),...extraHeaders},body:raw,...(raw instanceof ReadableStream?{duplex:'half'}:{})})
  const result=await handler(req)
  return{status:result.status,body:await result.json()}
 }
 return{invoke,calls}
}
const fields={phone_number:phone,operator_id:productId,product_id:productId,package_id:packageId}
const noProvider=h=>{assert.equal(h.calls.providerGet,0);assert.equal(h.calls.providerPost,0);assert.equal(h.calls.providerConstruct,0)}
const safeError=r=>{assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('synthetic-service'));assert.ok(!JSON.stringify(r).includes('synthetic-provider-only'))}

for(const body of [{action:'check_phone',phone_number:phone},{action:'quote',...fields},{action:'orders'},{action:'status',order_id:orderId}]){
 const h=harness(),raw=JSON.stringify(body)
 const r=await h.invoke(raw,sign(raw),{Authorization:'Bearer synthetic-service'})
 assert.equal(r.status,200);assert.equal(r.body.success,true);assert.equal(h.calls.consume,1);assert.equal(h.calls.webAuth,0);assert.equal(h.calls.providerPost,0)
}
let h=harness(),raw=JSON.stringify({action:'orders'}),cap=sign(raw)
assert.equal((await h.invoke(raw,cap)).status,200)
assert.equal((await h.invoke(raw,cap)).status,401);assert.equal(h.calls.consume,2)
for(const [config,delta]of [[{revoked:true},{}],[{grant:false},{}],[{}, {section:'sms'}],[{}, {target:'smsbus'}],[{}, {expires_at:Date.now()-1000}],[{}, {expires_at:Date.now()+120000}]]){
 h=harness(config);const r=await h.invoke(raw,sign(raw,delta));assert.equal(r.status,401);noProvider(h);safeError(r)
}
h=harness();let r=await h.invoke(raw+' ',sign(raw));assert.equal(r.status,401);assert.equal(h.calls.consume,0);noProvider(h)
h=harness({enabled:false});r=await h.invoke(raw,sign(raw));assert.equal(r.status,401);assert.equal(h.calls.consume,0);noProvider(h)
for(const body of [
 {action:'admin_pricing_get',kind:'airtime'},
 {action:'admin_pricing_set',kind:'airtime',scope:'global',mode:'amount',value:1},
 {action:'admin_product_options',kind:'airtime',product_id:productId},
 {action:'constructor'},{action:'orders',user_id:identity.user_id},{action:'quote',...fields,url:'https://evil.invalid'},
 {action:'check_phone',phone_number:phone,provider_key:'private'},
 {action:'purchase',...fields,expected_amount_ngn:3000,idempotency_key:'test-only-idempotency',wallet_balance:1000000},
]){
 h=harness();const bodyRaw=JSON.stringify(body);r=await h.invoke(bodyRaw,sign(bodyRaw));assert.ok(r.status===400||r.status===403);noProvider(h);assert.equal(h.calls.ownerRpc,0);assert.equal(h.calls.consume,0);safeError(r)
}
h=harness();r=await h.invoke(raw,undefined,{Authorization:'Bearer synthetic-service'});assert.equal(r.status,401);noProvider(h);assert.equal(h.calls.webAuth,0)
h=harness();r=await h.invoke(raw,undefined,{Authorization:'Bearer   synthetic-service '});assert.equal(r.status,401);noProvider(h);assert.equal(h.calls.webAuth,0)
h=harness();r=await h.invoke(raw,undefined,{Authorization:'Bearer invalid-web-jwt'});assert.equal(r.status,401);noProvider(h);assert.equal(h.calls.webAuth,1)
h=harness();r=await h.invoke(raw,undefined,{Authorization:'Bearer synthetic-user-jwt'});assert.equal(r.status,200);assert.equal(h.calls.webAuth,1);assert.equal(h.calls.consume,0)
h=harness();r=await h.invoke(JSON.stringify({action:'admin_pricing_get',kind:'airtime'}),undefined,{Authorization:'Bearer synthetic-user-jwt'});assert.equal(r.body.code,'OWNER_DENIED');assert.equal(h.calls.ownerRpc,1);noProvider(h)
for(const [funds,expected]of [[false,3000],[true,2990]]){
 h=harness({funds});const purchase=JSON.stringify({action:'purchase',...fields,idempotency_key:'test-only-wallet-idempotency',expected_amount_ngn:expected})
 r=await h.invoke(purchase,sign(purchase));assert.equal(r.body.code,funds?'PRICE_CHANGED':'INSUFFICIENT_FUNDS');assert.equal(h.calls.consume,1)
 assert.ok(h.calls.providerGet>0,'fresh catalog reads occur only after valid authentication');assert.equal(h.calls.providerPost,0,'funds/price failures never create or pay provider invoice')
 assert.equal(h.calls.reserve,funds?0:1)
}
for(const oversized of [JSON.stringify({action:'orders',extra:'x'.repeat(17000)}),JSON.stringify({action:'orders',extra:'😀'.repeat(5000)})]){
 h=harness();r=await h.invoke(oversized,sign(oversized));assert.equal(r.status,413);noProvider(h);assert.equal(h.calls.consume,0);safeError(r)
}
h=harness();r=await h.invoke(raw,sign(raw),{'Content-Length':'17000'});assert.equal(r.status,413);noProvider(h)
let controller
const hanging=new ReadableStream({start(c){controller=c},cancel(){return new Promise(()=>{})}})
h=harness();const started=Date.now()
r=await h.invoke(hanging,sign(raw));assert.equal(r.status,408);assert.ok(Date.now()-started<6000,'cloned stream cancellation cannot delay deadline');noProvider(h);assert.equal(h.calls.consume,0);safeError(r)
controller.close()
console.log('Airtime delegated bundled handler: signed identity/grant consumption, exact body/section/target/expiry, replay/revocation/flag/role denial, JWT preservation, strict actions/fields, byte limits/5s hanging-stream deadline, redacted errors, and zero paid POST on wallet/price failures passed.')
