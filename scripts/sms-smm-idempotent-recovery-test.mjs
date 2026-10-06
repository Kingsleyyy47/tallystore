// Execute the actual entry points against owned, already committed orders.
// Every database/provider transport is synthetic; no real calls or changes.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
const compile=source=>ts.transpileModule(source,{compilerOptions}).outputText
const contract=await import(`data:text/javascript;base64,${Buffer.from(compile(readFileSync('supabase/functions/_shared/smm-order-contract.ts','utf8'))).toString('base64')}`)
let fixture,smsHandler,smmHandler,checks=0
globalThis.Deno={env:{get:name=>['SMS_OTP_ENABLED','SMM_ORDERS_ENABLED'].includes(name)?String(fixture?.enabled??true):undefined}}
globalThis.__smsReplayTests={
  serve:callback=>{smsHandler=callback},createClient:()=>fixture.admin,
  authenticateCustomerRequest:async(_req,_admin,section,target)=>{
    fixture.authenticationChecks++;assert.equal(section,'sms');assert.equal(target,'smsbus')
    if(fixture.unauthorized)throw Error('Unauthorized');return {id:fixture.user}
  },
  customerMarkupPrice:()=>{throw Error('Recovery must not requote')},loadSmsMarkupRules:async()=>{throw Error('Recovery must not requote')},
}
globalThis.__smmReplayTests={...contract,
  serve:callback=>{smmHandler=callback},createClient:()=>fixture.admin,
  authenticateCustomerRequest:async(_req,_admin,section,target)=>{
    fixture.authenticationChecks++;assert.equal(section,'social_boost');assert.equal(target,'smm-create-order')
    if(fixture.unauthorized)throw Error('Unauthorized');return {id:fixture.user}
  },smmPanelRequest:async()=>{fixture.providerRequests++;throw Error('A replay must never dispatch')},
}
for(const [file,name,injected,extra] of [
  ['smsbus','__smsReplayTests',['serve','createClient','authenticateCustomerRequest','customerMarkupPrice','loadSmsMarkupRules'],''],
  ['smm-create-order','__smmReplayTests',['serve','createClient','authenticateCustomerRequest','smmPanelRequest','quoteSmmOrder','validateSmmOrderFields','SMM_QUANTITY_TYPES','SMM_UNAVAILABLE'],
    '\nglobalThis.__smmReplayTests.panelPayloadHash=panelPayloadHash;globalThis.__smmReplayTests.buildPanelOrderParams=buildPanelOrderParams;'],
]){
  const source=compile(readFileSync(`supabase/functions/${file}/index.ts`,'utf8')).replace(/^import .*(?:\r?\n|$)/gm,'')
  const code=`const {${injected.join(',')}}=globalThis.${name}; const console={error(){},warn(){},log(){}};const fetch=async()=>{globalThis.__replayFixture.providerRequests++;throw Error('Live transport forbidden')};\n${source}${extra}`
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
function makeFixture(kind){
  const user=randomUUID(),key='recovery-'+randomUUID(),service=kind==='sms'?'signal':randomUUID()
  const state={kind,user,key,service,enabled:true,unauthorized:false,spendable:0,blocked:false,profile:{is_admin:false,is_staff:false,account_suspended:false},
    authenticationChecks:0,permissionReads:0,walletChecks:0,catalogueReads:0,providerRequests:0,writes:0,lookupError:false,
    order:{id:randomUUID(),user_id:user,idempotency_key:key,service_id:service,reference:'ORIGINAL',status:'completed',
      ...(kind==='sms'?{order_type:'otp',price_ngn:930,messages:[{code:'123456'}],phone_number:'+15550001111'}:
        {quantity:1000,amount_ngn:500,link:'https://example.invalid/post'})},transaction:null,
    admin:{rpc:async(name,args)=>{
      assert.equal(name,'wallet_financial_truth_internal');assert.equal(args.p_user_id,user);state.walletChecks++
      return {data:{spending_blocked:state.blocked,confirmed_spendable:state.spendable},error:null}
    },from:table=>new Query(table)},
    request(extra={}){
      globalThis.__replayFixture=state
      const payload=kind==='sms'?{action:'create_otp',service_id:service,idempotency_key:key,expected_price_ngn:930}:
        {service_id:service,idempotency_key:key,expected_price_ngn:500,quantity:1000,link:'https://example.invalid/post'}
      return (kind==='sms'?smsHandler:smmHandler)(new Request(`https://synthetic.invalid/functions/v1/${kind==='sms'?'smsbus':'smm-create-order'}`,{
        method:'POST',headers:{'Content-Type':'application/json','x-tally-api-capability':'synthetic-capability'},body:JSON.stringify({...payload,...extra}),
      }))
    },
  }
  class Query{
    constructor(table){this.table=table;this.filters=[]}
    select(){return this}eq(name,value){this.filters.push([name,value]);return this}
    insert(){state.writes++;throw Error('Replay must not insert')}update(){state.writes++;throw Error('Replay must not update')}upsert(){state.writes++;throw Error('Replay must not upsert')}
    single(){return this.read()}maybeSingle(){return this.read()}
    async read(){
      const match=name=>this.filters.find(([field])=>field===name)?.[1]
      if(this.table==='profiles'){assert.equal(match('id'),user);state.permissionReads++;return {data:state.profile,error:null}}
      if(this.table===(kind==='sms'?'sms_orders':'smm_orders')){
        assert.equal(match('user_id'),user);assert.equal(match('idempotency_key'),key)
        return {data:state.lookupError?null:state.order,error:state.lookupError?{code:'SYNTHETIC_DB_FAILURE'}:null}
      }
      if(this.table==='transactions'){assert.equal(match('user_id'),user);assert.equal(match('idempotency_key'),`smm:purchase:${key}`);return {data:state.transaction,error:null}}
      state.catalogueReads++;throw Error('Committed recovery must not consult current catalogue')
    }
  }
  return state
}
function noNewPurchase(){assert.equal(fixture.writes,0);assert.equal(fixture.providerRequests,0);assert.equal(fixture.catalogueReads,0)}

fixture=makeFixture('sms')
let response=await fixture.request(),result=await response.json()
assert.equal(response.status,200);assert.equal(result.idempotency_hit,true);assert.equal(result.data.messages[0].code,'123456');assert.equal(fixture.walletChecks,1);noNewPurchase();checks++
for(const status of ['active','waiting','cancelled','failed','processing']){
  fixture=makeFixture('sms');fixture.order.status=status
  response=await fixture.request();assert.equal(response.status,['failed','processing'].includes(status)?202:200);noNewPurchase();checks++
}
for(const patch of [{service_id:'facebook'},{expected_price_ngn:940},{quantity:2}]){
  fixture=makeFixture('sms');response=await fixture.request(patch);assert.equal(response.status,409);assert.equal((await response.json()).code,'IDEMPOTENCY_REQUEST_CONFLICT');noNewPurchase();checks++
}
for(const tamper of [order=>{order.user_id=randomUUID()},order=>{order.idempotency_key='different-key'}]){
  fixture=makeFixture('sms');tamper(fixture.order);response=await fixture.request();assert.equal(response.status,409);noNewPurchase();checks++
}

async function bindSmm(type='Default',input={quantity:1000,link:'https://example.invalid/post'},amount=500){
  fixture=makeFixture('smm')
  const normalized=contract.validateSmmOrderFields(type,input)
  const actual=contract.quoteSmmOrder({service_type:type,price_ngn:500,min_quantity:1,max_quantity:10000},{...normalized,quantity:input.quantity})
  fixture.order.quantity=actual.quantity;fixture.order.amount_ngn=amount;fixture.order.link=input.link
  const params=globalThis.__smmReplayTests.buildPanelOrderParams({service_type:type,external_id:22},{...normalized,actualQuantity:actual.quantity})
  const hash=await globalThis.__smmReplayTests.panelPayloadHash({action:'add',...params});fixture.order.dispatch_payload_sha256=hash
  fixture.transaction={id:randomUUID(),user_id:fixture.user,idempotency_key:`smm:purchase:${fixture.key}`,reference:'ORIGINAL',type:'purchase',status:'completed',balance_type:'wallet',amount:-amount,
    metadata:{service_external_id:22,service_id:fixture.service,quantity:actual.quantity,dispatch_payload_sha256:hash}}
}
await bindSmm();response=await fixture.request();result=await response.json()
assert.equal(response.status,200);assert.equal(result.idempotency_hit,true);assert.equal(result.data.id,fixture.order.id);assert.equal(fixture.walletChecks,1);noNewPurchase();checks++
for(const patch of [{service_id:randomUUID()},{expected_price_ngn:510},{quantity:999},{link:'https://example.invalid/other'}]){
  await bindSmm();response=await fixture.request(patch);assert.equal(response.status,409);assert.equal((await response.json()).code,'IDEMPOTENCY_REQUEST_CONFLICT');noNewPurchase();checks++
}
for(const [type,input,amount,changed] of [
  ['Custom Comments',{link:'https://example.invalid/post',comments:'first\nsecond',quantity:1},1,{comments:'first\nCHANGED'}],
  ['Comment Replies',{link:'https://example.invalid/post',comments:'first\nsecond',username:'owner',quantity:1},1,{username:'different'}],
  ['Mentions Custom List',{link:'https://example.invalid/post',usernames:'alice\nbob',quantity:1},1,{usernames:'alice\ncarl'}],
  ['Custom Comments Package',{link:'https://example.invalid/post',comments:'first\nsecond'},500,{comments:'different'}],
  ['SEO',{link:'https://example.invalid/post',keywords:'news\nscience',quantity:1000},500,{keywords:'other'}],
  ['Poll',{link:'https://example.invalid/post',answer_number:2,quantity:1000},500,{answer_number:3}],
]){
  await bindSmm(type,input,amount);response=await fixture.request({...input,expected_price_ngn:amount});assert.equal(response.status,200,type);noNewPurchase();checks++
  response=await fixture.request({...input,expected_price_ngn:amount,...changed});assert.equal(response.status,409,type);assert.equal((await response.json()).code,'IDEMPOTENCY_REQUEST_CONFLICT');noNewPurchase();checks++
}
for(const [status,expected,code] of [['pending',202,'SMM_DISPATCH_STATUS_UNCONFIRMED'],['outcome_unknown',202,'SMM_SUPPLIER_OUTCOME_UNKNOWN'],['failed',409,null]]){
  await bindSmm();fixture.order.status=status;response=await fixture.request();result=await response.json();assert.equal(response.status,expected);assert.equal(result.success,false);if(code)assert.equal(result.code,code);noNewPurchase();checks++
}
for(const tamper of [()=>{fixture.transaction=null},()=>{fixture.order.dispatch_payload_sha256=null},()=>{fixture.transaction.reference='wrong'},()=>{fixture.transaction.user_id=randomUUID()},()=>{fixture.transaction.amount=-400}]){
  await bindSmm();tamper();response=await fixture.request();assert.equal(response.status,202);assert.equal((await response.json()).code,'SMM_DISPATCH_STATUS_UNCONFIRMED');noNewPurchase();checks++
}
for(const kind of ['sms','smm'])for(const gate of ['unauthorized','disabled','staff','admin','suspended','blocked','lookupError']){
  if(kind==='smm')await bindSmm();else fixture=makeFixture('sms')
  if(gate==='unauthorized')fixture.unauthorized=true
  if(gate==='disabled')fixture.enabled=false
  if(gate==='staff')fixture.profile.is_staff=true
  if(gate==='admin')fixture.profile.is_admin=true
  if(gate==='suspended')fixture.profile.account_suspended=true
  if(gate==='blocked')fixture.blocked=true
  if(gate==='lookupError')fixture.lookupError=true
  response=await fixture.request();assert.equal((await response.json()).success,false,`${kind}/${gate}`);noNewPurchase();checks++
}
console.log(JSON.stringify({actualEntryPoints:true,checks,emptyWalletCommittedRecovery:true,unchangedSecurityGates:true,changedPayloadConflicts:true,
  exactPersistedPaidAction:true,missingLegacyEvidenceHeld:true,providerPurchaseRequests:0,productionWrites:0}))
