// Render the real checkout component with synthetic data and mocked server calls.
// This harness cannot contact Supabase or a payment provider.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'tally-checkout-recovery-test-'))
const bundlePath = join(temporary, 'bundle.js')
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')

const mocks = {
  '@/contexts/SimpleAuth': `
    const user = { id: 'synthetic-customer', email: 'synthetic@example.invalid' };
    const refreshWalletBalance = async () => new Promise(() => {});
    export function useAuth() { return { user, walletBalance: 10000, walletLoading: false,
      walletBalanceUnavailable: false, refreshWalletBalance, showBalances: true,
      isStaff: false, isAdmin: false } }
  `,
  '@/contexts/CurrencyContext': `export function useCurrency() { return { formatPrice: (value) => 'NGN ' + Number(value).toFixed(2) } }`,
  '@/hooks/use-toast': `const toast = () => {}; export function useToast() { return { toast } }`,
  '@/lib/staffPurchaseGuard': `export function blockStaffPurchase() { return false }`,
  '@/lib/revenue-os': `export function getRevenueRequestContext() { return {} }; export function trackRevenueEvent() {}`, 
  '@/lib/productAvailability': `export function canAutoFulfillProduct() { return false }; export function isCustomerSellableProduct(product) { return product?.is_active === true && product?.is_sellable === true && product?.stock_count > 0 }`,
  '@/lib/supabase': `
    const mode = new URLSearchParams(location.search).get('case');
    const product = { id: 'synthetic-product', category_id: 'synthetic-category', name: 'SYNTHETIC CHECKOUT PRODUCT',
      description: 'Synthetic test item', price: 200, stock_count: 5, is_active: true, is_sellable: true,
      availability_status: 'AVAILABLE', quantity_discount_tiers: [] };
    export const DISCOUNTS_ENABLED = false;
    export const supabase = { rpc: async () => mode === 'circle-hung'
      ? new Promise(() => {})
      : mode === 'circle-error'
      ? { data: null, error: { message: 'unavailable' } }
      : { data: { enabled: false, is_member: false, discount_active: false, discount_percent: 0 }, error: null } };
    export async function getProductGroupById() { return product }
    export async function getCategoryById() { return { id: 'synthetic-category', name: 'Synthetic' } }
    export async function getIndividualAccountById() { return null }
    export function computeDiscountedTotal(price, quantity) { return { total: price * quantity, discountPct: 0, originalTotal: price * quantity } }
    export async function previewDiscountCode() { return { valid: false } }
    export async function processPurchaseSecure(...args) {
      window.__checkoutFixture.paidCalls.push({ key: args.at(-1), stored: localStorage.getItem(window.__checkoutFixture.storageKey) });
      if (mode === 'success') return { success: true, order_id: 'synthetic-order', account_details: { accounts: [
        { username: 'synthetic-user', password: 'synthetic-password' },
      ] } };
      return new Promise(() => {});
    }
    export async function getCustomerPurchaseAttemptStatus(...args) {
      window.__checkoutFixture.statusCalls.push(args);
      if (mode === 'completed') return { state: 'completed', order_id: 'synthetic-order', quantity: 1, amount_ngn: 200 };
      if (mode === 'released') return { state: 'released' };
      return { state: 'unknown' };
    }
  `,
  '@/components/NavbarAuth': `export default function NavbarAuth() { return null }`,
  '@/components/CategoryLogo': `export default function CategoryLogo() { return null }`,
  '@/components/ui/back-button': `export function BackToProducts() { return null }`,
  '@/components/ui/button': `import React from 'react'; export function Button({children,asChild,...props}) { if (asChild && React.isValidElement(children)) return React.cloneElement(children, props); return React.createElement('button', props, children) }`,
  '@/components/ui/card': `import React from 'react'; const Box = ({children,...props}) => React.createElement('div',props,children); export const Card = Box; export const CardContent = Box; export const CardHeader = Box; export const CardTitle = Box;`,
  '@/components/ui/badge': `import React from 'react'; export function Badge({children,...props}) { return React.createElement('span',props,children) }`,
  '@/components/ui/alert': `import React from 'react'; const Box = ({children,...props}) => React.createElement('div',props,children); export const Alert = Box; export const AlertDescription = Box;`,
  '@/components/ui/input': `import React from 'react'; export function Input(props) { return React.createElement('input',props) }`,
  '@/components/ui/dialog': `import React from 'react'; const Box = ({children,...props}) => React.createElement('div',props,children); export function Dialog({open,children}) { return open ? React.createElement('div',null,children) : null }; export const DialogContent = Box; export const DialogDescription = Box; export const DialogHeader = Box; export const DialogTitle = Box;`,
  '@/components/ui/collapsible': `import React from 'react'; const Box = ({children,...props}) => React.createElement('div',props,children); export const Collapsible = Box; export const CollapsibleContent = Box; export const CollapsibleTrigger = Box;`,
}

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import CheckoutPage from ${JSON.stringify(join(root, 'src/pages/CheckoutPage.tsx'))};
  const mode = new URLSearchParams(location.search).get('case');
  const storageKey = 'tallystore:pending-purchase:synthetic-customer:synthetic-product';
  window.__checkoutFixture = { paidCalls: [], statusCalls: [], storageKey };
  if (!['deferred', 'success', 'circle-error', 'circle-hung'].includes(mode)) localStorage.setItem(storageKey, JSON.stringify({
    idempotencyKey: 'original-synthetic-key', orderId: 'synthetic-order', quantity: 1, expectedAmountNgn: 200,
  }));
  createRoot(document.getElementById('app')!).render(<BrowserRouter><CheckoutPage /></BrowserRouter>);
`

await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'checkout-recovery-test-entry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: bundlePath,
  jsx: 'automatic', absWorkingDir: root,
  plugins: [{ name: 'mock-services', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, (args) => mocks[args.path]
      ? { path: args.path, namespace: 'mock-services' }
      : { path: join(root, 'src', args.path.slice(2)) })
    plugin.onLoad({ filter: /.*/, namespace: 'mock-services' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

let browser
try {
  browser = await chromium.launch({ executablePath: edge, headless: true, timeout: 60000 })
  process.stdout.write('Checkout recovery: browser ready\n')
  const context = await browser.newContext()
  context.setDefaultTimeout(30000)
  const origin = `http://127.0.0.1:${port}`
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const storageKey = 'tallystore:pending-purchase:synthetic-customer:synthetic-product'
  const saved = () => page.evaluate(key => {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }, storageKey)
  const calls = () => page.evaluate(() => ({ paid: window.__checkoutFixture.paidCalls, status: window.__checkoutFixture.statusCalls }))
  const load = async testCase => {
    await page.goto(`${origin}/checkout?product=synthetic-product&case=${testCase}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('SYNTHETIC CHECKOUT PRODUCT').first().waitFor()
  }

  await load('deferred')
  await page.getByRole('button', { name: 'Buy Now' }).click()
  await page.waitForFunction(() => window.__checkoutFixture.paidCalls.length === 1)
  const dispatched = (await calls()).paid[0]
  const pending = await saved()
  assert.equal(dispatched.key, pending.idempotencyKey, 'Original key was saved before paid call')
  assert.equal(JSON.parse(dispatched.stored).expectedAmountNgn, 200)
  assert.equal(JSON.parse(dispatched.stored).quantity, 1)
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key) !== null, storageKey), true)
  process.stdout.write('Checkout recovery: reference saved before paid dispatch\n')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Order Being Checked' }).waitFor()
  assert.equal((await calls()).paid.length, 0, 'Reload dispatched a second paid call')
  assert.equal((await saved()).idempotencyKey, pending.idempotencyKey)
  await page.getByRole('button', { name: 'Check purchase status' }).last().click()
  await page.waitForFunction(() => window.__checkoutFixture.statusCalls.length === 1)
  await page.getByText(/still unconfirmed/).last().waitFor()
  assert.equal((await saved()).idempotencyKey, pending.idempotencyKey, 'Unknown status cleared original key')
  assert.equal((await calls()).paid.length, 0)
  process.stdout.write('Checkout recovery: reload and unknown status retained original reference\n')

  await load('missing')
  await page.getByRole('button', { name: 'Order Being Checked' }).waitFor()
  await page.getByRole('button', { name: 'Check purchase status' }).last().click()
  await page.waitForFunction(() => window.__checkoutFixture.statusCalls.length === 1)
  await page.getByText(/still unconfirmed/).last().waitFor()
  assert.equal((await saved()).idempotencyKey, 'original-synthetic-key', 'Missing result cleared original key')
  assert.equal((await calls()).paid.length, 0)
  process.stdout.write('Checkout recovery: missing result retained original reference\n')

  await load('completed')
  await page.getByRole('button', { name: 'Check purchase status' }).last().click()
  await page.getByRole('button', { name: 'Purchase Complete' }).waitFor()
  assert.equal(await saved(), null, 'Completed attempt retained pending key')
  assert.equal(await page.getByRole('link', { name: /Purchase confirmed.*order history/ }).count(), 1)
  assert.equal((await calls()).paid.length, 0)

  await load('released')
  await page.getByRole('button', { name: 'Check purchase status' }).last().click()
  await page.getByRole('button', { name: 'Buy Now' }).waitFor()
  assert.equal(await saved(), null, 'Released attempt retained pending key')
  assert.equal((await calls()).paid.length, 0)

  await load('success')
  await page.getByRole('button', { name: 'Buy Now' }).click()
  await page.getByText('synthetic-user').last().waitFor()
  await page.getByText('synthetic-password', { exact: true }).waitFor()
  assert.equal(await page.getByText('USERNAME / ID', { exact: true }).count(), 1)
  assert.equal(await page.getByText('MAIL PASS', { exact: true }).count(), 0, 'Missing mail password acquired a phantom label')
  assert.equal(await saved(), null, 'Successful attempt retained pending key')
  assert.equal((await calls()).paid.length, 1)

  await load('circle-error')
  await page.getByText(/Tally Circle status is unavailable/).waitFor()
  await page.getByRole('button', { name: 'Buy Now' }).click()
  await page.waitForFunction(() => window.__checkoutFixture.paidCalls.length === 1)
  assert.equal(JSON.parse((await calls()).paid[0].stored).expectedAmountNgn, 200,
    'Circle RPC outage must use standard price before server verification')

  await page.evaluate(key => { localStorage.removeItem(key); sessionStorage.removeItem(key) }, storageKey)
  await load('circle-hung')
  await page.getByRole('button', { name: 'Checking Price...' }).waitFor()
  assert.equal((await calls()).paid.length, 0, 'Hung optional status dispatched a purchase while loading')
  await page.getByText(/Tally Circle status is unavailable/).waitFor({ timeout: 12000 })
  await page.getByRole('button', { name: 'Buy Now' }).click()
  await page.waitForFunction(() => window.__checkoutFixture.paidCalls.length === 1)
  assert.equal(JSON.parse((await calls()).paid[0].stored).expectedAmountNgn, 200,
    'Timed-out Circle RPC must use standard price before server verification')
  assert.deepEqual(errors, [], 'Browser component raised an error')
  process.stdout.write('Checkout recovery browser tests passed (pre-dispatch persistence, reload/unknown/missing, completed/released, credentials before wallet refresh).\n')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
