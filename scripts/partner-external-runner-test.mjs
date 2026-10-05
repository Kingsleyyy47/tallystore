import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'

const source=readFileSync('supabase/functions/_shared/partner-external-runner.ts','utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
const exports={}
vm.runInNewContext(code,{exports,crypto:webcrypto,TextEncoder,console:{error(){}}})
const execute=exports.executePartnerExternalPurchase
assert.equal(typeof execute,'function')
const keyId='10000000-0000-4000-8000-000000000001'
const partnerId='20000000-0000-4000-8000-000000000001'
const orderId='30000000-0000-4000-8000-000000000001'
const auth={key:{id:keyId,api_key:'private-key-marker'},partner:{id:partnerId,unlimited_credit:true}}
const body={expected_amount_ngn:100,idempotency_key:'partner-fixture-request-1',partner_reference:'fixture-reference'}
const accepted={kind:'accepted',source:'daisy',id:'activation-fixture',status:'active',payload:{phone_number:'fixture-phone',api_key:'private-key-marker',raw_provider_response:{secret:'private-provider-marker'},raw_request:'private-provider-marker',vendor_message:'private-provider-marker',nested:{password:'private-password-marker',public_status:'active'}}}
function model(options={}) {
  let stored=null
  const counters={reserve:0,claim:0,send:0,receipt:0,record:0,holds:0,captures:0,releases:0}
  const args=[]
  const summary=()=>({id:orderId,status:stored?.status??'pending',response_payload:stored?.payload??{},api_key:'private-key-marker',request_payload:{secret:'private-provider-marker'},customer_email:'private-email-marker'})
  const admin={rpc:async(name,input)=>{
    args.push({name,input:structuredClone(input)})
    if(name==='reserve_api_partner_external_order') {
      counters.reserve++
      if(options.denyReserve)return{data:{success:false,code:options.denyReserve},error:null}
      if(stored&&stored.fingerprint!==input.p_request_fingerprint)return{data:{success:false,code:'IDEMPOTENCY_CONFLICT'},error:null}
      const replay=Boolean(stored)
      if(!stored){stored={fingerprint:input.p_request_fingerprint,state:'prepared',status:'pending',payload:{}};counters.holds++}
      return{data:{success:true,idempotent_replay:replay,order_id:orderId,dispatch_state:stored.state,data:summary()},error:null}
    }
    if(name==='claim_api_partner_external_dispatch') {
      counters.claim++
      assert.equal(input.p_key_id,keyId)
      if(options.claimDeny)return{data:{success:false,code:options.claimDeny},error:null}
      if(stored.state!=='prepared')return{data:{success:false,code:'DISPATCH_ALREADY_CLAIMED',dispatch_state:stored.state},error:null}
      stored.state='sending';stored.status='processing';counters.send++
      return{data:{success:true,send_allowed:true,order_id:orderId,dispatch_state:'sending'},error:null}
    }
    if(name==='record_api_partner_dispatch_receipt') {
      counters.receipt++
      assert.equal(stored.state,'sending','receipt must follow the single paid-send claim')
      assert.equal(input.p_order_id,orderId)
      assert.equal(input.p_partner_id,partnerId)
      assert.equal(input.p_key_id,keyId)
      assert.equal(input.p_request_fingerprint,stored.fingerprint)
      assert.equal(input.p_amount_ngn,100)
      if(options.receiptFailure)return{data:null,error:{message:'private-provider-marker'}}
      if(options.receiptThrow)throw new Error('private-provider-marker')
      stored.receipt=structuredClone(input)
      return{data:{success:true,proof_hash:'a'.repeat(64)},error:null}
    }
    assert.equal(name,'record_api_partner_external_outcome','Runner must use only the partner journal RPCs, never customer wallets')
    counters.record++
    if(options.recordFailure)return{data:null,error:{message:'private-provider-marker'}}
    if(options.recordThrow)throw new Error('private-provider-marker')
    stored.state=input.p_outcome;stored.status=input.p_status;stored.payload=input.p_public_payload
    if(input.p_outcome==='accepted')counters.captures++
    if(input.p_outcome==='rejected')counters.releases++
    return{data:{success:true,data:summary()},error:null}
  }}
  return{admin,counters,args,get stored(){return stored}}
}
function plan(dispatch,requestPayload={service_id:'fixture',recipient:{phone:'fixture-recipient',country:'US'}}) {
  return{section:'sms',itemId:'fixture-service',itemName:'Fixture SMS',quantity:1,amountNgn:100,requestPayload,dispatch}
}
function safe(result) {
  const text=JSON.stringify(result)
  for(const marker of ['private-key-marker','private-provider-marker','private-password-marker','private-email-marker'])assert.equal(text.includes(marker),false)
  assert.equal(text.includes('request_payload'),false)
}

for(const denial of ['INSUFFICIENT_PARTNER_BALANCE','INVALID_KEY','PARTNER_DISABLED']) {
  const db=model({denyReserve:denial});let dispatched=0
  const result=await execute(db.admin,auth,body,plan(async()=>{dispatched++;return accepted}))
  assert.equal(dispatched,0);assert.equal(db.counters.holds,0);assert.equal(result.body.success,false);safe(result)
}
for(const alteredBody of [{...body,expected_amount_ngn:undefined},{...body,expected_amount_ngn:99},{...body,idempotency_key:'short'},{...body,payment_mode:'gateway'},{...body,force:false},{...body,skip_balance:true},{...body,unlimited_credit:true},{...body,customer_email:'x'.repeat(255)}]) {
  const db=model();let dispatched=0
  const result=await execute(db.admin,auth,alteredBody,plan(async()=>{dispatched++;return accepted}))
  assert.equal(result.body.success,false);assert.equal(db.counters.reserve,0);assert.equal(dispatched,0)
}
const race=model();let raceDispatch=0
const concurrentPlan=plan(async()=>{raceDispatch++;await new Promise(resolve=>setImmediate(resolve));return accepted})
const races=await Promise.all([execute(race.admin,auth,body,concurrentPlan),execute(race.admin,auth,body,concurrentPlan)])
assert.equal(raceDispatch,1);assert.equal(race.counters.holds,1);assert.equal(race.counters.send,1);assert.equal(race.counters.captures,1)
assert.equal(race.counters.receipt,1)
races.forEach(safe)
const raceNames=race.args.map(call=>call.name)
assert.ok(raceNames.indexOf('record_api_partner_dispatch_receipt')<raceNames.indexOf('record_api_partner_external_outcome'))
assert.equal(JSON.stringify(race.stored.receipt).includes('private-key-marker'),false)
assert.equal(JSON.stringify(race.stored.receipt).includes('private-provider-marker'),false)
assert.equal(race.args.find(call=>call.name==='record_api_partner_external_outcome').input.p_public_payload.api_key,undefined)
assert.equal(race.args.find(call=>call.name==='record_api_partner_external_outcome').input.p_public_payload.nested,undefined)
const replay=await execute(race.admin,auth,body,concurrentPlan)
assert.equal(raceDispatch,1);assert.equal(replay.body.idempotent_replay,true);assert.equal(replay.body.data.status,'active');safe(replay)

// Use a failed claim followed by a legitimate prepared replay, then allow one send.
const deferred=model({claimDeny:'DISPATCH_AUTHORIZATION_STALE'});let deferredDispatch=0
const deferredResult=await execute(deferred.admin,auth,body,plan(async()=>{deferredDispatch++;return accepted}))
assert.equal(deferredDispatch,0);assert.equal(deferredResult.body.code,'DISPATCH_AUTHORIZATION_STALE')
const beforeClaim=model();let beforeClaimDispatch=0
const originalRpc=beforeClaim.admin.rpc
let firstClaim=true
beforeClaim.admin.rpc=async(name,input)=>{if(name==='claim_api_partner_external_dispatch'&&firstClaim){firstClaim=false;return{data:null,error:{message:'fixture'}}}return originalRpc(name,input)}
await execute(beforeClaim.admin,auth,body,plan(async()=>{beforeClaimDispatch++;return accepted}))
assert.equal(beforeClaim.stored.state,'prepared');assert.equal(beforeClaimDispatch,0)
await execute(beforeClaim.admin,auth,body,plan(async()=>{beforeClaimDispatch++;return accepted}))
assert.equal(beforeClaimDispatch,1);assert.equal(beforeClaim.counters.holds,1)

for(const config of [{recordFailure:true},{recordThrow:true}]) {
  const db=model(config);let dispatched=0
  const requestPlan=plan(async()=>{dispatched++;return accepted})
  const result=await execute(db.admin,auth,body,requestPlan)
  assert.equal(result.body.success,false)
  assert.equal(db.counters.receipt,1)
  assert.equal(result.status,202);assert.equal(result.body.data.status,'processing');assert.equal(db.counters.releases,0);assert.equal(db.stored.state,'sending')
  await execute(db.admin,auth,body,requestPlan)
  assert.equal(dispatched,1);assert.equal(db.counters.holds,1);assert.equal(db.counters.releases,0);safe(result)
}
for(const config of [{receiptFailure:true},{receiptThrow:true}]) {
  const db=model(config);let dispatched=0
  const requestPlan=plan(async()=>{dispatched++;return accepted})
  const result=await execute(db.admin,auth,body,requestPlan)
  assert.equal(result.body.code,'PURCHASE_OUTCOME_UNKNOWN')
  assert.equal(result.status,202)
  assert.equal(db.counters.receipt,1)
  assert.equal(db.counters.record,0,'financial finalizer must not run without durable receipt')
  assert.equal(db.stored.state,'sending')
  assert.equal(db.counters.releases,0)
  await execute(db.admin,auth,body,requestPlan)
  assert.equal(dispatched,1,'receipt failure must never cause a second paid send')
  safe(result)
}
for(const dispatch of [async()=>{throw new Error('private-provider-marker')},async()=>({kind:'unknown'}),async()=>({kind:'accepted',source:'smm',id:'wrong',status:'completed',payload:{}}),async()=>({kind:'rejected',reason:'NO_STOCK',payload:{delivered:true}}),async()=>({kind:'rejected',reason:'UNRECOGNIZED_VENDOR_ERROR'})]) {
  const db=model();const result=await execute(db.admin,auth,body,plan(dispatch))
  assert.equal(db.stored.state,'unknown');assert.equal(db.counters.releases,0);assert.equal(result.status,202);assert.equal(db.args.at(-1).input.p_reason_code,null);safe(result)
}
for(const reason of ['NO_STOCK','INSUFFICIENT_BALANCE','PRICE_CHANGED','INVALID_RECIPIENT']) {
  const db=model();let dispatched=0
  const requestPlan=plan(async()=>{dispatched++;return{kind:'rejected',reason}})
  const result=await execute(db.admin,auth,body,requestPlan)
  assert.equal(result.body.success,false)
  assert.equal(db.counters.releases,1);assert.equal(db.counters.captures,0);assert.equal(result.body.code,reason)
  assert.equal(db.args.at(-1).input.p_status,'failed');assert.deepEqual(db.args.at(-1).input.p_public_payload,{})
  await execute(db.admin,auth,body,requestPlan)
  assert.equal(dispatched,1);assert.equal(db.counters.releases,1);safe(result)
}
const semantic=model();let semanticDispatch=0
const firstPlan=plan(async()=>{semanticDispatch++;return accepted},{z:[1,2],a:{phone:'fixture-recipient',country:'US'}})
await execute(semantic.admin,auth,body,firstPlan)
const samePlan=plan(async()=>{semanticDispatch++;return accepted},{a:{country:'US',phone:'fixture-recipient'},z:[1,2]})
assert.equal((await execute(semantic.admin,auth,{...body,expected_amount_ngn:'100.00'},samePlan)).body.success,true)
for(const [newBody,newPlan] of [[{...body,partner_reference:'other'},samePlan],[{...body,customer_phone:'new-recipient'},samePlan],[body,plan(async()=>accepted,{a:{country:'US',phone:'changed'},z:[1,2]})],[body,plan(async()=>accepted,{a:{country:'US',phone:'fixture-recipient'},z:[2,1]})]]) {
  assert.equal((await execute(semantic.admin,auth,newBody,newPlan)).body.code,'IDEMPOTENCY_CONFLICT')
}
assert.equal(semanticDispatch,1)
assert.ok(semantic.args.filter(call=>call.name==='reserve_api_partner_external_order').every(call=>/^[a-f0-9]{64}$/.test(call.input.p_request_fingerprint)))
console.log('Partner external runner: reserve authorization, single claim, durable receipt before settlement, held unknown/save failures, definitive rejection release, canonical conflict and secret-safe summaries passed.')
