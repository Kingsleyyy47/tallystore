// The actual exported handler and frozen provider/validators run against
// synthetic Supabase and HTTP fixtures. No live login or paid call is made.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import esbuild from 'esbuild'
import { webcrypto } from 'node:crypto'

const build = await esbuild.build({ entryPoints:['supabase/functions/customer-giftcards/index.ts'],bundle:true,
  platform:'node',format:'cjs',write:false,plugins:[{ name:'synthetic-supabase',setup(api) {
    api.onResolve({ filter:/^https:\/\/esm\.sh\// },()=>({ path:'supabase',namespace:'mock' }))
    api.onLoad({ filter:/.*/,namespace:'mock' },()=>({ contents:'export const createClient = globalThis.__createClient',loader:'js' }))
  } }] })
const buyer='11111111-1111-4111-8111-111111111111'
const foreign='22222222-2222-4222-8222-222222222222'
const orderId='33333333-3333-4333-8333-333333333333'
const invoiceId='synthetic-invoice'
const packageId='synthetic-gift<&>10'
const purchase={ action:'purchase',product_id:'synthetic-gift',package_id:packageId,unit_value:10,quantity:2,
  expected_amount_ngn:520,idempotency_key:'giftcard-synthetic-purchase-001' }
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
const native=value=>JSON.parse(JSON.stringify(value))

function harness(options={}) {
  let edge
  let journal=options.replay ? { state:options.completeReplay?'completed':'unknown',request:{...purchase},quote:null } : null
  let currentStatus=options.statusReady?'processing':options.completeReplay?'completed':'pending'
  let bound=false
  let balanceReads=0
  const quote={ product_id:'synthetic-gift',product_name:'Synthetic Gift',package_id:packageId,unit_value:10,currency:'EUR',quantity:options.quantity??2,
    amount_ngn:options.expectedAmount??520,provider_price:options.expectedProviderPrice??5.02,billing_currency:'USD' }
  if(journal) journal.quote=quote
  const calls={ auth:0,clients:0,profile:[],queries:[],rpc:[],get:0,create:0,pay:0,post:0,bind:0,claimCreate:0,claimPay:0,
    reserve:0,replay:0,unknown:0,completed:0,rejected:0,alerts:0,events:[] }
  const env={ SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
    BITREFILL_API_KEY:'synthetic-provider',CUSTOMER_GIFTCARDS_ENABLED:options.enabled===false?'false':'true',
    BITREFILL_PRICE_UNIT:options.unit===undefined?'major':options.unit }
  if(options.defaultGate) delete env.CUSTOMER_GIFTCARDS_ENABLED
  if(options.defaultUnit) delete env.BITREFILL_PRICE_UNIT
  const row=()=>({ id:orderId,user_id:options.foreignOrder?foreign:buyer,status:currentStatus,product_id:quote.product_id,
    product_name:quote.product_name,package_id:quote.package_id,unit_value:quote.unit_value,currency:quote.currency,quantity:quote.quantity,
    amount_ngn:quote.amount_ngn,created_at:'2026-10-05T00:00:00Z',invoice_id:'PRIVATE-INVOICE',api_key:'PRIVATE-KEY' })
  const units=()=>[0,1].map(index=>({ order_id:`synthetic-unit-${index}`,code:`SYNTHETIC-CODE-${index}`,pin:'1234' }))
  const admin={
    from(table) {
      const query={ table,fields:'',filters:{} }
      const builder={ select(fields) { query.fields=fields;return this },eq(field,value) { query.filters[field]=value;return this },
        order(){return this},async limit() { calls.queries.push(query);return {data:[row()],error:null} },
        async maybeSingle() {
          if(table==='profiles') {calls.profile.push(query);return {data:options.missingProfile?null:{is_staff:!!options.staff,is_admin:!!options.admin,account_suspended:!!options.suspended},error:null} }
          if(table==='app_settings') return {data:query.filters.key==='ngn_usd_rate'?{value:'100'}
            :options.blocked?{value:JSON.stringify([{product_id:'synthetic-gift'}])}:options.badBlocklist?{value:'invalid-json'}:null,error:options.settingFailure?{message:'PRIVATE-DB-ERROR'}:null}
          throw new Error('Unexpected table fixture')
        },
      }
      return builder
    },
    async rpc(name,args) {
      calls.rpc.push({name,args:native(args)});calls.events.push(name)
      if(name==='get_customer_bitrefill_pricing') {
        assert.equal(args.p_kind,'gift_card');assert.equal(args.p_currency,'EUR');assert.equal(args.p_package_id,packageId)
        return {data:{success:true,mode:options.pricingMode||'amount',value:options.pricingValue??7,source:'denomination'},error:null}
      }
      if(name==='get_customer_giftcard_replay') {
        calls.replay++;assert.equal(args.p_user_id,buyer)
        if(options.replayConflict) return {data:{success:false,code:'IDEMPOTENCY_REQUEST_CONFLICT'},error:null}
        if(journal) {
          const expected={product_id:purchase.product_id,package_id:purchase.package_id,unit_value:10,quantity:2,expected_amount_ngn:520}
          if(JSON.stringify(native(args.p_request))!==JSON.stringify(expected)) return {data:{success:false,code:'IDEMPOTENCY_REQUEST_CONFLICT'},error:null}
          return {data:{success:true,existing:true,order_id:orderId,state:journal.state,idempotent_replay:true},error:null}
        }
        return {data:{success:true,existing:false},error:null}
      }
      if(name==='authorize_customer_giftcard_purchase') {
        calls.reserve++;assert.equal(args.p_user_id,buyer);assert.equal(args.p_quote.amount_ngn,quote.amount_ngn)
        assert.equal(args.p_quote.provider_price,quote.provider_price);assert.equal(args.p_quote.billing_currency,'USD')
        assert.equal(args.p_expected_amount_ngn,quote.amount_ngn)
        if(options.reserveFail) return {data:{success:false,code:'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'},error:null}
        journal={request:native(args.p_request),quote:native(args.p_quote),state:'prepared'}
        return {data:{success:true,order_id:orderId,idempotent_replay:false},error:null}
      }
      if(name==='claim_customer_giftcard_dispatch') {
        calls.claimCreate++;assert.equal(args.p_user_id,buyer)
        if(options.claimCreateDenied) return {data:{success:true,send_allowed:false},error:null}
        journal.state='creating';currentStatus='processing';return {data:{success:true,send_allowed:true},error:null}
      }
      if(name==='bind_customer_giftcard_invoice') {
        calls.bind++;assert.equal(args.p_invoice_id,invoiceId);assert.equal(args.p_quote.product_id,'synthetic-gift')
        assert.equal(args.p_quote.package_id,packageId);assert.equal(args.p_provider_status,'unpaid')
        if(options.bindFailure) return {data:null,error:{message:'PRIVATE-BIND-ERROR'}}
        bound=true;journal.state='bound';return {data:{success:true,bound:true},error:null}
      }
      if(name==='claim_customer_giftcard_payment') {
        calls.claimPay++;assert.equal(bound,true,'invoice bind commits before payment claim')
        assert.equal(args.p_user_id,buyer);assert.equal(args.p_invoice_id,invoiceId)
        if(options.claimPayDenied) return {data:{success:true,pay_allowed:false},error:null}
        journal.state='paying';return {data:{success:true,pay_allowed:true},error:null}
      }
      if(name==='record_customer_giftcard_outcome') {
        assert.equal(args.p_user_id,buyer)
        if(args.p_outcome==='unknown') {
          calls.unknown++
          if(!['creating','bound','paying','unknown'].includes(journal.state)) return {data:{success:false,code:'UNKNOWN_NOT_ELIGIBLE'},error:null}
          journal.state='unknown';currentStatus='review_required'
        }
        if(args.p_outcome==='rejected') {
          calls.rejected++;assert.equal(calls.pay,0);journal.state='rejected';currentStatus='failed'
          if(options.rejectionResponseLost) throw new Error('Synthetic committed rejection response loss')
        }
        if(args.p_outcome==='completed') {
          calls.completed++;assert.equal(args.p_evidence.redemptions.length,2);assert.equal(args.p_evidence.invoice_id,invoiceId)
          assert.equal(args.p_evidence.package_id,packageId);assert.equal(args.p_evidence.item_id,'synthetic-gift')
          if(options.captureFailure) return {data:{success:false,code:'CAPTURE_REQUIRES_REVIEW'},error:null}
          journal={...journal,state:'completed'};currentStatus='completed'
          if(options.captureResponseLost) throw new Error('Synthetic committed capture response loss')
        }
        return {data:{success:true},error:null}
      }
      if(name==='get_customer_giftcard_order') {
        assert.equal(args.p_user_id,buyer);assert.equal(args.p_order_id,orderId)
        if(options.foreignMissing) return {data:{success:false,code:'ORDER_NOT_FOUND'},error:null}
        return {data:{success:true,order:row(),state:journal?.state||'paying',private_payload:'PRIVATE-PAYLOAD',
          ...(currentStatus==='completed'&&!options.omitCapturedRedemptions?{redemptions:units()}:options.prematureCodes?{redemptions:units()}:{} )},error:null}
      }
      if(name==='get_customer_giftcard_reconciliation') return {data:{success:true,order_id:orderId,quote,invoice_id:invoiceId,
        state:options.unclaimed?'bound':'unknown',payment_claimed:!options.unclaimed},error:null}
      if(name==='record_supplier_balance_alert') {
        calls.alerts++;assert.equal(args.p_source,'customer-giftcards')
        if(options.alertThrow) throw new Error('PRIVATE-ALERT-TRANSPORT-ERROR')
        return {data:null,error:options.alertFail?{message:'PRIVATE-ALERT-ERROR'}:null}
      }
      throw new Error('Unexpected RPC fixture')
    },
  }
  const context={ module:{exports:{}},exports:{},Request,Response,URL,Date,TextEncoder,TextDecoder,Uint8Array,AbortSignal,AbortController,
    setTimeout,clearTimeout,crypto:webcrypto,console:{error(){}},Deno:{serve(fn){edge=fn},env:{get(name){return env[name]}}},
    async fetch(input,init={}) {
      const url=String(input)
      calls.events.push(init.method==='POST'?'provider-post':'provider-get')
      if(init.method==='POST') calls.post++;else calls.get++
      assert.ok(url.startsWith('https://api.bitrefill.com/v2/')||url.includes('coinbase.com'),'fixed official provider origin only')
      if(url.includes('BTC-USD/ticker')) return response({price:'100000',time:new Date().toISOString()})
      if(url.endsWith('/products/synthetic-gift')) {
        if(options.productFailure) throw new Error('PRIVATE-SUPPLIER-TOKEN-ERROR')
        return response({data:{id:'synthetic-gift',name:'Synthetic Gift',type:options.wrongType?'phone_refill':'gift_card',in_stock:true,
          currency:'EUR',recipient_type:'none',packages:[{package_id:packageId,value:10,price:options.candidatePrice??2.51}]}})
      }
      if(url.endsWith('/accounts/balance')) {
        balanceReads++
        return response({data:{currency:balanceReads>1&&options.changedBalanceCurrency?options.changedBalanceCurrency:options.balanceCurrency||'USD',
          balance:balanceReads>1&&options.lowFreshBalance?0:options.balance??1000}})
      }
      if(url.endsWith('/invoices')&&init.method==='POST') {
        calls.create++;assert.equal(calls.claimCreate,1);assert.equal(calls.reserve,1)
        const payload=JSON.parse(init.body)
        assert.equal(payload.auto_pay,false);assert.equal(payload.payment_method,'balance')
        assert.deepEqual(payload.products,[{product_id:'synthetic-gift',quantity:2,package_id:packageId}])
        if(options.createUnknown) throw new Error('PRIVATE-TOKEN-NETWORK-ERROR')
        return response({data:{id:invoiceId,status:options.createdPaid?'complete':'unpaid',orders:[{id:'synthetic-unit-0'},{id:'synthetic-unit-1'}]}})
      }
      if(url.endsWith(`/invoices/${invoiceId}/pay`)) {
        calls.pay++;assert.equal(calls.claimPay,1);assert.equal(bound,true)
        if(options.payUnknown) throw new Error('PRIVATE-TOKEN-AMBIGUOUS-PAID-ERROR')
        return response({data:{id:invoiceId,status:'pending'}})
      }
      if(url.endsWith(`/invoices/${invoiceId}`)) return response({data:{id:invoiceId,status:calls.pay||options.statusReady?'complete':'unpaid',
        payment:{method:options.wrongPayment?'bitcoin':'balance',currency:options.invoiceCurrency||'USD',price:options.invoicePrice??5.02},
        orders:options.duplicateUnits?[{id:'synthetic-unit-0'},{id:'synthetic-unit-0'}]:[{id:'synthetic-unit-0'},{id:'synthetic-unit-1'}]}})
      if(url.includes('/orders/synthetic-unit-')) {
        const child=url.split('/').at(-1)
        const paid=calls.pay||options.statusReady
        return response({data:{id:child,status:paid?(options.partial&&child.endsWith('-1')?'processing':'delivered'):'created',
          product:{id:options.wrongChildProduct?'foreign-gift':'synthetic-gift',value:options.wrongChildValue?20:10,currency:'EUR',package_id:packageId},
          ...(paid?{redemption_info:{code:`SYNTHETIC-CODE-${child.endsWith('-1')?1:0}`,pin:'1234'}}:{})}})
      }
      throw new Error('Unexpected HTTP fixture')
    },
  }
  context.globalThis=context
  context.__createClient=(_url,token)=>{
    calls.clients++
    return token==='public-test'?{auth:{async getUser(jwt){calls.auth++;return jwt==='synthetic-jwt'?{data:{user:{id:buyer}},error:null}:{data:{user:null},error:{message:'PRIVATE-AUTH-ERROR'}}}}}:admin
  }
  vm.runInNewContext(build.outputFiles[0].text,context,{timeout:5000})
  const request=value=>new Request('https://synthetic.invalid/functions/v1/customer-giftcards',{method:'POST',
    headers:{Authorization:'Bearer synthetic-jwt','Content-Type':'application/json'},body:JSON.stringify(value)})
  const post=async(value,headers={})=>{
    const req=request(value)
    for(const [key,value] of Object.entries(headers)) req.headers.set(key,value)
    const result=await edge(req)
    return {status:result.status,body:await result.json()}
  }
  return {post,edge,request,calls}
}

let h=harness()
let result=await h.post({action:'quote',product_id:'synthetic-gift',package_id:packageId,unit_value:10,quantity:2})
assert.equal(result.body.quote.amount_ngn,520);assert.equal(result.body.quote.unit_amount_ngn,260)
assert.equal(result.body.quote.currency,'EUR','face currency does not determine merchant billing currency')
assert.ok(!/provider_price|billing_currency|unit_price_candidate|balance|synthetic-provider/.test(JSON.stringify(result.body)))
h=harness({candidatePrice:0.1,pricingValue:0,quantity:3,expectedAmount:30,expectedProviderPrice:0.3,reserveFail:true})
result=await h.post({...purchase,quantity:3,expected_amount_ngn:30})
assert.equal(result.body.code,'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS')
assert.equal(h.calls.rpc.find(call=>call.name==='authorize_customer_giftcard_purchase').args.p_quote.provider_price,0.3,
  '0.1 times3 freezes an exact declared decimal supplier total')
assert.equal(h.calls.rpc.find(call=>call.name==='authorize_customer_giftcard_purchase').args.p_quote.amount_ngn,30,
  'exact NGN10 per-unit boundary never rounds toNGN20')
assert.equal(h.calls.post,0)
for(const [options,expectedUnit] of [[{unit:'satoshi',balanceCurrency:'BTC',candidatePrice:3000},310],
  [{unit:'major',balanceCurrency:'NGN'},10],[{pricingMode:'percent',pricingValue:10},280]]) {
  h=harness(options)
  result=await h.post({action:'quote',product_id:'synthetic-gift',package_id:packageId,unit_value:10,quantity:2})
  assert.equal(result.body.quote.unit_amount_ngn,expectedUnit);assert.equal(result.body.quote.amount_ngn,expectedUnit*2)
  assert.equal(h.calls.post,0)
}
h=harness()
result=await h.post({action:'details',product_id:'synthetic-gift'})
assert.equal(result.body.product.packages[0].unit_value,10)
assert.ok(!JSON.stringify(result.body).includes('2.51'))
h=harness({defaultGate:true})
result=await h.post(purchase)
assert.equal(result.body.code,'GIFT_CARDS_PAUSED');assert.equal(h.calls.replay,1);assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
for(const options of [{defaultUnit:true},{unit:'auto'},{unit:'satoshi',balanceCurrency:'USD'},{unit:'major',balanceCurrency:'BTC'}]) {
  h=harness(options);result=await h.post(purchase)
  assert.ok(['PRICE_UNIT_UNVERIFIED','PRICE_UNAVAILABLE'].includes(result.body.code));assert.equal(h.calls.post,0);assert.equal(h.calls.reserve,0)
  if(options.defaultUnit||options.unit==='auto') assert.equal(h.calls.get,0)
}
for(const extra of [{user_id:foreign},{provider_key:'private'},{url:'https://evil.example'},{wallet_balance:1000000},{action:'admin_pricing_set'}]) {
  h=harness();result=await h.post({...purchase,...extra})
  assert.equal(result.status,400);assert.equal(h.calls.auth,0);assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
}
for(const auth of ['Bearer synthetic-service','Bearer forged-jwt']) {
  h=harness();result=await h.post(purchase,{Authorization:auth})
  assert.equal(result.status,401);assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
}
h=harness();result=await h.post(purchase,{'x-tally-api-capability':'signed-but-unsupported'})
assert.equal(result.status,401);assert.equal(h.calls.clients,0)
for(const options of [{staff:true},{admin:true},{suspended:true},{missingProfile:true}]) {
  h=harness(options);result=await h.post(purchase)
  assert.ok([401,403].includes(result.status));assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
}
h=harness({reserveFail:true});result=await h.post(purchase)
assert.equal(result.body.code,'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS');assert.equal(h.calls.reserve,1);assert.equal(h.calls.create,0);assert.equal(h.calls.pay,0)
h=harness();result=await h.post({...purchase,expected_amount_ngn:530})
assert.equal(result.body.code,'PRICE_CHANGED');assert.equal(h.calls.reserve,0);assert.equal(h.calls.post,0)
h=harness({replay:true,defaultUnit:true,enabled:false});result=await h.post(purchase)
assert.equal(result.body.idempotent_replay,true);assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
result=await h.post({...purchase,quantity:1})
assert.equal(result.body.code,'IDEMPOTENCY_REQUEST_CONFLICT');assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
for(const options of [{blocked:true},{badBlocklist:true},{wrongType:true},{productFailure:true}]) {
  h=harness(options);result=await h.post(purchase)
  assert.equal(result.body.success,false);assert.equal(h.calls.post,0)
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE'))
}
h=harness({balance:0,alertFail:true});result=await h.post(purchase)
assert.equal(result.body.code,'PROVIDER_BALANCE_LOW');assert.equal(h.calls.rejected,1);assert.equal(h.calls.alerts,1);assert.equal(h.calls.post,0)
h=harness({balance:0,alertThrow:true});result=await h.post(purchase)
assert.equal(result.body.code,'PROVIDER_BALANCE_LOW');assert.equal(h.calls.rejected,1);assert.equal(h.calls.alerts,1);assert.equal(h.calls.post,0)
h=harness({lowFreshBalance:true});result=await h.post(purchase)
assert.equal(result.body.code,'PROVIDER_BALANCE_LOW');assert.equal(h.calls.create,1);assert.equal(h.calls.bind,1);assert.equal(h.calls.pay,0);assert.equal(h.calls.rejected,1)
for(const options of [{claimCreateDenied:true},{createUnknown:true},{createdPaid:true},{wrongChildProduct:true},
  {wrongChildValue:true},{duplicateUnits:true},{invoiceCurrency:'BTC'},{wrongPayment:true},{bindFailure:true},{claimPayDenied:true},
  {changedBalanceCurrency:'BTC'}]) {
  h=harness(options);result=await h.post(purchase)
  assert.equal(result.body.outcome_unknown,true);assert.equal(h.calls.pay,0);assert.equal(h.calls.rejected,0)
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE'))
}
h=harness({invoicePrice:5.5});result=await h.post(purchase)
assert.equal(result.body.code,'PRICE_CHANGED');assert.equal(h.calls.bind,1);assert.equal(h.calls.rejected,1);assert.equal(h.calls.claimPay,0);assert.equal(h.calls.pay,0)
for(const options of [{balance:0,rejectionResponseLost:true},{lowFreshBalance:true,rejectionResponseLost:true},
  {invoicePrice:5.5,rejectionResponseLost:true}]) {
  h=harness(options);result=await h.post(purchase)
  assert.equal(result.body.order.status,'failed');assert.equal(result.body.success,false);assert.equal(result.body.code,'PURCHASE_REJECTED')
  assert.ok(!('outcome_unknown' in result.body));assert.ok(!('redemptions' in result.body));assert.equal(h.calls.rejected,1);assert.equal(h.calls.pay,0)
  if(options.balance===0||options.lowFreshBalance) {
    assert.equal(h.calls.alerts,1)
    assert.ok(h.calls.events.indexOf('record_supplier_balance_alert')<h.calls.events.indexOf('record_customer_giftcard_outcome'),
      'known low supplier balance is recorded before a lost rejection response')
  }
}
for(const options of [{payUnknown:true},{partial:true},{captureFailure:true}]) {
  h=harness(options);result=await h.post(purchase)
  assert.equal(result.body.outcome_unknown,true);assert.equal(h.calls.create,1);assert.equal(h.calls.pay,1);assert.equal(h.calls.rejected,0)
  assert.ok(!('redemptions' in result.body));assert.ok(!JSON.stringify(result.body).includes('PRIVATE'))
  result=await h.post(purchase)
  assert.equal(result.body.idempotent_replay,true);assert.equal(h.calls.create,1);assert.equal(h.calls.pay,1,'uncertain replay does not pay again')
}
h=harness();result=await h.post(purchase)
assert.equal(result.body.order.status,'completed');assert.equal(result.body.redemptions.length,2)
assert.equal(h.calls.create,1);assert.equal(h.calls.pay,1);assert.equal(h.calls.completed,1)
assert.ok(h.calls.events.indexOf('bind_customer_giftcard_invoice')<h.calls.events.indexOf('claim_customer_giftcard_payment'))
assert.ok(!/PRIVATE|invoice_id|provider_price|billing_currency/.test(JSON.stringify(result.body)))
// Model a committed capture whose HTTP/RPC response was lost. The actual SQL
// denies the subsequent unknown transition and owned proof remains completed.
h=harness({captureResponseLost:true});result=await h.post(purchase)
assert.equal(result.body.success,true);assert.equal(result.body.order.status,'completed');assert.equal(result.body.redemptions.length,2)
assert.ok(!('outcome_unknown' in result.body));assert.equal(h.calls.unknown,1);assert.equal(h.calls.completed,1)
assert.equal(h.calls.create,1);assert.equal(h.calls.pay,1);assert.equal(h.calls.rejected,0)
assert.deepEqual(h.calls.profile[0],{table:'profiles',fields:'is_admin,is_staff,account_suspended',filters:{id:buyer}})
result=await h.post(purchase);assert.equal(result.body.idempotent_replay,true);assert.equal(h.calls.pay,1)
h=harness({captureResponseLost:true,omitCapturedRedemptions:true});result=await h.post(purchase)
assert.equal(result.body.success,false);assert.equal(result.body.outcome_unknown,true)
assert.ok(!('redemptions' in result.body));assert.equal(h.calls.pay,1);assert.equal(h.calls.rejected,0)
h=harness({statusReady:true});result=await h.post({action:'status',order_id:orderId})
assert.equal(result.body.order.status,'completed');assert.equal(result.body.redemptions.length,2)
assert.equal(h.calls.completed,1);assert.equal(h.calls.create,0);assert.equal(h.calls.pay,0);assert.equal(h.calls.post,0)
h=harness({statusReady:true,unclaimed:true});result=await h.post({action:'status',order_id:orderId})
assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
for(const options of [{foreignMissing:true},{foreignOrder:true}]) {
  h=harness(options);result=await h.post({action:'status',order_id:orderId})
  assert.equal(result.body.success,false);assert.equal(h.calls.get,0);assert.equal(h.calls.post,0)
}
h=harness({prematureCodes:true});result=await h.post({action:'order',order_id:orderId})
assert.ok(!('redemptions' in result.body),'uncaptured summaries cannot forward premature codes')
h=harness();result=await h.post({action:'orders'})
assert.equal(result.body.orders.length,1);assert.ok(!JSON.stringify(result.body).includes('PRIVATE'))
assert.deepEqual(h.calls.queries[0].filters,{user_id:buyer})
assert.equal(h.calls.queries[0].fields,'id,user_id,status,product_id,product_name,package_id,unit_value,currency,quantity,amount_ngn,created_at')

h=harness()
result=await h.post(purchase,{'Content-Length':'20000'})
assert.equal(result.status,413);assert.equal(h.calls.get,0);assert.equal(h.calls.auth,0)
const oversize=new Request('https://synthetic.invalid/customer-giftcards',{method:'POST',headers:{Authorization:'Bearer synthetic-jwt','Content-Type':'application/json'},
  body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));controller.close()}}),duplex:'half'})
assert.equal((await h.edge(oversize)).status,413)
const hanging=new Request('https://synthetic.invalid/customer-giftcards',{method:'POST',headers:{Authorization:'Bearer synthetic-jwt','Content-Type':'application/json'},
  body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"action":"purchase"'))},cancel(){return new Promise(()=>{})}}),duplex:'half'})
const started=Date.now()
assert.equal((await h.edge(hanging)).status,408);assert.ok(Date.now()-started<6500,'cancellation cannot delay body deadline')
assert.equal(h.calls.auth,0);assert.equal(h.calls.post,0)
console.log('Customer gift-card actual handler: private unit/launch gates, JWT-only ownership, per-unit rounding, stable replay, real unpaid validators, one create/pay, held ambiguity/partial delivery, captured-only redemption projection, owned GET reconciliation and body bounds passed with synthetic adapters only.')
