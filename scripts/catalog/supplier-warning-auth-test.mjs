import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the current handler with auth and database adapters replaced.
const source = readFileSync('supabase/functions/manage-staff/index.ts', 'utf8')
  .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

async function request({ profile, authenticated = true, profileError = null, action = 'supplier_balance_alerts', body = {} }) {
  let handler
  let alertReads = 0
  let selected
  let clientCount = 0
  const context = {
    Request, Response, Headers, URL, crypto, TextEncoder, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: key => key === 'TALLYSTORE_OWNER_USER_ID' ? 'verified-user' : 'test-only' } },
    serve: callback => { handler = callback },
    createClient: () => {
      clientCount++
      if (clientCount === 1) return { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'verified-user' } : null }, error: null }) } }
      return { from: table => {
        if (table === 'profiles') {
          const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: profile, error: profileError }) }
          return chain
        }
        if (table === 'supplier_balance_alerts') {
          alertReads++
          const stored = { provider: 'shopclone', alert_code: 'insufficient_balance', last_seen_at: '2026-10-05T12:00:00Z', api_key: 'secret', provider_response: 'account|password', product_group_id: 'hidden' }
          const chain = {
            select: fields => { selected = fields; return chain },
            is: (field, value) => { assert.equal(field, 'resolved_at'); assert.equal(value, null); return chain },
            order: () => chain,
            limit: async count => { assert.equal(count, 3); return { data: [Object.fromEntries(selected.split(',').map(field => field.trim()).map(field => [field, stored[field]]))], error: null } },
          }
          return chain
        }
        throw new Error(`Unexpected table: ${table}`)
      } }
    },
  }
  vm.runInNewContext(code, context)
  const response = await handler(new Request('https://local/functions/v1/manage-staff', { method: 'POST', headers: { Authorization: 'Bearer verified-test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) }))
  return { status: response.status, result: await response.json(), alertReads, selected }
}

for (const profile of [
  { is_admin: false, is_staff: false },
  { is_admin: false, is_staff: true, account_suspended: true },
  { is_admin: true, account_suspended: true },
  null,
]) {
  const result = await request({ profile })
  assert.equal(result.status, 403)
  assert.equal(result.alertReads, 0)
}
assert.equal((await request({ authenticated: false })).status, 401)
assert.equal((await request({ profile: { is_staff: true }, profileError: { message: 'failed' } })).status, 403)
for (const profile of [{ is_staff: true, account_suspended: false }, { is_admin: true, account_suspended: false }]) {
  const result = await request({ profile })
  assert.equal(result.status, 200)
  assert.equal(result.alertReads, 1)
  assert.equal(result.selected, 'provider, alert_code, last_seen_at')
  assert.equal(JSON.stringify(result.result).includes('secret'), false)
  assert.equal(JSON.stringify(result.result).includes('password'), false)
}
assert.equal((await request({ profile: { is_admin: true }, action: 'set_permission', body: { user_id: 'staff-id', permission_key: 'setting_referral_pct', is_enabled: true } })).status, 400)
console.log('Supplier warning handler: verified staff/admin allowed; customers, suspended users and invalid sessions denied; no supplier secrets returned; retired permission cannot be granted.')
