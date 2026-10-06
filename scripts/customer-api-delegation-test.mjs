import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

globalThis.Deno = { env: { get: (name) => name === 'CUSTOMER_API_DELEGATION_SECRET' ? 'test-secret-for-customer-api-delegation-123456789' : '' } }
const source = readFileSync(new URL('../supabase/functions/_shared/customer-api-delegation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText.replace(/^import \{ createClient \}.*\n/m, 'const createClient = () => { throw Error("JWT path is outside this test") };\n')
const { signCustomerCapability, authenticateCustomerRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
const identity = {
  key_id: '20000000-0000-4000-8000-000000000001',
  user_id: '10000000-0000-4000-8000-000000000001', section: 'products',
}
const body = JSON.stringify({ product_group_id: 'some-product', quantity: 1, idempotency_key: 'purchase-001' })
const used = new Set()
let revoked = false
const admin = { rpc: async (_name, args) => {
  if (revoked || args.p_key_id !== identity.key_id || args.p_user_id !== identity.user_id ||
      args.p_section !== identity.section || used.has(args.p_nonce)) return { data: false, error: null }
  used.add(args.p_nonce)
  return { data: true, error: null }
} }
const request = (capability, payload = body, target = 'process-purchase') => new Request(`https://tallystore.invalid/functions/v1/${target}`, {
  method: 'POST', headers: { 'x-tally-api-capability': capability }, body: payload,
})
const authorize = (capability, payload = body, section = 'products', target = 'process-purchase') =>
  authenticateCustomerRequest(request(capability, payload, target), admin, section, target)

const first = await signCustomerCapability(identity, 'process-purchase', body)
assert.deepEqual(await authorize(first), { id: identity.user_id })
await assert.rejects(authorize(first), /Unauthorized/) // nonce replay
await assert.rejects(authorize(await signCustomerCapability(identity, 'process-purchase', body), body + ' '), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'process-purchase', body), body, 'sms'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'process-purchase', body), body, 'products', 'smsbus'), /Unauthorized/)
revoked = true
await assert.rejects(authorize(await signCustomerCapability(identity, 'process-purchase', body)), /Unauthorized/)
revoked = false
const [encoded, signature] = (await signCustomerCapability(identity, 'process-purchase', body)).split('.')
const modified = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
modified.user_id = '10000000-0000-4000-8000-000000000099'
await assert.rejects(authorize(`${Buffer.from(JSON.stringify(modified)).toString('base64url')}.${signature}`), /Unauthorized/)
identity.section = 'airtime'
const airtimeBody = JSON.stringify({ action: 'purchase', phone_number: '+14155550123',
  product_id: 'operator-one', operator_id: 'operator-one', package_id: 'bundle-one',
  expected_amount_ngn: 100, idempotency_key: 'airtime-order-001' })
const airtime = await signCustomerCapability(identity, 'customer-airtime', airtimeBody)
assert.deepEqual(await authorize(airtime, airtimeBody, 'airtime', 'customer-airtime'), { id: identity.user_id })
await assert.rejects(authorize(airtime, airtimeBody, 'airtime', 'customer-airtime'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-airtime', airtimeBody),
  airtimeBody.replace('operator-one', 'operator-two'), 'airtime', 'customer-airtime'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-airtime', airtimeBody),
  airtimeBody, 'products', 'customer-airtime'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-airtime', airtimeBody),
  airtimeBody, 'airtime', 'smsbus'), /Unauthorized/)
revoked = true
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-airtime', airtimeBody),
  airtimeBody, 'airtime', 'customer-airtime'), /Unauthorized/)
revoked = false
identity.section = 'giftcards'
const giftBody = JSON.stringify({ action: 'purchase', product_id: 'amazon-us', package_id: 'ten',
  unit_value: 10, quantity: 2, expected_amount_ngn: 22000, idempotency_key: 'giftcard-order-001' })
const gift = await signCustomerCapability(identity, 'customer-giftcards', giftBody)
assert.deepEqual(await authorize(gift, giftBody, 'giftcards', 'customer-giftcards'), { id: identity.user_id })
await assert.rejects(authorize(gift, giftBody, 'giftcards', 'customer-giftcards'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-giftcards', giftBody),
  giftBody.replace('amazon-us', 'foreign-gift'), 'giftcards', 'customer-giftcards'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-giftcards', giftBody),
  giftBody, 'products', 'customer-giftcards'), /Unauthorized/)
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-giftcards', giftBody),
  giftBody, 'giftcards', 'customer-airtime'), /Unauthorized/)
revoked = true
await assert.rejects(authorize(await signCustomerCapability(identity, 'customer-giftcards', giftBody),
  giftBody, 'giftcards', 'customer-giftcards'), /Unauthorized/)
console.log('customer API capability checks passed')
