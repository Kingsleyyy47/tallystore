// Render the real checkout component with synthetic data and mocked server calls.
// This harness cannot contact Supabase or a payment provider.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

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
      description: 'Synthetic product instructions. Read the first line before purchase.\\nSecond line: keep your recovery details secure and follow the full setup guide after delivery.', price: 200, stock_count: 5, is_active: true, is_sellable: true,
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
      if (mode === 'visual-single' || mode === 'visual-bulk') return { success: true, order_id: 'synthetic-visual-order', account_details: { accounts: Array.from({ length: mode === 'visual-bulk' ? 3 : 1 }, (_, i) => ({
        username: 'synthetic-long-login-' + (i + 1) + '-'.repeat(72) + '@example.invalid',
        password: '  synthetic-password-' + (i + 1) + '-'.repeat(54) + '  ',
        two_fa_code: 'SYNTHETIC-2FA-' + (i + 1),
        email: 'synthetic-mail-' + (i + 1) + '@example.invalid',
        email_password: 'synthetic-mail-password-' + (i + 1),
        recovery_email: 'recovery-' + (i + 1) + '@example.invalid',
        recovery_email_password: 'recovery-pass-' + (i + 1),
        additional_info: '  Synthetic setup note for account ' + (i + 1) + '.\\nKeep this line and the next line visible.  ',
      })) } };
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
}

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import CheckoutPage from ${JSON.stringify(join(root, 'src/pages/CheckoutPage.tsx'))};
  const mode = new URLSearchParams(location.search).get('case');
  const storageKey = 'tallystore:pending-purchase:synthetic-customer:synthetic-product';
  window.__checkoutFixture = { paidCalls: [], statusCalls: [], storageKey };
  if (!['deferred', 'success', 'circle-error', 'circle-hung', 'visual-single', 'visual-bulk'].includes(mode)) localStorage.setItem(storageKey, JSON.stringify({
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
      : { path: existsSync(join(root, 'src', args.path.slice(2) + '.tsx'))
        ? join(root, 'src', args.path.slice(2) + '.tsx')
        : join(root, 'src', args.path.slice(2) + '.ts') })
    plugin.onLoad({ filter: /.*/, namespace: 'mock-services' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})

const bundle = await readFile(bundlePath)
const tailwindConfig = createRequire(import.meta.url)('tailwindcss/loadConfig')(join(root,'tailwind.config.ts'))
const css = (await postcss([tailwindcss({ ...tailwindConfig, safelist:['dark'], content:[
  join(root,'src/pages/CheckoutPage.tsx'),join(root,'src/components/ui/*.{ts,tsx}'),
]}),autoprefixer()]).process(await readFile(join(root,'src/index.css'),'utf8'),{from:join(root,'src/index.css')})).css
const server = createServer((request, response) => {
  if (request.url?.startsWith('/bundle.js')) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(bundle)
  } else if (request.url?.startsWith('/styles.css')) {
    response.writeHead(200, { 'Content-Type': 'text/css' })
    response.end(css)
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/styles.css" /></head><body><div id="app"></div><script src="/bundle.js"></script></body></html>')
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
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

  const visualDir = join(root, 'scripts/ui-review.local')
  await mkdir(visualDir, { recursive: true })
  await page.evaluate(key => { localStorage.removeItem(key); sessionStorage.removeItem(key) }, storageKey)
  await page.setViewportSize({ width: 390, height: 560 })
  await load('visual-single')
  const instructions = page.getByRole('region', { name: 'Product information & instructions' })
  await instructions.waitFor()
  assert.match(await instructions.textContent(), /Second line: keep your recovery details secure/)
  assert.equal(await instructions.evaluate(element => getComputedStyle(element.querySelector('p:last-child')).maxHeight), 'none',
    'Product instructions must not be clamped or height limited')
  await page.getByRole('button', { name: 'Buy Now' }).click()
  const dialog = page.getByTestId('credentials-dialog')
  await dialog.waitFor()
  const waitForCenteredModal = async () => page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="credentials-dialog"]')
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return Math.abs(rect.y - (innerHeight - rect.height) / 2) < 3
  }, null, { timeout: 10000 })
  await waitForCenteredModal()
  const shortMetrics = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="credentials-dialog"]')
    const rect = modal.getBoundingClientRect()
    const value = modal.querySelector('[data-testid="credential-value"]')
    const style = getComputedStyle(value)
    return { x: rect.x, width: rect.width, y: rect.y, bottom: rect.bottom,
      valueWidth: value.clientWidth, valueScrollWidth: value.scrollWidth,
      textOverflow: style.textOverflow, whiteSpace: style.whiteSpace, overflowX: style.overflowX,
      modalOverflowY: getComputedStyle(modal).overflowY,
      modalScrollHeight: modal.scrollHeight, modalClientHeight: modal.clientHeight,
      scrollableChildren: Array.from(modal.querySelectorAll('*')).filter(element => {
        const overflow = getComputedStyle(element).overflowY
        return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1
      }).length,
      viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  assert.ok(shortMetrics.width <= 340 && shortMetrics.x >= 0 && shortMetrics.bottom <= 560,
    `Short-screen modal must fit horizontally and vertically: ${JSON.stringify(shortMetrics)}`)
  assert.ok(shortMetrics.bottom-shortMetrics.y <= 420,'Credential modal must remain compact on short screens')
  assert.ok(Math.abs(shortMetrics.y - (560 - (shortMetrics.bottom - shortMetrics.y)) / 2) < 5,
    'Short-screen modal should be centered')
  assert.equal(await page.getByTestId('credential-scroll-region').count(), 0, 'Modal must not use an internal scroll panel')
  assert.equal(shortMetrics.textOverflow, 'ellipsis')
  assert.equal(shortMetrics.whiteSpace, 'nowrap')
  assert.ok(shortMetrics.modalScrollHeight <= shortMetrics.modalClientHeight + 1,
    'Modal must not hide vertically overflowing content')
  assert.equal(shortMetrics.scrollableChildren, 0, 'No inner pane should need scrolling')
  process.stdout.write(`Credential compact metrics: ${JSON.stringify(shortMetrics)}\n`)
  assert.ok(shortMetrics.valueScrollWidth > shortMetrics.valueWidth + 2, 'Long value should be visually ellipsized')
  assert.equal(await page.getByRole('button', { name: 'Copy USERNAME / ID for account 1' }).count(), 1)
  await page.evaluate(() => {
    window.__clipboardWrites = []
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async value => {
      window.__clipboardWrites.push(value)
      return originalWriteText(value)
    }
  })
  const fullLongLogin = 'synthetic-long-login-1' + '-'.repeat(72) + '@example.invalid'
  assert.equal(await page.getByTestId('credential-value').first().textContent(), fullLongLogin,
    'Ellipsis must be CSS only; the value in the DOM stays complete')
  await page.getByRole('button', { name: 'Copy USERNAME / ID for account 1' }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fullLongLogin,
    'Copy must include the full long login, not its visual ellipsis')
  const fullPassword = '  synthetic-password-1' + '-'.repeat(54) + '  '
  await page.getByRole('button', { name: 'Copy PASSWORD for account 1' }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fullPassword,
    'Copy must preserve leading and trailing spaces')
  await page.getByRole('button', { name: 'Next fields' }).click()
  await page.getByRole('button', { name: 'Next fields' }).click()
  const fullExtra = '  Synthetic setup note for account 1.\nKeep this line and the next line visible.  '
  await page.getByRole('button', { name: 'Copy EXTRA for account 1' }).click()
  assert.equal(await page.evaluate(() => window.__clipboardWrites.at(-1)), fullExtra,
    'Copy must pass the exact original multiline note to clipboard.writeText')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fullExtra.replace(/\n/g, '\r\n'),
    'Windows clipboard may normalize LF to CRLF, but must retain all lines and surrounding spaces')
  await page.getByRole('button', { name: 'Previous fields' }).click()
  await page.getByRole('button', { name: 'Previous fields' }).click()
  await page.screenshot({ path: join(visualDir, 'checkout-credentials-390x560.png') })

  await page.evaluate(key => { localStorage.removeItem(key); sessionStorage.removeItem(key) }, storageKey)
  await page.setViewportSize({ width: 390, height: 700 })
  await load('visual-bulk')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByRole('button', { name: 'Buy Now' }).click()
  await dialog.waitFor()
  await waitForCenteredModal()
  assert.equal(await dialog.getByRole('region', { name: /^Account \d$/ }).count(), 1,
    'Only one account should be visible at a time')
  assert.equal(await dialog.getByRole('button', { name: /Copy PASSWORD for account/ }).count(), 1)
  const bulkBounds = await dialog.boundingBox()
  assert.ok(bulkBounds && bulkBounds.x >= 0 && bulkBounds.x + bulkBounds.width <= 390
    && bulkBounds.y >= 0 && bulkBounds.y + bulkBounds.height <= 700
    && bulkBounds.height <= 420, `Bulk credentials must fit compactly: ${JSON.stringify(bulkBounds)}`)
  await page.screenshot({ path: join(visualDir, 'checkout-credentials-bulk-390x700.png') })
  for (let account = 1; account <= 3; account++) {
    await dialog.getByText(`Account ${account} of 3`).waitFor()
    const seen = []
    for (let fieldPage = 0; fieldPage < 3; fieldPage++) {
      seen.push(...await dialog.locator('button[aria-label^="Copy "]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
      if (fieldPage < 2) await dialog.getByRole('button', { name: 'Next fields' }).click()
    }
    assert.equal(seen.length, 8, `All eight credential fields must be reachable for account ${account}`)
    assert.equal(await dialog.getByRole('button', { name: `Copy EXTRA for account ${account}` }).count(), 1)
    if (account < 3) {
      await dialog.getByRole('button', { name: 'Next account' }).click()
      await dialog.getByText('Fields 1–3 of 8').waitFor()
    }
  }
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download all as TXT' }).click()
  const download = await downloadPromise
  const downloadedText = await readFile(await download.path(), 'utf8')
  for (let account = 1; account <= 3; account++) {
    assert.ok(downloadedText.includes(`Account ${account}`), `TXT must contain account ${account}`)
    assert.ok(downloadedText.includes(`PASSWORD:   synthetic-password-${account}${'-'.repeat(54)}  `),
      `TXT must preserve account ${account}'s full password`)
    assert.ok(downloadedText.includes(`EXTRA:   Synthetic setup note for account ${account}.\nKeep this line and the next line visible.  `),
      `TXT must preserve account ${account}'s multiline extra text`)
  }
  await page.screenshot({ path: join(visualDir, 'checkout-credentials-bulk-last-390x700.png') })
  assert.deepEqual(errors, [], 'Browser component raised an error')
  process.stdout.write('Checkout recovery browser tests passed (pre-dispatch persistence, reload/unknown/missing, completed/released, credentials before wallet refresh).\n')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
