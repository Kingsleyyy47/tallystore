import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000001'
const localId = '30000000-0000-4000-8000-000000000001'
const extraLocalId = '30000000-0000-4000-8000-000000000002'
const setupSource = readFileSync(new URL('./supplier-purchase-journal-pglite-test.mjs', import.meta.url), 'utf8')
const scaffold = setupSource.match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1]
assert.ok(scaffold)
const setup = scaffold.replaceAll('${userId}', userId).replaceAll('${productId}', productId).replaceAll('${localId}', localId)
const migration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const metadata = JSON.stringify({ supplier_configured_providers: ['muabanvia'] })
async function call(name, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)).rows[0].result
}
try {
  await db.exec(setup)
  await db.exec(migration('20261005002000_supplier_purchase_journal.sql'))
  await db.exec(migration('20261005003000_authoritative_inventory_projection.sql'))
  await db.exec(migration('20261005017000_supplier_paid_send_readiness.sql'))

  const authorize = key => call('authorize_supplier_product_purchase',
    [userId, productId, 2, 200, key, metadata, 1])
  assert.equal((await authorize('readiness-initial-false')).code, 'SUPPLIER_NOT_READY')
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.orders')).rows[0].n, 0)

  assert.equal((await call('refresh_supplier_product_availability', [productId, true])).supplier_fallback_enabled, true)
  const order = await authorize('readiness-approved-order')
  assert.equal(order.success, true)
  const first = await call('begin_supplier_purchase_attempt',
    [order.order_id, order.reservation_id, 'muabanvia', 'supplier-42', 'readiness-approved-order:muabanvia:0'])
  assert.equal(first.status, 'prepared')

  // Keep local stock available, so is_sellable remains true when readiness is
  // turned off. The paid-send guard must still reject the prepared attempt.
  await db.query("INSERT INTO public.individual_accounts(id,product_group_id,status,username,password) VALUES($1,$2,'available','extra','secret')",
    [extraLocalId, productId])
  await db.query('UPDATE public.product_groups SET supplier_fallback_ready=false WHERE id=$1', [productId])
  assert.equal((await db.query('SELECT is_sellable FROM public.product_groups WHERE id=$1', [productId])).rows[0].is_sellable, true)
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).code, 'SUPPLIER_NOT_READY')
  assert.equal((await call('begin_supplier_purchase_attempt',
    [order.order_id, order.reservation_id, 'muabanvia', 'supplier-42', 'readiness-approved-order:muabanvia:1'])).code,
    'SUPPLIER_NOT_READY')

  await call('refresh_supplier_product_availability', [productId, true])
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).send_allowed, true)
  assert.equal((await call('record_supplier_purchase_outcome',
    [first.attempt_id, 'succeeded', 'paid-provider-ref', JSON.stringify([{ username: 'paid', password: 'credential' }]), null])).success, true)
  await db.query('UPDATE public.product_groups SET supplier_fallback_ready=false WHERE id=$1', [productId])
  const replay = await call('begin_supplier_purchase_attempt',
    [order.order_id, order.reservation_id, 'muabanvia', 'supplier-42', 'readiness-approved-order:muabanvia:0'])
  assert.equal(replay.outcome, 'succeeded')
  const attached = await call('attach_supplier_purchase_accounts', [order.order_id, first.attempt_id])
  assert.equal(attached.success, true)
  assert.equal(attached.account_ids.length, 2)
  assert.equal((await call('attach_supplier_purchase_accounts', [order.order_id, first.attempt_id])).idempotent_replay, true)
  console.log('supplier paid-send readiness and successful-attachment recovery passed')
} finally { await db.close() }
