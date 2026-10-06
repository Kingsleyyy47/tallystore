import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {customerApiRoute} from '../supabase/functions/_shared/customer-api-route.mjs'
import {validTelegramApiInput,readTelegramApiBody} from '../supabase/functions/_shared/telegram-api-contract.ts'
import {telegramProviderJson} from '../supabase/functions/_shared/telegram-provider-transport.ts'
import {canonicalTelegramApiPurchase,telegramApiDebitProven} from '../supabase/functions/_shared/telegram-api-replay.ts'

const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',
  keyId='20000000-0000-4000-8000-000000000001',productId='30000000-0000-4000-8000-000000000001',
  foreignOrder='40000000-0000-4000-8000-000000000099',key=`tlyc_telegram_${'a'.repeat(64)}`
const env={CUSTOMER_API_ENABLED:'true',TELEGRAM_ORDERS_ENABLED:'true',SUPABASE_URL:'https://local.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'fixture-service-only',SUPABASE_ANON_KEY:'fixture-anon',
  CUSTOMER_API_DELEGATION_SECRET:'fixture-secret-with-at-least-thirty-two-bytes',
  ISTAR_BASE_URL:'https://supplier.invalid',ISTAR_API_KEY:'fixture-provider'}
const orders=[],transactions=[],nonces=new Set(),queries=[],walletCalls=[],paid=[],free=[]
let funds=100_000,spendingBlocked=false,staff=false,adminRole=false,revoked=false,
  failDebit=false,unknownSupplier=false,forceConsume=false,engine,api,sequence=0,supplierDown=false,truthCalls=0,raceInsert=false,lookupError=false
const settings={ngn_usd_rate:'1000',telegram_star_cost_usdt:'0.01',telegram_wallet_type:'USDT',
  telegram_star_markup_tiers:JSON.stringify([{min_qty:50,max_qty:null,markup_ngn:100}]),
  telegram_premium_markup_ngn_3m:'1000'}
const premium={id:productId,product_type:'premium',months:3,price_ngn:9000,label:'3 months',is_active:true,sort_order:1}
function query(table){
 const entry={table,filters:[],method:'select',fields:''};queries.push(entry)
 const builder={select(fields='*'){entry.fields=fields;return this},eq(k,v){entry.filters.push([k,v]);return this},
   is(k,v){entry.filters.push([k,v]);return this},order(){return this},limit(){return this},
   insert(value){entry.method='insert';entry.value=value;return this},update(value){entry.method='update';entry.value=value;return this},
   upsert(value){entry.method='upsert';entry.value=value;return this},
   async single(){return execute(true,false)},async maybeSingle(){return execute(true,true)},
   then(resolve,reject){return execute(false,false).then(resolve,reject)}}
 async function execute(single,nullable){
  let rows
  if(table==='profiles')rows=[{id:user,is_staff:staff,is_admin:adminRole,account_suspended:false}]
  else if(table==='app_settings')rows=Object.entries(settings).map(([key,value])=>({key,value}))
  else if(table==='telegram_products')rows=[premium]
  else if(table==='telegram_orders')rows=orders
  else if(table==='transactions')rows=transactions
  else throw Error('Unexpected table '+table)
  if(entry.method==='insert'){
   assert.equal(table,'telegram_orders');assert.equal(entry.value.user_id,user)
   if(raceInsert){raceInsert=false;orders.push({...entry.value,id:crypto.randomUUID(),refunded_at:null});return{data:null,error:{code:'23505',message:'unique'}}}
   if(orders.some(o=>o.user_id===entry.value.user_id&&o.idempotency_key===entry.value.idempotency_key))return{data:null,error:{code:'23505',message:'unique'}}
   const row={...entry.value,id:`40000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,refunded_at:null,created_at:new Date().toISOString()};orders.push(row);rows=[row]
  }else if(entry.method==='upsert'){
   assert.equal(table,'app_settings');settings[entry.value.key]=entry.value.value;return{data:null,error:null}
  }
  rows=rows.filter(row=>entry.filters.every(([k,v])=>row[k]===v))
  if(table==='telegram_orders'&&entry.method==='select'&&lookupError)return{data:null,error:{message:'private db error'}}
  if(entry.method==='update')for(const row of rows)Object.assign(row,entry.value)
  if(single&&rows.length!==1&&!(nullable&&rows.length===0))return{data:null,error:{message:'not found'}}
  return{data:single?(rows[0]??null):rows.map(row=>({...row})),error:null}
 }
 return builder
}
const database={from:query,rpc:async(name,args)=>{
 if(name==='customer_api_authorize'){
  if(revoked||staff||adminRole||args.p_section!=='telegram'||args.p_hash!==await capability.sha256Hex(key))return{data:{ok:false,code:'invalid_key'},error:null}
  return{data:{ok:true,key_id:keyId,user_id:user,section:'telegram'},error:null}
 }
 if(name==='customer_api_consume_capability'){
  if(revoked||(!forceConsume&&(staff||adminRole))||args.p_section!=='telegram'||args.p_key_id!==keyId||args.p_user_id!==user||nonces.has(args.p_nonce))return{data:false,error:null}
  nonces.add(args.p_nonce);return{data:true,error:null}
 }
 if(name==='wallet_financial_truth_internal'){
  truthCalls++;assert.equal(args.p_user_id,user);return{data:{confirmed_spendable:funds,spending_blocked:spendingBlocked},error:null}
 }
 if(name==='apply_wallet_transaction'){
  walletCalls.push(args);assert.equal(args.p_user_id,user);assert.equal(args.p_type,'purchase');assert.equal(args.p_balance_type,'wallet');assert.equal(args.p_currency,'NGN')
  assert.equal(args.p_metadata.source_order_table,'telegram_orders');assert.ok(orders.some(o=>o.id===args.p_metadata.source_order_id&&o.user_id===user))
  if(failDebit)return{data:{success:false,error:'insufficient_balance'},error:null}
  assert.ok(funds>=args.p_amount);const before=funds;funds-=args.p_amount
  const row={id:crypto.randomUUID(),user_id:user,idempotency_key:args.p_idempotency_key,amount:-args.p_amount,
   status:'completed',type:'purchase',currency:'NGN',balance_type:'wallet',reference:args.p_reference,
   metadata:{...args.p_metadata,trusted_principal_authorized:true,trusted_principal_debit_amount:args.p_amount},
   transaction_hash:'b'.repeat(64),balance_before:before,balance_after:funds};transactions.push(row)
  return{data:{success:true,transaction_id:row.id,balance_after:funds},error:null}
 }
 throw Error('Unexpected RPC '+name)
}}
const common={Request,Response,URL,AbortSignal,AbortController,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,crypto,
  btoa,atob,Deno:{env:{get:name=>env[name]}},console:{error(){},warn(){}},createClient:()=>database}
function load(path,extra){
 const source=readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const context=vm.createContext({...common,...extra});vm.runInContext(code,context);return context
}
const capability=load('supabase/functions/_shared/customer-api-delegation.ts',{})
const fakeProviderFetch=async(url,options={})=>{
    assert.ok(url.startsWith('https://supplier.invalid/'));assert.equal(options.redirect,'error');assert.ok(options.signal)
    assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');if(supplierDown)throw Error('provider down')
    if(options.method==='POST'){
      assert.ok(url.endsWith('/orders/star')||url.endsWith('/orders/premium'));const input=JSON.parse(options.body)
      assert.equal(input.recipient_hash,'server-recipient-hash');assert.equal(input.username,'recipient_one')
      paid.push({url,input});if(unknownSupplier)throw Error('unknown supplier outcome')
      return Response.json({order_id:'supplier-order-'+paid.length,amount:input.quantity?input.quantity*0.01:10})
    }
    free.push(url)
    if(url.endsWith('/premium/packages'))return Response.json([{months:3,usd_value:10}])
    if(url.includes('/recipient/search?'))return Response.json({recipient:'server-recipient-hash',name:'Recipient',photo:null})
    if(url.includes('/orders/'))return Response.json({status:'processing'})
    throw Error('Unexpected free supplier request')
  }
load('supabase/functions/telegram-stars/index.ts',{authenticateCustomerRequest:capability.authenticateCustomerRequest,
  validTelegramApiInput,readTelegramApiBody,canonicalTelegramApiPurchase,telegramApiDebitProven,
  telegramProviderJson:(url,init,options)=>telegramProviderJson(url,init,{...options,fetcher:fakeProviderFetch}),serve:handler=>{engine=handler}})
load('supabase/functions/customer-api/index.ts',{serve:handler=>{api=handler},customerApiRoute,
  sha256Hex:capability.sha256Hex,signCustomerCapability:capability.signCustomerCapability,validTelegramApiInput,
  fetch:async(url,options)=>{
   assert.equal(url,'https://local.invalid/functions/v1/telegram-stars');assert.equal(options.headers['x-tally-api-capability'].split('.').length,2)
   return engine(new Request(url,options))
  }})
async function call(path,body,bearer=key){const r=await api(new Request('https://local.invalid/customer-api'+path,
 {method:body?'POST':'GET',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return{status:r.status,body:await r.json()}}
const request={section:'telegram',product_type:'stars',quantity:100,username:'@recipient_one',expected_amount_ngn:1100,idempotency_key:'telegram-api-order-001'}
let result=await call('/v1/catalogue?section=telegram')
assert.equal(result.status,200);assert.equal(result.body.data.stars.min_quantity,50);assert.deepEqual(result.body.data.premium,[{id:productId,label:'3 months',months:3,price_ngn:11000}]);assert.ok(!/cost|markup|supplier|wallet_type|istar/.test(JSON.stringify(result.body)))
result=await call('/v1/telegram/quote',{section:'telegram',product_type:'stars',quantity:100});assert.equal(result.body.data.price_ngn,1100)
result=await call(`/v1/quote?section=telegram&product_type=premium&product_id=${productId}`);assert.equal(result.body.data.price_ngn,11000)
result=await call('/v1/telegram/recipient',{section:'telegram',product_type:'stars',quantity:100,username:'recipient_one'});assert.equal(result.body.data.recipient,'server-recipient-hash')
result=await call('/v1/purchases',{...request,expected_amount_ngn:1000});assert.equal(result.status,409);assert.equal(result.body.code,'PRICE_CHANGED');assert.equal(walletCalls.length,0);assert.equal(paid.length,0)
result=await call('/v1/purchases',request);assert.equal(result.status,200);assert.equal(walletCalls.length,1);assert.equal(walletCalls[0].p_amount,1100);assert.equal(paid.length,1);assert.equal(result.body.data.status,'processing');assert.ok(!/istar|recipient_hash|idempotency/.test(JSON.stringify(result.body)))
const owned=result.body.data.id
result=await call('/v1/purchases',request);assert.equal(result.status,200);assert.equal(result.body.idempotency_hit,true);assert.equal(walletCalls.length,1);assert.equal(paid.length,1)
// Replay must not depend on today's quote, funds or supplier availability.
const replayBefore={free:free.length,paid:paid.length,wallet:walletCalls.length,truth:truthCalls}
funds=0;supplierDown=true;settings.telegram_star_markup_tiers=JSON.stringify([{min_qty:50,max_qty:null,markup_ngn:999}])
result=await call('/v1/purchases',request);assert.equal(result.status,200);assert.equal(result.body.idempotency_hit,true)
assert.deepEqual({free:free.length,paid:paid.length,wallet:walletCalls.length,truth:truthCalls},replayBefore)
for(const changed of [{username:'recipient_one'},{quantity:101},{expected_amount_ngn:1200}]){
 result=await call('/v1/purchases',{...request,...changed});assert.equal(result.status,409)
}
const starOrder=orders.find(o=>o.id===owned),starTx=transactions.find(t=>t.metadata.source_order_id===owned)
const originalHash=starOrder.customer_api_request_hash;assert.match(originalHash,/^[a-f0-9]{64}$/)
starOrder.customer_api_request_hash=null;assert.equal((await call('/v1/purchases',request)).status,409);starOrder.customer_api_request_hash=originalHash
starOrder.status='completed';const savedTx=structuredClone(starTx)
for(const change of [{amount:1100},{user_id:other},{transaction_hash:null},{balance_after:123},
 {type:'deposit'},{currency:'USD'},{balance_type:'crypto'},{reference:'wrong-reference'},
 {metadata:{...starTx.metadata,source_order_id:foreignOrder}},
 {metadata:{...starTx.metadata,trusted_principal_authorized:false}},
 {metadata:{...starTx.metadata,trusted_principal_debit_amount:1200}}, {metadata:{...starTx.metadata,customer_api_request_hash:'c'.repeat(64)}}]){
 Object.assign(starTx,change);assert.equal((await call('/v1/purchases',request)).status,202);Object.assign(starTx,structuredClone(savedTx))
}
transactions.splice(transactions.indexOf(starTx),1);assert.equal((await call('/v1/purchases',request)).status,202);transactions.push(starTx)
assert.deepEqual({free:free.length,paid:paid.length,wallet:walletCalls.length,truth:truthCalls},replayBefore)
starOrder.status='processing';supplierDown=false;funds=100_000;settings.telegram_star_markup_tiers=JSON.stringify([{min_qty:50,max_qty:null,markup_ngn:100}])
result=await call('/v1/purchases',{...request,product_type:'premium',quantity:undefined,product_id:productId,expected_amount_ngn:11000,idempotency_key:'telegram-premium-order-001'});assert.equal(result.status,200);assert.equal(walletCalls.at(-1).p_amount,11000);assert.equal(paid.at(-1).input.months,3)
const premiumRequest={...request,product_type:'premium',quantity:undefined,product_id:productId,expected_amount_ngn:11000,idempotency_key:'telegram-premium-order-001'}
const premiumBefore={free:free.length,paid:paid.length,wallet:walletCalls.length,truth:truthCalls}
funds=0;supplierDown=true;premium.is_active=false;premium.price_ngn=25000
assert.equal((await call('/v1/purchases',premiumRequest)).status,200)
assert.equal((await call('/v1/purchases',{...premiumRequest,product_id:'30000000-0000-4000-8000-000000000002'})).status,409)
assert.deepEqual({free:free.length,paid:paid.length,wallet:walletCalls.length,truth:truthCalls},premiumBefore)
premium.is_active=true;premium.price_ngn=11000;supplierDown=false;funds=100_000
lookupError=true;assert.equal((await call('/v1/purchases',{...request,idempotency_key:'telegram-read-failure-001'})).status,503);lookupError=false
const raceBefore={paid:paid.length,wallet:walletCalls.length};raceInsert=true
result=await call('/v1/purchases',{...request,idempotency_key:'telegram-race-order-001'});assert.equal(result.status,202)
assert.deepEqual({paid:paid.length,wallet:walletCalls.length},raceBefore)
const paidBefore=paid.length,walletBefore=walletCalls.length
for(const addition of[{user_id:other},{recipient_hash:'caller-controlled'},{action:'admin_wallet_balance'},{wallet_type:'TON'},{supplier_url:'https://evil.invalid'}]){
 result=await call('/v1/purchases',{...request,...addition});assert.equal(result.status,400)
}
assert.equal(paid.length,paidBefore);assert.equal(walletCalls.length,walletBefore)
assert.equal((await call('/v1/telegram/quote',{section:'telegram',product_type:'stars',quantity:100},`tlyc_sms_${'b'.repeat(64)}`)).status,401)
orders.push({id:foreignOrder,user_id:other,status:'completed',istar_order_id:'foreign-secret',price_ngn:1})
result=await call(`/v1/orders/${foreignOrder}?section=telegram`);assert.equal(result.status,404);assert.ok(!JSON.stringify(result.body).includes('foreign-secret'))
const queryBefore=queries.length
result=await call(`/v1/orders/${owned}?section=telegram`);assert.equal(result.status,200)
for(const q of queries.slice(queryBefore).filter(q=>q.table==='telegram_orders'))assert.ok(q.filters.some(([k,v])=>k==='user_id'&&v===user),'every status reread must retain wallet ownership')
result=await call('/v1/orders?section=telegram');assert.equal(result.body.data.some(o=>o.id===foreignOrder),false)
funds=0;result=await call('/v1/purchases',{...request,idempotency_key:'telegram-no-funds-001'});assert.ok(result.status>=400);assert.equal(paid.length,paidBefore);assert.equal(walletCalls.length,walletBefore)
funds=100_000;failDebit=true;result=await call('/v1/purchases',{...request,idempotency_key:'telegram-debit-fails-001'});assert.ok(result.status>=400);assert.equal(paid.length,paidBefore);failDebit=false
unknownSupplier=true;result=await call('/v1/purchases',{...request,idempotency_key:'telegram-unknown-001'});assert.equal(result.status,202);assert.equal(result.body.code,'SUPPLIER_OUTCOME_UNKNOWN');const unknownPaid=paid.length,unknownDebit=walletCalls.length
result=await call('/v1/purchases',{...request,idempotency_key:'telegram-unknown-001'});assert.equal(result.status,202);assert.equal(paid.length,unknownPaid);assert.equal(walletCalls.length,unknownDebit);unknownSupplier=false
const identity={key_id:keyId,user_id:user,section:'telegram'},raw=JSON.stringify({action:'api_catalogue'})
async function direct(cap,body=raw,bearer=env.SUPABASE_SERVICE_ROLE_KEY){const r=await engine(new Request('https://local.invalid/functions/v1/telegram-stars',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json','x-tally-api-capability':cap},body}));return{status:r.status,body:await r.json()}}
const cap=await capability.signCustomerCapability(identity,'telegram-stars',raw)
assert.equal((await direct(cap)).status,200);assert.equal((await direct(cap)).status,401)
assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',raw),raw+' ')).status,401)
assert.equal((await direct(await capability.signCustomerCapability({...identity,section:'giftcards'},'telegram-stars',raw))).status,401)
assert.equal((await direct(await capability.signCustomerCapability(identity,'smsbus',raw))).status,401)
assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',raw),raw,'fixture-customer-JWT')).status,401)
forceConsume=true;staff=true;assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',raw))).status,403);staff=false;adminRole=true;assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',raw))).status,403);adminRole=false;forceConsume=false
const forbidden=JSON.stringify({action:'api_hidden_purchase',product_type:'stars',quantity:100})
assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',forbidden),forbidden)).status,400)
env.TELEGRAM_ORDERS_ENABLED='false';assert.equal((await call('/v1/purchases',{...request,idempotency_key:'telegram-paused-001'})).status,503)
const finalPaid=paid.length,finalDebits=walletCalls.length;env.CUSTOMER_API_ENABLED='false'
assert.equal((await call('/v1/catalogue?section=telegram')).body.code,'coming_soon')
assert.equal((await direct(await capability.signCustomerCapability(identity,'telegram-stars',raw))).status,503)
assert.equal(paid.length,finalPaid);assert.equal(walletCalls.length,finalDebits)
env.CUSTOMER_API_ENABLED='true'
const oversized=await engine(new Request('https://local.invalid/functions/v1/telegram-stars',{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json','Content-Length':'20000','x-tally-api-capability':'invalid'},body:'{}'}))
assert.equal(oversized.status,413)
const hanging=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"action":"api_catalogue"'))}})
const timedOut=await engine(new Request('https://local.invalid/functions/v1/telegram-stars',{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json','x-tally-api-capability':'invalid'},body:hanging,duplex:'half'}))
assert.equal(timedOut.status,408);assert.equal(paid.length,finalPaid);assert.equal(walletCalls.length,finalDebits)
console.log('Telegram customer API actual handlers: safe retail catalogue/quotes, section/body/nonce binding, owned wallet debit, price/low-funds/privilege denial, unresolved no-resend and launch gates passed (offline only).')
