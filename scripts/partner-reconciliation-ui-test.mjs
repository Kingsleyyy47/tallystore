// Synthetic browser test of the real owner reconciliation component. All service calls are local fixtures.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(root, 'scripts/ui-review.local/partner-reconciliation-'))
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const localRequire = createRequire(join(root, 'scripts/ui-review.local/package.json'))
const { chromium } = localRequire('playwright')
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const firstId = '10000000-0000-4000-8000-000000000001'
const thirdId = '10000000-0000-4000-8000-000000000003'
const acceptedId = '10000000-0000-4000-8000-000000000004'
const rejectedPrepaidId = '10000000-0000-4000-8000-000000000005'
const rejectedUnlimitedId = '10000000-0000-4000-8000-000000000006'
const proofHash = 'a'.repeat(64)

await writeFile(join(fixtureRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/harness.tsx"></script></body></html>')
await writeFile(join(fixtureRoot, 'harness.tsx'), String.raw`
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PartnerReconciliationPanel from '@/components/PartnerReconciliationPanel';
import '@/index.css';
const OWNER = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const thirdId = '10000000-0000-4000-8000-000000000003';
const acceptedId = '10000000-0000-4000-8000-000000000004';
const rejectedPrepaidId = '10000000-0000-4000-8000-000000000005';
const rejectedUnlimitedId = '10000000-0000-4000-8000-000000000006';
const unknownId = '10000000-0000-4000-8000-000000000007';
const malformedId = '10000000-0000-4000-8000-000000000008';
const activeId = '10000000-0000-4000-8000-000000000009';
const completedId = '10000000-0000-4000-8000-00000000000a';
const proofHash = 'a'.repeat(64);
const row = (order_id, probe_available, state = 'unknown') => ({ order_id, section: 'sms', state,
 order_status: 'processing', amount_ngn: 12345.67,
 created_at: '2026-10-05T12:00:00Z', claimed_at: '2026-10-05T12:01:00Z', probe_available });
const recoverable = (order_id, outcome, funding_type) => ({ ...row(order_id, order_id === acceptedId, 'sending'),
 funding_type, recovery: { outcome, proof_hash: proofHash } });
const fixture = { calls: [], mode: new URLSearchParams(location.search).get('mode') || 'rows',
 pending: [], pendingRecoveries: [], resolvedIds: new Set(), setOwner: null, setActive: null, setMode(mode) { this.mode = mode; },
 settleCases(response) { const pending = this.pending.shift(); if (pending) pending.resolve(response); },
 failCases() { const pending = this.pending.shift(); if (pending) pending.reject(new Error('private provider payload')); },
 settleRecovery(response) { const pending = this.pendingRecoveries.shift(); if (pending) pending.resolve(response); } };
window.__fixture = fixture;
function Harness() {
 const [ownerId, setOwnerId] = useState(new URLSearchParams(location.search).get('actor') === 'other' ? '20000000-0000-4000-8000-000000000001' : OWNER);
 const [active, setActive] = useState(true);
 fixture.setOwner = setOwnerId; fixture.setActive = setActive;
 const invoke = useCallback(async (payload) => {
   fixture.calls.push(payload);
   if (payload.action === 'admin_reconciliation_probe') return { success: true, case: row(payload.order_id, true),
     observation: fixture.mode === 'bad_probe' ? '__proto__' : 'reported_pending', financial_decision: 'none' };
   if (payload.action === 'admin_reconcile_dispatch_receipt') {
     if (fixture.mode === 'recovery_pending') return new Promise((resolve, reject) => fixture.pendingRecoveries.push({ resolve, reject }));
     if (fixture.mode === 'recovery_error') throw new Error('private financial payload');
     if (fixture.mode === 'recovery_malformed') return { success: true, order_id: firstId, decision: 'accepted', idempotent_replay: false };
     fixture.resolvedIds.add(payload.order_id);
     return { success: true, order_id: payload.order_id,
       decision: payload.order_id === acceptedId ? 'accepted' : 'rejected', idempotent_replay: false };
   }
   if (fixture.mode === 'pending') return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
   if (fixture.mode === 'error') throw new Error('private provider payload');
   if (fixture.mode === 'empty') return { success: true, cases: [], next_page: null };
   if (fixture.mode.startsWith('recovery')) return { success: true, cases: [
     recoverable(acceptedId, 'accepted', 'prepaid'),
     recoverable(rejectedPrepaidId, 'rejected', 'prepaid'),
     recoverable(rejectedUnlimitedId, 'rejected', 'unlimited_credit'),
     { ...row(unknownId, false, 'unknown'), funding_type: 'prepaid', recovery: { outcome: 'accepted', proof_hash: proofHash } },
     { ...row(malformedId, false, 'sending'), funding_type: 'prepaid', recovery: { outcome: 'rejected', proof_hash: 'bad' } },
     { ...recoverable(activeId, 'accepted', 'prepaid'), order_status: 'active' },
     { ...recoverable(completedId, 'rejected', 'prepaid'), order_status: 'completed' },
   ].filter(item => !fixture.resolvedIds.has(item.order_id)), next_page: null };
   if (payload.page === 1) return { success: true, cases: [row(thirdId, true, 'sending')], next_page: null };
   return { success: true, cases: [row(firstId, true), row(secondId, false)], next_page: 1 };
 }, []);
 return <main style={{maxWidth: 900, margin: '2rem auto', padding: '0 1rem'}}>
   {active && <PartnerReconciliationPanel ownerId={ownerId} active={active} invoke={invoke}/>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`)

const server = await createServer({
  root: fixtureRoot, configFile: false, publicDir: false, logLevel: 'error',
  resolve: { alias: { '@': join(root, 'src') } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, 'tailwind.config.ts') }), autoprefixer()] } },
  server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [root, fixtureRoot] } },
})
let browser
const pageErrors = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: edge, headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(120_000)
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  const load = mode => page.goto(`${origin}/?mode=${mode}`, { waitUntil: 'commit' })
  const calls = () => page.evaluate(() => window.__fixture.calls)
  const emptyResponse = { success: true, cases: [], next_page: null }

  await page.goto(`${origin}/?mode=rows&actor=other`, { waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.__fixture?.setOwner))
  assert.equal(await page.getByText('External order review').count(), 0)
  assert.deepEqual(await calls(), [], 'Non-owner must not invoke the endpoint')

  await load('pending')
  await page.getByText('Loading held orders…').waitFor()
  assert.equal((await calls()).length, 1)
  await page.evaluate(response => window.__fixture.settleCases(response), emptyResponse)
  await page.getByText('No held external partner orders need review.').waitFor()

  await load('error')
  await page.getByRole('alert').filter({ hasText: 'Could not read held orders' }).waitFor()
  assert.equal(await page.getByText('private provider payload').count(), 0, 'Raw errors must not render')

  await load('rows')
  await page.getByText('Unknown outcome').first().waitFor()
  assert.equal(await page.getByRole('button', { name: /Review recorded/ }).count(), 0,
    'Orders without a stored receipt must remain read-only')
  assert.equal(await page.getByRole('button', { name: 'Check provider' }).count(), 1,
    'Only the case with a bound provider ID can be checked')
  assert.equal(await page.getByText('Automatic provider check unavailable').count(), 1)
  await page.getByRole('button', { name: 'Check provider' }).click()
  await page.getByText('Provider reports pending. Keep this order held.').waitFor()
  assert.equal((await calls()).filter(call => call.action === 'admin_reconciliation_probe').length, 1)
  assert.equal(await page.getByText('private provider payload').count(), 0)
  await page.evaluate(() => window.__fixture.setMode('bad_probe'))
  await page.getByRole('button', { name: 'Check provider' }).click()
  await page.getByRole('alert').filter({ hasText: 'Provider check could not finish' }).waitFor()
  assert.equal(await page.getByText('__proto__').count(), 0, 'Malformed observation must not render')
  await page.evaluate(() => window.__fixture.setMode('rows'))
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByText('Page 2').waitFor()
  await page.getByText(thirdId).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Previous' }).click()
  await page.getByText('Page 1').waitFor()

  await page.screenshot({ path: join(fixtureRoot, 'reconciliation-390.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: join(fixtureRoot, 'reconciliation-dark-390.png'), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
    'Long order IDs must wrap without horizontal page overflow at 390px')

  await load('pending')
  await page.getByText('Loading held orders…').waitFor()
  await page.evaluate(() => window.__fixture.setOwner('20000000-0000-4000-8000-000000000001'))
  await page.getByText('External order review').waitFor({ state: 'hidden' })
  await page.evaluate(response => window.__fixture.settleCases(response), {
    success: true, cases: [{ order_id: '10000000-0000-4000-8000-000000000003', section: 'sms',
      state: 'unknown', order_status: 'processing', amount_ngn: 1, created_at: null,
      claimed_at: null, probe_available: true }], next_page: null,
  })
  await page.evaluate(() => window.__fixture.setMode('empty'))
  await page.evaluate(() => window.__fixture.setOwner('c1396bda-86e2-4dfc-94bb-0d95469d1d36'))
  await page.getByText('No held external partner orders need review.').waitFor()
  assert.equal(await page.getByText(thirdId).count(), 0, 'Late old-account result must be discarded')

  await page.evaluate(() => window.__fixture.setMode('pending'))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('Loading held orders…').waitFor()
  await page.evaluate(() => window.__fixture.setActive(false))
  await page.getByText('External order review').waitFor({ state: 'hidden' })
  await page.evaluate(response => window.__fixture.settleCases(response), emptyResponse)
  await page.evaluate(() => window.__fixture.setMode('rows'))
  await page.evaluate(() => window.__fixture.setActive(true))
  await page.getByText(firstId).waitFor()
  assert.equal(await page.getByText('No held external partner orders need review.').count(), 0,
    'Late inactive-tab result must be discarded')

  await load('recovery')
  const caseRow = id => page.locator('div.rounded-xl.border.p-4').filter({ hasText: id })
  await caseRow(acceptedId).waitFor()
  assert.equal(await caseRow('10000000-0000-4000-8000-000000000007').getByRole('button', { name: /Review recorded/ }).count(), 0,
    'Unknown outcome must remain read-only despite a claimed receipt')
  assert.equal(await caseRow('10000000-0000-4000-8000-000000000008').getByRole('button', { name: /Review recorded/ }).count(), 0,
    'Malformed receipt must not expose recovery')
  for (const staleId of ['10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-00000000000a']) {
    assert.equal(await caseRow(staleId).getByRole('button', { name: /Review recorded/ }).count(), 0,
      'Only processing orders can expose recovery')
  }
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  assert.equal((await calls()).filter(call => call.action === 'admin_reconcile_dispatch_receipt').length, 0,
    'First click must only reveal confirmation')
  assert.match(await caseRow(acceptedId).innerText(), /₦12,345\.67.*Prepaid reservation/s)
  assert.match(await caseRow(acceptedId).innerText(), /does not make another provider purchase/)
  await page.screenshot({ path: join(fixtureRoot, 'recovery-confirm-390.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
    'Confirmation must fit a 390px viewport')
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).click()
  await page.getByText('Recorded acceptance confirmed. Refreshing the case list.').waitFor()
  await caseRow(acceptedId).waitFor({ state: 'hidden' })

  await caseRow(rejectedPrepaidId).getByRole('button', { name: 'Review recorded rejected receipt' }).click()
  assert.match(await caseRow(rejectedPrepaidId).innerText(), /returns ₦12,345\.67 from its original reserved prepaid funds once/)
  await caseRow(rejectedPrepaidId).getByRole('button', { name: 'Confirm recorded rejected' }).click()
  await page.getByText('Recorded rejection confirmed; the original prepaid reservation was returned once. Refreshing the case list.').waitFor()
  await caseRow(rejectedPrepaidId).waitFor({ state: 'hidden' })

  await caseRow(rejectedUnlimitedId).getByRole('button', { name: 'Review recorded rejected receipt' }).click()
  assert.match(await caseRow(rejectedUnlimitedId).innerText(), /closes its unlimited-credit reservation/)
  assert.match(await caseRow(rejectedUnlimitedId).innerText(), /does not add money to the partner balance/)
  await caseRow(rejectedUnlimitedId).getByRole('button', { name: 'Confirm recorded rejected' }).click()
  await page.getByText('Recorded rejection confirmed; the unlimited-credit reservation was closed without a balance credit. Refreshing the case list.').waitFor()
  const applied = (await calls()).filter(call => call.action === 'admin_reconcile_dispatch_receipt')
  assert.equal(applied.length, 3)
  for (const call of applied) {
    assert.deepEqual(Object.keys(call).sort(), ['action', 'order_id', 'receipt_proof_hash'])
    assert.equal(call.receipt_proof_hash, proofHash)
  }
  assert.deepEqual(applied.map(call => call.order_id), [acceptedId, rejectedPrepaidId, rejectedUnlimitedId])
  assert.equal((await calls()).some(call => ['create_order', 'create_checkout', 'purchase', 'refund'].includes(call.action)), false,
    'Recovery UI must never send a paid or refund action')

  await load('recovery_pending')
  await caseRow(acceptedId).waitFor()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).evaluate(button => { button.click(); button.click() })
  await page.waitForFunction(() => window.__fixture.pendingRecoveries.length === 1)
  assert.equal((await calls()).filter(call => call.action === 'admin_reconcile_dispatch_receipt').length, 1,
    'Synchronous double click must not send duplicate recovery')
  assert.equal(await page.getByRole('button', { name: 'Refresh' }).isDisabled(), true)
  assert.equal(await caseRow(acceptedId).getByRole('button', { name: 'Check provider' }).isDisabled(), true)
  assert.equal(await caseRow(rejectedPrepaidId).getByRole('button', { name: 'Review recorded rejected receipt' }).isDisabled(), true)
  await page.evaluate(() => window.__fixture.setOwner('20000000-0000-4000-8000-000000000001'))
  await page.getByText('External order review').waitFor({ state: 'hidden' })
  await page.evaluate(id => window.__fixture.settleRecovery({ success: true, order_id: id, decision: 'accepted', idempotent_replay: false }), acceptedId)
  await page.evaluate(() => window.__fixture.setMode('recovery'))
  await page.evaluate(id => window.__fixture.setOwner(id), owner)
  await caseRow(acceptedId).waitFor()
  assert.equal(await page.getByText('Recorded acceptance confirmed').count(), 0,
    'Late old-account recovery result must be ignored')

  await load('recovery_pending')
  await caseRow(acceptedId).waitFor()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).click()
  await page.waitForFunction(() => window.__fixture.pendingRecoveries.length === 1)
  await page.evaluate(() => window.__fixture.setActive(false))
  await page.getByText('External order review').waitFor({ state: 'hidden' })
  await page.evaluate(id => window.__fixture.settleRecovery({ success: true, order_id: id, decision: 'accepted', idempotent_replay: false }), acceptedId)
  await page.evaluate(() => window.__fixture.setMode('recovery'))
  await page.evaluate(() => window.__fixture.setActive(true))
  await caseRow(acceptedId).waitFor()
  assert.equal(await page.getByText('Recorded acceptance confirmed').count(), 0,
    'Late unmounted recovery result must be ignored')

  await load('recovery_malformed')
  await caseRow(acceptedId).waitFor()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).click()
  await page.getByText('Recovery result could not be confirmed. It may have completed. Refresh cases before deciding whether to try again.').waitFor()
  assert.equal(await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).count(), 0,
    'Malformed response must require refresh before another attempt')
  assert.equal(await page.getByText('private financial payload').count(), 0)

  await load('recovery_error')
  await caseRow(acceptedId).waitFor()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).click()
  await page.getByText('Recovery result could not be confirmed. It may have completed. Refresh cases before deciding whether to try again.').waitFor()
  assert.equal(await page.getByText('private financial payload').count(), 0, 'Denied result must remain a fixed message')

  await load('recovery_pending')
  await caseRow(acceptedId).waitFor()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Confirm recorded accepted' }).click()
  await page.waitForFunction(() => window.__fixture.pendingRecoveries.length === 1)
  await page.clock.install()
  await page.clock.fastForward(31_000)
  await page.getByText('Recovery result could not be confirmed. It may have completed. Refresh cases before deciding whether to try again.').waitFor()
  assert.equal((await calls()).filter(call => call.action === 'admin_reconcile_dispatch_receipt').length, 1,
    'Timed-out recovery must not automatically retry')
  await page.evaluate(() => window.__fixture.setMode('recovery'))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await caseRow(acceptedId).getByRole('button', { name: 'Review recorded accepted receipt' }).waitFor()

  await load('pending')
  await page.getByText('Loading held orders…').waitFor()
  await page.clock.fastForward(31_000)
  await page.getByRole('alert').filter({ hasText: 'Could not read held orders' }).waitFor()
  assert.equal(await page.getByText('Loading held orders…').count(), 0, 'Deadline must end the loader')
  assert.deepEqual(pageErrors, [])
  console.log(`Partner reconciliation UI passed; 390px screenshot: ${join(fixtureRoot, 'reconciliation-390.png')}`)
} finally {
  await browser?.close()
  await server.close()
}
