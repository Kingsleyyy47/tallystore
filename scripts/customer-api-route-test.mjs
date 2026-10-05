import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { customerApiRoute } from '../supabase/functions/_shared/customer-api-route.mjs'

const prefixes = ['/functions/v1/customer-api', '/customer-api', '']
for (const prefix of prefixes) {
  assert.deepEqual(customerApiRoute(`${prefix}/v1/keys`, 'POST'), { kind: 'manage', path: '/v1/keys' })
  assert.deepEqual(customerApiRoute(`${prefix}/v1/wallet`, 'GET'), { kind: 'read', path: '/v1/wallet' })
  assert.deepEqual(customerApiRoute(`${prefix}/v1/purchases`, 'POST'), { kind: 'purchase', path: '/v1/purchases' })
}

let handler
let businessCalls = 0
const forbiddenAdmin = new Proxy({}, { get() { businessCalls += 1; throw new Error('business query reached') } })
globalThis.__customerApiRouteTest = {
  serve: callback => { handler = callback },
  createClient: () => forbiddenAdmin,
  sha256Hex: () => { throw new Error('hash must not run for missing key') },
  signCustomerCapability: () => { throw new Error('capability must not be issued') },
  customerApiRoute,
}
globalThis.Deno = { env: { get: () => 'test' } }
const source = readFileSync(new URL('../supabase/functions/customer-api/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText.replace(/^import .*\r?\n/gm, '')
const injected = `const { serve, createClient, sha256Hex, signCustomerCapability, customerApiRoute } = globalThis.__customerApiRouteTest;\nconst console = { error() {} };\n${compiled}`
await import(`data:text/javascript;base64,${Buffer.from(injected).toString('base64')}`)
assert.equal(typeof handler, 'function')

for (const prefix of prefixes) {
  const base = `https://example.invalid${prefix}`
  const requests = [
    new Request(`${base}/v1/keys`, { method: 'POST' }),
    new Request(`${base}/v1/wallet?section=products`, { method: 'GET' }),
    new Request(`${base}/v1/purchases`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'products' }) }),
  ]
  for (const request of requests) {
    const response = await handler(request)
    assert.equal(response.status, 401, `${request.method} ${request.url} must reach auth`)
    assert.notEqual((await response.json()).code, 'not_found')
  }
}
assert.equal(businessCalls, 0)
console.log('customer API gateway/stripped routes reach authentication before business queries')
