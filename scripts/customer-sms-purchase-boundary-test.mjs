// Executes the actual SMS purchase handler through its preallocation guards.
// Synthetic database/Daisy only; no customer account or paid provider call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('supabase/functions/smsbus/index.ts', 'utf8')
const ast = ts.createSourceFile('smsbus.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleCreateOtp')
assert.ok(declaration, 'SMS purchase handler must exist')
const code = ts.transpileModule(`${declaration.getText(ast)}\nexports.handleCreateOtp = handleCreateOtp`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function fixture({ expectedPriceNgn, walletAllowed, debitAllowed = true }) {
  let providerCalls = 0
  let authorizationChecks = 0
  const exports = {}
  const admin = { from(table) {
    assert.ok(['sms_orders', 'transactions'].includes(table))
    return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: null, error: null } } }
  } }
  const context = {
    exports, Date, Math, Number, String,
    async assertPurchasingCustomer(_admin, _userId, _req, amount) {
      authorizationChecks++
      if (amount != null && !walletAllowed) throw new Error('Insufficient verified wallet funds')
    },
    getDaisyKey: () => 'synthetic-key',
    sanitizeRevenueRequestContext: () => null,
    getWalletRequestForensics: async () => ({}),
    buildSmsCatalog: async () => ({ products: [{ service_code: 'signal', service_name: 'Signal', is_enabled: true,
      available_count: 2, price_ngn: 930, provider_cost_usd: 0.55 }], exchangeRate: 1500, globalMarginNgn: 0,
      roundAutoPricesToNearestTen: true }),
    recordRevenueEvent: async () => undefined,
    generateReference: () => 'synthetic-reference',
    debitWallet: async () => { if (!debitAllowed) throw new Error('Insufficient verified wallet funds'); return { prev: 1000, next: 70 } },
    friendlyError: err => err instanceof Error ? err.message : 'Unavailable',
    DaisySmsError: class DaisySmsError extends Error {},
    daisyGetNumber: async () => { providerCalls++; throw new Error('Daisy must not be called before guards') },
  }
  vm.runInNewContext(code, context)
  return {
    invoke: () => exports.handleCreateOtp(admin, 'synthetic-user', {
      service_id: 'signal', idempotency_key: 'synthetic-key-123', expected_price_ngn: expectedPriceNgn,
    }, new Request('https://synthetic.invalid')),
    providerCalls: () => providerCalls,
    authorizationChecks: () => authorizationChecks,
  }
}

let f = fixture({ expectedPriceNgn: 920, walletAllowed: true })
await assert.rejects(f.invoke(), /Price changed/)
assert.equal(f.providerCalls(), 0, 'displayed price mismatch must precede Daisy allocation')
assert.equal(f.authorizationChecks(), 1)

f = fixture({ expectedPriceNgn: 930, walletAllowed: false })
await assert.rejects(f.invoke(), /Insufficient verified wallet funds/)
assert.equal(f.providerCalls(), 0, 'zero/insufficient wallet must precede Daisy allocation')
assert.equal(f.authorizationChecks(), 2)

f = fixture({ expectedPriceNgn: 930, walletAllowed: true, debitAllowed: false })
await assert.rejects(f.invoke(), /Insufficient verified wallet funds/)
assert.equal(f.providerCalls(), 0, 'failed canonical debit must precede Daisy allocation')
assert.equal(f.authorizationChecks(), 2)
console.log('SMS purchase preallocation boundary fixtures passed')
