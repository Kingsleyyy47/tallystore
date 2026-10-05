/** Local UI review only: real production components, fake services, no customer login.
 * Install Playwright under scripts/ui-review.local, then run this file from the repo. */
import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const root = resolve('.')
const local = join(root, 'scripts/ui-review.local')
const artifacts = join(local, 'artifacts')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
await access(edge)
await mkdir(artifacts, { recursive: true })
const localRequire = createRequire(join(local, 'package.json'))
const { chromium } = localRequire('playwright')

const files = {
  'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/harness.tsx"></script></body></html>',
  'harness.tsx': `import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import Navbar from '@/components/NavbarAuth';
import Home from '@/pages/Dashboard';
import Profile from '@/pages/ProfilePage';
import '@/index.css';
function NavigationFixture() { return <><Navbar/><main><h1 style={{padding:24}}>Isolated navigation review</h1></main></> }
createRoot(document.getElementById('root')!).render(<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}><BrowserRouter><Routes><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard" element={<Home/>}/><Route path="/profile" element={<Profile/>}/><Route path="*" element={<NavigationFixture/>}/></Routes><div data-testid="scroll-spacer" style={{height:12000}}/></BrowserRouter></ThemeProvider>);
`,
  'auth.tsx': `export function useAuth() {
 const q = new URLSearchParams(location.search); const role = q.get('role');
 return { user: role === 'guest' ? null : {id:'fixture-only',email:'review@example.invalid',created_at:'2026-01-01',user_metadata:{full_name:'Review Customer'}},
 loading:q.has('loading'), roleLookupError:q.has('unverified')?'fixture lookup denied':null, accountSuspended:q.has('suspended'),
 isAdmin:role==='admin', isStaff:role==='staff', walletBalance:5000, walletLoading:false, walletBalanceUnavailable:false, showBalances:true,
 signOut:async()=>{}, refreshWalletBalance:async()=>{}, toggleBalanceVisibility:()=>{}, setBalanceVisibility:()=>{} };
}`,
  'currency.tsx': `export function useCurrency(){return {currency:'NGN',toggleCurrency:()=>{},formatPrice:n=>'₦'+n.toLocaleString(),convert:n=>n,rate:1500,rateLoading:false}}`,
  'pwa.tsx': `export function usePWAInstall(){return {canInstall:false,isInstalled:true,isAndroid:false,isIOS:false,platform:'desktop',installApp:async()=>false}}`,
  'toast.tsx': `export function useToast(){return {toast:()=>{}}}`,
  'revenue.tsx': `export function trackRevenueEvent(){return Promise.resolve()}`,
  'recommendations.tsx': `export function useRecommendations(){return {recommendations:[],loading:false}}`,
  'recommendation-card.tsx': `export function RecommendationStrip(){return null}`,
  'services.tsx': `const categories=[{id:'facebook',name:'Facebook Accounts',description:'Account collection',is_active:true},{id:'instagram',name:'Instagram Accounts',description:'Account collection',is_active:true}];
const products=categories.map((c,i)=>({id:'fixture-'+i,category_id:c.id,name:c.name,price:2500,stock_count:12,is_sellable:true,is_active:true,availability_status:'AVAILABLE'}));
export const getCategories=async()=>categories; export const getAllProductGroups=async()=>products;
export const getUserCount=async()=>1600; export const getPublicOrderCount=async()=>2400; export const formatCount=n=>n.toLocaleString();
export const supabase={from:table=>{const data=table==='orders_safe_history'?[{id:'fixture-order',amount:2500,status:'completed',created_at:'2026-10-01T12:00:00Z',product_name:'Facebook Account'}]:{email_lifecycle_opt_in:false,email_promotions_opt_in:false};const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,maybeSingle:()=>query,abortSignal:()=>query,then:(resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject),upsert:async()=>({error:null})};return query},auth:{updateUser:async()=>({error:null})}};`,
}
for (const [name, contents] of Object.entries(files)) await writeFile(join(local, name), contents)
const aliases = {
  '@/contexts/SimpleAuth': 'auth.tsx', '@/contexts/CurrencyContext': 'currency.tsx',
  '@/lib/supabase': 'services.tsx', '@/lib/revenue-os': 'revenue.tsx',
  '@/hooks/useRecommendations': 'recommendations.tsx', '@/components/RecommendationCard': 'recommendation-card.tsx',
  '@/hooks/usePWAInstall': 'pwa.tsx', '@/hooks/use-toast': 'toast.tsx',
}
const server = await createServer({
  configFile: false, root: local, envDir: local, cacheDir: join(local, '.vite'),
  publicDir: join(root, 'public'), logLevel: 'error',
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    ...Object.entries(aliases).map(([find, file]) => ({ find, replacement: join(local, file) })),
    { find: '@', replacement: join(root, 'src') },
  ] },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, 'tailwind.config.ts') }), autoprefixer()] } },
  server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [root] } },
})
let browser
const errors = []
const evidence = []
try {
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  console.log('UI review: localhost Vite server ready')
  browser = await chromium.launch({ executablePath: edge, headless: true })
  console.log('UI review: headless Edge launched')
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(60000)
  // Never allow the harness to reach any supplier, Supabase project, or other service.
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const shot = name => page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: false })
  const openMenu = page.getByRole('button', { name: 'Open navigation menu', exact: true })
  const dialog = page.getByRole('dialog')
  const expectedLabels = ['Home', 'Products', 'US & Canada (SMS)', 'Social Boost', 'Telegram', 'Travel & Visa', 'Help Centre']
  async function load(path) {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor()
    await page.waitForFunction(() => document.querySelector('nav[aria-label="Main navigation"]')?.getBoundingClientRect().height === 73)
    await page.waitForTimeout(250)
    console.log(`UI review: rendered ${path}`)
  }
  async function noHorizontalOverflow(label) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, `${label}: no horizontal overflow`)
  }
  async function account(expectedWorkspace = null) {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor()
    for (const [label, route] of [['Wallet', '/wallet'], ['Order history', '/orders'], ['Profile', '/profile']]) {
      assert.equal(await menu.getByRole('menuitem', { name: new RegExp(`^${label}`) }).getAttribute('href'), route)
    }
    assert.equal(await menu.getByRole('menuitem', { name: /API Access/ }).getAttribute('aria-disabled'), 'true')
    assert.equal(await menu.locator('a[href="/developer-api"],a[href="/referrals"],a[href="/bills"]').count(), 0)
    assert.equal(await menu.locator('a[href="/admin"],a[href="/staff-admin"]').count(), expectedWorkspace ? 1 : 0)
    if (expectedWorkspace) assert.equal(await menu.locator(`a[href="${expectedWorkspace}"]`).count(), 1)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
  }

  await load('/__nav')
  for (const y of [1600, 9300]) {
    await page.evaluate(y => window.scrollTo(0, y), y)
    await page.waitForFunction(y => Math.abs(scrollY - y) < 1, y)
    await openMenu.click()
    await dialog.waitFor()
    const bounds = await dialog.boundingBox()
    assert.ok(Math.abs(bounds.x) < 1, 'Drawer starts at the left edge of the viewport')
    assert.ok(bounds.width > 300 && bounds.width <= 375, 'Drawer fits within the viewport')
    assert.ok(Math.abs(bounds.y) < 1 && Math.abs(bounds.height - 667) < 1, 'Drawer covers the viewport at the original deep scroll position')
    assert.equal(await page.evaluate(() => document.body.style.position), 'fixed')
    assert.deepEqual(await dialog.getByRole('link').allTextContents(), expectedLabels)
    assert.equal(await dialog.getByRole('link', { name: 'Home', exact: true }).getAttribute('href'), '/dashboard')
    const comingSoon = dialog.getByRole('button', { name: /Tally Circle/ })
    assert.equal(await comingSoon.isDisabled(), true)
    assert.match(await comingSoon.innerText(), /Coming soon/)
    assert.equal(await dialog.locator('a[href="/referrals"],a[href="/bills"],a[href="/wallet"],a[href="/orders"],a[href="/profile"]').count(), 0)
    await shot(`drawer-scroll-${y}`)
    // Dialog keeps focus inside while background is inaccessible.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(y => Math.abs(scrollY - y) < 1, y)
    assert.equal(await openMenu.evaluate(node => node === document.activeElement), true, 'Close restores keyboard focus to the menu trigger')
    assert.equal(await page.evaluate(() => document.body.style.position), '')
    evidence.push({ mobileScroll: y, x: bounds.x, width: bounds.width, viewportHeight: bounds.height, restored: true, focusRestored: true })
  }

  await page.setViewportSize({ width: 375, height: 420 })
  await openMenu.click()
  await dialog.waitFor()
  const scrolling = dialog.locator('.overflow-y-auto')
  const internal = await scrolling.evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight }))
  assert.ok(internal.content > internal.height, 'Short viewport has its own scroll area')
  await scrolling.evaluate(node => { node.scrollTop = node.scrollHeight })
  const help = await dialog.getByRole('link', { name: 'Help Centre', exact: true }).boundingBox()
  assert.ok(help.y >= 0 && help.y + help.height <= 420, 'The last menu item is reachable inside the drawer')
  assert.equal(await page.evaluate(() => document.body.style.top), '-9300px', 'Internal scrolling does not move the background')
  await shot('drawer-short-viewport-last-item')
  await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await account()

  for (const path of ['/__nav?role=admin&unverified', '/__nav?role=admin&suspended', '/__nav?role=staff&loading']) {
    await load(path)
    await account()
  }
  await load('/__nav?role=admin')
  await account('/admin')
  await load('/__nav?role=staff')
  await account('/staff-admin')
  await load('/__nav?role=guest')
  assert.equal(await page.getByRole('navigation').getByRole('link', { name: /TallyStore/ }).getAttribute('href'), '/')
  await openMenu.click()
  assert.equal(await dialog.getByRole('link', { name: 'Home', exact: true }).getAttribute('href'), '/')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  evidence.push({ roleGates: 'ordinary, unverified, suspended, loading, admin, staff verified' })

  for (const [path, label] of [['/dashboard', 'home'], ['/profile', 'profile']]) {
    await page.setViewportSize({ width: 375, height: 812 })
    await load(path)
    if (label === 'home') {
      await page.getByRole('heading', { name: 'Home', exact: true }).waitFor()
      await page.getByRole('link', { name: /Facebook Account/ }).waitFor()
      assert.equal(await page.getByRole('navigation').getByRole('link', { name: /TallyStore/ }).getAttribute('href'), '/dashboard')
    }
    await noHorizontalOverflow(`mobile ${label}`)
    await shot(`${label}-mobile`)
    await account()
    await page.setViewportSize({ width: 1280, height: 900 })
    await noHorizontalOverflow(`desktop ${label}`)
    assert.equal(await openMenu.isVisible(), false)
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    for (const label of expectedLabels) assert.equal(await nav.getByRole('link', { name: label, exact: true }).isVisible(), true)
    assert.equal(await nav.getByRole('button', { name: /Tally Circle/ }).isDisabled(), true)
    const boxes = await nav.locator('a,button').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({ left: n.getBoundingClientRect().left, right: n.getBoundingClientRect().right })))
    assert.ok(boxes.every(box => box.left >= 0 && box.right <= 1281), 'Desktop controls fit inside the viewport')
    await shot(`${label}-desktop`)
    evidence.push({ page: label, widths: [375, 1280], horizontalOverflow: false })
  }
  assert.deepEqual(errors, [], 'The isolated production components must not crash')
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ passed: true, evidence, screenshots: artifacts }))
} finally {
  await browser?.close()
  await server.close()
}
