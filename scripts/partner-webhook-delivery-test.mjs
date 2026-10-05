import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/_shared/partner-webhook-delivery.ts', 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports, crypto: webcrypto, TextEncoder, AbortController,
  Response, URL, Date, setTimeout, clearTimeout })
const { deliverPartnerWebhookSafely, validatePartnerWebhookUrl } = exports
const partnerId = '10000000-0000-4000-8000-000000000001'
const orderId = '20000000-0000-4000-8000-000000000002'
const secret = `tly_whsec_${'a'.repeat(64)}`
const partner = { id: partnerId, is_active: true, owner_reviewed_at: '2026-10-05T12:00:00Z',
  webhook_url: 'https://hooks.partner.example/receiver', webhook_secret: secret }
const order = { id: orderId, partner_id: partnerId, item_type: 'product', status: 'completed',
  amount_ngn: 2000, currency: 'NGN', partner_reference: 'client-ref',
  response_payload: { api_key: 'PRIVATE_PROVIDER_SECRET', accounts: [{ password: 'PRIVATE_ACCOUNT_PASSWORD' }] },
  request_payload: { card: 'PRIVATE_CUSTOMER_DATA' }, customer_email: 'private@example.test' }

let sends = 0
let resolutions = 0
function transport(addresses = ['93.184.215.14'], response = new Response('OK', { status: 200 })) {
  return {
    async resolveAll(hostname, signal) {
      resolutions++
      assert.equal(hostname, 'hooks.partner.example')
      assert.equal(signal.aborted, false)
      return addresses
    },
    async postPinned(request) {
      sends++
      assert.equal(request.url, partner.webhook_url)
      assert.equal(request.hostname, 'hooks.partner.example')
      assert.equal(request.method, 'POST')
      assert.equal(request.redirect, 'error')
      assert.deepEqual(Array.from(request.verifiedIpv4), [...new Set(addresses)])
      assert.equal(Object.isFrozen(request.verifiedIpv4), true)
      const sent = JSON.parse(request.body)
      assert.equal(sent.partner_id, partnerId)
      assert.equal(sent.data.order.id, orderId)
      assert.equal(JSON.stringify(sent).includes('PRIVATE_'), false)
      assert.equal(JSON.stringify(sent).includes('customer_email'), false)
      assert.equal(JSON.stringify(sent).includes('response_payload'), false)
      const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const expected = Buffer.from(await webcrypto.subtle.sign('HMAC', key,
        new TextEncoder().encode(`${request.headers['X-Tally-Timestamp']}.${request.body}`))).toString('hex')
      assert.equal(request.headers['X-Tally-Signature'], `sha256=${expected}`)
      return response
    },
  }
}
const input = { partner, order, eventType: 'partner.order.completed',
  keyScopes: ['orders:read'], nowMs: Date.parse('2026-10-05T12:00:00Z') }

assert.equal((await deliverPartnerWebhookSafely(input)).code, 'PINNED_EGRESS_REQUIRED')
assert.equal(sends, 0)
assert.equal(resolutions, 0)
for (const url of [
  'http://hooks.partner.example/x', 'https://u:p@example.com/x',
  'https://hooks.partner.example:444/x', 'https://127.0.0.1/x',
  'https://169.254.169.254/latest/meta-data', 'https://[::ffff:127.0.0.1]/x',
  'https://2130706433/x', 'https://localhost/x', 'https://foo.local/x',
  'https://foo.internal/x', 'https://hooks.partner.example/x#fragment',
]) assert.equal(validatePartnerWebhookUrl(url), null, `unsafe URL admitted: ${url}`)
assert.ok(validatePartnerWebhookUrl(partner.webhook_url))

for (const addresses of [
  [], ['127.0.0.1'], ['10.1.2.3'], ['172.16.0.1'], ['192.168.1.1'],
  ['169.254.169.254'], ['100.64.0.1'], ['192.0.2.1'], ['198.51.100.1'],
  ['203.0.113.1'], ['::ffff:127.0.0.1'], ['93.184.215.14', '127.0.0.1'],
]) {
  const before = sends
  const result = await deliverPartnerWebhookSafely({ ...input, transport: transport(addresses) })
  assert.equal(result.code, 'WEBHOOK_DNS_UNSAFE')
  assert.equal(sends, before, 'mixed public/private DNS answers must prevent any send')
}

let result = await deliverPartnerWebhookSafely({ ...input, transport: transport(['93.184.215.14', '93.184.215.14']) })
assert.equal(result.state, 'delivered')
assert.equal(result.http_status, 200)
result = await deliverPartnerWebhookSafely({ ...input,
  transport: transport(['93.184.215.14'], new Response('redirect', { status: 302, headers: { Location: 'http://127.0.0.1' } })) })
assert.equal(result.code, 'WEBHOOK_REDIRECT_REFUSED')
result = await deliverPartnerWebhookSafely({ ...input,
  transport: transport(['93.184.215.14'], new Response('x'.repeat(5000), { status: 200 })) })
assert.equal(result.code, 'WEBHOOK_RESPONSE_TOO_LARGE')
result = await deliverPartnerWebhookSafely({ ...input,
  transport: transport(['93.184.215.14'], new Response('PRIVATE_PROVIDER_SECRET', { status: 500 })) })
assert.equal(result.code, 'WEBHOOK_HTTP_FAILURE')
assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
result = await deliverPartnerWebhookSafely({ ...input, timeoutMs: 5, transport: {
  resolveAll: () => new Promise(() => {}),
  postPinned: () => { throw new Error('must not send after DNS timeout') },
} })
assert.equal(result.code, 'WEBHOOK_TRANSPORT_UNAVAILABLE')

for (const change of [
  { partner: { ...partner, owner_reviewed_at: null } },
  { partner: { ...partner, is_active: false } },
  { partner: { ...partner, webhook_url: 'https://127.0.0.1/' } },
  { order: { ...order, partner_id: 'wrong' } },
  { order: { ...order, status: 'processing' } },
  { keyScopes: ['orders:create'] },
]) {
  const before = sends
  result = await deliverPartnerWebhookSafely({ ...input, ...change, transport: transport() })
  assert.equal(result.code, 'WEBHOOK_NOT_AUTHORIZED')
  assert.equal(sends, before)
}
console.log('Partner webhook delivery: fail-closed egress, URL/DNS denial, signed minimal payload, redirect/size bounds and authorization passed')
