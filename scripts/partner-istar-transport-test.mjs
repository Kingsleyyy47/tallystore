import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { IStarProvider } from '../supabase/functions/_shared/istar-provider.ts'

// Actual partner entrypoint calls the actual provider transport; no live HTTP.
const source = readFileSync('supabase/functions/partner-api/index.ts', 'utf8')
  .replace(/^import .*$/gm, '') + '\nglobalThis.istarTransport = { istarGet, istarPost };'
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText
const secret = 'TEST_ONLY_PRIVATE_ISTAR_KEY'
function gateway(baseURL) {
  const context = vm.createContext({ exports: {}, serve: () => {}, IStarProvider,
    Deno: { env: { get: name => name === 'ISTAR_API_KEY' ? secret
      : name === 'ISTAR_BASE_URL' ? baseURL : undefined } },
  })
  vm.runInContext(code, context)
  return context.istarTransport
}
const savedFetch = globalThis.fetch
const calls = []
let response = Response.json({ order_id: 'provider-order-1', status: 'processing' })
globalThis.fetch = async (url, options) => {
  calls.push({ url, options })
  return response
}
try {
  const transport = gateway()
  await transport.istarGet('/orders/provider-order-1')
  assert.equal(calls.at(-1).url,
    'https://v1.fragmentapi.com/api/v1/partner/orders/provider-order-1')
  assert.equal(calls.at(-1).options.redirect, 'error')
  assert.equal(calls.at(-1).options.credentials, 'omit')
  assert.equal(calls.at(-1).options.cache, 'no-store')
  assert.equal(calls.at(-1).options.headers['API-Key'], secret)
  response = Response.json({ order_id: 'provider-order-2', status: 'pending' })
  const before = calls.length
  await transport.istarPost('/orders/star', {
    username: 'fixture_user', recipient_hash: 'fixture_recipient', quantity: 50,
    wallet_type: 'USDT',
  }, '10000000-0000-4000-8000-000000000001')
  assert.equal(calls.length, before + 1)
  assert.equal(calls.at(-1).options.method, 'POST')
  assert.equal(calls.at(-1).options.headers['Idempotency-Key'],
    '10000000-0000-4000-8000-000000000001')
  for (const base of ['http://127.0.0.1/private', 'https://attacker.invalid/api',
    'https://v1.fragmentapi.com/api/v1/partner/']) {
    const invalid = gateway(base)
    const count = calls.length
    await assert.rejects(invalid.istarGet('/premium/packages'),
      /^Error: Supplier configuration unavailable$/)
    assert.equal(calls.length, count)
  }
  const count = calls.length
  await assert.rejects(transport.istarGet('/orders/../../wallet'))
  await assert.rejects(transport.istarPost('/orders/star', {
    username: 'fixture_user', recipient_hash: 'fixture_recipient', quantity: 50,
    wallet_type: 'USDT', provider_url: 'https://attacker.invalid',
  }, 'same-request'))
  assert.equal(calls.length, count)
  response = Response.json({ message: secret }, { status: 500 })
  const beforeFailure = calls.length
  await assert.rejects(transport.istarPost('/orders/premium', {
    username: 'fixture_user', recipient_hash: 'fixture_recipient', months: 3,
    wallet_type: 'USDT',
  }, '10000000-0000-4000-8000-000000000002'),
  /^Error: Supplier request unavailable$/)
  assert.equal(calls.length, beforeFailure + 1, 'failed paid calls are never resent')
  console.log('Partner iStar entrypoint: reviewed origins/paths, bounded provider client, isolated credentials and exactly one paid request passed.')
} finally { globalThis.fetch = savedFetch }
