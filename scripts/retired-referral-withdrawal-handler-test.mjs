import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/create-withdrawal-request/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(legacyFlag) {
  const calls = { auth: 0, profile: 0, admin: 0, rpc: 0, provider: 0, fetch: 0 }
  const anon = {
    auth: { async getUser() { calls.auth++; return { data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null } } },
    from(table) {
      assert.equal(table, 'profiles')
      calls.profile++
      return {
        select() { return this }, eq() { return this },
        async single() { return { data: null, error: { message: 'Synthetic profile stop' } } },
      }
    },
    rpc() { calls.rpc++; throw new Error('Unexpected wallet RPC') },
  }
  let handler
  const sandbox = {
    exports: {}, Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto: webcrypto,
    setTimeout, clearTimeout, AbortController, AbortSignal,
    console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get(name) {
      if (name === 'WITHDRAWALS_ENABLED') return 'true'
      if (name === 'LEGACY_REFERRAL_WITHDRAWALS_ENABLED') return legacyFlag
      if (name === 'SUPABASE_ANON_KEY') return 'anon-key'
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key'
      if (name === 'SUPABASE_URL') return 'https://example.invalid'
      return undefined
    } } },
    fetch() { calls.fetch++; throw new Error('Unexpected provider fetch') },
    require(specifier) {
      if (specifier.includes('/http/server.ts')) return { serve: fn => { handler = fn } }
      if (specifier.includes('supabase-js')) return { createClient(_url, key) {
        if (key === 'service-key') { calls.admin++; throw new Error('Unexpected service role client') }
        assert.equal(key, 'anon-key')
        return anon
      } }
      throw new Error(`Unexpected import ${specifier}`)
    },
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'create-withdrawal-request.js' })
  assert.equal(typeof handler, 'function')
  return {
    calls,
    async request(sourceValue) {
      const body = { amount: 1000, bank_code: '001', bank_name: 'Test Bank', account_number: '0000000000', account_name: 'Test Customer' }
      if (sourceValue !== undefined) body.source = sourceValue
      const response = await handler(new Request('https://example.invalid/functions/v1/create-withdrawal-request', {
        method: 'POST', headers: { Authorization: 'Bearer test-customer', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
      return { status: response.status, body: await response.json() }
    },
  }
}

for (const legacyFlag of [undefined, '', 'false', 'TRUE-ish']) {
  const t = harness(legacyFlag)
  const result = await t.request('referral')
  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assert.equal(result.body.code, 'LEGACY_REFERRAL_WITHDRAWALS_DISABLED')
  assert.match(result.body.error, /historical referral withdrawals require review/i)
  assert.deepEqual(t.calls, { auth: 1, profile: 0, admin: 0, rpc: 0, provider: 0, fetch: 0 })
}

for (const sourceValue of ['crypto', undefined]) {
  const t = harness(undefined)
  const result = await t.request(sourceValue)
  assert.notEqual(result.body.code, 'LEGACY_REFERRAL_WITHDRAWALS_DISABLED')
  assert.equal(t.calls.profile, 1, 'crypto continues through existing profile validation')
  assert.equal(t.calls.admin, 0)
  assert.equal(t.calls.rpc, 0)
}

const historical = harness('true')
const reviewed = await historical.request('referral')
assert.notEqual(reviewed.body.code, 'LEGACY_REFERRAL_WITHDRAWALS_DISABLED')
assert.equal(historical.calls.profile, 1, 'explicit Supabase flag permits the existing validated referral path')
assert.equal(historical.calls.admin, 0)
assert.equal(historical.calls.rpc, 0)

console.log('Retired referral withdrawal handler gate passed')
