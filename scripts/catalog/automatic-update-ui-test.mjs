// Local two-deployment service-worker lifecycle test. No production services are contacted.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'tally-update-lifecycle-'))
const bundlePath = join(temporary, 'fixture.js')
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const gatePath = join(root, 'src/lib/automaticUpdateSafety.ts')
const workerAssets = await readFile(join(root, 'public/sw-assets.js'))
const generatedWorker = await readFile(join(root, 'dist/sw.js'), 'utf8')
const workboxName = generatedWorker.match(/\.\/(workbox-[A-Za-z0-9_-]+)"/)?.[1]
assert.ok(workboxName, 'Generated worker did not import a Workbox runtime')
const workboxRuntime = await readFile(join(root, `dist/${workboxName}.js`))
const minimalManifest = '[{url:"index.html",revision:"fixture"},{url:"assets/Lazy.old-abc123.js",revision:null}]'
const actualWorker = generatedWorker.replace(/s\.precacheAndRoute\(\[.*?\],\{\}\)/, `s.precacheAndRoute(${minimalManifest},{})`)
assert.notEqual(actualWorker, generatedWorker, 'Could not narrow generated precache manifest for local worker test')
const instrumentedActualWorker = `self.addEventListener('error', event => {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) client.postMessage({ type: 'FIXTURE_WORKER_ERROR', message: event.message });
  });
});\n${actualWorker}`
const registerSource = await readFile(join(root, 'node_modules/vite-plugin-pwa/dist/client/build/register.js'), 'utf8')
const viteConfig = await readFile(join(root, 'vite.config.ts'), 'utf8')
assert.match(viteConfig, /registerType:\s*'autoUpdate'/)
assert.match(viteConfig, /skipWaiting:\s*true/)
assert.match(viteConfig, /clientsClaim:\s*true/)
assert.match(viteConfig, /importScripts:\s*\['\/sw-assets\.js'\]/)

const actualRegister = registerSource
  .replaceAll('"__SW_AUTO_UPDATE__"', '"true"')
  .replaceAll('"__SW_SELF_DESTROYING__"', '"false"')
  .replaceAll('"__SW__"', '"/sw.js"')
  .replaceAll('"__SCOPE__"', '"/"')
  .replaceAll('"__TYPE__"', '"classic"')
assert.equal(actualRegister.includes('__SW__'), false)

const entry = `
  import { registerSW } from 'virtual:pwa-register';
  import { createAutomaticReloadGate } from ${JSON.stringify(gatePath)};
  const count = name => Number(sessionStorage.getItem(name) || '0');
  const gate = createAutomaticReloadGate({ buildVersion: document.documentElement.dataset.build,
    quietMilliseconds: 150, reload: () => {
      sessionStorage.setItem('reloads', String(count('reloads') + 1));
      location.reload();
    } });
  registerSW({ immediate: true,
    onNeedReload: () => { sessionStorage.setItem('needs', String(count('needs') + 1)); gate(); },
    onRegisteredSW: (_url, registration) => { window.__registration = registration; },
    onRegisterError: error => { window.__registerError = String(error); },
  });
`
await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'automatic-update-fixture.ts', loader: 'ts' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: bundlePath, absWorkingDir: root,
  plugins: [{ name: 'actual-pwa-registration', setup(plugin) {
    plugin.onResolve({ filter: /^virtual:pwa-register$/ }, () => ({ path: 'actual-register', namespace: 'actual-register' }))
    plugin.onLoad({ filter: /.*/, namespace: 'actual-register' }, () => ({ contents: actualRegister, loader: 'js', resolveDir: root }))
  } }],
})

const bundle = await readFile(bundlePath)
let workerVersion = 'v1'
let workerMode = 'fixture'
let privateReads = 0
const worker = version => `
  importScripts('/sw-assets.js');
  const version = ${JSON.stringify(version)};
  self.addEventListener('install', event => event.waitUntil((async () => {
    const cache = await caches.open('tallystore-' + version + '-precache-fixture');
    await cache.put(new Request(new URL('/assets/Lazy.old-abc123.js', self.location.origin)),
      new Response('export const oldBuild = true;', { status: 200, headers: { 'Content-Type': 'text/javascript' } }));
    await self.skipWaiting();
  })()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
`
const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost')
  if (url.pathname === '/fixture.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' })
    response.end(bundle)
  } else if (url.pathname === '/sw.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' })
    response.end(workerMode === 'actual' ? instrumentedActualWorker : worker(workerVersion))
  } else if (url.pathname === `/${workboxName}.js`) {
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' })
    response.end(workboxRuntime)
  } else if (url.pathname === '/sw-assets.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' })
    response.end(workerAssets)
  } else if (url.pathname === '/assets/Lazy.old-abc123.js') {
    response.writeHead(workerVersion === 'v1' ? 200 : 404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
    response.end(workerVersion === 'v1' ? 'export const oldBuild = true;' : 'Gone from new deployment')
  } else if (url.pathname === '/api/private') {
    privateReads += 1
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    response.end(`private-read-${privateReads}`)
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><html data-build="${workerVersion}"><body><input id="unsaved" aria-label="Unsaved form"><script src="/fixture.js"></script></body></html>`)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch({ executablePath: edge, headless: true, timeout: 60000 })
  async function scenario(path, prepare, verifyBlocked) {
    workerVersion = 'v1'
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    context.setDefaultTimeout(20000)
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__registration && !!navigator.serviceWorker.controller)
    await page.waitForFunction(async () => {
      const reports = await caches.open('tallystore-client-builds-v1')
      return (await reports.keys()).length > 0
    })
    if (prepare) await prepare(page)
    workerVersion = 'v2'
    await page.evaluate(() => window.__registration.update())
    await page.waitForFunction(() => Number(sessionStorage.getItem('needs') || 0) >= 1)
    if (verifyBlocked) await verifyBlocked(page)
    await page.waitForFunction(() => Number(sessionStorage.getItem('reloads') || 0) === 1)
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('reloads') || 0)), 1, 'Update reloaded more than once')
    assert.deepEqual(errors, [], 'Browser update lifecycle error')
    await context.close()
  }

  await scenario('/products', null, null)
  process.stdout.write('Auto-update fixture: safe page replaced once\n')

  await scenario('/checkout', null, async page => {
    await page.waitForTimeout(450)
    assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('reloads') || 0)), 0, 'Checkout reloaded mid-purchase')
    const asset = await page.evaluate(async () => {
      const response = await fetch('/assets/Lazy.old-abc123.js')
      return { status: response.status, text: await response.text() }
    })
    assert.equal(asset.status, 200, 'Old lazy chunk became unavailable during deferred update')
    assert.match(asset.text, /oldBuild = true/)
    const privateValues = await page.evaluate(async () => [
      await (await fetch('/api/private')).text(), await (await fetch('/api/private')).text(),
    ])
    assert.notEqual(privateValues[0], privateValues[1], 'Private reads were cached by public asset worker')
    assert.equal(await page.evaluate(async () => caches.match('/api/private').then(Boolean)), false)
    await page.evaluate(() => history.pushState({}, '', '/products'))
  })
  process.stdout.write('Auto-update fixture: checkout deferred; old lazy asset and private reads stayed valid\n')

  await scenario('/products', page => page.getByRole('textbox', { name: 'Unsaved form' }).fill('draft'), async page => {
    await page.waitForTimeout(450)
    assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('reloads') || 0)), 0, 'Unsaved form was reloaded')
    await page.getByRole('textbox', { name: 'Unsaved form' }).fill('')
  })
  workerMode = 'actual'
  workerVersion = 'v1'
  const actualContext = await browser.newContext({ serviceWorkers: 'allow' })
  actualContext.setDefaultTimeout(20000)
  await actualContext.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  await actualContext.addInitScript(() => {
    window.__workerErrors = []
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'FIXTURE_WORKER_ERROR') window.__workerErrors.push(event.data.message)
    })
  })
  const actualPage = await actualContext.newPage()
  const actualErrors = []
  actualContext.on('console', message => { if (message.type() === 'error') actualErrors.push(message.text()) })
  actualPage.on('pageerror', error => actualErrors.push(error.message))
  await actualPage.goto(origin + '/products', { waitUntil: 'domcontentloaded' })
  await actualPage.waitForFunction(() => !!navigator.serviceWorker.controller)
  workerVersion = 'v2'
  const generatedAsset = await actualPage.evaluate(async () => {
    const response = await fetch('/assets/Lazy.old-abc123.js')
    return { status: response.status, text: await response.text() }
  })
  assert.equal(generatedAsset.status, 200, 'Actual generated Workbox worker did not serve cached asset')
  assert.match(generatedAsset.text, /oldBuild = true/)
  const actualPrivate = await actualPage.evaluate(async () => [
    await (await fetch('/api/private')).text(), await (await fetch('/api/private')).text(),
  ])
  assert.notEqual(actualPrivate[0], actualPrivate[1], 'Generated worker cached a private read')
  assert.equal(await actualPage.evaluate(async () => caches.match('/api/private').then(Boolean)), false)
  await actualPage.waitForTimeout(200)
  actualErrors.push(...await actualPage.evaluate(() => window.__workerErrors))
  assert.equal(actualErrors.length, 0, `Actual generated worker reported errors: ${actualErrors.join(' | ')}`)
  await actualContext.close()
  process.stdout.write('Automatic update lifecycle browser tests passed (single reload, checkout/form deferral, old chunk and private request behavior).\n')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
