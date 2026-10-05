// Actual OrderHistoryPage + actual legacy normalizer with synthetic data only.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(),'tally-old-credential-browser-'))
const localRequire = createRequire(join(root,'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const original = '  old-login |  login-pass  | email@example.invalid | mail-pass | 2fa-key |  '
const mockModules = {
  '@/contexts/SimpleAuth': `const user={id:'synthetic-customer',email:'synthetic@example.invalid'};export function useAuth(){return{user,showBalances:true,accountSuspended:false,walletReviewRequired:false,walletReviewedBy:null}}`,
  '@/contexts/CurrencyContext': `export function useCurrency(){return{formatPrice:value=>'NGN '+Number(value).toFixed(2)}}`,
  '@/hooks/use-toast': `export function useToast(){return{toast:()=>{}}}`,
  '@/lib/walletReviewPolicy': `export function isPurchasingPausedByProfile(){return false}`,
  '@/lib/productAvailability': `export function isCustomerSellableProduct(){return true}`,
  '@/lib/supabase': `
    const sample={id:'11111111-1111-4111-8111-111111111111',status:'completed',amount:200,
      created_at:'2026-10-01T12:00:00Z',product_group_id:'synthetic-product',
      account_details:{product_name:'SYNTHETIC LEGACY ORDER',category:'Discord',quantity:1,
        accounts:[{username:${JSON.stringify(original)}}]}};
    export async function getUserOrders(){return[sample]}
    export async function getAllProductGroups(){return[]}
    export async function getCategories(){return[]}
    export async function getAppSetting(){return null}
    export async function getFavoriteProductGroupIds(){return[]}
    export async function getTopSellingProductGroupIds(){return[]}
    export async function getUserPurchaseHistory(){return{productGroupCounts:{},categoryCounts:{},lastPurchasedAtByProductGroup:{},lastPurchasedAtByCategory:{},lastProductGroupId:null}}
  `,
  '@/lib/revenue-os': `
    export function trackRevenueEvent(){}
    export function getCustomerPressureState(){return{}}
    export function getRevenueVisitorId(){return 'synthetic-visitor'}
    export function loadCustomerRelationshipBoosts(){return Promise.resolve({})}
    export function loadRevenueOsSettings(){return new Promise(()=>{})}
    export function loadRunningCroActionPlans(){return Promise.resolve([])}
    export function loadRunningCroExperiments(){return Promise.resolve([])}
    export function rankProductsForRevenueOs(){return[]}
    export function resolveCroAssignment(){return{rankingEnabled:false,mode:'off',experimentId:null,variantId:null}}
  `,
  '@/components/NavbarAuth': `export default function NavbarAuth(){return null}`,
  '@/components/Footer': `export default function Footer(){return null}`,
  '@/components/WalletBalanceWidget': `export default function WalletBalanceWidget(){return null}`,
  '@/components/PageBreadcrumb': `export default function PageBreadcrumb(){return null}`,
  '@/components/ProductTemplateCard': `export default function ProductTemplateCard(){return null}`,
  '@/components/RevampLayout': `import React from 'react';export function RevampCard({children,...props}){return React.createElement('div',props,children)};export function RevampPage({children,...props}){return React.createElement('main',props,children)}`,
  '@/components/ui/button': `import React from 'react';export function Button({children,asChild,...props}){if(asChild&&React.isValidElement(children))return React.cloneElement(children,props);return React.createElement('button',props,children)}`,
  '@/components/ui/card': `import React from 'react';export const Card=({children,...props})=>React.createElement('div',props,children);export const CardContent=Card`,
  '@/components/ui/badge': `import React from 'react';export function Badge({children,...props}){return React.createElement('span',props,children)}`,
  '@/components/ui/input': `import React from 'react';export function Input(props){return React.createElement('input',props)}`,
  '@/components/ui/alert': `import React from 'react';export function Alert({children,...props}){return React.createElement('div',props,children)}`,
  '@/components/ui/select': `import React from 'react';const Box=({children,...props})=>React.createElement('div',props,children);export const Select=Box;export const SelectContent=Box;export const SelectItem=Box;export const SelectTrigger=Box;export const SelectValue=Box`,
}
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import OrderHistoryPage from ${JSON.stringify(join(root,'src/pages/OrderHistoryPage.tsx'))};
createRoot(document.getElementById('app')).render(<BrowserRouter><OrderHistoryPage/></BrowserRouter>);`
await build({stdin:{contents:entry,resolveDir:root,sourcefile:'old-credential-browser-entry.tsx',loader:'tsx'},
  bundle:true,format:'iife',platform:'browser',target:'es2022',outfile:join(temporary,'bundle.js'),jsx:'automatic',absWorkingDir:root,
  plugins:[{name:'mock-services',setup(plugin){
    plugin.onResolve({filter:/^@\/lib\/orderCredentials$/},()=>({path:join(root,'src/lib/orderCredentials.ts')}))
    plugin.onResolve({filter:/^@\//},args=>mockModules[args.path]
      ?{path:args.path,namespace:'mock-services'}:{path:join(root,'src',args.path.slice(2))})
    plugin.onLoad({filter:/.*/,namespace:'mock-services'},args=>({contents:mockModules[args.path],loader:'tsx',resolveDir:root}))
  }}]})
const bundle = await readFile(join(temporary,'bundle.js'))
const server = createServer((request,response)=>{
  if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundle)}
  else{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>')}
})
let browser
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  browser=await chromium.launch({executablePath:edge,headless:true})
  const context=await browser.newContext({viewport:{width:390,height:700},acceptDownloads:true})
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin})
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
  const page=await context.newPage()
  page.setDefaultTimeout(30_000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('button',{name:'View Details'}).click()
  await page.getByText('ORIGINAL STOCK LINE').waitFor()
  await page.evaluate(()=>{
    const write=navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText=value=>{window.__copied=value;return write(value)}
  })
  await page.getByRole('button',{name:'Copy ORIGINAL STOCK LINE'}).click()
  assert.equal(await page.evaluate(()=>window.__copied),original,'Copy must receive the exact stored line')
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),original)
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download'}).click()])
  const txt=await readFile(await download.path(),'utf8')
  assert.ok(txt.includes(`ORIGINAL STOCK LINE: ${original}`),'TXT must retain the exact stored line')
  assert.deepEqual(errors,[])
  console.log('Historical credential browser copy/TXT passed with exact original stock line.')
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
