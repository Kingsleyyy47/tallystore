import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Evaluate the real build identity declarations: two deployments of one commit
// must not share a cache, including environment-only redeployments.
const config = ts.createSourceFile('vite.config.ts', readFileSync('vite.config.ts', 'utf8'), ts.ScriptTarget.ES2022, true)
const identityNames = new Set(['buildSource', 'buildInstance', 'appBuildVersion'])
const declarations = config.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => identityNames.has(declaration.name.getText(config))))
  .map(statement => statement.getText(config)).join('\n')
const evaluateBuild = new Function('process', ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText + '\nreturn appBuildVersion;')
const firstBuild = evaluateBuild({ env: { VERCEL_GIT_COMMIT_SHA: 'samecommit', VERCEL_DEPLOYMENT_ID: 'dpl_first' } })
const nextBuild = evaluateBuild({ env: { VERCEL_GIT_COMMIT_SHA: 'samecommit', VERCEL_DEPLOYMENT_ID: 'dpl_next' } })
assert.notEqual(firstBuild, nextBuild, 'Same-commit redeployment must use a separate precache')
assert.match(firstBuild, /^[A-Za-z0-9_-]{1,180}$/)
assert.match(nextBuild, /^[A-Za-z0-9_-]{1,180}$/)

const origin = 'https://tallystore.test'
const listeners = new Map()
const clients = new Map()
const storage = new Map()
const networkRequests = []
const deletedCaches = []

function openCache(name) {
  if (!storage.has(name)) storage.set(name, new Map())
  const entries = storage.get(name)
  return {
    async keys() { return [...entries.keys()].map(url => new Request(url)) },
    async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone() },
    async put(request, response) { entries.set(typeof request === 'string' ? request : request.url, response.clone()) },
    async delete(request) { return entries.delete(typeof request === 'string' ? request : request.url) },
  }
}
const caches = {
  async open(name) { return openCache(name) },
  async keys() { return [...storage.keys()] },
  async delete(name) { deletedCaches.push(name); return storage.delete(name) },
  async match(request) {
    for (const entries of storage.values()) if (entries.has(request.url)) return entries.get(request.url).clone()
  },
}
const self = {
  location: { origin },
  clients: {
    async matchAll() { return [...clients.values()] },
    async get(id) { return clients.get(id) },
  },
  addEventListener(type, handler) { listeners.set(type, handler) },
}
const context = vm.createContext({ self, caches, URL, Request, Response, Promise, Set,
  fetch: async request => {
    networkRequests.push(request.url)
    return new Response('network', { headers: { 'Content-Type': 'text/javascript' } })
  },
})
vm.runInContext(readFileSync('public/sw-assets.js', 'utf8'), context, { filename: 'public/sw-assets.js' })

async function dispatchFetch(url, method = 'GET') {
  let responded = false
  let responsePromise
  listeners.get('fetch')({
    request: new Request(url, { method }),
    respondWith(value) { responded = true; responsePromise = value },
  })
  return { responded, response: responded ? await responsePromise : null }
}
async function dispatchLifecycle(type) {
  let work
  listeners.get(type)({ waitUntil(value) { work = value } })
  await work
}
async function report(id, buildVersion) {
  let work
  listeners.get('message')({
    data: { type: 'TALLY_CLIENT_BUILD', buildVersion }, source: { id },
    waitUntil(value) { work = value },
  })
  if (work) await work
}
function buildNames() { return [...storage.keys()].filter(name => name.includes('-precache-')) }

const assets = await caches.open('workbox-runtime-assets')
const js = `${origin}/assets/vendor.react-a1b2c3d4.js`
const css = `${origin}/assets/app-a1b2c3.css`
await assets.put(js, new Response('cached-js', { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }))
await assets.put(css, new Response('cached-css', { headers: { 'Content-Type': 'text/css' } }))
assert.equal(await (await dispatchFetch(js)).response.text(), 'cached-js', 'dotted hashed JS must be served from cache')
assert.equal(await (await dispatchFetch(css)).response.text(), 'cached-css', 'hashed CSS must be served from cache')
assert.equal(networkRequests.length, 0)

for (const [url, method] of [
  [`${origin}/api/orders`, 'GET'],
  [`${origin}/index.html`, 'GET'],
  [`${origin}/assets/unhashed.js`, 'GET'],
  [`${origin}/assets/app-a1b2c3.js`, 'POST'],
  ['https://other.test/assets/app-a1b2c3.js', 'GET'],
]) assert.equal((await dispatchFetch(url, method)).responded, false, `${method} ${url} must not be intercepted`)

await assets.put(js, new Response('bad-cache', { headers: { 'Content-Type': 'text/html' } }))
assert.equal(await (await dispatchFetch(js)).response.text(), 'network', 'wrong cached MIME must use network')
assert.deepEqual(networkRequests, [js])

for (let index = 1; index <= 8; index++) await caches.open(`tallystore-b${String(index).padStart(2, '0')}-precache-assets`)
clients.set('old-tab', { id: 'old-tab', url: `${origin}/orders` })
clients.set('unreported-tab', { id: 'unreported-tab', url: `${origin}/` })
await report('old-tab', 'b01')
assert.equal(buildNames().length, 8, 'unreported live tab must defer all purging')
await report('unreported-tab', 'b08')
assert.deepEqual(buildNames(), [
  'tallystore-b01-precache-assets',
  ...[4, 5, 6, 7, 8].map(index => `tallystore-b${String(index).padStart(2, '0')}-precache-assets`),
], 'retain five latest plus the active old build')

clients.delete('old-tab')
await dispatchLifecycle('activate')
assert.deepEqual(buildNames(), [4, 5, 6, 7, 8].map(index =>
  `tallystore-b${String(index).padStart(2, '0')}-precache-assets`),
  'closing old tab permits its old build to be purged')
const reports = await caches.open('tallystore-client-builds-v1')
assert.deepEqual((await reports.keys()).map(request => new URL(request.url).pathname),
  ['/__tally_build_report__/unreported-tab'], 'closed client report must be removed')
assert.ok(deletedCaches.includes('tallystore-b01-precache-assets'))
console.log('Service worker asset interception, MIME checks, and old-build cache cleanup passed.')
