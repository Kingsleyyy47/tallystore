import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const source = readFileSync(join(root, 'src/lib/customerApi.ts'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replaceAll('import.meta.env.', 'fixtureEnv.')
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText

function requestFixture({ session, fetchImpl }) {
  const callbacks = new Map()
  let nextTimer = 0
  const exports = {}
  vm.runInNewContext(code, { exports, supabase: { auth: { getSession: session } },
    fetch: fetchImpl, fixtureEnv: { VITE_SUPABASE_URL: 'https://source.example.com', VITE_SUPABASE_ANON_KEY: 'public-anon-key' },
    AbortController, Response, Error, Promise,
    setTimeout: callback => { const id = ++nextTimer; callbacks.set(id, callback); return id },
    clearTimeout: id => callbacks.delete(id),
  })
  return { request: exports.customerApiRequest, expire() {
    assert.equal(callbacks.size, 1, 'one total request deadline should be active')
    const callback = [...callbacks.values()][0]
    callback()
  }, timers: callbacks }
}

const session = async () => ({ data: { session: { access_token: 'PRIVATE_JWT_TOKEN' } }, error: null })
let sent
let fixture = requestFixture({ session, fetchImpl: async (_url, options) => {
  sent = options
  return new Response(JSON.stringify({ success: true, data: { keys: [] } }), { status: 200 })
} })
assert.deepEqual(await fixture.request('/v1/keys'), { keys: [] })
assert.equal(sent.headers.Authorization, 'Bearer PRIVATE_JWT_TOKEN')
assert.equal(sent.signal.aborted, false)
assert.equal(fixture.timers.size, 0)

let fetchStarted
const started = new Promise(resolve => { fetchStarted = resolve })
fixture = requestFixture({ session, fetchImpl: async (_url, options) => {
  sent = options
  fetchStarted()
  return new Promise(() => {})
} })
let pending = fixture.request('/v1/keys')
await started
fixture.expire()
await assert.rejects(pending, /timed out/)
assert.equal(sent.signal.aborted, true)
assert.equal(fixture.timers.size, 0)

let resolveSession
fixture = requestFixture({ session: () => new Promise(resolve => { resolveSession = resolve }),
  fetchImpl: () => { throw new Error('fetch must not start after session deadline') } })
pending = fixture.request('/v1/keys')
fixture.expire()
await assert.rejects(pending, /timed out/)
resolveSession({ data: { session: { access_token: 'PRIVATE_LATE_TOKEN' } }, error: null })
await Promise.resolve()

let fetchCalls = 0
fixture = requestFixture({ session: () => new Promise(resolve => { resolveSession = resolve }),
  fetchImpl: () => { fetchCalls++; throw new Error('cross-account fetch') } })
pending = fixture.request('/v1/keys', 'POST', { section: 'airtime' },
  { expectedUserId: '10000000-0000-4000-8000-000000000001' })
resolveSession({ data: { session: { access_token: 'PRIVATE_OTHER_ACCOUNT_TOKEN',
  user: { id: '10000000-0000-4000-8000-000000000002' } } }, error: null })
await assert.rejects(pending, /Sign in to manage your API keys/)
assert.equal(fetchCalls, 0)

const abort = new AbortController()
fixture = requestFixture({ session: () => new Promise(resolve => { resolveSession = resolve }),
  fetchImpl: () => { fetchCalls++; throw new Error('unmounted fetch') } })
pending = fixture.request('/v1/keys', 'POST', { section: 'airtime' },
  { expectedUserId: '10000000-0000-4000-8000-000000000001', signal: abort.signal })
abort.abort()
await assert.rejects(pending, /unavailable/)
resolveSession({ data: { session: { access_token: 'PRIVATE_LATE_TOKEN',
  user: { id: '10000000-0000-4000-8000-000000000001' } } }, error: null })
await Promise.resolve()
assert.equal(fetchCalls, 0)

for (const fetchImpl of [
  async () => { throw new Error('PRIVATE_JWT_TOKEN tlyc_airtime_PRIVATE_KEY') },
  async () => new Response(JSON.stringify({ success: false, code: 'tlyc_airtime_PRIVATE_KEY' }), { status: 503 }),
]) {
  fixture = requestFixture({ session, fetchImpl })
  await assert.rejects(fixture.request('/v1/keys'), error => {
    assert.equal(error.message, 'The API request is unavailable. Please try again.')
    return true
  })
  assert.equal(fixture.timers.size, 0)
}

const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import CustomerApiPage from '@/pages/CustomerApiPage';
const first = '10000000-0000-4000-8000-000000000001';
window.fixture = { userId:first, pending:[], calls:[], setUser(id){this.userId=id;dispatchEvent(new Event('fixture-user'))},
  resolve(value){this.pending.shift()?.resolve(value)}, reject(message){this.pending.shift()?.reject(new Error(message))} };
createRoot(document.getElementById('root')).render(<CustomerApiPage/>);
`
const mocks = {
  '@/components/NavbarAuth': 'export default function Navbar(){return <header>TallyStore</header>}',
  '@/components/Footer': 'export default function Footer(){return <footer>Footer</footer>}',
  '@/components/ui/button': 'export function Button(props){return <button {...props}/>}',
  '@/contexts/SimpleAuth': `import {useEffect,useState} from 'react';
    export function useAuth(){const [,refresh]=useState(0);useEffect(()=>{const listener=()=>refresh(n=>n+1);
    addEventListener('fixture-user',listener);return()=>removeEventListener('fixture-user',listener)},[]);
    return {user:{id:window.fixture.userId}}}`,
  '@/lib/customerApi': `export function customerApiRequest(path,method='GET',input){const fixture=window.fixture;
    fixture.calls.push({path,method,input,userId:fixture.userId});
    return new Promise((resolve,reject)=>fixture.pending.push({resolve,reject}))}`,
  'react-router-dom': 'export function Link(props){return <a href={props.to}>{props.children}</a>}',
}
const bundled = await build({ stdin: { contents: harness, resolveDir: root, sourcefile: 'customer-api-fixture.tsx', loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  alias: { '@': join(root, 'src') }, plugins: [{ name: 'mock-customer-api', setup(plugin) {
    plugin.onResolve({ filter: /^(@\/|react-router-dom$)/ }, args =>
      Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture-mock' } : undefined)
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-mock' }, args =>
      ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})
const bundle = bundled.outputFiles[0].contents
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(bundle) }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<div id="root"></div><script src="/bundle.js"></script>') }
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath: edge, headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.getByText('Loading…').waitFor()
  await page.evaluate(() => window.fixture.reject('PRIVATE_JWT_TOKEN tlyc_airtime_PRIVATE_KEY'))
  await page.getByRole('button', { name: 'Retry' }).waitFor()
  assert.match(await page.locator('body').innerText(), /Unable to load your keys/)
  assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_JWT_TOKEN|PRIVATE_KEY/)
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.evaluate(() => window.fixture.resolve({ access: { allowed_sections: ['airtime'], is_active: true }, keys: [] }))
  await page.getByRole('option', { name: 'International Airtime' }).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('button', { name: 'Retry' }).count(), 0)
  await page.getByPlaceholder('My integration').fill('Mobile integration')
  await page.getByRole('button', { name: 'Create key' }).click()
  await page.evaluate(() => window.fixture.resolve({ api_key: 'tlyc_airtime_ONE_TIME_SECRET' }))
  await page.getByText('tlyc_airtime_ONE_TIME_SECRET').waitFor()
  await page.evaluate(() => window.fixture.resolve({ access: { allowed_sections: ['airtime'], is_active: true }, keys: [] }))
  await page.getByRole('button', { name: 'Close key' }).click()
  assert.equal(await page.getByText('tlyc_airtime_ONE_TIME_SECRET').count(), 0)
  await page.getByPlaceholder('My integration').fill('Second key')
  await page.getByRole('button', { name: 'Create key' }).click()
  await page.evaluate(() => window.fixture.resolve({ api_key: 'tlyc_airtime_SWITCH_SECRET' }))
  await page.getByText('tlyc_airtime_SWITCH_SECRET').waitFor()
  await page.evaluate(() => window.fixture.resolve({ access: { allowed_sections: ['airtime'], is_active: true }, keys: [] }))
  await page.getByText('No keys created yet.').waitFor()
  await page.evaluate(() => window.fixture.setUser('10000000-0000-4000-8000-000000000002'))
  await page.getByText('Loading…').waitFor()
  assert.equal(await page.getByText('tlyc_airtime_SWITCH_SECRET').count(), 0)
  await page.evaluate(() => window.fixture.resolve({ access: { allowed_sections: ['products'], is_active: true }, keys: [] }))
  await page.getByRole('option', { name: 'Products' }).waitFor({ state: 'attached' })
  await browser.close()
} finally {
  if (browser?.isConnected()) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
console.log('Customer API request deadline/redaction and browser failed-load Retry/one-time-key account switch passed.')
