import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {customerApiRoute} from '../supabase/functions/_shared/customer-api-route.mjs'

const owner='10000000-0000-4000-8000-000000000001'
const foreign='10000000-0000-4000-8000-000000000002'
const orderId='30000000-0000-4000-8000-000000000001'
const key=`tlyc_products_${'a'.repeat(64)}`
const original='  synthetic-user | full password | synthetic@example.invalid  '
const source=readFileSync('supabase/functions/customer-api/index.ts','utf8').replace(/^import .*$/gm,'')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
let passed=0
async function probe({response,error=null,authorized=true,enabled='true',suffix='',header=`Bearer ${key}`}={}){
  let handler
  const calls=[]
  const admin={
    from(){throw new Error('Raw order queries must never be reached')},
    async rpc(name,args){
      calls.push({name,args})
      if(name==='customer_api_authorize')return {data:{ok:authorized,code:'invalid_key',user_id:owner,key_id:foreign,section:'products'},error:null}
      assert.equal(name,'get_customer_api_product_order_detail')
      assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_user_id:owner,p_order_id:orderId})
      return {data:response,error}
    },
  }
  vm.runInNewContext(code,{
    serve:callback=>{handler=callback},createClient:()=>admin,customerApiRoute,
    sha256Hex:async raw=>{assert.equal(raw,key);return 'hash'},
    Deno:{env:{get:name=>name==='CUSTOMER_API_ENABLED'?enabled:'synthetic'}},
    Request,Response,URL,TextEncoder,TextDecoder,console:{error(){}},
  })
  const result=await handler(new Request(`https://fixture.invalid/functions/v1/customer-api/v1/orders/${orderId}?section=products${suffix}`,{
    headers:{Authorization:header},
  }))
  return {status:result.status,body:await result.json(),calls}
}
function order(account_details){return {success:true,order:{id:orderId,status:'completed',amount:1500,
  created_at:'2026-09-19T12:00:00Z',product_group_id:foreign,account_details,
  financial_authorization_status:null,provider_secret:'must-not-leak',user_id:owner}}}

let r=await probe({response:order({accounts:[{additional_info:{original_line:original}}]}),suffix:`&user_id=${foreign}&p_user_id=${foreign}`})
assert.equal(r.status,200)
assert.equal(r.body.data.account_details.accounts[0].additional_info.original_line,original)
assert.deepEqual(Object.keys(r.body.data).sort(),['account_details','amount','created_at','id','product_group_id','status'])
passed++
r=await probe({response:order({product_name:'Metadata only',quantity:1})})
assert.equal(r.status,200);assert.equal('accounts' in r.body.data.account_details,false);passed++
r=await probe({response:{success:false,code:'not_found'}})
assert.equal(r.status,404);assert.equal(JSON.stringify(r.body).includes(original),false);passed++
for(const response of [null,{},[],{success:true,order:null},{success:true,order:[]},
  {...order({accounts:[]}),order:{...order({}).order,id:foreign}},
  {success:false,code:'unexpected',order:order({accounts:[]}).order}]){
  r=await probe({response});assert.equal(r.status,503);assert.equal('data' in r.body,false);passed++
}
r=await probe({response:order({accounts:[]}),error:{message:'function missing'}})
assert.equal(r.status,503);assert.equal('data' in r.body,false);passed++
r=await probe({authorized:false,response:order({accounts:[]})})
assert.equal(r.status,401);assert.equal(r.calls.length,1);passed++
r=await probe({header:'Bearer invalid',response:order({accounts:[]})})
assert.equal(r.status,401);assert.equal(r.calls.length,0);passed++
r=await probe({enabled:'false',response:order({accounts:[]})})
assert.equal(r.status,503);assert.equal(r.body.code,'coming_soon');assert.equal(r.calls.length,0);passed++
console.log(JSON.stringify({passed,realGatewayCode:true,transportMocked:true,liveWrites:0,
  ownerIdentityFromApiAuthorization:true,rawOrderReadFallback:false,fullOriginalLinePreserved:true}))
