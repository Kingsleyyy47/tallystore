import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync('supabase/functions/partner-api/index.ts', 'utf8')
const clientSource = source.slice(source.indexOf('function getBitrefillClient()'), source.indexOf('async function getBlockedBitrefillIds'))
const code = ts.transpileModule(clientSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let fetchCalls = 0, mode = 'valid', lastSignal
const context = vm.createContext({
  BITREFILL_API_URL: 'https://api.bitrefill.com/v2',
  Deno: { env: { get: () => 'SYNTHETIC_ONLY_TOKEN' } },
  AbortController, TextDecoder, Uint8Array, clearTimeout,
  setTimeout: (fn, ms) => setTimeout(fn, ms === 20_000 ? 30 : ms),
  fetch: async (url, options) => {
    fetchCalls++; lastSignal = options.signal
    assert.match(url, /^https:\/\/api\.bitrefill\.com\/v2\//)
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, 'Bearer SYNTHETIC_ONLY_TOKEN')
    if (mode === 'timeout') return new Promise(() => {})
    if (mode === 'status') return new Response('PRIVATE_PROVIDER_MESSAGE', { status: 500 })
    if (mode === 'redirect') return { ok: true, redirected: true }
    if (mode === 'large') return new Response('x'.repeat(1_000_001))
    if (mode === 'declared-large') return new Response('{}', { headers: { 'content-length': '1000001' } })
    return new Response(JSON.stringify({ data: { id: 'invoice-1', status: 'unpaid' } }))
  },
})
vm.runInContext(code, context)
const client = vm.runInContext('getBitrefillClient()', context)
assert.equal((await client.getInvoice('invoice-1')).id, 'invoice-1')
for (mode of ['status', 'redirect', 'large', 'declared-large', 'timeout']) {
  const before = fetchCalls
  await assert.rejects(client.payInvoice('invoice-1'), /CATALOG_UNAVAILABLE/)
  assert.equal(fetchCalls, before + 1, 'paid calls never retry after an uncertain response')
  assert.equal(lastSignal.aborted, true)
}
console.log('Partner Bitrefill client: fixed host, redirect denial, bounded bodies, abort deadline and one paid send passed (mock transport only).')
