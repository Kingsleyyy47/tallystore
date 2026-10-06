import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the actual Edge client, not a reimplementation of its wire calls.
const source = readFileSync('supabase/functions/partner-api/index.ts', 'utf8')
const parsed = ts.createSourceFile('partner-api.ts', source, ts.ScriptTarget.ES2022, true)
const factory = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getBitrefillClient')
assert.ok(factory)
const calls = []
let reply = { data: { id: 'INVOICE-TEST', status: 'unpaid' } }
let status = 200
const context = vm.createContext({
  BITREFILL_API_URL: 'https://api.bitrefill.com/v2', URLSearchParams, AbortController, TextDecoder, setTimeout, clearTimeout,
  Deno: { env: { get: name => name === 'BITREFILL_API_KEY' ? 'synthetic-test-only' : undefined } },
  fetch: async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-only')
    return new Response(JSON.stringify(reply), {status})
  },
})
vm.runInContext(ts.transpileModule(factory.getText(parsed), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context)
const client = vm.runInContext('getBitrefillClient()', context)
assert.equal((await client.createInvoice({ products:[{product_id:'test-card',quantity:2}],auto_pay:false })).id,'INVOICE-TEST')
assert.equal(JSON.parse(calls.at(-1).options.body).auto_pay,false)
assert.equal(calls.at(-1).options.method,'POST')
reply = { data: { id: 'INVOICE-TEST', status: 'pending' } }
assert.equal((await client.payInvoice('INVOICE-TEST')).status,'pending')
assert.equal(calls.at(-1).url,'https://api.bitrefill.com/v2/invoices/INVOICE-TEST/pay')
assert.equal(calls.at(-1).options.method,'POST')
assert.deepEqual(JSON.parse(calls.at(-1).options.body),{})
reply = { data: { id:'INVOICE-TEST',status:'complete' } }
assert.equal((await client.getInvoice('INVOICE-TEST')).status,'complete')
assert.equal(calls.at(-1).options.method,undefined,'invoice probe is GET only')
reply = { data:{ balance:500,currency:'USD' } }
assert.equal((await client.getBalance()).balance,500)
reply = { data:{ product_id:'test-card',currency:'USD' } }
assert.equal((await client.getProductDetails('test-card')).product_id,'test-card')
reply = { data:[{product_id:'test-card'}],meta:{_next:'synthetic-cursor'} }
assert.equal((await client.listProducts()).meta._next,'synthetic-cursor','catalog retains pagination envelope')
reply = { id:'INVOICE-TEST',status:'pending' }
assert.equal((await client.getInvoice('INVOICE-TEST')).id,'INVOICE-TEST','direct payload remains compatible')
status=403
const before=calls.length
await assert.rejects(client.payInvoice('INVOICE-TEST'))
assert.equal(calls.length,before+1,'client must never automatically retry a paid request')
console.log('Actual partner Bitrefill client: unpaid create, one explicit pay, GET probe, response envelopes and no paid retries passed.')
