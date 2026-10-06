import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { customerApiRoute } from '../supabase/functions/_shared/customer-api-route.mjs'
import { getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields } from
  '../supabase/functions/_shared/smm-order-contract.ts'

const orderId = '30000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'
const keyId = '20000000-0000-4000-8000-000000000001'
const key = `tlyc_giftcards_${'a'.repeat(64)}`
let handler
let wrongSection = false
const targetCalls = []
const admin = {
  async rpc(name, args) {
    assert.equal(name, 'customer_api_authorize')
    if (wrongSection || args.p_section !== 'giftcards') return { data: { ok: false, code: 'invalid_key' }, error: null }
    return { data: { ok: true, key_id: keyId, user_id: userId, section: 'giftcards' }, error: null }
  },
  from() { throw new Error('gift-card API route must use owned target, not direct service query') },
}
globalThis.__giftApiTest = {
  serve: fn => { handler = fn }, createClient: () => admin,
  sha256Hex: async () => 'hash', signCustomerCapability: async () => 'signed-capability',
  customerApiRoute, getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields,
}
globalThis.Deno = { env: { get: key => key === 'CUSTOMER_API_ENABLED' ? 'true' :
  key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : 'service-only-fixture' } }
const source = readFileSync(new URL('../supabase/functions/customer-api/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText.replace(/^import .*\r?\n/gm, '')
const injected = `const { serve, createClient, sha256Hex, signCustomerCapability, customerApiRoute,
  getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields } = globalThis.__giftApiTest;
const fetch = async (url, init) => {
  if (url !== 'https://synthetic.invalid/functions/v1/customer-giftcards') throw Error('wrong target');
  if (init.headers['x-tally-api-capability'] !== 'signed-capability') throw Error('missing capability');
  const body = JSON.parse(init.body);
  globalThis.__giftApiCalls.push(body);
  const id = '${orderId}';
  const payload = body.action === 'catalogue' ? {success:true,products:[{id:'amazon-us',price_ngn:null}],pagination:{start:body.start,limit:body.limit,next_start:null}} :
    body.action === 'orders' ? { success:true, orders:[{id,status:'completed'}] } :
    body.action === 'order' ? { success:true, order:{id,status:'completed'}, redemptions:[{code:'private-owned-code'}] } :
    body.action === 'status' ? { success:true, order:{id,status:'processing'} } :
    body.action === 'quote' ? { success:true, quote:{amount_ngn:2500} } :
    body.action === 'details' ? { success:true, product:{product_id:'amazon-us'} } :
    { success:true, order:{id,status:'processing'} };
  return new Response(JSON.stringify(payload), {status:200});
};
${compiled}`
globalThis.__giftApiCalls = targetCalls
await import(`data:text/javascript;base64,${Buffer.from(injected).toString('base64')}`)
assert.equal(typeof handler, 'function')
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
async function call(path, input) {
  const response = await handler(new Request(`https://synthetic.invalid/customer-api${path}`, {
    method: input ? 'POST' : 'GET', headers,
    ...(input ? { body: JSON.stringify(input) } : {}),
  }))
  return { status: response.status, body: await response.json() }
}
for (const [path, input, action] of [
  ['/v1/giftcards/details', { section:'giftcards', product_id:'amazon-us' }, 'details'],
  ['/v1/giftcards/quote', { section:'giftcards', product_id:'amazon-us', package_id:'ten', unit_value:10, quantity:2,
    quote_request_id:'giftcard-quote-001' }, 'quote'],
  ['/v1/giftcards/status', { section:'giftcards', order_id:orderId }, 'status'],
  ['/v1/purchases', { section:'giftcards', product_id:'amazon-us', package_id:'ten', unit_value:10,
    quantity:2, expected_amount_ngn:2500, idempotency_key:'giftcard-order-001',
    quote_id:'22222222-2222-4222-8222-222222222222' }, 'purchase'],
]) {
  const result = await call(path, input)
  assert.equal(result.status, 200)
  assert.equal(targetCalls.at(-1).action, action)
  assert.ok(!Object.hasOwn(targetCalls.at(-1), 'section'))
}
const orders = await call('/v1/orders?section=giftcards')
assert.equal(orders.status, 200)
assert.deepEqual(orders.body.data, [{ id:orderId,status:'completed' }])
const order = await call(`/v1/orders/${orderId}?section=giftcards`)
assert.equal(order.status, 200)
assert.equal(order.body.data.id, orderId)
assert.deepEqual(order.body.data.redemptions, [{ code:'private-owned-code' }])
const beforeDenied = targetCalls.length
wrongSection = true
assert.equal((await call('/v1/orders?section=giftcards')).status, 401)
wrongSection = false
assert.equal((await call('/v1/giftcards/status', { section:'giftcards', order_id:'foreign' })).status, 400)
assert.equal((await call('/v1/giftcards/quote', { section:'giftcards', product_id:'amazon-us',
  package_id:'ten',quantity:1,quote_request_id:'giftcard-quote-002' })).status,400,
  'package quotes require the exact selected unit value for the durable quote intent')
assert.equal(targetCalls.length, beforeDenied)
const catalog=await call('/v1/catalogue?section=giftcards&q=amazon&country=US&limit=20&start=0')
assert.equal(catalog.status,200);assert.equal(catalog.body.data[0].id,'amazon-us')
assert.deepEqual(targetCalls.at(-1),{action:'catalogue',start:0,limit:20,country:'US',query:'amazon'})
const beforeInvalid=targetCalls.length
for(const query of ['limit=51','limit=0','start=-1','q=','country=us','limit=20&limit=30','url=https://evil.invalid']) {
  assert.equal((await call('/v1/catalogue?section=giftcards&'+query)).status,400)
}
assert.equal(targetCalls.length,beforeInvalid,'invalid catalog input never reaches the supplier engine')
console.log('Customer gift-card API: section-bound target, quote/purchase/status and owned order projection passed')
