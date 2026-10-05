import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, requireImpl = () => { throw new Error('unexpected import') }) {
  const exports = {}
  const source = readFileSync(path, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    allowImportingTsExtensions: true,
  } }).outputText
  vm.runInNewContext(output, { exports, require: requireImpl, crypto: webcrypto,
    TextEncoder, TextDecoder, AbortController, Response, URL, Date, setTimeout, clearTimeout })
  return exports
}
const delivery = load('supabase/functions/_shared/partner-webhook-delivery.ts')
const transportModule = load('supabase/functions/_shared/partner-webhook-transport.ts', name => {
  assert.equal(name, './partner-webhook-delivery.ts')
  return delivery
})
const { createPinnedDenoWebhookTransport, createRuntimePinnedWebhookTransport } = transportModule
assert.equal(createRuntimePinnedWebhookTransport(), null, 'missing Edge socket APIs must fail closed')

const partnerId = '10000000-0000-4000-8000-000000000001'
const orderId = '20000000-0000-4000-8000-000000000002'
const input = {
  partner: { id: partnerId, is_active: true, owner_reviewed_at: '2026-10-05',
    webhook_url: 'https://hooks.partner.example/receive?event=order', webhook_secret: `tly_whsec_${'a'.repeat(64)}` },
  order: { id: orderId, partner_id: partnerId, status: 'completed', item_type: 'product', amount_ngn: 100 },
  eventType: 'partner.order.completed', keyScopes: ['orders:read'], nowMs: 1791201600000,
}

function fakeRuntime({ ipv4 = ['93.184.215.14'], ipv6 = [], status = 200,
  header = null, tlsError = false, slowRead = false } = {}) {
  const calls = { dns: [], connect: [], tls: [], writes: [], closes: 0, reads: 0 }
  const response = new TextEncoder().encode(header ??
    `HTTP/1.1 ${status} OK\r\nContent-Length: 100000000\r\nConnection: close\r\n\r\nPRIVATE_RESPONSE_BODY`)
  let cursor = 0
  const tcp = { remoteAddr: { hostname: '93.184.215.14' },
    close() { calls.closes++ }, read: async () => null, write: async () => 0 }
  const tls = { close() { calls.closes++ },
    async write(bytes) { calls.writes.push(new Uint8Array(bytes)); return Math.max(1, Math.floor(bytes.length / 2)) },
    async read(bytes) {
      calls.reads++
      if (slowRead) return new Promise(() => {})
      if (cursor >= response.length) return null
      const count = Math.min(bytes.length, response.length - cursor)
      bytes.set(response.subarray(cursor, cursor + count))
      cursor += count
      return count
    } }
  return { calls, runtime: {
    async resolveDns(hostname, type, options) {
      calls.dns.push({ hostname, type, hasSignal: !!options.signal })
      return type === 'A' ? ipv4 : ipv6
    },
    async connect(options) { calls.connect.push(options); return tcp },
    async startTls(conn, options) {
      calls.tls.push({ conn, options })
      if (tlsError) throw new Error('PRIVATE_TLS_ERROR')
      return tls
    },
  } }
}

let f = fakeRuntime()
let result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.state, 'delivered')
assert.equal(result.http_status, 200)
assert.deepEqual(Array.from(f.calls.dns, item => item.type), ['A'])
assert.equal(f.calls.connect.length, 1)
assert.equal(f.calls.connect[0].hostname, '93.184.215.14', 'connect must use literal checked IP')
assert.equal(f.calls.connect[0].port, 443)
assert.equal(f.calls.tls[0].options.hostname, 'hooks.partner.example', 'certificate/SNI hostname must be original URL host')
assert.deepEqual(Array.from(f.calls.tls[0].options.alpnProtocols), ['http/1.1'])
const firstWrite = new TextDecoder().decode(f.calls.writes[0])
assert.ok(firstWrite.startsWith('POST /receive?event=order HTTP/1.1\r\nHost: hooks.partner.example\r\n'))
assert.ok(firstWrite.includes('Connection: close\r\n'))
assert.equal(JSON.stringify(result).includes('PRIVATE_RESPONSE_BODY'), false)
assert.ok(f.calls.closes >= 1)

f = fakeRuntime({ ipv4: ['93.184.215.14'], ipv6: ['2606:2800:220:1:248:1893:25c8:1946'] })
result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.state, 'delivered', 'public dual-stack hostname must use its public A answer')
assert.deepEqual(Array.from(f.calls.dns, item => item.type), ['A'])
assert.equal(f.calls.connect[0].hostname, '93.184.215.14')

f = fakeRuntime({ ipv4: ['127.0.0.1'], ipv6: ['2606:2800:220:1:248:1893:25c8:1946'] })
result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.code, 'WEBHOOK_DNS_UNSAFE')
assert.equal(f.calls.connect.length, 0)

f = fakeRuntime({ status: 302 })
result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.code, 'WEBHOOK_REDIRECT_REFUSED')
assert.equal(f.calls.connect.length, 1, 'redirect must never open a second connection')

f = fakeRuntime({ header: `HTTP/1.1 200 OK\r\nX-Huge: ${'x'.repeat(10000)}\r\n\r\n` })
result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.code, 'WEBHOOK_TRANSPORT_UNAVAILABLE')
assert.ok(f.calls.closes >= 1)

f = fakeRuntime({ tlsError: true })
result = await delivery.deliverPartnerWebhookSafely({ ...input,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.code, 'WEBHOOK_TRANSPORT_UNAVAILABLE')
assert.ok(f.calls.closes >= 1)

f = fakeRuntime({ slowRead: true })
result = await delivery.deliverPartnerWebhookSafely({ ...input, timeoutMs: 5,
  transport: createPinnedDenoWebhookTransport(f.runtime) })
assert.equal(result.code, 'WEBHOOK_TRANSPORT_UNAVAILABLE')
assert.ok(f.calls.closes >= 1, 'deadline must close socket')

f = fakeRuntime()
const transport = createPinnedDenoWebhookTransport(f.runtime)
await assert.rejects(transport.postPinned({ url: input.partner.webhook_url,
  hostname: 'hooks.partner.example', verifiedIpv4: Object.freeze(['127.0.0.1']),
  method: 'POST', redirect: 'error', headers: {}, body: '{}', signal: new AbortController().signal }))
assert.equal(f.calls.connect.length, 0, 'transport must reject direct private-IP misuse')

console.log('Pinned webhook transport: public A selection, literal-IP TCP, hostname TLS, bounded HTTP status, redirect refusal and socket cleanup passed')
