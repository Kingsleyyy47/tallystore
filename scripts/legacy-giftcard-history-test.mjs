// Real component in an isolated browser; all Supabase responses are synthetic.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(root, 'scripts/ui-review.local/legacy-gift-history-'))
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const code = '  FULL-LONG-CODE-' + 'X'.repeat(170) + '  '
const pin = ' 1234\nSECOND LINE '
const link = 'https://example.invalid/redeem?token=synthetic'
const history = [
  { id:'11111111-1111-4111-8111-111111111111', reference:'SYNTHETIC-ONE', product_name:'SYNTHETIC CARD',
    quantity:3, amount_ngn:14000, status:'successful', redemption_code:code, redemption_pin:pin,
    redemption_link:link, created_at:'2026-10-01T12:00:00Z' },
  { id:'22222222-2222-4222-8222-222222222222', reference:'SYNTHETIC-TWO', product_name:'PENDING CARD',
    quantity:1, amount_ngn:2000, status:'pending', redemption_code:'DO-NOT-SHOW', redemption_pin:null,
    redemption_link:'javascript:alert(1)', created_at:'2026-10-02T12:00:00Z' },
  { id:'33333333-3333-4333-8333-333333333333', reference:'SYNTHETIC-THREE', product_name:'UNSAFE LINK CARD',
    quantity:1, amount_ngn:3000, status:'successful', redemption_code:null, redemption_pin:null,
    redemption_link:'javascript:alert(2)', created_at:'2026-10-03T12:00:00Z' },
  { id:'44444444-4444-4444-8444-444444444444', reference:'SYNTHETIC-FOUR', product_name:'INSECURE HTTP CARD',
    quantity:1, amount_ngn:4000, status:'successful', redemption_code:null, redemption_pin:null,
    redemption_link:'http://example.invalid/redeem', created_at:'2026-10-04T12:00:00Z' },
]

const authMock = `
import { useEffect, useState } from 'react'
let current = 'account-a'
const listeners = new Set()
export function switchUser(id) { current = id; for (const listener of listeners) listener(id) }
export function useAuth() {
  const [id,setId] = useState(current)
  useEffect(() => { listeners.add(setId); return () => listeners.delete(setId) }, [])
  return { user: id ? { id } : null }
}`
const supabaseMock = `
export const supabase = { rpc(name) {
  if (name !== 'get_my_bitrefill_order_history') throw new Error('Unexpected RPC')
  const f = window.__fixture
  f.calls.push({ name, userId:f.userId })
  let promise
  if (f.mode === 'pending') promise = new Promise((resolve,reject) => f.pending.push({ resolve,reject }))
  else if (f.mode === 'error') promise = Promise.resolve({ data:null,error:new Error('private supplier error') })
  else if (f.mode === 'empty') promise = Promise.resolve({ data:[],error:null })
  else promise = Promise.resolve({ data:f.mode === 'other' ? [{...f.rows[0],product_name:'OTHER ACCOUNT CARD',redemption_code:'OTHER-ONLY'}] : f.rows,error:null })
  promise.abortSignal = () => promise
  return promise
} }`
await writeFile(join(fixtureRoot, 'harness.tsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import LegacyGiftCardHistory from '@/components/LegacyGiftCardHistory'
import { switchUser } from '@/contexts/SimpleAuth'
window.__fixture = { mode:new URLSearchParams(location.search).get('mode') || 'success', calls:[], pending:[],
  userId:'account-a', rows:${JSON.stringify(history)},
  setMode(mode) { this.mode=mode },
  setUser(id) { this.userId=id; switchUser(id) },
  settle(data) { const item=this.pending.shift(); item?.resolve({data,error:null}) } }
createRoot(document.getElementById('root')).render(<LegacyGiftCardHistory />)
`)
await writeFile(join(fixtureRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script defer src="/bundle.js"></script></body></html>')
await build({ entryPoints:[join(fixtureRoot,'harness.tsx')], bundle:true, platform:'browser',
  format:'iife', target:'es2022', jsx:'automatic', absWorkingDir:root,
  outfile:join(fixtureRoot,'bundle.js'), plugins:[{ name:'mocks', setup(plugin) {
    plugin.onResolve({filter:/^@\/contexts\/SimpleAuth$/},()=>({path:'auth',namespace:'mock'}))
    plugin.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}))
    plugin.onResolve({filter:/^@\//},args=>({path:join(root,'src',args.path.slice(2)+'.tsx')}))
    plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='auth'?authMock:supabaseMock,loader:'tsx',resolveDir:root}))
  }}] })
let css = ''
try {
  const file = (await readdir(join(root,'dist/assets'))).find(name=>/^index-.*\.css$/.test(name))
  if (file) css = await readFile(join(root,'dist/assets',file),'utf8')
} catch { /* layout still renders without a previous build */ }
const bundle = await readFile(join(fixtureRoot,'bundle.js'))
const html = await readFile(join(fixtureRoot,'index.html'))
const server = createServer((request,response)=>{
  if (request.url==='/bundle.js') { response.writeHead(200,{'Content-Type':'application/javascript'}); response.end(bundle) }
  else if (request.url==='/styles.css') { response.writeHead(200,{'Content-Type':'text/css'}); response.end(css) }
  else { response.writeHead(200,{'Content-Type':'text/html'}); response.end(html) }
})
let browser
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  browser=await chromium.launch({executablePath:edge,headless:true})
  const context=await browser.newContext({viewport:{width:390,height:700},acceptDownloads:true})
  context.setDefaultTimeout(30_000)
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin})
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/?mode=success')
  await page.getByText('SYNTHETIC CARD').waitFor()
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = value => { window.__fixture.copied = value; return original(value) }
  })
  assert.equal(await page.getByText(/This older order records one set/).count(),1)
  assert.equal(await page.getByText('DO-NOT-SHOW').count(),0)
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0)
  assert.equal(await page.locator('a[href^="http:"]').count(),0)
  assert.equal(await page.getByRole('link',{name:'Open redemption link'}).count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.getByRole('button',{name:'Copy Code'}).click()
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),code)
  await page.getByRole('button',{name:'Copy PIN'}).click()
  assert.equal(await page.evaluate(()=>window.__fixture.copied),pin,'Copy must pass the exact original multiline PIN')
  assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),pin)
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download details TXT'}).first().click()])
  const txt=await readFile(await download.path(),'utf8')
  assert.ok(txt.includes(`Code: ${code}\n`))
  assert.ok(txt.includes(`PIN: ${pin}\n`))
  assert.ok(txt.includes(`Link: ${link}\n`))
  await page.screenshot({path:join(fixtureRoot,'legacy-history-390.png'),fullPage:true})

  await page.goto(origin+'/?mode=error')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByText('private supplier error').count(),0)
  await page.evaluate(()=>window.__fixture.setMode('success'))
  await page.getByRole('button',{name:'Retry'}).click()
  await page.getByText('SYNTHETIC CARD').waitFor()

  await page.goto(origin+'/?mode=empty')
  await page.getByText('No previous gift-card orders found.').waitFor()
  await page.goto(origin+'/?mode=pending')
  await page.getByText('Loading previous orders…').waitFor()
  await page.evaluate(()=>{window.__fixture.setMode('other');window.__fixture.setUser('account-b')})
  await page.getByText('OTHER ACCOUNT CARD').waitFor()
  await page.evaluate(rows=>window.__fixture.settle(rows),history)
  assert.equal(await page.getByText('SYNTHETIC CARD').count(),0,'Old account result must not render')
  await page.evaluate(()=>window.__fixture.setUser(null))
  await page.getByText('Sign in to view previous orders.').waitFor()
  assert.equal(await page.getByText('OTHER ACCOUNT CARD').count(),0,'Signed-out panel must clear credentials')
  assert.deepEqual(errors,[])
  console.log(`Legacy gift-card history browser tests passed; 390px screenshot: ${join(fixtureRoot,'legacy-history-390.png')}`)
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)) }
