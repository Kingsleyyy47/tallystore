import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { customerApiRoute } from '../supabase/functions/_shared/customer-api-route.mjs'
import { getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields } from
  '../supabase/functions/_shared/smm-order-contract.ts'

const services = [
  { id: 1, name: 'Poll votes', service_type: 'Poll', category: 'Poll', platform: 'Example',
    price_ngn: 1000, rate_usd: 1, min_quantity: 10, max_quantity: 1000, is_active: true },
  { id: 2, name: 'Search visits', service_type: 'SEO', category: 'SEO', platform: 'Example',
    price_ngn: 123.45, rate_usd: 1, min_quantity: 100, max_quantity: 500, is_active: true },
  { id: 3, name: 'Fixed package', service_type: 'Package', category: 'Package', platform: 'Example',
    price_ngn: 499, rate_usd: 1, min_quantity: 1, max_quantity: 1, is_active: true },
  { id: 4, name: 'Unsupported', service_type: 'Subscriptions', category: 'Other', platform: 'Example',
    price_ngn: 500, rate_usd: 1, min_quantity: 1, max_quantity: 100, is_active: true },
  { id: 5, name: 'No supplier cost', service_type: 'Poll', category: 'Poll', platform: 'Example',
    price_ngn: 1000, rate_usd: null, min_quantity: 1, max_quantity: 100, is_active: true },
]
let route
let authCalls = 0
let serviceReads = 0
let financialCalls = 0
const admin = {
  async rpc(name, args) {
    assert.equal(name, 'customer_api_authorize')
    assert.equal(args.p_section, 'social_boost')
    authCalls++
    return { data: { ok: true, key_id: 'key-id', user_id: 'user-id', section: 'social_boost' }, error: null }
  },
  from(table) {
    assert.equal(table, 'smm_services')
    serviceReads++
    let serviceId = null
    const query = {
      select() { return query },
      eq(field, value) { if (field === 'id') serviceId = value; return query },
      order() { return query },
      async limit() { return { data: services, error: null } },
      async maybeSingle() { return { data: services.find(row => row.id === serviceId) ?? null, error: null } },
    }
    return query
  },
}
globalThis.__customerSocialQuoteTest = {
  serve: callback => { route = callback },
  createClient: () => admin,
  sha256Hex: async () => 'hash',
  signCustomerCapability: () => { financialCalls++; throw new Error('no target capability in quote') },
  customerApiRoute, getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields,
}
globalThis.Deno = { env: { get: key => key === 'CUSTOMER_API_ENABLED' ? 'true' : '' } }
const source = readFileSync(new URL('../supabase/functions/customer-api/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText.replace(/^import .*\r?\n/gm, '')
const injected = `const { serve, createClient, sha256Hex, signCustomerCapability, customerApiRoute,
  getSmmOrderContract, quoteSmmOrder, validateSmmOrderFields } = globalThis.__customerSocialQuoteTest;
const fetch = () => { throw new Error('no supplier or delegated target request in quote') };
${compiled}`
await import(`data:text/javascript;base64,${Buffer.from(injected).toString('base64')}`)
assert.equal(typeof route, 'function')
const key = `tlyc_social_boost_${'a'.repeat(64)}`
async function get(path) {
  const response = await route(new Request(`https://example.invalid/customer-api${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  }))
  return { status: response.status, body: await response.json() }
}
const catalogue = await get('/v1/catalogue?section=social_boost')
assert.equal(catalogue.status, 200)
assert.deepEqual(catalogue.body.data.map(item => item.id), [1, 2, 3])
assert.deepEqual(catalogue.body.data.map(item => item.price_basis), ['per_1000', 'per_1000', 'fixed'])
assert.deepEqual(catalogue.body.data[0].required_fields, ['link', 'quantity', 'answer_number'])
assert.ok(catalogue.body.data.every(item => !Object.hasOwn(item, 'rate_usd')))

const poll = await get('/v1/quote?section=social_boost&service_id=1&link=https%3A%2F%2Fexample.org%2Fpost&quantity=15&answer_number=1')
assert.equal(poll.status, 200)
assert.deepEqual(poll.body.data, { service_id: 1, quantity: 15, expected_price_ngn: 15, currency: 'NGN' })
const seo = await get('/v1/quote?section=social_boost&service_id=2&link=https%3A%2F%2Fexample.org%2Fpost&quantity=300&keywords=one%0Atwo')
assert.equal(seo.status, 200)
assert.deepEqual(seo.body.data, { service_id: 2, quantity: 300, expected_price_ngn: 38, currency: 'NGN' })
const pack = await get('/v1/quote?section=social_boost&service_id=3&link=https%3A%2F%2Fexample.org%2Fpost')
assert.equal(pack.status, 200)
assert.deepEqual(pack.body.data, { service_id: 3, quantity: 1, expected_price_ngn: 499, currency: 'NGN' })
for (const suffix of [
  'service_id=1&link=https%3A%2F%2Fexample.org%2Fpost&quantity=9&answer_number=1',
  'service_id=2&link=https%3A%2F%2Fexample.org%2Fpost&quantity=501&keywords=one',
  'service_id=1&link=https%3A%2F%2Fexample.org%2Fpost&quantity=15',
  'service_id=1&link=https%3A%2F%2Fexample.org%2Fpost&quantity=15&answer_number=1&amount_ngn=1',
  'service_id=1&link=https%3A%2F%2Fexample.org%2Fpost&quantity=15&quantity=16&answer_number=1',
]) {
  const invalid = await get(`/v1/quote?section=social_boost&${suffix}`)
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, 'invalid_request')
}
assert.equal((await get('/v1/quote?section=social_boost&service_id=4&link=https%3A%2F%2Fexample.org')).status, 409)
assert.equal(financialCalls, 0)
assert.equal(authCalls, serviceReads + 2, 'every request authenticates before any service read')
console.log('Customer Social Boost catalogue/quote: exact purchase rounding, supported fields, bounds, no provider or wallet call passed')
