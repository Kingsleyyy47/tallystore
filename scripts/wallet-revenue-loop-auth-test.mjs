import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAuthorizedRevenueLoopRequest } from '../supabase/functions/revenue-os-loop/auth.mjs'

const key = 'local-test-service-role-key'
const request = (authorization) => new Request('https://example.invalid/revenue-os-loop', {
  method: 'POST',
  headers: authorization ? { authorization } : {},
})

assert.equal(isAuthorizedRevenueLoopRequest(request(), key), false)
assert.equal(isAuthorizedRevenueLoopRequest(request('Bearer ordinary-user-jwt'), key), false)
assert.equal(isAuthorizedRevenueLoopRequest(request(`Bearer ${key}`), key), true)
assert.equal(isAuthorizedRevenueLoopRequest(request(`Bearer ${key}`), ''), false)

const source = readFileSync(new URL('../supabase/functions/revenue-os-loop/index.ts', import.meta.url), 'utf8')
const methodGuard = source.indexOf("if (req.method !== 'POST')")
const authGuard = source.indexOf('if (!isAuthorizedRevenueLoopRequest(req, SERVICE_ROLE_KEY))')
const firstWrite = source.indexOf('await closeAttributionWindows(windowH)')
assert(methodGuard > -1 && authGuard > methodGuard && firstWrite > authGuard)

const config = readFileSync(new URL('../supabase/functions/revenue-os-loop/config.toml', import.meta.url), 'utf8')
assert.match(config, /verify_jwt\s*=\s*true/)

console.log('Revenue loop rejects ordinary callers before privileged maintenance.')
