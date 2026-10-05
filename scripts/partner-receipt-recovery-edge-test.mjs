import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const exported={}
vm.runInNewContext(ts.transpileModule(readFileSync('supabase/functions/_shared/partner-receipt-recovery.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText,{exports:exported,setTimeout,clearTimeout})
const recover=exported.reconcilePartnerDispatchReceipt
const owner='c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const id='30000000-0000-4000-8000-000000000001'
const body={action:'admin_reconcile_dispatch_receipt',order_id:id,receipt_proof_hash:'a'.repeat(64)}
let calls=[]
let response={data:{success:true,order_id:id,decision:'accepted',idempotent_replay:false},error:null}
const admin={async rpc(name,args){calls.push({name,args});return response},from(){throw Error('Direct table access forbidden')}}
let result=await recover(admin,'40000000-0000-4000-8000-000000000001',body)
assert.equal(result.status,403);assert.equal(calls.length,0)
for(const invalid of [null,[],{...body,action:'create_order'},{...body,owner_user_id:owner},{...body,amount_ngn:999},
  {...body,outcome:'accepted'},{...body,force:true},{...body,receipt_proof_hash:'bad'},{...body,order_id:'bad'}]) {
  result=await recover(admin,owner,invalid)
  assert.equal(result.status,400);assert.equal(calls.length,0)
}
result=await recover(admin,owner,body)
assert.equal(result.status,200)
assert.equal(calls[0].name,'reconcile_api_partner_dispatch_receipt')
assert.equal(JSON.stringify(calls[0].args),JSON.stringify({p_order_id:id,p_owner_user_id:owner,p_receipt_proof_hash:body.receipt_proof_hash}))
for(const decision of ['accepted','rejected']) {
  response={data:{success:true,order_id:id,decision,idempotent_replay:true,secret:'PRIVATE_MARKER'},error:null}
  result=await recover(admin,owner,body)
  assert.equal(result.body.idempotent_replay,true)
  assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'),false)
}
response={data:{success:false,code:'UNKNOWN_REQUIRES_REVIEW'},error:null}
assert.equal((await recover(admin,owner,body)).status,409)
for(const uncertain of [{data:null,error:{message:'PRIVATE_MARKER'}},
  {data:{success:true,order_id:id,decision:'made_up',idempotent_replay:false},error:null},
  {data:{success:false,code:'PRIVATE_MARKER'},error:null}]) {
  response=uncertain;result=await recover(admin,owner,body)
  assert.equal(result.status,202)
  assert.equal(result.body.code,'RECOVERY_OUTCOME_UNKNOWN')
  assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'),false)
}
let sends=0
admin.rpc=()=>{sends++;return new Promise(()=>{})}
const started=Date.now()
result=await recover(admin,owner,body)
assert.equal(result.status,202)
assert.equal(result.body.code,'RECOVERY_OUTCOME_UNKNOWN')
assert.equal(sends,1,'an uncertain recovery must not automatically retry its RPC')
assert.ok(Date.now()-started>=19900&&Date.now()-started<24000)
console.log('Recovery Edge boundary: owner-only, no outcome/amount overrides, exact receipt RPC, redacted results and bounded unknown outcomes passed.')
