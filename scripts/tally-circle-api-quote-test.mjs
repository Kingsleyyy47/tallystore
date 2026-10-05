import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/customer-api/index.ts','utf8')
const tree = ts.createSourceFile('customer-api.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
const names = new Set(['ngnMinorUnits','circlePercent','productQuote'])
const functions = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
assert.equal(functions.length,3)
const actual = functions.map((node) => node.getText(tree)).join('\n')
const code = ts.transpileModule(actual + '\nexports.productQuote=productQuote;',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports = {}
vm.runInNewContext(code,{exports,URL,BigInt,Number,Date,
  uuid:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  json:(value)=>value,fail:(code)=>({success:false,code})})
const {productQuote}=exports
const id='10000000-0000-4000-8000-000000000001'
const user='20000000-0000-4000-8000-000000000001'

async function quote({enabled=false,member=false,rpcError=false,gate=false,tier=false,code=false}={}) {
  const calls=[]
  const admin={
    async rpc(name){
      calls.push(name)
      if(name==='get_tally_circle_purchase_status') return rpcError
        ? {data:null,error:{message:'unavailable'}}
        : {data:{enabled,is_member:member,discount_percent:enabled&&member?3:0},error:null}
      if(name==='tally_circle_launch_enabled') return {data:gate,error:null}
      if(name==='discount_code_capacity_version') return {data:1,error:null}
      throw Error('Unexpected RPC: '+name)
    },
    from(table){
      calls.push(table)
      return {select(){return this},eq(){return this},
        async maybeSingle(){return {data:table==='product_groups'
          ? {id,category_id:id,name:'Account',price:100,stock_count:10,is_sellable:true,is_active:true,
              availability_status:'AVAILABLE',quantity_discount_tiers:tier?[{min_qty:2,discount_pct:10}]:[]}
          : {id:'discount-id',percent_off:20,is_active:true},error:null}}}
    },
  }
  const url=new URL('https://fixture.invalid/v1/quote?section=products&product_group_id='+id+
    '&quantity=3'+(code?'&discount_code=SAVE20':''))
  const result=await productQuote(admin,user,url)
  return {result,calls}
}

let r=await quote({enabled:false,member:true})
assert.equal(r.result.data.expected_amount_ngn,300)
assert.equal(r.result.data.tally_circle_discount_percent,0)
r=await quote({enabled:true,member:true})
assert.equal(r.result.data.expected_amount_ngn,291)
r=await quote({enabled:true,member:true,tier:true})
assert.equal(r.result.data.expected_amount_ngn,261.9,'3% follows quantity tier discount')
r=await quote({enabled:true,member:true,code:true})
assert.equal(r.result.data.expected_amount_ngn,232.8,'3% follows code discount')
r=await quote({rpcError:true,gate:false})
assert.equal(r.result.data.expected_amount_ngn,300,'status outage while off uses standard price')
assert.ok(r.calls.includes('tally_circle_launch_enabled'))
await assert.rejects(quote({rpcError:true,gate:true}),/Circle status unavailable/)
console.log('Customer API product quote: off/on/disabled-RPC and tier/code 3% prices use actual source calculation.')
