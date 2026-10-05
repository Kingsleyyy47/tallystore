import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = require('playwright')
const temp = await mkdtemp(join(tmpdir(), 'tally-support-hook-'))
const bundlePath = join(temp, 'bundle.js')

await build({
  stdin: {
    contents: `import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useSupportSettings, invalidateSupportSettingsCache } from ${JSON.stringify(join(root, 'src/hooks/useSupportSettings.ts'))};
      import LoginWelcomeDialog from ${JSON.stringify(join(root, 'src/components/LoginWelcomeDialog.tsx'))};
      window.__support = { requests: [], calls: 0, aborted: 0, invalidate: invalidateSupportSettingsCache };
      function Probe() {
        const [key, setKey] = useState('first-user');
        window.__support.setKey = setKey;
        const state = useSupportSettings(key);
        return <pre id="state">{JSON.stringify(state)}</pre>;
      }
      function App() {
        const [showWelcome, setWelcome] = useState(false);
        window.__support.setWelcome = setWelcome;
        return <><Probe/>{showWelcome && <LoginWelcomeDialog/>}</>;
      }
      let reactRoot;
      window.__support.mount = () => { reactRoot = createRoot(document.getElementById('app')); reactRoot.render(<App/>); };
      window.__support.unmount = () => { reactRoot.unmount(); reactRoot = undefined; };
      window.__support.mount();`,
    resolveDir: root,
    sourcefile: 'support-hook-test.tsx',
    loader: 'tsx',
  },
  absWorkingDir: root,
  bundle: true,
  outfile: bundlePath,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  plugins: [{ name: 'mock-settings-read', setup(plugin) {
    plugin.onResolve({ filter: /^@\/contexts\/SimpleAuth$/ }, () => ({ path: 'auth', namespace: 'mock' }))
    plugin.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }))
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
      loader: 'js',
      contents: args.path === 'auth'
        ? `export function useAuth() { return { user: { id: 'synthetic-customer' }, loading: false, roleLookupError: null, isAdmin: false, isStaff: false }; }`
        : `export const supabase = { from(table) {
        if (table !== 'app_settings') throw Error('Unexpected table');
        return { select() { return { in() { return { abortSignal(signal) {
          window.__support.calls++;
          return new Promise((resolve, reject) => {
            const request = { resolve, reject };
            window.__support.requests.push(request);
            signal.addEventListener('abort', () => { window.__support.aborted++; reject(Error('Aborted')); }, { once: true });
          });
        } } } } } };
      } };`,
    }))
  } }],
})

const bundle = await readFile(bundlePath)
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(bundle)
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>')
  }
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const origin = `http://127.0.0.1:${server.address().port}`
let browser

async function state(page) {
  return page.locator('#state').evaluate(element => JSON.parse(element.textContent))
}
async function loaded(page) {
  await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).loading === false)
  return state(page)
}
async function freshPage() {
  const page = await browser.newPage()
  page.on('pageerror', error => process.stderr.write(`Browser fixture error: ${error.message}\n`))
  await page.goto(origin)
  await page.waitForFunction(() => window.__support?.requests.length === 1)
  return page
}

try {
  browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

  let page = await freshPage()
  await page.evaluate(() => window.__support.requests[0].resolve({ data: [{ key: 'support_popup_message', value: 'Saved announcement' }], error: null }))
  assert.equal((await loaded(page)).popupMessage, 'Saved announcement')
  await page.evaluate(() => { window.__support.unmount(); window.__support.mount() })
  await page.waitForFunction(() => document.querySelector('#state'))
  assert.equal(await page.evaluate(() => window.__support.calls), 1, 'Successful read should be cached')
  await page.close()

  for (const failure of ['error', 'reject', 'invalid']) {
    page = await freshPage()
    await page.evaluate(kind => {
      const request = window.__support.requests[0]
      if (kind === 'error') request.resolve({ data: null, error: { code: 'unavailable' } })
      else if (kind === 'reject') request.reject(Error('Offline'))
      else request.resolve({ data: { unexpected: true }, error: null })
    }, failure)
    const fallback = await loaded(page)
    assert.match(fallback.popupMessage, /Stay updated/)
    await page.evaluate(() => { window.__support.unmount(); window.__support.mount() })
    await page.waitForFunction(() => window.__support.calls === 2)
    await page.close()
  }

  page = await freshPage()
  await page.evaluate(() => window.__support.setWelcome(true))
  await page.waitForFunction(() => window.__support.calls === 2)
  const started = Date.now()
  const timedOut = await loaded(page)
  assert.match(timedOut.popupMessage, /Stay updated/)
  assert.ok(Date.now() - started >= 5500 && Date.now() - started < 10000, 'Hung read should have a bounded deadline')
  assert.equal(await page.evaluate(() => window.__support.aborted), 2, 'Deadline should abort both mounted requests')
  await page.getByRole('dialog', { name: 'Store announcement' }).waitFor({ timeout: 3000 })
  await page.close()

  page = await freshPage()
  await page.evaluate(() => {
    window.__support.unmount()
    window.__support.requests[0].resolve({ data: [{ key: 'support_popup_message', value: 'Stale unmounted' }], error: null })
  })
  assert.equal(await page.evaluate(() => window.__support.aborted), 1, 'Unmount should abort the request')
  await page.waitForTimeout(50)
  await page.evaluate(() => window.__support.mount())
  await page.waitForFunction(() => window.__support.calls === 2)
  await page.evaluate(() => window.__support.requests[1].resolve({ data: [{ key: 'support_popup_message', value: 'Current after mount' }], error: null }))
  assert.equal((await loaded(page)).popupMessage, 'Current after mount')
  await page.close()

  page = await freshPage()
  await page.evaluate(() => {
    window.__support.invalidate()
    window.__support.requests[0].resolve({ data: [{ key: 'support_popup_message', value: 'Stale before save' }], error: null })
  })
  await page.waitForFunction(() => window.__support.calls === 2)
  assert.notEqual((await state(page)).popupMessage, 'Stale before save', 'Invalidated result must not show in mounted hook')
  await page.evaluate(() => window.__support.requests[1].resolve({ data: [{ key: 'support_popup_message', value: 'Saved after invalidation' }], error: null }))
  assert.equal((await loaded(page)).popupMessage, 'Saved after invalidation')
  await page.close()

  page = await freshPage()
  await page.evaluate(() => window.__support.requests[0].resolve({ data: [{ key: 'support_popup_message', value: 'Before login change' }], error: null }))
  assert.equal((await loaded(page)).popupMessage, 'Before login change')
  await page.evaluate(() => {
    const originalNow = Date.now
    Date.now = () => originalNow() + 6 * 60 * 1000
    window.__support.setKey('second-user')
  })
  await page.waitForFunction(() => window.__support.calls === 2)
  await page.evaluate(() => window.__support.requests[1].resolve({ data: [{ key: 'support_popup_message', value: 'After login change' }], error: null }))
  assert.equal((await loaded(page)).popupMessage, 'After login change')
  await page.close()

  process.stdout.write('Support settings hook browser tests passed.\n')
} finally {
  await browser?.close()
  await new Promise(resolveClose => server.close(resolveClose))
  await rm(temp, { recursive: true, force: true })
}
