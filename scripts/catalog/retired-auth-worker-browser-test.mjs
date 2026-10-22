// Real local browser + two worker versions. No Supabase/provider traffic.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '../..')
const dependency = [join(root, 'scripts/ui-review.local/package.json'),
  join(root, '../tallystore/scripts/ui-review.local/package.json')].find(existsSync)
assert.ok(dependency, 'Local browser test dependency is required')
const { chromium } = createRequire(dependency)('playwright')
const temporary = await mkdtemp(join(tmpdir(), 'tally-retired-auth-'))
const bundlePath = join(temporary, 'fixture.js')
const assets = await readFile(join(root, 'public/sw-assets.js'))
const registerSource = await readFile(join(root, 'node_modules/vite-plugin-pwa/dist/client/build/register.js'), 'utf8')
const register = registerSource.replaceAll('"__SW_AUTO_UPDATE__"', '"true"')
  .replaceAll('"__SW_SELF_DESTROYING__"', '"false"').replaceAll('"__SW__"', '"/sw.js"')
  .replaceAll('"__SCOPE__"', '"/"').replaceAll('"__TYPE__"', '"classic"')
const entry = `import { registerSW } from 'virtual:pwa-register';
  import { createAutomaticReloadGate } from ${JSON.stringify(join(root, 'src/lib/automaticUpdateSafety.ts'))};
  const gate = createAutomaticReloadGate({buildVersion:document.documentElement.dataset.build,quietMilliseconds:100,
    reload:()=>{sessionStorage.setItem('automatic_reload','1');location.reload();}});
  registerSW({immediate:true,onNeedReload:()=>{window.__needs=true;gate();},
    onRegisteredSW:(_url,r)=>window.__registration=r});
  document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();
    fetch('https://dssvvswvqnxanyzfhixf.supabase.co/auth/v1/token?grant_type=password',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'synthetic@example.invalid',password:'SYNTHETIC_DO_NOT_FORWARD'})
    }).then(async r=>{window.__result={status:r.status,body:await r.json()};}).catch(()=>{window.__requestFailed=true;});});`
await build({stdin:{contents:entry,resolveDir:root,sourcefile:'fixture.ts',loader:'ts'},bundle:true,
  format:'iife',platform:'browser',target:'es2022',outfile:bundlePath,absWorkingDir:root,
  plugins:[{name:'actual-pwa-register',setup(p){p.onResolve({filter:/^virtual:pwa-register$/},()=>({path:'register',namespace:'fixture'}));
    p.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:register,loader:'js',resolveDir:root}));}}]})
const bundle = await readFile(bundlePath)
const generatedWorker = await readFile(join(root, 'dist/sw.js'), 'utf8')
const workboxName = generatedWorker.match(/\.\/(workbox-[A-Za-z0-9_-]+)"/)?.[1]
assert.ok(workboxName, 'Production build must provide its actual Workbox runtime')
const workboxRuntime = await readFile(join(root, `dist/${workboxName}.js`))
const actualWorker = generatedWorker.replace(/s\.precacheAndRoute\(\[.*?\],\{\}\)/,
  's.precacheAndRoute([{url:"index.html",revision:"local-v2"}],{})')
assert.notEqual(actualWorker, generatedWorker, 'Could not narrow actual production precache for this local fixture')
let version = 'v1'
const worker = () => version === 'v2' ? `${actualWorker}\n
  self.addEventListener('message',event=>{if(event.data==='VERSION')event.ports[0].postMessage('v2');});`
  : `
  const version=${JSON.stringify(version)};
  self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
  self.addEventListener('message',event=>{if(event.data==='VERSION')event.ports[0].postMessage(version);});`
const server = createServer((request,response)=>{
  const path = new URL(request.url,'http://localhost').pathname
  response.setHeader('Cache-Control','no-store')
  if(path===`/${workboxName}.js`){response.setHeader('Content-Type','application/javascript');response.end(workboxRuntime)}
  else if(path==='/sw.js'||path==='/sw-assets.js'||path==='/fixture.js'){
    response.setHeader('Content-Type','application/javascript');
    if(path==='/sw.js')response.setHeader('Service-Worker-Allowed','/');
    response.end(path==='/sw.js'?worker():path==='/sw-assets.js'?assets:bundle)
  }else{response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html data-build="${version}"><body>
    <form><input aria-label="Login password" type="password"><button>Sign in</button></form><script src="/fixture.js"></script></body></html>`)}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try{
  browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,
    args:['--host-resolver-rules=MAP *.supabase.co 127.0.0.1'],timeout:60000})
  for(const path of ['/login','/checkout']){
    version='v1'
    const context=await browser.newContext({serviceWorkers:'allow'});context.setDefaultTimeout(20000)
    let externalRequests=0
    await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();externalRequests++;return route.abort();})
    const page=await context.newPage()
    await page.goto(origin+path)
    await page.waitForFunction(()=>!!window.__registration&&!!navigator.serviceWorker.controller)
    await page.getByLabel('Login password').fill('synthetic unsaved password')
    version='v2'
    await page.evaluate(()=>window.__registration.update())
    await page.waitForFunction(async()=>await new Promise(resolve=>{
      const channel=new MessageChannel();channel.port1.onmessage=event=>resolve(event.data==='v2');
      navigator.serviceWorker.controller.postMessage('VERSION',[channel.port2]);
    }))
    await page.waitForFunction(()=>window.__needs===true)
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('automatic_reload')),null,'Dirty login/checkout must stay until submit')
    assert.equal(await page.getByLabel('Login password').inputValue(),'synthetic unsaved password')
    await page.getByRole('button',{name:'Sign in'}).click()
    if(path==='/login'){
      await page.waitForURL('**/login?store_updated=1')
      assert.equal(await page.locator('html').getAttribute('data-build'),'v2','Recovery must load current page')
      assert.equal(await page.getByLabel('Login password').inputValue(),'','Password is discarded on recovery, never retained')
      await page.getByRole('button',{name:'Sign in'}).click()
      await page.waitForFunction(()=>window.__result?.status===409)
      assert.equal(page.url(),origin+'/login?store_updated=1','Marker prevents repeated recovery navigation')
    }else{
      await page.waitForFunction(()=>window.__result?.status===409)
      assert.equal(page.url(),origin+'/checkout','Checkout must never be forced to reload')
      assert.equal(await page.getByLabel('Login password').inputValue(),'synthetic unsaved password')
    }
    assert.equal(externalRequests,0,'Retired credentials must not reach the network')
    await context.close()
  }
  console.log('Real browser: new worker activates while dirty old page waits; retired sign-in safely refreshes login once; checkout untouched; zero external requests passed.')
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
