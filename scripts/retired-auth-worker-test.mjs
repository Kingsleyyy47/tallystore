import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const origin = 'https://www.tallystore.test'
const retired = 'https://dssvvswvqnxanyzfhixf.supabase.co/auth/v1/token?grant_type=password'
const active = 'https://ktmlojvchkmzcdbjdyjx.supabase.co/auth/v1/token?grant_type=password'
const listeners = new Map(), clients = new Map(), navigations = [], network = []
const context = vm.createContext({
  URL, Request, Response, Promise, Set,
  self: { location: { origin }, clients: {
    async get(id) { return clients.get(id) }, async matchAll() { return [...clients.values()] },
  }, addEventListener(type, listener) { listeners.set(type, listener) } },
  caches: { async match() { return undefined } },
  fetch: async request => { network.push(request.url); return new Response('asset') },
})
vm.runInContext(readFileSync('public/sw-assets.js', 'utf8'), context)
function client(id, path, type = 'window') {
  const record = { id, type, url: new URL(path, origin).href,
    async navigate(url) { navigations.push({ id, url }); record.url = url; return record } }
  clients.set(id, record)
  return record
}
async function dispatch(url, clientId, { method = 'POST', body = 'email=synthetic%40example.invalid&password=DO_NOT_FORWARD' } = {}) {
  const request = new Request(url, { method, ...(method === 'POST' ? { body } : {}) })
  let response, work
  listeners.get('fetch')({ request, clientId, respondWith(value) { response = value }, waitUntil(value) { work = value } })
  if (work) await work
  assert.equal(request.bodyUsed, false, 'Worker must never read the password/token request body')
  return response ? await response : null
}

client('login', '/login?next=%2Fproducts')
let response = await dispatch(retired, 'login')
assert.equal(response.status, 409)
assert.equal(response.headers.get('Cache-Control'), 'no-store')
assert.deepEqual(await response.json(), { code: 'store_updated', msg: 'The store has updated. Please sign in again.' })
assert.deepEqual(navigations, [{ id: 'login', url: origin + '/login?next=%2Fproducts&store_updated=1' }])
assert.equal(network.length, 0, 'Retired sign-in must never reach either Supabase project')
await dispatch(retired, 'login')
assert.equal(navigations.length, 1, 'A stale browser must not enter a reload loop')

for (const [id, path] of [['checkout', '/checkout'], ['admin', '/admin'], ['orders', '/orders'], ['reset', '/reset-password'], ['external', 'https://other.test/login']]) {
  client(id, path)
  assert.equal((await dispatch(retired, id)).status, 409)
}
client('worker', '/login', 'sharedworker')
assert.equal((await dispatch(retired, 'worker')).status, 409)
assert.equal((await dispatch(retired, 'missing')).status, 409)
assert.equal(navigations.length, 1, 'Only the same-origin login window may be replaced')

for (const url of [active, 'https://other.supabase.co/auth/v1/token', origin + '/api/payment', retired.replace('/token?', '/recover?'), retired.replace('https:', 'http:')]) {
  assert.equal(await dispatch(url, 'login'), null, 'Unrelated API requests must retain their existing handling')
}
assert.equal(await dispatch(retired, 'login', { method: 'GET' }), null)
assert.equal(await dispatch(active, 'checkout'), null)
assert.equal(network.length, 0)
console.log('Retired Auth guard: credentials unread/unforwarded, safe response, one login-only recovery, checkout/admin/reset isolation, active Auth unchanged passed.')
