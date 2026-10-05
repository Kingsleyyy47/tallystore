import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'

const source=readFileSync('supabase/functions/process-purchase/index.ts','utf8').replace(/^import .*$/gm,'')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const user='10000000-0000-4000-8000-000000000001'
const product='20000000-0000-4000-8000-000000000001'

async function attempt({enabled=false,member=false,rpcError=false,gate=false,expected=100}={}) {
  let handler, authorizations=0, authorizedAmount=null
  const calls=[]
  const db={
    from(table){
      calls.push(table)
      const query={select(){return query},eq(){return query},
        async single(){return table==='profiles'
          ? {data:{is_admin:false,is_staff:false,account_suspended:false,financial_security_version:1},error:null}
          : {data:{id:product,name:'Product',price:100,category_id:product,is_active:true,is_sellable:true},error:null}},
        async maybeSingle(){return {data:null,error:null}},
        async insert(){return {data:null,error:null}},async upsert(){return {data:null,error:null}}}
      return query
    },
    async rpc(name,args){
      calls.push(name)
      if(name==='get_tally_circle_purchase_status') return rpcError
        ? {data:null,error:{message:'unavailable'}}
        : {data:{enabled,is_member:member,discount_percent:enabled&&member?3:0},error:null}
      if(name==='tally_circle_launch_enabled') return {data:gate,error:null}
      if(name==='wallet_financial_truth_internal') return {data:{confirmed_spendable:1000,spending_blocked:false},error:null}
      if(name==='authorize_product_purchase') {
        authorizations++;authorizedAmount=args.p_amount
        return {data:{success:false,code:'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'},error:null}
      }
      throw Error('Unexpected RPC: '+name)
    },
  }
  vm.runInNewContext(code,{exports:{},serve:(fn)=>{handler=fn},createClient:()=>db,
    authenticateCustomerRequest:async()=>({id:user}),
    getCustomerPurchaseStatus:async()=>({state:'unknown'}),
    configuredSuppliers:()=>[],fulfillSupplierShortfall:()=>{throw Error('No supplier call expected')},
    ngnMinorUnits,Deno:{env:{get:()=>undefined}},Error,Request,Response,URL,TextEncoder,
    crypto:webcrypto,console:{log(){},error(){}}})
  const response=await handler(new Request('https://fixture.invalid/process-purchase',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({product_group_id:product,
      quantity:1,expected_amount_ngn:expected,idempotency_key:'circle_gate_fixture'})}))
  return {status:response.status,body:await response.json(),authorizations,authorizedAmount,calls}
}

let r=await attempt({enabled:false,member:false,expected:100})
assert.equal(r.authorizations,1)
assert.equal(r.authorizedAmount,100)
assert.ok(!r.calls.includes('tally_circle_launch_enabled'))
r=await attempt({enabled:true,member:true,expected:97})
assert.equal(r.authorizations,1)
assert.equal(r.authorizedAmount,97)
r=await attempt({enabled:true,member:true,expected:100})
assert.equal(r.authorizations,0,'stale full price cannot create hold when discount is active')
r=await attempt({rpcError:true,gate:false,expected:100})
assert.equal(r.authorizations,1,'Circle status outage while disabled cannot block ordinary purchase')
assert.equal(r.authorizedAmount,100)
r=await attempt({rpcError:true,gate:true,expected:97})
assert.equal(r.authorizations,0,'Circle status outage after launch stops before hold')
assert.ok(r.calls.includes('tally_circle_launch_enabled'))
console.log('Product purchase: actual handler uses standard off price, 3% on price, and no hold on active-price mismatch or launched status outage.')
