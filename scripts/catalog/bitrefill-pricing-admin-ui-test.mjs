// Actual pricing component in a local browser fixture; no live Supabase or provider traffic.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const fixtureRoot = await mkdtemp(join(root, 'scripts/ui-review.local/bitrefill-pricing-'))
const { chromium } = createRequire(join(root, 'scripts/ui-review.local/package.json'))('playwright')
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
await writeFile(join(fixtureRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script defer src="/bundle.js"></script></body></html>')
await writeFile(join(fixtureRoot, 'harness.tsx'), String.raw`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import BitrefillPricingAdmin from '@/components/BitrefillPricingAdmin';
const fixture={calls:[],actor:'c1396bda-86e2-4dfc-94bb-0d95469d1d36',mode:'normal',pending:[],
 setActor(actor){this.actor=actor;dispatchEvent(new Event('fixture-user'));},
 setMode(mode){this.mode=mode;},
 settle(value){const next=this.pending.shift();if(next)next.resolve(value);}};
window.__fixture=fixture;
function Harness(){const [kind,setKind]=useState('airtime');fixture.setKind=setKind;
 return <main style={{maxWidth:800,margin:'2rem auto',padding:'0 1rem'}}><BitrefillPricingAdmin kind={kind}/></main>}
createRoot(document.getElementById('root')).render(<Harness/>);
`)
const mocks = {
  '@/contexts/SimpleAuth': `import {useEffect,useState} from 'react';export function useAuth(){const[,rerender]=useState(0);
    useEffect(()=>{const cb=()=>rerender(n=>n+1);addEventListener('fixture-user',cb);return()=>removeEventListener('fixture-user',cb)},[]);
    return {user:{id:window.__fixture.actor}}}`,
  '@/lib/supabase': `export const supabase={functions:{invoke:async(_name,{body})=>{
    const f=window.__fixture;f.calls.push(body);
    if(f.mode==='pending_get'&&body.action==='admin_pricing_get')return new Promise(resolve=>f.pending.push({resolve:value=>resolve({data:value,error:null})}));
    if(f.mode==='pending_set'&&body.action==='admin_pricing_set')return new Promise(resolve=>f.pending.push({resolve:value=>resolve({data:value,error:null})}));
    if(f.mode==='error_get'&&body.action==='admin_pricing_get')throw new Error('PRIVATE PROVIDER KEY');
    if(f.mode==='error_set'&&body.action==='admin_pricing_set')throw new Error('PRIVATE PROVIDER KEY');
    if(body.action==='admin_pricing_get')return {data:{success:true,global:{mode:'percent',value:10},overrides:[
      {scope:'product',product_id:'existing-product',package_id:null,unit_value:null,currency:null,mode:'amount',value:50}
    ]},error:null};
    if(body.action==='admin_product_options')return {data:{success:true,product:{product_id:body.product_id,product_name:'Verified top-up',currency:'GBP',
      packages:[{package_id:'p5',unit_value:5},{package_id:'p10',unit_value:10}],range:{min:1,max:20,step:1}}},error:null};
    if(body.action==='admin_pricing_set')return {data:{success:true,changed:true},error:null};
    throw new Error('unexpected action');
  }}}`,
}
await build({ entryPoints: [join(fixtureRoot, 'harness.tsx')], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  absWorkingDir: root, alias: { '@': join(root, 'src') }, outfile: join(fixtureRoot, 'bundle.js'),
  plugins: [{ name: 'mock-service', setup(plugin) {
    plugin.onResolve({ filter: /^@\/(contexts\/SimpleAuth|lib\/supabase)$/ }, args => ({ path: args.path, namespace: 'fixture-mock' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})
const bundle = await readFile(join(fixtureRoot, 'bundle.js'))
const html = await readFile(join(fixtureRoot, 'index.html'))
const cssFile = (await readdir(join(root, 'dist/assets'))).find(file => /^index-.*\.css$/.test(file))
assert.ok(cssFile)
const css = await readFile(join(root, 'dist/assets', cssFile))
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle) }
  else if (request.url === '/styles.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(css) }
  else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html) }
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: edge, headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 740 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(90_000)
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'commit' })
  await page.getByText('Current: Add 10% of supplier cost').waitFor()
  assert.deepEqual((await page.evaluate(() => window.__fixture.calls)).map(call => call.action), ['admin_pricing_get'])
  await page.getByLabel('Method').first().selectOption('amount')
  await page.getByLabel('Amount (₦)').first().fill('125')
  await page.getByRole('button', { name: 'Review global change' }).click()
  assert.equal(await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'admin_pricing_set').length), 0)
  await page.getByText('Set Add ₦125 for global').waitFor()
  await page.getByRole('button', { name: 'Save audited change' }).click()
  await page.getByText('Pricing change was saved and audited.').waitFor()
  const globalSet = await page.evaluate(() => window.__fixture.calls.find(call => call.action === 'admin_pricing_set'))
  assert.deepEqual(globalSet, { action:'admin_pricing_set',kind:'airtime',scope:'global',mode:'amount',value:125 })
  await page.getByLabel('Product ID').fill('verified-uk-product')
  await page.getByRole('button', { name: 'Verify product' }).click()
  await page.getByText('Verified: Verified top-up · GBP').waitFor()
  await page.getByLabel('Apply to').selectOption('denomination')
  await page.locator('select').filter({ has: page.locator('option[value="p10"]') }).selectOption('p10')
  await page.getByLabel('Percentage (%)').last().fill('12.5')
  await page.getByRole('button', { name: 'Review override' }).click()
  await page.getByText('Set Add 12.5% of supplier cost for denomination').waitFor()
  await page.getByRole('button', { name: 'Save audited change' }).click()
  const sets = await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'admin_pricing_set'))
  assert.deepEqual(sets.at(-1), {action:'admin_pricing_set',kind:'airtime',scope:'denomination',product_id:'verified-uk-product',
    package_id:'p10',unit_value:10,currency:'GBP',mode:'percent',value:12.5})
  await page.getByRole('button', { name: 'Review removal' }).click()
  await page.getByText('Remove the override for product').waitFor()
  await page.getByRole('button', { name: 'Save audited change' }).click()
  const removed = await page.evaluate(() => window.__fixture.calls.filter(call => call.action === 'admin_pricing_set').at(-1))
  assert.deepEqual(removed, {action:'admin_pricing_set',kind:'airtime',scope:'product',product_id:'existing-product',remove:true})
  await page.screenshot({ path: join(fixtureRoot, 'airtime-pricing-390.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)

  await page.evaluate(() => window.__fixture.setKind('sms'))
  await page.getByText('SMS pricing').waitFor()
  await page.getByLabel('SMS service code').fill('sms-service')
  await page.getByRole('button', { name: 'Verify product' }).click()
  await page.getByText('Verified: Verified top-up · GBP').waitFor()
  assert.equal(await page.getByRole('option', { name: 'One denomination' }).count(), 0, 'SMS accepts product override only')
  await page.evaluate(() => window.__fixture.setActor('30000000-0000-4000-8000-000000000003'))
  await page.getByText('SMS pricing').waitFor({ state: 'hidden' })
  const callsBefore = await page.evaluate(() => window.__fixture.calls.length)
  await page.evaluate(() => window.__fixture.setKind('gift_card'))
  assert.equal(await page.evaluate(() => window.__fixture.calls.length), callsBefore, 'Non-owner must not call pricing endpoint')
  await page.evaluate(() => window.__fixture.setActor('c1396bda-86e2-4dfc-94bb-0d95469d1d36'))
  await page.getByText('Gift card pricing').waitFor()
  await page.evaluate(() => window.__fixture.setMode('error_set'))
  await page.getByRole('button', { name: 'Review global change' }).click()
  await page.getByRole('button', { name: 'Save audited change' }).click()
  await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor()
  assert.equal(await page.getByText('PRIVATE PROVIDER KEY').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Review global change' }).isDisabled(), true)
  await page.evaluate(() => window.__fixture.setMode('normal'))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('Current: Add 10% of supplier cost').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Review global change' }).isDisabled(), false)
  await page.evaluate(() => window.__fixture.setMode('pending_get'))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('Loading pricing rules…').waitFor()
  await page.evaluate(() => window.__fixture.setActor('30000000-0000-4000-8000-000000000003'))
  await page.getByText('Gift card pricing').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.__fixture.settle({success:true,global:{mode:'amount',value:999999},overrides:[]}))
  await page.evaluate(() => window.__fixture.setMode('normal'))
  await page.evaluate(() => window.__fixture.setActor('c1396bda-86e2-4dfc-94bb-0d95469d1d36'))
  await page.getByText('Current: Add 10% of supplier cost').waitFor()
  assert.equal(await page.getByText('Add ₦999,999').count(), 0, 'Late prior-session pricing result must be ignored')
  assert.deepEqual(errors, [])
  console.log(`Bitrefill pricing actual UI fixture passed. Screenshot: ${join(fixtureRoot, 'airtime-pricing-390.png')}`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
