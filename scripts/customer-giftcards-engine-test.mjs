// Actual Edge handler against synthetic auth, database, and Bitrefill adapters.
// No production connection, real provider request, wallet write, or purchase.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import esbuild from 'esbuild'
import { webcrypto } from 'node:crypto'

const bundle = await esbuild.build({ entryPoints:['supabase/functions/customer-giftcards/index.ts'], bundle:true,
  platform:'node',format:'cjs',write:false,plugins:[{name:'mock-supabase',setup(build){
    build.onResolve({filter:/^https:\/\/esm\.sh\//},()=>({path:'mock',namespace:'mock'}))
    build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient = globalThis.__createClient',loader:'js'}))
  }}] })
const user='11111111-1111-4111-8111-111111111111'
const quoteId='22222222-2222-4222-8222-222222222222'
const orderId='33333333-3333-4333-8333-333333333333'
const invoiceId='synthetic-invoice'
const packageId='gift-package'
const selection={product_id:'synthetic-gift',package_id:packageId,unit_value:10,quantity:2}
const expectedQuote={...selection,product_name:'Synthetic Gift',currency:'EUR',amount_ngn:520,provider_price:5.02,billing_currency:'USD'}
const quoteRequest={action:'quote',...selection,quote_request_id:'gift-quote-intent-001'}
const purchaseRequest={action:'purchase',...selection,quote_id:quoteId,expected_amount_ngn:520,idempotency_key:'gift-purchase-intent-001'}
const answer=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
const copy=value=>JSON.parse(JSON.stringify(value))

function fixture(options={}) {
  const calls={rpc:[],post:[],get:[],rates:[],authorize:0,create:0,pay:0,bind:0,completed:0,unknown:0,alerts:0}
  let handler, finalQuote=options.finalized?copy(expectedQuote):null, status='pending', claimed=false, journal=null
  let balanceReads=0
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',
    SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',BITREFILL_API_KEY:'synthetic-provider',
    CUSTOMER_GIFTCARDS_ENABLED:options.paused?'false':'true',BITREFILL_INVOICE_PRICE_UNIT:options.unit||'major'}
  if(options.noUnit) delete env.BITREFILL_INVOICE_PRICE_UNIT
  const order=()=>({id:orderId,user_id:user,status,product_id:'synthetic-gift',product_name:'Synthetic Gift',
    package_id:packageId,unit_value:10,currency:'EUR',quantity:2,amount_ngn:520,created_at:'2026-10-06T00:00:00Z'})
  const admin={
    from(table){const state={key:null};return {select(){return this},eq(key,value){if(key==='key')state.key=value;return this},
      async maybeSingle(){if(table==='profiles')return {data:{is_admin:false,is_staff:false,account_suspended:false},error:null}
        if(table==='app_settings')return {data:state.key==='ngn_usd_rate'?{value:options.noStoredUsdRate?null:'100'}:
          state.key==='ngn_eur_rate'?{value:'110'}:null,error:null}
        throw Error('unexpected table')},order(){return this},async limit(){return {data:[order()],error:null}}}},
    async rpc(name,args){calls.rpc.push({name,args:copy(args)})
      if(name==='get_customer_bitrefill_pricing')return {data:{success:true,mode:'amount',value:9},error:null}
      if(name==='record_supplier_balance_alert'){
        calls.alerts++;assert.equal(args.p_provider,'bitrefill');assert.equal(args.p_source,'customer-giftcards')
        return {data:null,error:null}
      }
      if(name==='begin_customer_giftcard_quote'){
        assert.equal(JSON.stringify(args.p_selection),JSON.stringify(selection))
        if(options.beginLostAck)throw Error('synthetic lost DB ack')
        if(options.beginUnknown)return {data:{success:false,code:'QUOTE_OUTCOME_UNKNOWN'},error:null}
        if(finalQuote)return {data:{success:true,quote_id:quoteId,create_allowed:false,finalized:true,
          quote:finalQuote,expires_at:new Date(Date.now()+60000).toISOString()},error:null}
        return {data:{success:true,quote_id:quoteId,create_allowed:true,finalized:false},error:null}
      }
      if(name==='finalize_customer_giftcard_quote'){
        assert.equal(args.p_quote_id,quoteId);assert.equal(args.p_invoice_id,invoiceId)
        assert.equal(JSON.stringify(args.p_child_order_ids),JSON.stringify(['unit-0','unit-1']))
        finalQuote=copy(args.p_quote)
        return {data:{success:true,quote_id:quoteId,expires_at:args.p_expires_at},error:null}
      }
      if(name==='get_customer_giftcard_replay'){
        assert.equal(args.p_quote_id,quoteId)
        if(journal)return {data:{success:true,existing:true,order_id:orderId},error:null}
        return {data:{success:true,existing:false},error:null}
      }
      if(name==='get_customer_giftcard_invoice_quote')return {data:{success:true,quote_id:quoteId,
        quote:finalQuote||expectedQuote,request:selection,invoice_id:invoiceId,child_order_ids:['unit-0','unit-1'],
        expires_at:new Date(Date.now()+60000).toISOString(),status:'finalized'},error:null}
      if(name==='authorize_customer_giftcard_purchase'){
        calls.authorize++;assert.equal(args.p_quote_id,quoteId);assert.equal(JSON.stringify(args.p_quote),JSON.stringify(finalQuote||expectedQuote))
        assert.equal(args.p_expected_amount_ngn,520)
        if(options.reserveDenied)return {data:{success:false,code:'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'},error:null}
        journal={state:'prepared'};return {data:{success:true,order_id:orderId,idempotent_replay:false},error:null}
      }
      if(name==='claim_customer_giftcard_dispatch'){
        if(options.claimDenied)return {data:{success:true,send_allowed:false},error:null}
        journal.state='creating';status='processing';return {data:{success:true,send_allowed:true},error:null}
      }
      if(name==='bind_customer_giftcard_invoice'){
        calls.bind++;assert.equal(args.p_invoice_id,invoiceId);assert.equal(args.p_quote.provider_price,5.02)
        journal.state='bound';return {data:{success:true},error:null}
      }
      if(name==='claim_customer_giftcard_payment'){
        assert.equal(calls.bind,1)
        if(options.payClaimDenied)return {data:{success:true,pay_allowed:false},error:null}
        claimed=true;journal.state='paying';return {data:{success:true,pay_allowed:true},error:null}
      }
      if(name==='record_customer_giftcard_outcome'){
        if(args.p_outcome==='unknown'){calls.unknown++;journal.state='unknown';status='review_required'}
        if(args.p_outcome==='completed'){calls.completed++;journal.state='completed';status='completed'}
        return {data:{success:true},error:null}
      }
      if(name==='get_customer_giftcard_order')return {data:{success:true,order:order(),state:journal?.state||'pending',
        ...(status==='completed'?{redemptions:[{order_id:'unit-0',code:'code-0'},
          {order_id:'unit-1',code:'code-1'}]}:{})},error:null}
      if(name==='get_customer_giftcard_reconciliation')return {data:{success:true,order_id:orderId,
        quote:expectedQuote,invoice_id:invoiceId,state:'unknown',payment_claimed:true},error:null}
      throw Error('unexpected RPC '+name)
    }
  }
  const context={module:{exports:{}},exports:{},Request,Response,URL,URLSearchParams,Date,TextEncoder,TextDecoder,
    Uint8Array,AbortSignal,AbortController,btoa,atob,setTimeout,clearTimeout,crypto:webcrypto,console:{error(){}},
    Deno:{serve(fn){handler=fn},env:{get(name){return env[name]}}},
    async fetch(input,init={}){
      const url=String(input)
      if(url==='https://open.er-api.com/v6/latest/USD'){
        assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit')
        assert.equal(init.cache,'no-store');assert.ok(init.signal)
        calls.rates.push(url)
        return options.rateResponse || answer(options.exchangeRates || {result:'success',
          time_last_update_unix:Math.floor(Date.now()/1000),rates:{NGN:100}})
      }
      assert.ok(url.startsWith('https://api.bitrefill.com/v2/'),'only fixed supplier origin')
      assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit')
      if(init.method==='POST')calls.post.push({url,body:JSON.parse(init.body)})
      else calls.get.push(url)
      if(url.endsWith('/products/synthetic-gift'))return answer({data:{id:'synthetic-gift',type:options.wrongType?'phone_refill':'gift_card',
        name:'Synthetic Gift',currency:'EUR',in_stock:true,recipient_type:'none',
        packages:[{id:packageId,value:10}]}})
      if(url.endsWith('/accounts/balance')){balanceReads++;return answer({data:{currency:options.balanceCurrency||'USD',
        balance:options.initialLowBalance?0:options.lowBalance&&balanceReads>1?0:100}})}
      if(url.endsWith('/invoices')&&init.method==='POST'){
        calls.create++;assert.equal(calls.authorize,0,'quote creates unpaid invoice before wallet reserve')
        assert.deepEqual(JSON.parse(init.body),{products:[{product_id:'synthetic-gift',quantity:2,package_id:packageId}],
          payment_method:'balance',auto_pay:false})
        if(options.lostCreateAck)throw Error('synthetic lost provider ack')
        return answer({data:{id:invoiceId,status:'unpaid',orders:[{id:'unit-0'},{id:'unit-1'}]}})
      }
      if(url.endsWith('/invoices/'+invoiceId+'/pay')){
        calls.pay++;assert.equal(claimed,true)
        if(options.lostPayAck)throw Error('synthetic ambiguous pay ack')
        return answer({data:{id:invoiceId,status:'pending'}})
      }
      if(url.endsWith('/invoices/'+invoiceId))return answer({data:{id:invoiceId,
        status:calls.pay?'complete':'unpaid',payment:{method:'balance',currency:options.invoiceCurrency||
          (options.wrongCurrency?'EUR':'USD'),
          price:options.wrongPrice?5.50:5.02},orders:options.duplicateChild?
          [{id:'unit-0'},{id:'unit-0'}]:[{id:'unit-0'},{id:'unit-1'}]}})
      if(url.endsWith('/orders/unit-0')||url.endsWith('/orders/unit-1')){
        const child=url.slice(-6),paid=calls.pay>0
        return answer({data:{id:child,status:paid?'delivered':'created',product:{id:options.wrongChild?'other':'synthetic-gift',
          value:10,currency:'EUR',package_id:packageId},...(paid?{redemption_info:{code:'CODE-'+child}}:{})}})
      }
      throw Error('unexpected provider URL')
    }}
  context.globalThis=context
  context.__createClient=(_url,key)=>key==='synthetic-public'?{auth:{async getUser(token){
    return token==='synthetic-jwt'?{data:{user:{id:user}},error:null}:{data:{user:null},error:{message:'invalid'}}
  }}}:admin
  vm.runInNewContext(bundle.outputFiles[0].text,context,{timeout:5000})
  async function post(value){const request=new Request('https://synthetic.invalid/customer-giftcards',{
    method:'POST',headers:{Authorization:'Bearer synthetic-jwt','Content-Type':'application/json'},body:JSON.stringify(value)})
    const response=await handler(request);return {status:response.status,body:await response.json()}}
  return {post,calls}
}

let h=fixture({noUnit:true});let r=await h.post(quoteRequest)
assert.equal(r.body.code,'PRICE_UNIT_UNVERIFIED');assert.equal(h.calls.create,0)
h=fixture({paused:true});r=await h.post(quoteRequest)
assert.equal(r.body.code,'GIFT_CARDS_PAUSED');assert.equal(h.calls.create,0)
h=fixture({wrongType:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,0)
h=fixture({beginLostAck:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,0)
h=fixture({beginUnknown:true});r=await h.post(quoteRequest)
assert.equal(r.status,409);assert.equal(r.body.code,'QUOTE_OUTCOME_UNKNOWN');assert.equal(h.calls.create,0)
h=fixture({lostCreateAck:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0)
h=fixture({wrongCurrency:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0)
h=fixture({wrongChild:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0)
h=fixture({duplicateChild:true});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0)
h=fixture({invoiceCurrency:'EUR',balanceCurrency:'EUR'});r=await h.post(quoteRequest)
assert.equal(r.body.quote.amount_ngn,580,'EUR invoice uses the owner EUR/NGN rate and rounds each unit to NGN10')
assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0)
h=fixture({initialLowBalance:true});r=await h.post(quoteRequest)
assert.equal(r.body.code,'PROVIDER_BALANCE_LOW');assert.equal(h.calls.alerts,1)
assert.equal(h.calls.authorize,0);assert.equal(h.calls.pay,0)
h=fixture({noStoredUsdRate:true});r=await h.post(quoteRequest)
assert.equal(r.body.quote.amount_ngn,520);assert.equal(h.calls.rates.length,1)
for(const exchangeRates of [
  {result:'success',time_last_update_unix:Math.floor(Date.now()/1000)-200000,rates:{NGN:100}},
  {result:'success',time_last_update_unix:Math.floor(Date.now()/1000)+1000,rates:{NGN:100}},
  {result:'success',time_last_update_unix:Math.floor(Date.now()/1000),rates:{NGN:0}},
  {result:'error',time_last_update_unix:Math.floor(Date.now()/1000),rates:{NGN:100}},
]){
  h=fixture({noStoredUsdRate:true,exchangeRates});r=await h.post(quoteRequest)
  assert.equal(r.body.success,false);assert.equal(h.calls.authorize,0);assert.equal(h.calls.pay,0)
}
h=fixture({noStoredUsdRate:true,rateResponse:new Response('x'.repeat(65_537))});r=await h.post(quoteRequest)
assert.equal(r.body.success,false);assert.equal(h.calls.rates.length,1)
assert.equal(h.calls.authorize,0);assert.equal(h.calls.pay,0,'oversized exchange-rate response cannot authorize purchase')
h=fixture();r=await h.post(quoteRequest)
assert.equal(r.status,200);assert.equal(r.body.quote_id,quoteId)
assert.equal(r.body.quote.amount_ngn,520);assert.equal(r.body.quote.unit_amount_ngn,260)
assert.equal(h.calls.create,1);assert.equal(h.calls.authorize,0);assert.equal(h.calls.pay,0)
assert.ok(!/provider_price|billing_currency|synthetic-invoice|PRIVATE/i.test(JSON.stringify(r.body)))
const supplierReadsBeforeQuoteReplay=h.calls.get.length
r=await h.post(quoteRequest);assert.equal(r.body.idempotent_replay,true);assert.equal(h.calls.create,1)
assert.equal(h.calls.get.length,supplierReadsBeforeQuoteReplay,'same quote intent replays without provider reads')
r=await h.post(purchaseRequest);assert.equal(r.status,200);assert.equal(r.body.order.status,'completed')
assert.equal(h.calls.create,1,'purchase reuses original invoice');assert.equal(h.calls.authorize,1)
assert.equal(h.calls.bind,1);assert.equal(h.calls.pay,1);assert.equal(h.calls.completed,1)
assert.ok(!/provider_price|billing_currency|synthetic-invoice/i.test(JSON.stringify(r.body)))
r=await h.post(purchaseRequest);assert.equal(r.body.idempotent_replay,true)
assert.equal(h.calls.authorize,1);assert.equal(h.calls.create,1);assert.equal(h.calls.pay,1)
h=fixture({finalized:true,reserveDenied:true});r=await h.post(purchaseRequest)
assert.equal(r.body.code,'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS');assert.equal(h.calls.pay,0);assert.equal(h.calls.create,0)
h=fixture({finalized:true,lowBalance:true});r=await h.post(purchaseRequest)
assert.equal(r.body.code,'PROVIDER_BALANCE_LOW');assert.equal(h.calls.pay,0);assert.equal(h.calls.create,0)
h=fixture({finalized:true,claimDenied:true});r=await h.post(purchaseRequest)
assert.equal(r.body.outcome_unknown,true);assert.equal(h.calls.pay,0);assert.equal(h.calls.create,0)
h=fixture({finalized:true,wrongPrice:true});r=await h.post(purchaseRequest)
assert.equal(r.body.outcome_unknown,true);assert.equal(h.calls.pay,0);assert.equal(h.calls.create,0)
h=fixture({finalized:true,payClaimDenied:true});r=await h.post(purchaseRequest)
assert.equal(r.body.outcome_unknown,true);assert.equal(h.calls.pay,0);assert.equal(h.calls.create,0)
h=fixture({finalized:true,lostPayAck:true});r=await h.post(purchaseRequest)
assert.equal(r.body.outcome_unknown,true);assert.equal(h.calls.pay,1);assert.equal(h.calls.create,0)
r=await h.post(purchaseRequest);assert.equal(r.body.idempotent_replay,true)
assert.equal(h.calls.pay,1,'uncertain payment is not resent')
console.log('Customer gift-card invoice-backed handler fixture PASS: durable quote intent, exact unpaid invoice/children, retail quote, original invoice purchase, one pay, held ambiguity, private response, closed gates.')
