// Browser fixture for the real customer airtime page. No network service is contacted.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const fixtureRoot = await mkdtemp(join(root, 'scripts/ui-review.local/international-airtime-'))
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const firstUser = '10000000-0000-4000-8000-000000000001'
const orderId = '20000000-0000-4000-8000-000000000001'

await writeFile(join(fixtureRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script defer src="/bundle.js"></script></body></html>')
await writeFile(join(fixtureRoot, 'harness.tsx'), String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import InternationalAirtime from '@/pages/InternationalAirtime';
const firstUser = '10000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-4000-8000-000000000001';
const order = {id:orderId,status:'processing',recipient_phone:'+447700900123',product_name:'UK Mobile',amount_ngn:1200,currency:'GBP',created_at:'2026-10-05T12:00:00Z'};
const lookup = {success:true,recipient_phone:'+447700900123',country_code:'GB',operators:[
 {operator_id:'o1',operator_name:'First Network',products:[{product_id:'p1',product_name:'UK Mobile',currency:'GBP',packages:[{package_id:'a',unit_value:5},{package_id:'b',unit_value:10}],range:{min:1,max:20,step:1}}]},
 {operator_id:'o2',operator_name:'Second Network',products:[{product_id:'p2',product_name:'Alternate UK Mobile',currency:'GBP',packages:[{package_id:'c',unit_value:7}]}]},
]};
const fixture = {calls:[],pending:[],mode:'normal',userId:firstUser,
 setUser(id){ this.userId=id; dispatchEvent(new Event('fixture-user')); },
 setMode(mode){ this.mode=mode; },
 settle(response){ const next=this.pending.shift(); if(next) next.resolve(response); },
 fail(){ const next=this.pending.shift(); if(next) next.reject(new Error('PRIVATE PROVIDER DETAIL')); }};
window.__fixture=fixture;
createRoot(document.getElementById('root')).render(<InternationalAirtime/>);
`)

const mockModules = {
  '@/components/NavbarAuth': `export default function Navbar(){return <header style={{padding:'1rem'}}>TallyStore</header>}`,
  '@/components/Footer': `export default function Footer(){return <footer style={{padding:'1rem'}}>TallyStore footer</footer>}`,
  '@/contexts/SimpleAuth': `import {useEffect,useState} from 'react';
    export function useAuth(){const [,refresh]=useState(0);useEffect(()=>{const listener=()=>refresh(n=>n+1);addEventListener('fixture-user',listener);return()=>removeEventListener('fixture-user',listener)},[]);
    return {user:{id:window.__fixture.userId},walletBalance:99999,walletBalanceUnavailable:false}}`,
  '@/lib/supabase': `export const supabase={functions:{invoke:async(_name,{body})=>{
    const fixture=window.__fixture;fixture.calls.push(body);
    if(body.action==='orders')return {data:{success:true,orders:[]},error:null};
    if(body.action==='check_phone'){
      if(fixture.mode==='pending_lookup')return new Promise((resolve,reject)=>fixture.pending.push({resolve:value=>resolve({data:value,error:null}),reject}));
      return {data:{success:true,recipient_phone:'+447700900123',country_code:'GB',operators:[
        {operator_id:'o1',operator_name:'First Network',products:[{product_id:'p1',product_name:'UK Mobile',currency:'GBP',packages:[{package_id:'a',unit_value:5},{package_id:'b',unit_value:10}],range:{min:1,max:20,step:1}}]},
        {operator_id:'o2',operator_name:'Second Network',products:[{product_id:'p2',product_name:'Alternate UK Mobile',currency:'GBP',packages:[{package_id:'c',unit_value:7}]}]}
      ]},error:null};}
    if(body.action==='quote'){
      const quote={product_id:body.product_id,product_name:body.product_id==='p1'?'UK Mobile':'Alternate UK Mobile',operator_id:body.operator_id,
        operator_name:body.operator_id==='o1'?'First Network':'Second Network',country_code:'GB',recipient_phone:'+447700900123',
        package_id:body.package_id??null,unit_value:body.package_id==='a'?5:body.package_id==='b'?10:body.package_id==='c'?7:body.unit_value,
        currency:'GBP',amount_ngn:1200,secret:'PRIVATE PROVIDER DETAIL'};
      if(fixture.mode==='bad_quote')quote.amount_ngn=0;
      return {data:{success:true,quote},error:null};}
    if(body.action==='purchase'){
      if(fixture.mode==='pending_purchase')return new Promise((resolve,reject)=>fixture.pending.push({resolve:value=>resolve({data:value,error:null}),reject}));
      if(fixture.mode==='unknown_purchase')return {data:{success:false,outcome_unknown:true},error:null};
      return {data:{success:true,order:{id:'20000000-0000-4000-8000-000000000001',status:'processing',recipient_phone:'+447700900123',product_name:body.product_id==='p1'?'UK Mobile':'Alternate UK Mobile',amount_ngn:1200,currency:'GBP',created_at:'2026-10-05T12:00:00Z'}},error:null};}
    if(body.action==='status')return {data:{success:true,order:{id:body.order_id,status:'completed',recipient_phone:'+447700900123',product_name:'UK Mobile',amount_ngn:1200,currency:'GBP',created_at:'2026-10-05T12:00:00Z'}},error:null};
    throw new Error('unexpected action');
  }}}`,
}

await build({
  entryPoints: [join(fixtureRoot, 'harness.tsx')], bundle: true, platform: 'browser', format: 'iife',
  target: 'es2022', jsx: 'automatic', absWorkingDir: root,
  alias: { '@': join(root, 'src') }, outfile: join(fixtureRoot, 'bundle.js'),
  plugins: [{ name: 'mock-service', setup(plugin) {
    plugin.onResolve({ filter: /^@\/(components\/NavbarAuth|components\/Footer|contexts\/SimpleAuth|lib\/supabase)$/ },
      args => ({ path: args.path, namespace: 'fixture-mock' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-mock' }, args => ({ contents: mockModules[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})
const bundle = await readFile(join(fixtureRoot, 'bundle.js'))
const html = await readFile(join(fixtureRoot, 'index.html'))
const cssFile = (await readdir(join(root, 'dist/assets'))).find(file => /^index-.*\.css$/.test(file))
assert.ok(cssFile, 'Build the app once to supply styles for the visual fixture')
const css = await readFile(join(root, 'dist/assets', cssFile))
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle) }
  else if (request.url === '/styles.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(css) }
  else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html) }
})
let browser
const pageErrors = []
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: edge, headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 740 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(90_000)
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin, { waitUntil: 'commit' })
  await page.getByText('No international airtime orders yet.').waitFor()
  assert.deepEqual((await page.evaluate(() => window.__fixture.calls)).map(call => call.action), ['orders'])
  await page.getByPlaceholder('+447700900123').fill('+447700900123')
  await page.getByRole('button', { name: 'Check number' }).click()
  await page.getByText('Number checked:').waitFor()
  assert.equal(await page.getByRole('option', { name: 'Second Network' }).count(), 1)
  await page.getByRole('button', { name: 'Get verified price' }).click()
  await page.getByText('Wallet charge: ₦1,200.00').waitFor()
  assert.equal(await page.getByText('PRIVATE PROVIDER DETAIL').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Confirm and pay ₦1,200.00' }).isDisabled(), true)
  await page.getByRole('checkbox').check()
  const before = await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'purchase').length)
  assert.equal(before, 0, 'Checking recipient and price must not make a purchase')
  await page.evaluate(() => window.__fixture.setMode('pending_purchase'))
  await page.getByRole('button', { name: 'Confirm and pay ₦1,200.00' }).click()
  await page.getByText('An airtime order still needs a confirmed outcome.').waitFor()
  const purchaseCalls = await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'purchase'))
  assert.equal(purchaseCalls.length, 1)
  assert.deepEqual(Object.keys(purchaseCalls[0]).sort(), ['action','expected_amount_ngn','idempotency_key','operator_id','package_id','phone_number','product_id'].sort())
  assert.equal(purchaseCalls[0].expected_amount_ngn, 1200)
  assert.equal(purchaseCalls[0].phone_number, '+447700900123')
  assert.equal(await page.getByRole('button', { name: 'Check number' }).isDisabled(), true)
  const storedIntent = await page.evaluate(() => localStorage.getItem('tallystore:airtime-pending:10000000-0000-4000-8000-000000000001'))
  assert.ok(storedIntent, 'An in-flight request must be persisted before reload')
  await page.reload({ waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.__fixture))
  const reloadedIntent = await page.evaluate(() => localStorage.getItem('tallystore:airtime-pending:10000000-0000-4000-8000-000000000001'))
  assert.equal(reloadedIntent, storedIntent, 'Reload must retain the pending request key')
  await page.getByRole('heading', { name: 'International airtime' }).waitFor()
  await page.getByText('An airtime order still needs a confirmed outcome.').waitFor()
  assert.equal(await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'purchase').length), 0,
    'Reload must never auto-retry a purchase')
  await page.screenshot({ path: join(fixtureRoot, 'airtime-pending-390.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.evaluate(userId => window.__fixture.setUser(userId), '30000000-0000-4000-8000-000000000003')
  await page.getByText('An airtime order still needs a confirmed outcome.').waitFor({ state: 'hidden' })
  await page.getByPlaceholder('+447700900123').fill('+447700900123')
  await page.getByRole('button', { name: 'Check number' }).click()
  await page.getByLabel('Operator').selectOption('o2')
  await page.evaluate(() => window.__fixture.setMode('bad_quote'))
  await page.getByRole('button', { name: 'Get verified price' }).click()
  await page.getByRole('status').filter({ hasText: 'A verified price could not be obtained' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Confirm and pay/ }).count(), 0,
    'Malformed price must not enable a purchase')
  await page.evaluate(() => window.__fixture.setMode('normal'))
  await page.getByRole('button', { name: 'Get verified price' }).click()
  await page.getByText('Wallet charge: ₦1,200.00').waitFor()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm and pay ₦1,200.00' }).click()
  await page.getByText('Your order is processing.').waitFor()
  const secondPurchase = await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'purchase'))
  assert.equal(secondPurchase.at(-1).operator_id, 'o2')
  assert.equal(secondPurchase.at(-1).package_id, 'c')
  assert.equal(await page.getByRole('button', { name: 'Check number' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Check order status' }).click()
  await page.getByText('Order completed.').waitFor()
  assert.equal(await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'purchase').length), secondPurchase.length,
    'Checking status must never call purchase')
  await page.evaluate(userId => window.__fixture.setUser(userId), firstUser)
  await page.getByText('An airtime order still needs a confirmed outcome.').waitFor()
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  console.log(`International airtime actual UI fixture passed. Screenshot: ${join(fixtureRoot, 'airtime-pending-390.png')}`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
