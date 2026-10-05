// Actual dialog and CSS; synthetic account/settings, blocked remote requests.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const root = resolve(import.meta.dirname,'../..')
const require = createRequire(import.meta.url)
const { chromium } = createRequire(join(root,'scripts/ui-review.local/package.json'))('playwright')
const config = require('tailwindcss/loadConfig')(join(root,'tailwind.config.ts'))
const css = (await postcss([tailwindcss({ ...config, safelist:['dark'], content:[join(root,'src/components/LoginWelcomeDialog.tsx'),join(root,'src/components/NavbarAuth.tsx'),join(root,'src/components/ui/*.{ts,tsx}')] }),autoprefixer()])
  .process(await readFile(join(root,'src/index.css'),'utf8'),{from:join(root,'src/index.css')})).css
const temporary = await mkdtemp(join(tmpdir(),'tally-welcome-ui-'))
const outfile = join(temporary,'bundle.js')
const mocks = {
  '@/contexts/SimpleAuth': `import {useSyncExternalStore} from 'react';
    function subscribe(f){addEventListener('fixture-change',f);return()=>removeEventListener('fixture-change',f)}
    export function useAuth(){useSyncExternalStore(subscribe,()=>window.__fixture.version);return window.__fixture.auth}`,
  '@/hooks/useSupportSettings': `import {useSyncExternalStore} from 'react';
    function subscribe(f){addEventListener('fixture-change',f);return()=>removeEventListener('fixture-change',f)}
    export function useSupportSettings(){useSyncExternalStore(subscribe,()=>window.__fixture.version);return window.__fixture.settings}`,
  '@/contexts/CurrencyContext': `export function useCurrency(){return{currency:'NGN',toggleCurrency(){},formatPrice:()=> 'NGN 1200'}}`,
  '@/components/ThemeToggle': `export function ThemeToggle(){return null}`,
  '@/components/InstallAppDialog': `export default function InstallAppDialog(){return null}`,
  '@/hooks/usePWAInstall': `export function usePWAInstall(){return{isInstalled:true}}`,
  '@/hooks/use-toast': `export function useToast(){return{toast(){}}}`,
}
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
  import {BrowserRouter} from 'react-router-dom';
  import Navbar from ${JSON.stringify(join(root,'src/components/NavbarAuth.tsx'))};
  import Welcome from ${JSON.stringify(join(root,'src/components/LoginWelcomeDialog.tsx'))};
  const mode=new URLSearchParams(location.search).get('case');
  window.__fixture={version:0,auth:{user:{id:'synthetic-user'},loading:false,roleLookupError:null,isAdmin:false,isStaff:false,walletBalance:1200,showBalances:true},
    settings:{loading:false,whatsappUrl:'',telegramUrl:'https://example.com/support',channelUrl:'https://example.com/channel',
      popupMessage:mode==='short'?'Service is ready. Please check your order details.':
      'Service restored. Read this announcement before continuing.\\n\\n'+('Clear store update with all the details visible.\\n').repeat(24)+'FINAL MESSAGE LINE'}};
  if(mode==='unsafe'){window.__fixture.settings.popupMessage='<img src=x onerror="window.__unsafe=true">';
    window.__fixture.settings.telegramUrl='javascript:alert(1)';window.__fixture.settings.channelUrl='https://user:password@example.com/'}
  if(mode==='storage-denied'){Storage.prototype.getItem=()=>{throw Error('Storage denied')};Storage.prototype.setItem=()=>{throw Error('Storage denied')}}
  createRoot(document.getElementById('app')).render(<BrowserRouter><Navbar/><Welcome/></BrowserRouter>);`,resolveDir:root,sourcefile:'welcome-test.tsx',loader:'tsx'},
  absWorkingDir:root,bundle:true,outfile,format:'iife',platform:'browser',jsx:'automatic',target:'es2022',
  plugins:[{name:'synthetic-only',setup(p){p.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mocks'}:
    {path:join(root,'src',a.path.slice(2))+(['@/components/ui/button','@/components/ui/dropdown-menu'].includes(a.path)?'.tsx':'.ts')});
    p.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}))}}]})
const bundle = await readFile(outfile)
const logo = await readFile(join(root,'public/TALLYAPPLOGO.png'))
const server=createServer((request,response)=>{
  if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundle)}
  else if(request.url==='/style.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(css)}
  else if(request.url==='/TALLYAPPLOGO.png'){response.writeHead(200,{'Content-Type':'image/png'});response.end(logo)}
  else{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main style="height:2500px">Synthetic background</main><div id="app"></div><script src="/bundle.js"></script></body></html>')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
try {
  browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,timeout:60000})
  const context=await browser.newContext({viewport:{width:390,height:700}})
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort())
  const page=await context.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const screenshots=join(root,'scripts/ui-review.local/announcement')
  await mkdir(screenshots,{recursive:true})
  async function load(mode,width,height){
    await page.setViewportSize({width,height});await page.goto(`${origin}/?case=${mode}`)
    await page.evaluate(()=>window.scrollTo(0,1000))
    const dialog=page.getByRole('dialog',{name:'Store announcement'})
    await dialog.waitFor()
    const box=await dialog.boundingBox()
    assert.ok(box.x>=15 && box.x+box.width<=width-15 && box.y>=0 && box.y+box.height<=height,
      'Centered dialog must fit the viewport, including when the page was scrolled')
    assert.ok(Math.abs(box.y+box.height/2-height/2)<2)
    assert.ok(box.height<=height*0.85+1)
    assert.equal(await page.getByRole('button',{name:'Close announcement'}).isVisible(),true)
    assert.equal(await page.getByRole('button',{name:'Got it',exact:true}).isVisible(),true)
    return dialog
  }
  await load('short',390,700)
  await page.screenshot({path:join(screenshots,'short-mobile.png')})
  await page.evaluate(()=>document.documentElement.classList.remove('dark'))
  await page.screenshot({path:join(screenshots,'short-mobile-light.png')})
  await page.getByRole('button',{name:'Got it',exact:true}).click()
  await page.reload();await page.waitForTimeout(1000)
  assert.equal(await page.getByRole('dialog').count(),0,'Dismissed announcement repeated in same session')
  await page.goto(`${origin}/travel-visa?case=short`)
  await page.getByRole('button',{name:'Open navigation menu'}).click()
  const navigation=page.getByRole('dialog',{name:'TallyStore.'})
  await navigation.waitFor()
  const marker=navigation.locator('img[data-selected-menu-marker]')
  assert.equal(await marker.count(),1)
  assert.equal(await marker.getAttribute('data-selected-menu-marker'),'Travel & Visa')
  assert.equal(await marker.evaluate(e=>e.closest('a').getAttribute('href')),'/travel-visa')
  const navBox=await navigation.boundingBox(), markerBox=await marker.boundingBox()
  assert.ok(markerBox.x>navBox.x+navBox.width*0.7,'Selected logo must sit on the right of the row')
  assert.ok(await marker.evaluate(e=>e.complete && e.naturalWidth>0),'Selected logo failed to load')
  await page.screenshot({path:join(screenshots,'selected-travel-menu.png')})
  await page.getByRole('button',{name:'Close navigation menu'}).click()
  const dialog=await load('long',320,480)
  const message=page.getByRole('region',{name:'Announcement message'})
  assert.ok((await message.boundingBox()).y<180,'Message must begin near the top, not below support links')
  assert.equal(await dialog.locator('img').count(),0,'Branding must not be added to announcements')
  await page.screenshot({path:join(screenshots,'long-short-screen.png')})
  await dialog.locator('.overflow-y-auto').evaluate(e=>{e.scrollTop=e.scrollHeight})
  await page.getByRole('link',{name:'Telegram support'}).scrollIntoViewIfNeeded()
  assert.equal(await page.getByRole('link',{name:'Telegram support'}).isVisible(),true)
  for(let i=0;i<6;i++)await page.keyboard.press('Tab')
  assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true,'Keyboard focus escaped modal')
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0)
  await load('unsafe',390,700)
  assert.equal(await page.getByRole('dialog').locator('img').count(),0,'Message HTML executed')
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0)
  assert.equal(await page.getByRole('link',{name:'Help Centre'}).count(),1,'Unsafe links must use safe help fallback')
  await page.getByRole('button',{name:'Got it',exact:true}).click()
  await load('storage-denied',390,700)
  await page.getByRole('button',{name:'Got it',exact:true}).click()
  assert.equal(await page.getByRole('dialog').count(),0)
  assert.deepEqual(errors,[])
  console.log('Announcement browser checks passed: centered mobile bounds, readable message first, scroll, fixed dismiss, focus, session dismissal, escaped text and safe links.')
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r))}
