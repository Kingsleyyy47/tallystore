import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/_shared/partner-external-reconciliation.ts', 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports, URL, Promise, Number, setTimeout, clearTimeout })
const { listPartnerExternalReconciliationCases: list, probePartnerExternalReconciliationCase: probe } = exports
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const orderId = '30000000-0000-4000-8000-000000000001'
const partnerId = '20000000-0000-4000-8000-000000000001'
const baseJournal = { order_id: orderId, partner_id: partnerId, section: 'sms',
  state: 'unknown', amount_ngn: 100, funding_type: 'prepaid',
  fulfillment_source: null, fulfillment_id: null, created_at: '2026-10-05T00:00:00Z', claimed_at: '2026-10-05T00:00:01Z' }
const baseOrder = { id: orderId, partner_id: partnerId, status: 'processing',
  item_type: 'sms', amount_ngn: 100, fulfillment_source: null, fulfillment_id: null,
  customer_email: 'PRIVATE_CUSTOMER', response_payload: { code: 'PRIVATE_CODE' } }

function fixture(journal = baseJournal, order = baseOrder) {
  const calls = { reads: [], ranges: [], rpc: [], writes: 0, provider: 0 }
  const admin = { async rpc(name,args) {
    calls.rpc.push({name,args})
    if(name==='get_api_partner_bitrefill_bound_invoice') return {data:{success:true,bound:false},error:null}
    assert.ok(['get_api_partner_dispatch_receipt_review','get_api_partner_bitrefill_bound_invoices'].includes(name))
    return {data:{success:true,cases:[]},error:null}
  }, from(table) {
    const query = {
      select(columns) { calls.reads.push({ table, columns }); return this },
      in() { return this }, eq() { return this }, order() { return this }, range(start,end) { calls.ranges.push([start,end]); return this },
      async maybeSingle() { return { data: table === 'api_partner_external_orders' ? journal : order, error: null } },
      then(resolve) { return Promise.resolve({ data: table === 'api_partner_external_orders' ? [journal] : [order], error: null }).then(resolve) },
      insert() { calls.writes++; throw new Error('write forbidden') },
      update() { calls.writes++; throw new Error('write forbidden') },
      delete() { calls.writes++; throw new Error('write forbidden') },
    }
    return query
  } }
  const deps = {
    async daisyStatus(id) { calls.provider++; assert.equal(id, 'ACTIVE123'); return 'STATUS_WAIT_CODE' },
    async smmStatus() { calls.provider++; return { status: 'Completed' } },
    async bitrefillInvoice() { calls.provider++; return { id: 'ACTIVE123', status: 'complete' } },
    async istarOrder() { calls.provider++; return { order_id: 'ACTIVE123', status: 'completed' } },
  }
  return { admin, deps, calls }
}

let f = fixture()
let result = await list(f.admin, '40000000-0000-4000-8000-000000000001', { page: 0 })
assert.equal(result.status, 403); assert.equal(f.calls.reads.length, 0)
result = await probe(f.admin, '40000000-0000-4000-8000-000000000001', { order_id: orderId }, f.deps)
assert.equal(result.status, 403); assert.equal(f.calls.provider, 0)
result = await list(f.admin, owner, { page: 0 })
assert.equal(result.status, 200)
assert.equal(result.body.cases[0].probe_available, false)
assert.equal(JSON.stringify(result.body).includes('PRIVATE_'), false)
assert.equal(f.calls.writes, 0)
result = await probe(f.admin, owner, { order_id: orderId }, f.deps)
assert.equal(result.body.observation, 'provider_id_unavailable')
assert.equal(result.body.financial_decision, 'none')
assert.equal(f.calls.provider, 0, 'unknown without a bound ID must not contact provider')

f = fixture({ ...baseJournal, state: 'accepted', fulfillment_source: 'daisy', fulfillment_id: 'ACTIVE123' },
  { ...baseOrder, fulfillment_source: 'daisy', fulfillment_id: 'ACTIVE123' })
result = await probe(f.admin, owner, { order_id: orderId }, f.deps)
assert.equal(result.body.observation, 'reported_pending')
assert.equal(f.calls.provider, 1)
assert.equal(JSON.stringify(result.body).includes('PRIVATE_'), false)
assert.equal(f.calls.writes, 0)

f = fixture({ ...baseJournal, state: 'accepted', fulfillment_source: 'daisy', fulfillment_id: 'ACTIVE123' },
  { ...baseOrder, fulfillment_source: 'daisy', fulfillment_id: 'OTHER_ID' })
result = await probe(f.admin, owner, { order_id: orderId }, f.deps)
assert.equal(result.body.observation, 'provider_id_unavailable')
assert.equal(f.calls.provider, 0, 'mismatched persisted IDs must not reach provider')

f = fixture({ ...baseJournal, state: 'accepted', section: 'giftcards', fulfillment_source: 'bitrefill', fulfillment_id: 'ACTIVE123' },
  { ...baseOrder, item_type: 'giftcards', fulfillment_source: 'bitrefill', fulfillment_id: 'ACTIVE123' })
result = await probe(f.admin, owner, { order_id: orderId }, f.deps)
assert.equal(result.body.observation, 'invoice_complete_requires_order_review', 'invoice completion alone is not card delivery')
assert.equal(result.body.financial_decision, 'none')

f = fixture({ ...baseJournal, state: 'accepted', fulfillment_source: 'daisy', fulfillment_id: 'ACTIVE123' },
  { ...baseOrder, fulfillment_source: 'daisy', fulfillment_id: 'ACTIVE123' })
f.deps.daisyStatus = async () => { f.calls.provider++; return 'NO_ACTIVATION' }
result = await probe(f.admin, owner, { order_id: orderId }, f.deps)
assert.equal(result.body.observation, 'inconclusive', 'lone missing provider ID must never mean safe release')
assert.equal(f.calls.writes, 0)

result = await probe(f.admin, owner, { order_id: 'invalid' }, f.deps)
assert.equal(result.status, 400); assert.equal(f.calls.provider, 1)
for (const page of [-1,1.5,'0',1001,NaN]) {
  f=fixture()
  result=await list(f.admin,owner,{page})
  assert.equal(result.status,400)
  assert.equal(f.calls.reads.length,0,'invalid pagination must not query the database')
}
f=fixture()
result=await list(f.admin,owner,{page:2})
assert.deepEqual(f.calls.ranges,[[100,150]],'fetch one extra row to determine whether another page exists')
for(const mismatch of [{id:'30000000-0000-4000-8000-000000000002'},
  {partner_id:'20000000-0000-4000-8000-000000000002'}, {amount_ngn:101},
  {item_type:'social_boost'}, {fulfillment_source:'smm'}]) {
  f=fixture({...baseJournal,fulfillment_source:'daisy',fulfillment_id:'ACTIVE123'},
    {...baseOrder,fulfillment_source:'daisy',fulfillment_id:'ACTIVE123',...mismatch})
  result=await probe(f.admin,owner,{order_id:orderId},f.deps)
  assert.equal(result.body.observation,'provider_id_unavailable')
  assert.equal(f.calls.provider,0,'a mismatched order binding must never reach the provider')
}
// Use the production timeout rather than an immediately rejecting mock. The
// late provider result cannot turn this observation into a financial action.
f=fixture({...baseJournal,fulfillment_source:'daisy',fulfillment_id:'ACTIVE123'},
  {...baseOrder,fulfillment_source:'daisy',fulfillment_id:'ACTIVE123'})
f.deps.daisyStatus=()=>{f.calls.provider++;return new Promise(()=>{})}
const started=Date.now()
result=await probe(f.admin,owner,{order_id:orderId},f.deps)
assert.equal(result.body.observation,'inconclusive')
assert.equal(result.body.financial_decision,'none')
assert.ok(Date.now()-started>=7900&&Date.now()-started<11000,'stalled provider returns within the production deadline')
assert.equal(f.calls.writes,0)
f=fixture({...baseJournal,state:'sending'})
f.admin.rpc=async(name,args)=>{
  assert.equal(name,'get_api_partner_dispatch_receipt_review')
  assert.equal(args.p_owner_user_id,owner)
  assert.deepEqual(Array.from(args.p_order_ids),[orderId])
  return {data:{success:true,cases:[{order_id:orderId,receipt_outcome:'accepted',receipt_proof_hash:'a'.repeat(64)}]},error:null}
}
result=await list(f.admin,owner,{})
assert.equal(result.body.cases[0].recovery.outcome,'accepted')
assert.equal(result.body.cases[0].recovery.proof_hash,'a'.repeat(64))
f.admin.rpc=async()=>({data:{success:true,cases:[{order_id:orderId,receipt_outcome:'unknown',receipt_proof_hash:'a'.repeat(64)}]},error:null})
result=await list(f.admin,owner,{})
assert.equal(result.status,503,'a malformed receipt summary must not invite settlement')
// An invoice bound before payment survives an unknown paid response. Its
// provider ID is used only for status reads and is excluded from browser data.
const giftJournal={...baseJournal,section:'giftcards'}
const giftOrder={...baseOrder,item_type:'giftcards'}
f=fixture(giftJournal,giftOrder)
f.admin.rpc=async(name,args)=>{
  f.calls.rpc.push({name,args})
  assert.equal(args.p_owner_user_id,owner)
  if(name==='get_api_partner_dispatch_receipt_review')return{data:{success:true,cases:[]},error:null}
  if(name==='get_api_partner_bitrefill_bound_invoices')return{data:{success:true,cases:[{order_id:orderId,invoice_id:'ACTIVE123'}]},error:null}
  assert.equal(name,'get_api_partner_bitrefill_bound_invoice')
  assert.equal(args.p_order_id,orderId)
  return{data:{success:true,bound:true,order_id:orderId,invoice_id:'ACTIVE123'},error:null}
}
result=await list(f.admin,owner,{})
assert.equal(result.body.cases[0].probe_available,true)
assert.equal(JSON.stringify(result.body).includes('ACTIVE123'),false,'private bound invoice is not browser payload')
result=await probe(f.admin,owner,{order_id:orderId},f.deps)
assert.equal(result.body.observation,'invoice_complete_requires_order_review')
assert.equal(result.body.financial_decision,'none')
assert.equal(f.calls.provider,1)
assert.equal(f.calls.writes,0)
assert.equal(JSON.stringify(result.body).includes('ACTIVE123'),false)
for(const malformed of [
  {success:true,bound:true,order_id:'30000000-0000-4000-8000-000000000002',invoice_id:'ACTIVE123'},
  {success:true,bound:true,order_id:orderId,invoice_id:'https://private.example/secret'},
  {success:true,bound:'true',order_id:orderId,invoice_id:'ACTIVE123'},
  {success:false,code:'BINDING_MISMATCH'}
]){
  const bad=fixture(giftJournal,giftOrder)
  bad.admin.rpc=async()=>({data:malformed,error:null})
  assert.equal((await probe(bad.admin,owner,{order_id:orderId},bad.deps)).status,503)
  assert.equal(bad.calls.provider,0)
}
for(const cases of [
  [{order_id:orderId,invoice_id:'ACTIVE123'},{order_id:orderId,invoice_id:'ACTIVE123'}],
  [{order_id:'30000000-0000-4000-8000-000000000002',invoice_id:'ACTIVE123'}],
  [{order_id:orderId,invoice_id:'https://private.example/secret'}]
]){
  const bad=fixture(giftJournal,giftOrder)
  bad.admin.rpc=async()=>({data:{success:true,cases},error:null})
  assert.equal((await list(bad.admin,owner,{})).status,503)
  assert.equal(bad.calls.provider,0)
}
for(const mismatch of [{partner_id:'20000000-0000-4000-8000-000000000002'},
  {status:'completed'},{amount_ngn:101},{fulfillment_source:'bitrefill',fulfillment_id:'OTHER_ID'}]){
  const bad=fixture(giftJournal,{...giftOrder,...mismatch})
  result=await probe(bad.admin,owner,{order_id:orderId},bad.deps)
  assert.equal(result.body.observation,'provider_id_unavailable')
  assert.equal(bad.calls.provider,0)
  assert.equal(bad.calls.rpc.length,0,'conflicting order cannot invoke bound invoice fallback')
}
console.log('Owner reconciliation reads: authorization, redaction, bound and receiptless invoice probes, validation and no financial writes passed.')
