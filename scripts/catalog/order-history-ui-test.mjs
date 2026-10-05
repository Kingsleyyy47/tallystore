// Renders the real order-history component in Chrome with synthetic account data.
// No Supabase request or paid operation can leave this isolated browser harness.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'tally-order-history-test-'))
const bundlePath = join(temporary, 'bundle.js')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const mockModules = {
  '@/contexts/SimpleAuth': `const user = { id: 'synthetic-customer', email: 'synthetic@example.invalid' }; export function useAuth() { return { user, showBalances: true, accountSuspended: false, walletReviewRequired: false, walletReviewedBy: null } }`,
  '@/contexts/CurrencyContext': `export function useCurrency() { return { formatPrice: (value) => 'NGN ' + Number(value).toFixed(2) } }`,
  '@/hooks/use-toast': `const toast = () => {}; export function useToast() { return { toast } }`,
  '@/lib/walletReviewPolicy': `export function isPurchasingPausedByProfile() { return false }`,
  '@/lib/orderCredentials': `export function normalizeOrderCredential(value) { return value }; export function normalizeOrderCredentials(values) { return values }`,
  '@/lib/productAvailability': `export function isCustomerSellableProduct() { return true }`,
  '@/lib/supabase': `
    let calls = 0;
    const mode = new URLSearchParams(location.search).get('case');
    const sample = { id: '11111111-1111-4111-8111-111111111111', status: 'completed', amount: 200,
      created_at: '2026-10-01T12:00:00Z', product_group_id: 'sample-product',
      account_details: { product_name: 'SYNTHETIC TEST ORDER', category: 'Test', quantity: 1,
        accounts: [{ username: 'synthetic-user', password: 'synthetic-password' }] } };
    export async function getUserOrders(_userId, signal) {
      calls++;
      if (signal?.aborted) throw new Error('aborted');
      if ((mode === 'initial-fail' || mode === 'initial-retry') && calls === 1) throw new Error('mock failure');
      if (mode === 'refresh' && calls === 2) throw new Error('mock refresh failure');
      return [sample];
    }
    export async function getAllProductGroups() { return [] }
    export async function getCategories() { return [] }
    export async function getAppSetting() { return null }
    export async function getFavoriteProductGroupIds() { return [] }
    export async function getTopSellingProductGroupIds() { return [] }
    export async function getUserPurchaseHistory() { return { productGroupCounts: {}, categoryCounts: {}, lastPurchasedAtByProductGroup: {}, lastPurchasedAtByCategory: {}, lastProductGroupId: null } }
  `,
  '@/lib/revenue-os': `
    export function trackRevenueEvent() {}
    export function getCustomerPressureState() { return {} }
    export function getRevenueVisitorId() { return 'synthetic-visitor' }
    export function loadCustomerRelationshipBoosts() { return Promise.resolve({}) }
    export function loadRevenueOsSettings() { return new Promise(() => {}) }
    export function loadRunningCroActionPlans() { return Promise.resolve([]) }
    export function loadRunningCroExperiments() { return Promise.resolve([]) }
    export function rankProductsForRevenueOs() { return [] }
    export function resolveCroAssignment() { return { rankingEnabled: false, mode: 'off', experimentId: null, variantId: null } }
  `,
  '@/components/NavbarAuth': `export default function NavbarAuth() { return null }`,
  '@/components/Footer': `export default function Footer() { return null }`,
  '@/components/WalletBalanceWidget': `export default function WalletBalanceWidget() { return null }`,
  '@/components/PageBreadcrumb': `export default function PageBreadcrumb() { return null }`,
  '@/components/ProductTemplateCard': `export default function ProductTemplateCard() { return null }`,
  '@/components/RevampLayout': `import React from 'react'; export function RevampCard({children,...props}) { return React.createElement('div', props, children) }; export function RevampPage({children,...props}) { return React.createElement('main', props, children) }`,
  '@/components/ui/button': `import React from 'react'; export function Button({children,asChild,...props}) { if (asChild && React.isValidElement(children)) return React.cloneElement(children, props); return React.createElement('button', props, children) }`,
  '@/components/ui/card': `import React from 'react'; export const Card = ({children,...props}) => React.createElement('div',props,children); export const CardContent = Card;`,
  '@/components/ui/badge': `import React from 'react'; export function Badge({children,...props}) { return React.createElement('span',props,children) }`,
  '@/components/ui/input': `import React from 'react'; export function Input(props) { return React.createElement('input',props) }`,
  '@/components/ui/alert': `import React from 'react'; export function Alert({children,...props}) { return React.createElement('div',props,children) }`,
  '@/components/ui/select': `import React from 'react'; const Box = ({children,...props}) => React.createElement('div',props,children); export const Select = Box; export const SelectContent = Box; export const SelectItem = Box; export const SelectTrigger = Box; export const SelectValue = Box;`,
}

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import OrderHistoryPage from ${JSON.stringify(join(root, 'src/pages/OrderHistoryPage.tsx'))};
  createRoot(document.getElementById('app')!).render(<BrowserRouter><OrderHistoryPage /></BrowserRouter>);
  const mode = new URLSearchParams(location.search).get('case');
  if (mode === 'initial-retry' || mode === 'refresh') setTimeout(() => {
    const label = mode === 'refresh' ? 'Refresh orders' : 'Retry orders';
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(label));
    button?.click();
  }, 250);
`

await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'order-history-test-entry.tsx', loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  outfile: bundlePath, jsx: 'automatic', absWorkingDir: root,
  plugins: [{ name: 'mock-services', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, (args) => mockModules[args.path]
      ? { path: args.path, namespace: 'mock-services' }
      : { path: join(root, 'src', args.path.slice(2)) })
    plugin.onLoad({ filter: /.*/, namespace: 'mock-services' }, (args) => ({ contents: mockModules[args.path], loader: 'tsx', resolveDir: root }))
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

async function browserText(testCase) {
  const url = `http://127.0.0.1:${port}/?case=${testCase}`
  const child = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--virtual-time-budget=1500', '--dump-dom', `--user-data-dir=${join(temporary, `chrome-${testCase}`)}`, url],
  { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { error += chunk })
  const status = await new Promise((resolve) => child.on('close', resolve))
  if (status !== 0) throw new Error(`Chrome failed in ${testCase}: ${error.slice(-700)}`)
  return output
}

try {
  const optional = await browserText('optional')
  if (!optional.includes('SYNTHETIC TEST ORDER')) throw new Error('Optional request delayed core orders')
  const initialFail = await browserText('initial-fail')
  if (!initialFail.includes('Order history is unavailable') || initialFail.includes('No Orders Found')) throw new Error('Initial failure appeared as empty history')
  const initialRetry = await browserText('initial-retry')
  if (!initialRetry.includes('SYNTHETIC TEST ORDER')) throw new Error('Retry did not restore core orders')
  const refresh = await browserText('refresh')
  if (!refresh.includes('SYNTHETIC TEST ORDER') || !refresh.includes('Could not refresh orders')) throw new Error('Refresh failure hid previously loaded order')
  process.stdout.write('Order history component browser tests passed (optional delay, initial failure, retry, refresh failure).\n')
} finally {
  server.close()
}
