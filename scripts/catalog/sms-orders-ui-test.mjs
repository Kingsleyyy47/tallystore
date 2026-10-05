// Real SMS page in one local browser, with synthetic account data and mocked server reads.
// No authentication, Supabase project, supplier, or paid endpoint is reachable.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'tally-sms-orders-test-'))
const bundlePath = join(temporary, 'bundle.js')
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')

const mocks = {
  '@/contexts/SimpleAuth': `
    import { useSyncExternalStore } from 'react';
    function subscribe(listener) { addEventListener('fixture-user-changed', listener); return () => removeEventListener('fixture-user-changed', listener) }
    function getSnapshot() { return window.__smsFixture.userId }
    export function useAuth() { const userId = useSyncExternalStore(subscribe, getSnapshot);
      return { user: { id: userId }, isStaff: false, isAdmin: false, walletBalance: 5000,
        walletLoading: false, walletBalanceUnavailable: false, refreshWalletBalance: async () => {},
        showBalances: true, toggleBalanceVisibility: () => {} } }
  `,
  '@/lib/supabase': `
    const mode = new URLSearchParams(location.search).get('case');
    const fixture = () => window.__smsFixture;
    function ownedOrder(actor) { return { id: 'owned-' + actor, reference: 'test-' + actor,
      order_type: 'otp', service_name: actor + ' owned SMS', phone_number: null,
      price_ngn: 200, status: 'completed', messages: [], created_at: '2026-10-01T12:00:00Z' } }
    export const supabase = { functions: { invoke: async (_name, options) => {
      const action = options.body.action;
      const actor = fixture().userId;
      const count = (fixture().counts[action] || 0) + 1;
      fixture().counts[action] = count;
      fixture().calls.push({ action, actor });
      if (!['health', 'orders', 'services', 'rental_areas', 'sync_cancelled'].includes(action))
        throw new Error('Fixture blocked a paid or mutating action: ' + action);
      if (action === 'health') return mode === 'health_pending'
        ? new Promise(() => {}) : { data: { success: true, configured: true, valid: true }, error: null };
      if (action === 'services' || action === 'rental_areas') return mode === 'catalog_pending'
        ? new Promise(() => {}) : { data: { success: true, data: [] }, error: null };
      if (action === 'sync_cancelled') return { data: { success: true }, error: null };
      if (mode === 'orders_fail_retry' && count === 1 || mode === 'refresh_fail' && count === 2)
        return { data: null, error: { message: 'Synthetic order read failure' } };
      if (mode === 'switch_user' && actor === 'old-customer') return new Promise(resolve => { fixture().resolveOld = resolve });
      return { data: { success: true, data: [ownedOrder(actor)] }, error: null };
    } } };
  `,
  '@/hooks/useSupportSettings': `export function useSupportSettings() { return { whatsappUrl: null, telegramUrl: null } }`,
  '@/lib/staffPurchaseGuard': `export function blockStaffPurchase() { return false }`,
  '@/lib/revenue-os': `export function getRevenueRequestContext() { return {} }; export function getRevenueVisitorId() { return 'synthetic-visitor' }; export function trackRevenueEvent() {}`,
  '@/hooks/useRecommendations': `export function useRecommendations() { return { recommendations: [] } }`,
  '@/components/RecommendationCard': `export function RecommendationStrip() { return null }`,
  '@/components/TopUpWallet': `export function TopUpWallet() { return null }`,
  '@/components/NavbarAuth': `export default function NavbarAuth() { return null }`,
}

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import SmsNumbersPage from ${JSON.stringify(join(root, 'src/pages/SmsNumbersPage.tsx'))};
  const mode = new URLSearchParams(location.search).get('case');
  window.__smsFixture = { userId: mode === 'switch_user' ? 'old-customer' : 'synthetic-customer',
    calls: [], counts: {}, resolveOld: null };
  createRoot(document.getElementById('app')!).render(<BrowserRouter><SmsNumbersPage /></BrowserRouter>);
`

await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'sms-orders-test-entry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: bundlePath,
  jsx: 'automatic', absWorkingDir: root,
  plugins: [{ name: 'mock-services', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, args => {
      if (mocks[args.path]) return { path: args.path, namespace: 'mock-services' }
      const base = join(root, 'src', args.path.slice(2))
      return { path: existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts` }
    })
    plugin.onLoad({ filter: /.*/, namespace: 'mock-services' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})

const bundle = await readFile(bundlePath)
const server = createServer((request, response) => {
  if (request.url?.startsWith('/bundle.js')) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(bundle)
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch({ executablePath: edge, headless: true, timeout: 60000 })
  const context = await browser.newContext()
  context.setDefaultTimeout(30000)
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const load = async testCase => {
    await page.goto(`${origin}/sms?case=${testCase}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'My numbers' }).click()
  }
  const order = actor => page.getByRole('heading', { name: `${actor} owned SMS` })
  const calls = () => page.evaluate(() => window.__smsFixture.calls)

  await load('health_pending')
  await order('synthetic-customer').waitFor()
  assert.equal((await calls()).some(call => call.action === 'health'), true)
  assert.equal(await page.getByText('No SMS numbers yet').count(), 0)
  await page.getByRole('alert').filter({ hasText: 'SMS request timed out' }).waitFor({ timeout: 15000 })
  assert.equal(await order('synthetic-customer').count(), 1)
  process.stdout.write('SMS fixture: orders visible during pending provider health\n')

  await load('catalog_pending')
  await order('synthetic-customer').waitFor()
  assert.equal((await calls()).some(call => call.action === 'services'), true)
  assert.equal((await calls()).some(call => call.action === 'rental_areas'), true)
  await page.getByRole('alert').filter({ hasText: 'Some live SMS stock could not be loaded' }).waitFor({ timeout: 15000 })
  assert.equal(await order('synthetic-customer').count(), 1)
  process.stdout.write('SMS fixture: orders visible during pending service and area reads\n')

  await load('orders_fail_retry')
  await page.getByRole('alert').filter({ hasText: 'SMS order history could not be verified' }).waitFor()
  assert.equal(await page.getByText('No SMS numbers yet').count(), 0, 'Read failure appeared as empty history')
  await page.getByRole('button', { name: 'Retry orders' }).click()
  await order('synthetic-customer').waitFor()
  process.stdout.write('SMS fixture: initial history failure recovered by Retry\n')

  await load('refresh_fail')
  await order('synthetic-customer').waitFor()
  await page.getByRole('button', { name: 'Refresh' }).last().click()
  await page.getByRole('alert').filter({ hasText: 'SMS order history could not be verified' }).waitFor()
  assert.equal(await order('synthetic-customer').count(), 1, 'Refresh failure hid existing orders')
  process.stdout.write('SMS fixture: refresh failure retained existing orders\n')

  await load('switch_user')
  await page.waitForFunction(() => typeof window.__smsFixture.resolveOld === 'function')
  await page.evaluate(() => { window.__smsFixture.userId = 'new-customer'; dispatchEvent(new Event('fixture-user-changed')) })
  await page.getByRole('button', { name: 'My numbers' }).click()
  await order('new-customer').waitFor()
  await page.evaluate(() => window.__smsFixture.resolveOld({ data: { success: true, data: [{
    id: 'old-order', reference: 'old-reference', order_type: 'otp', service_name: 'old-customer owned SMS',
    phone_number: null, price_ngn: 200, status: 'completed', messages: [], created_at: '2026-10-01T12:00:00Z',
  }] }, error: null }))
  await page.waitForTimeout(100)
  assert.equal(await order('old-customer').count(), 0, 'Previous account order leaked after account change')
  assert.deepEqual(errors, [], 'SMS component raised an error')
  process.stdout.write('SMS owned-orders component browser tests passed.\n')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
