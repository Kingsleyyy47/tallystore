import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const delivery={}
vm.runInNewContext(compile('supabase/functions/_shared/partner-bitrefill-delivery.ts'),{exports:delivery,setTimeout,clearTimeout,URL})
const recovery={}
vm.runInNewContext(compile('supabase/functions/_shared/partner-bitrefill-recovery.ts'),{
  exports:recovery,setTimeout,clearTimeout,require:name=>{
    assert.equal(name,'./partner-bitrefill-delivery.ts');return delivery
  },
})
const {reviewPartnerBitrefillDelivery:review,confirmPartnerBitrefillDelivery:confirm}=recovery
const owner='c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const orderId='30000000-0000-4000-8000-000000000001'
const hash='a'.repeat(64)
const reviewBody={action:'admin_review_bitrefill_delivery',order_id:orderId}
const confirmBody={action:'admin_confirm_bitrefill_delivery',order_id:orderId,evidence_proof_hash:hash}
function fixture(){
  const calls={rpc:[],tables:[],invoice:0,order:0,write:0}
  const order={id:orderId,partner_id:'20000000-0000-4000-8000-000000000001',item_type:'giftcards',
    item_id:'test-card',quantity:2,amount_ngn:100,status:'processing',
    request_payload:{value:10,provider_currency:'USD',package_id:null}}
  const admin={
    from(table){calls.tables.push(table);assert.equal(table,'api_partner_orders');return{
      select(){return this},eq(field,id){assert.equal(field,'id');assert.equal(id,orderId);return this},
      async maybeSingle(){return{data:order,error:null}},
      insert(){calls.write++;throw Error('direct write forbidden')},
      update(){calls.write++;throw Error('direct write forbidden')},
    }},
    async rpc(name,args){
      calls.rpc.push({name,args});assert.equal(args.p_owner_user_id,owner);assert.equal(args.p_order_id,orderId)
      if(name==='get_api_partner_bitrefill_bound_invoice')return{data:{success:true,bound:true,order_id:orderId,invoice_id:'INVOICE-TEST'},error:null}
      if(name==='record_api_partner_bitrefill_delivery_evidence'){
        assert.equal(args.p_invoice_id,'INVOICE-TEST');assert.equal(args.p_delivery.redemptions.length,2)
        assert.equal(args.p_delivery.provider_status,'complete')
        return{data:{success:true,order_id:orderId,evidence_proof_hash:hash,quantity:2,amount_ngn:100,
          funding_type:'prepaid',idempotent_replay:false,redemptions:args.p_delivery.redemptions,api_key:'PRIVATE_SERVER_ONLY'},error:null}
      }
      assert.equal(name,'reconcile_api_partner_bitrefill_delivery')
      assert.deepEqual(Object.keys(args).sort(),['p_evidence_proof_hash','p_order_id','p_owner_user_id'])
      assert.equal(args.p_evidence_proof_hash,hash)
      return{data:{success:true,order_id:orderId,decision:'accepted',idempotent_replay:false,private_key:'PRIVATE_SERVER_ONLY'},error:null}
    },
  }
  const client={
    async getInvoice(id){calls.invoice++;assert.equal(id,'INVOICE-TEST');return{id,status:'complete',orders:[{id:'UNIT-ONE',status:'delivered'},{id:'UNIT-TWO',status:'delivered'}]}},
    async getOrder(id){calls.order++;return{id,status:'delivered',product:{id:'test-card',value:10},redemption_info:{code:'PRIVATE_CUSTOMER_'+id,instructions:'Keep this private',api_key:'PRIVATE_SERVER_ONLY'}}},
    async payInvoice(){throw Error('paid request forbidden')},async createInvoice(){throw Error('new invoice forbidden')},
  }
  return{admin,client,calls,order}
}
let f=fixture()
assert.equal((await review(f.admin,'not-owner',reviewBody,f.client)).status,403)
assert.equal((await confirm(f.admin,'not-owner',confirmBody)).status,403)
assert.equal(f.calls.rpc.length,0)
for(const extra of [{amount_ngn:1},{outcome:'accepted'},{invoice_id:'OTHER'},{p_owner_user_id:owner},{force:true}]){
  f=fixture()
  assert.equal((await review(f.admin,owner,{...reviewBody,...extra},f.client)).status,400)
  assert.equal((await confirm(f.admin,owner,{...confirmBody,...extra})).status,400)
  assert.equal(f.calls.rpc.length,0)
}
f=fixture()
let result=await review(f.admin,owner,reviewBody,f.client)
assert.equal(result.status,200)
assert.equal(result.body.evidence_proof_hash,hash)
assert.equal(result.body.quantity,2)
assert.deepEqual(f.calls.rpc.map(call=>call.name),['get_api_partner_bitrefill_bound_invoice','record_api_partner_bitrefill_delivery_evidence'])
assert.equal(f.calls.invoice,1);assert.equal(f.calls.order,2);assert.equal(f.calls.write,0)
assert.equal(JSON.stringify(result).includes('PRIVATE_'),false,'review must not return purchased redemptions or server fields')
f=fixture();f.client.getOrder=async id=>({id,status:'failed',product:{id:'test-card',value:10},redemption_info:{code:'PRIVATE_CUSTOMER'}})
result=await review(f.admin,owner,reviewBody,f.client)
assert.equal(result.status,409)
assert.equal(f.calls.rpc.length,1,'partial delivery cannot persist financial evidence')
f=fixture();f.order.request_payload.value=undefined
assert.equal((await review(f.admin,owner,reviewBody,f.client)).status,409)
assert.equal(f.calls.rpc.length,1)
f=fixture();const realRpc=f.admin.rpc
f.admin.rpc=async(name,args)=>name==='get_api_partner_bitrefill_bound_invoice'
  ?{data:{success:true,bound:true,order_id:'30000000-0000-4000-8000-000000000002',invoice_id:'INVOICE-TEST'},error:null}:realRpc(name,args)
assert.equal((await review(f.admin,owner,reviewBody,f.client)).status,503)
assert.equal(f.calls.invoice,0)
f=fixture();result=await confirm(f.admin,owner,confirmBody)
assert.equal(result.status,200)
assert.equal(f.calls.rpc.length,1)
assert.equal(f.calls.invoice,0);assert.equal(f.calls.order,0)
assert.equal(JSON.stringify(result).includes('PRIVATE_'),false)
for(const response of [{error:{message:'PRIVATE_SERVER_ONLY'},data:null},
  {error:null,data:{success:true,order_id:'foreign',decision:'accepted',idempotent_replay:false}},
  {error:null,data:{success:false,code:'PRIVATE_DATABASE_ERROR'}}]){
  f=fixture();f.admin.rpc=async()=>response
  assert.equal((await confirm(f.admin,owner,confirmBody)).status,202,'uncertain financial response must require refresh')
}
f=fixture();f.admin.rpc=async()=>({error:null,data:{success:false,code:'BINDING_MISMATCH'}})
assert.equal((await confirm(f.admin,owner,confirmBody)).status,409)
f=fixture();let attempts=0;f.admin.rpc=()=>{attempts++;return new Promise(()=>{})}
const start=Date.now();result=await confirm(f.admin,owner,confirmBody)
assert.equal(result.status,202)
assert.ok(Date.now()-start>=19_900&&Date.now()-start<23_000)
assert.equal(attempts,1,'deadline must not repeat a potentially committed confirmation')
console.log('Bitrefill recovery Edge: owner and body gates, exact GET delivery evidence, redaction, separate confirmation, unknown deadlines and no paid retries passed.')
