import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { classifySupplierBalanceFailure, recordSupplierBalanceFailure, resolveSupplierBalanceAlert } from '../../supabase/functions/_shared/supplier-balance-alerts.mjs'

for (const response of [
  { status: 'error', msg: 'Insufficient balance' },
  { status: 'error', message: 'Not enough money' },
  { code: 'INSUFFICIENT_FUNDS' },
  { error: 'Số dư không đủ để mua hàng' },
  { msg: 'Không đủ tiền' },
]) assert.equal(classifySupplierBalanceFailure(response), 'insufficient_balance')
for (const response of [
  null, { message: 'Request timed out' }, { message: 'Out of stock' },
  { data: ['Insufficient balance|secret'] },
  { status: 'success', msg: 'Insufficient balance', data: ['account|password'] },
  { success: true, code: 'INSUFFICIENT_FUNDS' },
]) assert.equal(classifySupplierBalanceFailure(response), null)
assert.equal(classifySupplierBalanceFailure({ msg: 'Insufficient balance' }, { httpStatus: 504 }), null)
assert.equal(classifySupplierBalanceFailure(null, { confirmedBalance: 0 }), 'insufficient_balance')
assert.equal(classifySupplierBalanceFailure(null, { confirmedBalance: '0' }), null)

const calls = []
const mockAdmin = { rpc: async (name, args) => { calls.push({ name, args }); return { error: null } } }
await recordSupplierBalanceFailure(mockAdmin, { provider: 'muabanvia', source: 'process-purchase', response: { msg: 'Insufficient balance api_key=secret', data: ['user|password'] } })
assert.equal(calls.length, 1)
assert.equal(JSON.stringify(calls).includes('secret'), false)
assert.equal(JSON.stringify(calls).includes('password'), false)
assert.equal(await recordSupplierBalanceFailure(mockAdmin, { provider: 'unknown', source: 'process-purchase', confirmedBalance: 0 }), false)
assert.equal(await resolveSupplierBalanceAlert(mockAdmin, { provider: 'muabanvia' }), false)
assert.equal(calls.length, 1)

const db = new PGlite()
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.product_groups (id uuid PRIMARY KEY);')
  await db.exec(readFileSync('supabase/migrations/20261005001000_supplier_balance_alerts.sql', 'utf8'))
  await db.exec("SET ROLE service_role; SELECT public.record_supplier_balance_alert('muabanvia', NULL, 'process-purchase'); RESET ROLE;")
  let row = (await db.query('SELECT * FROM public.supplier_balance_alerts')).rows[0]
  assert.equal(row.occurrence_count, 1)
  const oldTime = new Date(new Date(row.last_seen_at).getTime() - 1000).toISOString()
  await db.query("SELECT public.resolve_supplier_balance_alert('muabanvia', $1::timestamptz)", [oldTime])
  assert.equal((await db.query('SELECT resolved_at FROM public.supplier_balance_alerts')).rows[0].resolved_at, null)
  const futureTime = new Date(Date.now() + 10000).toISOString()
  await db.query("SELECT public.resolve_supplier_balance_alert('muabanvia', $1::timestamptz)", [futureTime])
  assert.ok((await db.query('SELECT resolved_at FROM public.supplier_balance_alerts')).rows[0].resolved_at)
  await db.exec("SELECT public.record_supplier_balance_alert('muabanvia', NULL, 'manual-restock')")
  row = (await db.query('SELECT * FROM public.supplier_balance_alerts')).rows[0]
  assert.equal(row.occurrence_count, 2)
  assert.equal(row.resolved_at, null)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`)
    await assert.rejects(db.query('SELECT * FROM public.supplier_balance_alerts'), /permission denied/)
    await assert.rejects(db.query("SELECT public.record_supplier_balance_alert('muabanvia', NULL, 'manual-restock')"), /permission denied/)
    await assert.rejects(db.query("SELECT public.resolve_supplier_balance_alert('muabanvia', now())"), /permission denied/)
    await db.exec('RESET ROLE')
  }
  await assert.rejects(db.query("SELECT public.record_supplier_balance_alert('malicious', NULL, 'manual-restock')"), /check constraint/)
} finally { await db.close() }
console.log('Supplier warnings: classification, secret omission, stale-success protection and service-only storage passed.')
