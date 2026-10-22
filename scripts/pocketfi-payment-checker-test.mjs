import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const first = '10000000-0000-4000-8000-000000000001'
const second = '10000000-0000-4000-8000-000000000002'
const checkId = '20000000-0000-4000-8000-000000000001'
const row = {
  result_key: 'payment:example', reference: 'PAYMENT-REFERENCE-WITH-ALL-CHARACTERS',
  customer_id: first, customer_email: 'private-customer@example.com', account_number: '••••1234',
  received_at: '2026-10-22T10:00:00Z', amount_ngn: 2500, expected_credit_ngn: 2500, fee_ngn: null,
  fee_note: 'Provider fee not confirmed separately.', webhook_state: 'verified_success', credit_state: 'not_found',
  status: 'paid_credit_missing', transaction_id: null, credited_at: null, credited_amount_ngn: null,
  reasons: ['Verified payment has no matching wallet credit.'], can_flag: true,
}
const result = (reference = row.reference) => ({ check_id: checkId, checked_at: '2026-10-22T10:10:00Z',
  search_type: 'reference', search: reference, results: [{ ...row, reference }], truncated: false })
const source = readFileSync(join(root, 'src/lib/pocketfiPaymentCheck.ts'), 'utf8').replace(/^import .*$/gm, '')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

function fixture({ session = async () => ({ data: { session: { access_token: 'PRIVATE_JWT', user: { id: first } } }, error: null }), rpc } = {}) {
  const timers = new Map()
  const calls = []
  const exports = {}
  vm.runInNewContext(code, { exports, AbortController, Error, Promise, Set, Date, Intl, Number,
    supabase: { auth: { getSession: session }, rpc(name, args) { return { abortSignal(signal) {
      calls.push({ name, args, signal }); return rpc ? rpc(name, args, signal) : Promise.resolve({ data: result(), error: null })
    } } } }, setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  return { exports, calls, timers, expire() { assert.equal(timers.size, 1); [...timers.values()][0]() } }
}

let test = fixture()
await test.exports.checkPocketfiPayments('reference', ` ${row.reference} `, { expectedUserId: first })
assert.equal(test.calls[0].name, 'staff_check_pocketfi_payments')
assert.equal(test.calls[0].args.p_limit, 50)
assert.equal(test.timers.size, 0)
assert.throws(() => test.exports.parsePocketfiPaymentCheck({ ...result(), results: Array(51).fill(row) }), /could not be verified/)
assert.throws(() => test.exports.parsePocketfiPaymentRow({ ...row, status: 'made_up_success' }), /could not be verified/)
for (const inconsistent of [
  { ...row, status: 'paid_and_credited' }, { ...row, status: 'failed' }, { ...row, status: 'pending' },
  { ...row, expected_credit_ngn: 2450 },
]) assert.throws(() => test.exports.parsePocketfiPaymentRow(inconsistent), /could not be verified/)
assert.equal(test.exports.parsePocketfiPaymentRow({ ...row, webhook_state: 'unverified', status: 'needs_review',
  credit_state: 'credited', credited_amount_ngn: 2500, transaction_id: '40000000-0000-4000-8000-000000000001' }).credit_state,
'credited', 'Historical posted credit must remain distinct from missing webhook authenticity.')
const noWebhook = test.exports.parsePocketfiPaymentRow({ ...row, status: 'no_webhook', webhook_state: 'not_found' })
assert.match(test.exports.pocketfiCustomerSummary(noWebhook), /does not mean the payment failed/)
const publicRow = test.exports.parsePocketfiPaymentRow({ ...row, raw_body: 'PRIVATE_PROVIDER_SECRET', authorization: 'PRIVATE_JWT' })
assert.equal(publicRow.raw_body, undefined)
const summary = test.exports.pocketfiCustomerSummary(publicRow, '2026-10-22T10:10:00Z')
assert.match(summary, new RegExp(row.reference))
assert.match(summary, /WAT/)
assert.doesNotMatch(summary, /private-customer|1234|PRIVATE_|Verified payment has/)
assert.throws(() => test.exports.validatePocketfiSearch('email', 'partial@example'), /full email/)
assert.throws(() => test.exports.validatePocketfiSearch('account_number', '123'), /full receiving/)

test = fixture()
await assert.rejects(test.exports.checkPocketfiPayments('reference', row.reference, { expectedUserId: second }), /permission/)
assert.equal(test.calls.length, 0)
let resolveSession
test = fixture({ session: () => new Promise(resolve => { resolveSession = resolve }) })
let pending = test.exports.checkPocketfiPayments('reference', row.reference, { expectedUserId: first })
test.expire()
await assert.rejects(pending, /timed out/)
resolveSession({ data: { session: { access_token: 'PRIVATE_LATE_JWT', user: { id: first } } }, error: null })
await Promise.resolve()
assert.equal(test.calls.length, 0, 'late session must not start a request after its deadline')

let started
const rpcStarted = new Promise(resolve => { started = resolve })
test = fixture({ rpc: async () => { started(); return new Promise(() => {}) } })
const abort = new AbortController()
pending = test.exports.checkPocketfiPayments('reference', row.reference, { expectedUserId: first, signal: abort.signal })
await rpcStarted
abort.abort()
await assert.rejects(pending, /unavailable/)
assert.equal(test.calls[0].signal.aborted, true)
assert.equal(test.timers.size, 0)
test = fixture({ rpc: async () => ({ error: { code: 'XX001', message: 'PRIVATE_JWT DATABASE_SECRET' }, data: null }) })
await assert.rejects(test.exports.checkPocketfiPayments('reference', row.reference, { expectedUserId: first }), error => {
  assert.equal(error.message, 'Payment checking is unavailable. Please retry.'); return true
})
test = fixture({ rpc: async () => ({ error: null, data: { error: 'POCKETFI_CHECK_UNAVAILABLE', message: 'PRIVATE_RAW_DETAIL' } }) })
await assert.rejects(test.exports.checkPocketfiPayments('reference', row.reference, { expectedUserId: first }), /temporarily unavailable/)

const uiPackage = [process.env.TALLYSTORE_UI_TEST_PACKAGE, join(root, 'scripts/ui-review.local/package.json'),
  resolve(root, '../tallystore/scripts/ui-review.local/package.json')].find(path => path && existsSync(path))
assert(uiPackage, 'Install the local UI review harness or set TALLYSTORE_UI_TEST_PACKAGE.')
const localRequire = createRequire(uiPackage)
const { chromium } = localRequire('playwright')
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import Checker from '@/components/admin/PocketfiPaymentChecker';
window.fixture={userId:'${first}',admin:false,pending:[],calls:[],copied:'',
  resolve(index,data){this.pending[index].resolve({data,error:null})},reject(index){this.pending[index].resolve({error:{code:'XX001',message:'PRIVATE_DATABASE_SECRET'},data:null})},
  setUser(id){this.userId=id;dispatchEvent(new Event('fixture-user'))},setAdmin(value){this.admin=value;dispatchEvent(new Event('fixture-user'))}};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text)=>{window.fixture.copied=text}}});
function App(){const [,set]=React.useState(0);React.useEffect(()=>{const fn=()=>set(n=>n+1);addEventListener('fixture-user',fn);return()=>removeEventListener('fixture-user',fn)},[]);return <Checker admin={window.fixture.admin}/>}
createRoot(document.getElementById('root')).render(<App/>);`
const mocks = {
  '@/contexts/SimpleAuth': `export function useAuth(){return {user:{id:window.fixture.userId}}}`,
  '@/lib/supabase': `export const supabase={auth:{async getSession(){return {data:{session:{access_token:'PRIVATE_JWT',user:{id:window.fixture.userId}}},error:null}}},
    rpc(name,args){return {abortSignal(signal){window.fixture.calls.push({name,args});return new Promise((resolve,reject)=>window.fixture.pending.push({resolve,reject,signal}))}}}}`,
}
const bundled = await build({ stdin: { contents: harness, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', alias: { '@': join(root, 'src') },
  plugins: [{ name: 'mock-checker', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture' } : undefined)
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }))
  } }],
})
const bundle = bundled.outputFiles[0].contents
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle) }
  else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<div id="root"></div><script src="/bundle.js"></script>') }
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  assert.equal(await page.getByRole('button', { name: 'Admin review queue' }).count(), 0)
  await page.getByLabel('Full payment reference').fill('FIRST-REFERENCE')
  await page.getByRole('button', { name: 'Check payment', exact: true }).click()
  await page.evaluate(() => window.fixture.reject(0))
  await page.getByRole('button', { name: 'Retry / Recheck' }).waitFor()
  assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_DATABASE_SECRET/)
  await page.getByRole('button', { name: 'Retry / Recheck' }).click()
  await page.evaluate(data => window.fixture.resolve(1, data), result('FIRST-REFERENCE'))
  await page.getByText('Matching wallet credit found', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('No matching wallet credit found', { exact: true }).waitFor()
  await page.getByText('Verified: successful', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Copy customer summary' }).click()
  const copied = await page.evaluate(() => window.fixture.copied)
  assert.match(copied, /FIRST-REFERENCE/)
  assert.doesNotMatch(copied, /private-customer|1234|PRIVATE_|Verified payment has/)
  await page.getByRole('button', { name: 'Flag for admin' }).click()
  await page.getByLabel('Note for the admin').fill('Customer reports a missing credit; please review.')
  await page.getByRole('button', { name: 'Send for review', exact: true }).click()
  await page.evaluate(() => window.fixture.resolve(2, {review_id:'30000000-0000-4000-8000-000000000001',status:'pending',already_flagged:false}))
  await page.getByText('Sent to the admin review queue. No wallet balance was changed.').waitFor()
  assert.equal(await page.evaluate(() => window.fixture.calls[2].name), 'staff_flag_pocketfi_payment')

  await page.getByLabel('Full payment reference').fill('OLD-SEARCH')
  await page.getByRole('button', { name: 'Check payment', exact: true }).click()
  await page.getByLabel('Full payment reference').fill('NEW-SEARCH')
  await page.getByRole('button', { name: 'Check payment', exact: true }).click()
  await page.evaluate(data => window.fixture.resolve(4, data), result('NEW-SEARCH'))
  await page.getByRole('heading', { name: 'NEW-SEARCH' }).waitFor()
  await page.evaluate(data => window.fixture.resolve(3, data), result('OLD-SEARCH'))
  assert.equal(await page.getByRole('heading', { name: 'OLD-SEARCH' }).count(), 0)
  await page.evaluate(id => window.fixture.setUser(id), second)
  await page.getByRole('heading', { name: 'NEW-SEARCH' }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByLabel('Full payment reference').inputValue(), '')
  await page.evaluate(() => window.fixture.setAdmin(true))
  await page.getByRole('button', { name: 'Admin review queue' }).click()
  await page.evaluate(() => window.fixture.resolve(5, { reviews: [], truncated: false }))
  await page.getByText('No pending payment reviews.').waitFor()
  const names = await page.evaluate(() => window.fixture.calls.map(call => call.name))
  assert(names.every(name => ['staff_check_pocketfi_payments', 'staff_flag_pocketfi_payment', 'admin_list_pocketfi_payment_reviews'].includes(name)), 'UI must never call a credit/refund/replay/provider endpoint')
} finally {
  if (browser?.isConnected()) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
console.log('PocketFi checker: session/deadline/abort/redaction/contract bounds, browser Retry/search race/account clearing/customer-safe copy/read-only flag and admin queue passed.')
