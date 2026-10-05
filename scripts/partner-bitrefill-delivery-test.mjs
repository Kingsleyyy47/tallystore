// Local GET-only contract test; no Bitrefill credentials or provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/_shared/partner-bitrefill-delivery.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  return {
    setTimeout(callback, ms) { const id = ++nextId; timers.set(id, { at: now + ms, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback()
    },
    pending() { return timers.size },
  }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function helper(clock = fakeClock()) {
  const exports = {}
  vm.runInNewContext(code, { exports, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, URL })
  return { read: exports.readBoundBitrefillDelivery, clock }
}
const quote = { itemId: 'amazon-us', quantity: 2, unitValue: 50, currency: 'usd', packageId: 'amazon-us<&>50' }
const invoice = { id: 'invoice-123', status: 'complete', orders: [
  { id: 'unit-1', status: 'delivered', product: { id: 'amazon-us', value: 50 } },
  { id: 'unit-2', status: 'delivered' }, // Bitrefill summaries may omit product details.
] }
const details = {
  'unit-1': { id: 'unit-1', status: 'delivered', product: { id: 'amazon-us', value: 50, currency: 'USD', package_id: quote.packageId },
    redemption_info: { code: '  CARD-ONE  ', pin: ' 2468 ', instructions: ' Redeem online ', api_key: 'never-return-this' } },
  'unit-2': { id: 'unit-2', status: 'delivered', product_id: 'amazon-us', value: 50, currency: 'USD', package_id: quote.packageId,
    redemption_info: { link: 'https://redeem.example/card', expiration_date: '2027-01-01' } },
}
function fixture(nextInvoice = invoice, nextDetails = details) {
  const calls = []
  return { calls, client: {
    getInvoice: async id => { calls.push(['invoice', id]); return nextInvoice },
    getOrder: async id => { calls.push(['order', id]); return nextDetails[id] },
  } }
}
async function attempt(nextInvoice = invoice, nextDetails = details, nextQuote = quote) {
  const f = fixture(nextInvoice, nextDetails)
  const { read, clock } = helper()
  const result = await read(f.client, 'invoice-123', nextQuote)
  assert.equal(clock.pending(), 0, 'Deadline timer leaked')
  return { result, calls: f.calls }
}

let outcome = await attempt()
assert.equal(outcome.result.completed, true)
assert.deepEqual(Object.keys(outcome.result.delivery).sort(),
  ['currency', 'item_id', 'provider_status', 'quantity', 'redemptions', 'unit_value'].sort())
assert.equal(outcome.result.delivery.currency, 'USD')
assert.equal(outcome.result.delivery.quantity, 2)
assert.equal(outcome.result.delivery.redemptions[0].code, 'CARD-ONE')
assert.equal(outcome.result.delivery.redemptions[0].pin, '2468')
assert.equal(outcome.result.delivery.redemptions[1].link, 'https://redeem.example/card')
assert.ok(!JSON.stringify(outcome.result).includes('never-return-this'))
assert.equal(outcome.calls.length, 3, 'Only invoice and both order GETs are allowed')

const bad = [
  ['wrong denomination', invoice, { ...details, 'unit-2': { ...details['unit-2'], value: 100 } }, quote],
  ['PIN without redeemable code/link', invoice, { ...details, 'unit-2': { ...details['unit-2'], redemption_info: { pin: '1234', instructions: 'Use PIN' } } }, quote],
  ['credentialed URL', invoice, { ...details, 'unit-2': { ...details['unit-2'], redemption_info: { link: 'https://user:pass@example.invalid/card' } } }, quote],
  ['failed unit', invoice, { ...details, 'unit-2': { ...details['unit-2'], status: 'failed' } }, quote],
  ['flat/nested conflict', invoice, { ...details, 'unit-2': { ...details['unit-2'], product: { id: 'other-product', value: 50 } } }, quote],
  ['provider package mismatch', invoice, { ...details, 'unit-2': { ...details['unit-2'], package_id: 'other-package' } }, quote],
  ['provider currency mismatch', invoice, { ...details, 'unit-2': { ...details['unit-2'], currency: 'EUR' } }, quote],
  ['duplicate unit', { ...invoice, orders: [invoice.orders[0], { id: 'unit-1', status: 'delivered' }] }, details, quote],
  ['missing unit', { ...invoice, orders: [invoice.orders[0]] }, details, quote],
  ['failed summary', { ...invoice, orders: [invoice.orders[0], { id: 'unit-2', status: 'failed' }] }, details, quote],
  ['wrong invoice', { ...invoice, id: 'other-invoice' }, details, quote],
  ['missing quote value', invoice, details, { ...quote, unitValue: undefined }],
  ['missing quote currency', invoice, details, { ...quote, currency: undefined }],
  ['missing quote item', invoice, details, { ...quote, itemId: undefined }],
  ['wrong quote quantity', invoice, details, { ...quote, quantity: 1 }],
]
for (const [name, nextInvoice, nextDetails, nextQuote] of bad) {
  outcome = await attempt(nextInvoice, nextDetails, nextQuote)
  assert.equal(outcome.result.completed, false, `${name} completed an unverified gift card`)
  assert.equal(outcome.result.review, true, `${name} did not require review`)
}

outcome = await attempt({ ...invoice, status: 'pending' })
assert.equal(outcome.result.completed, false)
assert.equal(outcome.result.review, false, 'Pending invoice should stay pending without forced review')
assert.equal(outcome.calls.length, 1)

{
  const { read, clock } = helper()
  const pendingInvoice = deferred()
  let detailReads = 0
  const resultPromise = read({ getInvoice: () => pendingInvoice.promise, getOrder: () => { detailReads++; return Promise.resolve(details['unit-1']) } }, 'invoice-123', quote)
  clock.advance(15_000)
  const result = await resultPromise
  assert.equal(result.completed, false)
  assert.equal(result.review, true)
  pendingInvoice.resolve(invoice)
  await Promise.resolve()
  assert.equal(detailReads, 0, 'Late invoice response started order reads after deadline')
  assert.equal(clock.pending(), 0)
}

{
  const { read, clock } = helper()
  const pendingUnit = deferred()
  const ids = []
  const resultPromise = read({ getInvoice: async () => invoice, getOrder: id => {
    ids.push(id)
    return id === 'unit-1' ? Promise.resolve(details[id]) : pendingUnit.promise
  } }, 'invoice-123', quote)
  for (let i = 0; i < 30 && ids.length < 2; i++) await Promise.resolve()
  assert.deepEqual(ids, ['unit-1', 'unit-2'])
  clock.advance(15_000)
  assert.equal((await resultPromise).completed, false)
  pendingUnit.resolve(details['unit-2'])
  await Promise.resolve()
  assert.equal(ids.length, 2)
  assert.equal(clock.pending(), 0)
}

console.log('Bitrefill delivery contract: nested/flat units, quote binding, usable redemption, adversarial cases, and full-deadline reads passed.')
