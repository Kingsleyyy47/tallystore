import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/smm-sync-services/index.ts', import.meta.url), 'utf8')
let handler, fixture
globalThis.__smmSyncTest = {
  serve: callback => { handler = callback },
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-admin' } }, error: null }) },
    from(table) {
      return {
        select() { return this }, eq() { return this },
        async single() {
          if (table === 'profiles') return { data: { is_admin: fixture.admin, account_suspended: false }, error: null }
          if (table === 'app_settings') return { data: { value: '1410' }, error: null }
          throw new Error('Unexpected read')
        },
        async upsert(rows, options) {
          assert.equal(table, 'smm_services')
          assert.deepEqual(options, { onConflict: 'external_id', ignoreDuplicates: false })
          assert.ok(rows.every(row => !Object.hasOwn(row, 'is_active')))
          const offset = fixture.writes.reduce((sum, batch) => sum + batch.length, 0)
          fixture.writes.push(rows)
          if (fixture.failedOffsets.includes(offset)) return { error: { code: '22003', message: 'private database details must not leak' } }
          return { error: null }
        },
      }
    },
  }),
}
globalThis.Deno = { env: { get: () => 'SYNTHETIC_TEST_ONLY' } }
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .*(?:\r?\n|$)/gm, '')
const module = await import(`data:text/javascript;base64,${Buffer.from(`const {serve,createClient}=globalThis.__smmSyncTest;\n${compiled}`).toString('base64')}`)
assert.equal(typeof handler, 'function')
const originalFetch = globalThis.fetch
const supplierService = id => ({ service: id, name: `Synthetic service ${id}`, category: 'Instagram Followers',
  type: 'Default', rate: id === 8001 ? '35000.25' : '0.5', min: '10', max: '100000', refill: true, cancel: false })
function setFixture(extra = {}) {
  fixture = { admin: true, services: [supplierService(1)], balance: { balance: '0.1381087', currency: 'USD' },
    reads: [], writes: [], failedOffsets: [], ...extra }
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://thelordofthepanels.com/api/v2')
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.ok(init.signal)
    const form = new URLSearchParams(init.body)
    assert.equal(form.get('key'), 'SYNTHETIC_TEST_ONLY')
    const action = form.get('action')
    assert.ok(['services', 'balance'].includes(action), 'No paid supplier actions permitted')
    fixture.reads.push(action)
    return new Response(JSON.stringify(action === 'services' ? fixture.services : fixture.balance), { headers: { 'Content-Type': 'application/json' } })
  }
}
async function request(body) {
  const response = await handler(new Request('https://example.invalid/smm-sync-services', {
    method: 'POST', headers: { Authorization: 'Bearer SYNTHETIC', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { status: response.status, body: await response.json() }
}
try {
  const all = Array.from({ length: 9918 }, (_, index) => supplierService(index + 1))
  setFixture({ services: all })
  const health = await request({ action: 'health' })
  assert.equal(health.status, 200); assert.equal(health.body.success, true); assert.equal(health.body.read_only, true)
  assert.equal(health.body.catalogue.total, 9918); assert.equal(health.body.catalogue.max_supplier_rate_usd, 35000.25)
  assert.equal(health.body.balance.currency, 'USD'); assert.equal(health.body.ready_for_ordering, true)
  assert.equal(fixture.writes.length, 0); assert.deepEqual(fixture.reads, ['services', 'balance'])
  const canonical = JSON.stringify(health.body.catalogue.rows)
  assert.equal(health.body.catalogue.sha256, createHash('sha256').update(canonical).digest('hex'))
  assert.deepEqual(Object.keys(health.body.catalogue.rows[0]), ['external_id','name','category','platform','service_type','rate_usd','price_ngn','min_quantity','max_quantity','has_refill','has_cancel'])
  assert.ok(!JSON.stringify(health.body).includes('SYNTHETIC_TEST_ONLY'))
  assert.equal(health.body.catalogue.rows[8000].price_ngn, Math.ceil(35000.25 * 1410 * 2))

  setFixture({ services: [...all].reverse() })
  const reverse = await request({ action: 'health' })
  assert.equal(reverse.body.catalogue.sha256, health.body.catalogue.sha256)

  // Reproduce the real failure shape: three rejected batches account for
  // 1,418 supplier rows, even though the old handler reported success.
  setFixture({ services: all, failedOffsets: [8000, 9000, 9500] })
  const partial = await request()
  assert.equal(partial.status, 502); assert.equal(partial.body.success, false)
  assert.equal(partial.body.code, 'SMM_CATALOGUE_SYNC_INCOMPLETE')
  assert.equal(partial.body.stats.processed, 8500); assert.equal(partial.body.stats.errors, 1418)
  assert.equal(partial.body.ready_for_ordering, false)
  assert.deepEqual(partial.body.failed_batches.map(row => row.code), ['22003','22003','22003'])
  assert.ok(!JSON.stringify(partial.body).includes('private database'))
  assert.equal(new Set(fixture.writes.flat().map(row => row.last_synced_at)).size, 1)

  setFixture({ services: all })
  const complete = await request({})
  assert.equal(complete.status, 200); assert.equal(complete.body.success, true)
  assert.equal(complete.body.stats.processed, 9918); assert.equal(complete.body.stats.errors, 0)
  assert.deepEqual(complete.body.failed_batches, [])

  for (const services of [[], [supplierService(1), supplierService(1)],
    [{ ...supplierService(1), rate: '1.50private' }], [{ ...supplierService(1), max: '2147483648' }],
    [{ ...supplierService(1), rate: '1000000000000' }], [{ ...supplierService(1), name: 'bad\0name' }]]) {
    setFixture({ services }); const invalid = await request({})
    assert.equal(invalid.status, 422); assert.equal(invalid.body.error, 'SMM_CATALOGUE_INVALID')
    assert.equal(fixture.writes.length, 0); assert.deepEqual(fixture.reads, ['services'])
  }
  for (const balance of [{ balance: '1', currency: 'EUR' }, { balance: 'NaN', currency: 'USD' },
    { balance: '-1', currency: 'USD' }, { error: 'private provider material' }]) {
    setFixture({ balance }); const invalid = await request({ action: 'health' })
    assert.equal(invalid.status, 502); assert.equal(invalid.body.success, false); assert.equal(fixture.writes.length, 0)
    assert.ok(!JSON.stringify(invalid.body).includes('private provider'))
  }
  setFixture({ balance: { balance: '0', currency: 'USD' } })
  const emptyBalance = await request({ action: 'health' })
  assert.equal(emptyBalance.status, 200); assert.equal(emptyBalance.body.ready_for_ordering, false)
  setFixture({ admin: false }); const customer = await request({ action: 'health' })
  assert.equal(customer.status, 401); assert.equal(fixture.reads.length, 0); assert.equal(fixture.writes.length, 0)
  setFixture(); const unknown = await request({ action: 'add' })
  assert.equal(unknown.status, 422); assert.equal(fixture.reads.length, 0)

  let canceled = false, readCalls = 0
  globalThis.fetch = async () => { readCalls++; return new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1025)) }, cancel() { canceled = true },
  })) }
  await assert.rejects(() => module.readSmmJson('https://example.invalid', {}, 1000, 1024), /SMM_READ_TOO_LARGE/)
  assert.equal(canceled, true); assert.equal(readCalls, 1)
  globalThis.fetch = async () => { readCalls++; return new Response('private supplier material', { status: 500 }) }
  await assert.rejects(() => module.readSmmJson('https://example.invalid'), /SMM_READ_UNAVAILABLE/)
  assert.equal(readCalls, 2)

  // The real fetch body must abort if headers arrive but the response stalls.
  globalThis.fetch = originalFetch
  let requests = 0, closed = false
  const server = createServer((_req, response) => {
    requests++; response.on('close', () => { closed = true })
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('[{"service":')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await assert.rejects(() => module.readSmmJson(`http://127.0.0.1:${server.address().port}/`, {}, 80),
      error => ['TimeoutError','AbortError'].includes(error?.name))
    for (let n = 0; n < 30 && !closed; n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(requests, 1); assert.equal(closed, true)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  console.log(JSON.stringify({ actualHandler: true, complete9918Rows: true, oldRateOverflowRepresentable: true,
    partial1418RowsFailsHonestly: true, fullValidationBeforeWrites: true, adminHealthReadOnly: true,
    canonicalDigestStable: true, adminHiddenPreserved: true, currencyVerified: true,
    bodyBoundAndDeadline: true, noRetry: true, paidSupplierActions: 0, productionWrites: 0 }))
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.__smmSyncTest
  delete globalThis.Deno
}
