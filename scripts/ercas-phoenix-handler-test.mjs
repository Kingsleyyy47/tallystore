// Exercises the actual Edge handlers with synthetic auth, database and HTTP.
// No provider or Supabase request leaves this process.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ngnMinorUnits } from '../supabase/functions/_shared/ngn-amount.mjs'
import { matchesErcasCheckout } from '../supabase/functions/_shared/ercas-payment-identity.mjs'

const host = 'https://api.phoenix-wallet.ercaspay.com/api/v1'
const reference = 'ER|synthetic-checkout-1'
const merchantReference = 'TALLY-synthetic-1'
const customerId = '11111111-1111-4111-8111-111111111111'
const bearer = 'test-only-provider-secret'
const service = 'test-only-supabase-service'

function compile(path) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  let stripped = source
  for (const node of ast.statements.filter(ts.isImportDeclaration).reverse()) {
    stripped = stripped.slice(0, node.getFullStart()) + stripped.slice(node.end)
  }
  return ts.transpileModule(stripped, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
}

function harness(which, providerReply) {
  let handler
  const calls = { provider: [], rpc: [], pendingInserts: [], pendingUpdates: [], revenue: [] }
  const pending = {
    id: '22222222-2222-4222-8222-222222222222', user_id: customerId,
    amount: 1000, status: 'pending', check_count: 0,
    transaction_reference: reference, ercas_reference: merchantReference,
    created_at: new Date().toISOString(),
  }
  const admin = {
    from(table) {
      const q = { table, mode: '', filters: [], row: null }
      const chain = {
        select() { q.mode = 'select'; return chain },
        eq(field, value) { q.filters.push([field, value]); return chain },
        insert(row) { q.mode = 'insert'; q.row = row; return chain },
        update(row) { q.mode = 'update'; q.row = row; return chain },
        upsert(row) { q.mode = 'upsert'; q.row = row; return chain },
        async single() {
          if (table === 'profiles') return { data: { is_staff: false, is_admin: false }, error: null }
          if (table === 'app_settings') return { data: { value: 'true' }, error: null }
          throw Error(`Unexpected single ${table}`)
        },
        async maybeSingle() {
          if (table === 'transactions') return { data: null, error: null }
          if (table === 'pending_payments') {
            assert.deepEqual(q.filters.slice(0, 2), [
              ['transaction_reference', reference], ['user_id', customerId],
            ])
            return { data: pending, error: null }
          }
          if (table === 'wallet_missing_gateway_funding') return { data: null, error: null }
          throw Error(`Unexpected maybeSingle ${table}`)
        },
        then(resolve, reject) {
          if (table === 'pending_payments' && q.mode === 'insert') calls.pendingInserts.push(q.row)
          if (table === 'pending_payments' && q.mode === 'update') calls.pendingUpdates.push({ row: q.row, filters: q.filters })
          if (table === 'revenue_events') calls.revenue.push(q.row)
          return Promise.resolve({ error: null }).then(resolve, reject)
        },
      }
      return chain
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      assert.equal(name, 'apply_wallet_transaction')
      return { data: { success: true, balance_after: 1000 }, error: null }
    },
  }
  const userClient = { auth: { async getUser(token) {
    return token === 'synthetic-user-jwt'
      ? { data: { user: { id: customerId, email: 'customer@example.com' } }, error: null }
      : { data: { user: null }, error: { message: 'Unauthorized' } }
  } } }
  const context = {
    exports: {}, Request, Response, Headers, URL, AbortController, AbortSignal,
    TextEncoder, TextDecoder, crypto, setTimeout, clearTimeout, ngnMinorUnits,
    matchesErcasCheckout,
    console: { log() {}, warn() {}, error() {} },
    serve(fn) { handler = fn },
    Deno: { env: { get(key) { return ({
      SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'synthetic-anon',
      SUPABASE_SERVICE_ROLE_KEY: service, ERCASPAY_SECRET_KEY: bearer,
      TALLYSTORE_SITE_ORIGIN: 'https://tallystore.org',
    })[key] || '' } } },
    createClient(_url, key) { return key === 'synthetic-anon' ? userClient : admin },
    async fetch(url, options) {
      calls.provider.push({ url: String(url), options })
      return providerReply(url, options)
    },
  }
  vm.runInNewContext(compile(`supabase/functions/${which}/index.ts`), context, { timeout: 5000 })
  assert.equal(typeof handler, 'function')
  async function invoke(body, authorization = 'Bearer synthetic-user-jwt') {
    const response = await handler(new Request(`https://synthetic.invalid/functions/v1/${which}`, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() }
  }
  return { invoke, calls }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
function assertProviderCall(call, path, method) {
  assert.equal(call.url, `${host}${path}`)
  assert.equal(call.options.method, method)
  assert.equal(call.options.headers.Authorization, `Bearer ${bearer}`)
  assert.equal(call.options.redirect, 'error')
  assert.ok(call.options.signal, 'provider request must have a deadline signal')
}

let h = harness('create-wallet-topup', () => json({ requestSuccessful: true, responseBody: {
  transactionReference: reference, paymentReference: merchantReference,
  checkoutUrl: 'https://checkout.ercaspay.com/test-only',
} }))
let result = await h.invoke({ amount: 1000, customerName: 'Test Customer' })
assert.equal(result.status, 200)
assert.equal(result.body.success, true)
assert.equal(h.calls.provider.length, 1)
assertProviderCall(h.calls.provider[0], '/payment/initiate', 'POST')
assert.equal(JSON.parse(h.calls.provider[0].options.body).amount, 1000)
assert.equal(h.calls.pendingInserts.length, 1)
assert.equal(h.calls.pendingInserts[0].transaction_reference, reference)
assert.equal(h.calls.pendingInserts[0].ercas_reference, merchantReference)
assert.equal(h.calls.pendingInserts[0].user_id, customerId)

h = harness('create-wallet-topup', () => { throw Error('Provider must not be called') })
result = await h.invoke({ amount: 1000 }, 'Bearer invalid-user')
assert.equal(result.status, 401)
assert.equal(h.calls.provider.length, 0)
assert.equal(h.calls.pendingInserts.length, 0)

h = harness('verify-and-credit-wallet', () => json({
  requestSuccessful: false, responseMessage: 'Unauthorized access',
}, 401))
result = await h.invoke({ transaction_reference: reference })
assert.equal(result.status, 202)
assert.equal(result.body.status, 'pending')
assert.equal(result.body.retryable, true)
assertProviderCall(h.calls.provider[0], `/payment/transaction/verify/${encodeURIComponent(reference)}`, 'GET')
assert.equal(h.calls.rpc.length, 0, 'HTTP 401 must never create a wallet credit')
assert.ok(h.calls.pendingUpdates.some(({ row }) => row.status === 'pending'))
assert.ok(!h.calls.pendingUpdates.some(({ row }) => row.status === 'failed'))

h = harness('verify-and-credit-wallet', () => { throw Error('Provider must not be called') })
result = await h.invoke({ transaction_reference: reference }, 'Bearer invalid-user')
assert.equal(result.status, 401)
assert.equal(h.calls.provider.length, 0)
assert.equal(h.calls.rpc.length, 0)

const verified = { requestSuccessful: true, responseBody: {
  status: 'SUCCESSFUL', ercs_reference: reference, tx_reference: merchantReference,
  amount: 1000, currency: 'NGN',
} }
for (const [change, shouldCredit] of [
  [{}, true], [{ ercs_reference: 'ER|foreign' }, false],
  [{ tx_reference: 'TALLY-foreign' }, false], [{ amount: 999 }, false],
  [{ currency: 'USD' }, false],
]) {
  h = harness('verify-and-credit-wallet', () => json({
    ...verified, responseBody: { ...verified.responseBody, ...change },
  }))
  result = await h.invoke({ transaction_reference: reference })
  assert.equal(h.calls.rpc.length, shouldCredit ? 1 : 0, JSON.stringify(change))
  if (shouldCredit) {
    assert.equal(result.body.success, true)
    assert.equal(h.calls.rpc[0].args.p_idempotency_key, `ercas:${reference}`)
    assert.equal(h.calls.rpc[0].args.p_amount, 1000)
  } else {
    assert.equal(result.body.success, false)
    assert.equal(result.status, 409)
  }
}

console.log('ercas-phoenix-handler-test: PASS (actual handlers, synthetic transports only)')
