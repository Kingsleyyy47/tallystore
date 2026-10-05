import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const partner = '10000000-0000-4000-8000-000000000001'
const key = '20000000-0000-4000-8000-000000000001'
const customer = '30000000-0000-4000-8000-000000000001'
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const fingerprint = 'a'.repeat(64)
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const fixture = read('./partner-external-journal-pglite-test.mjs')
  .match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(localMigration/)
assert.ok(fixture)
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const reserve = idem => call('reserve_api_partner_external_order', [key, 'giftcards', 'giftcards',
  'fixture-card', 'Fixture card', 2, 40, 40, idem, fingerprint,
  JSON.stringify({ product_id: 'fixture-card', quantity: 2, value: 10 }), null, null, null])
const claim = id => call('claim_api_partner_external_dispatch', [id, key])
const bind = (id, invoice = 'TEST-INVOICE-260-A', overrides = {}) => call('bind_api_partner_bitrefill_invoice', [
  id, overrides.partner ?? partner, invoice, overrides.status ?? 'unpaid',
  overrides.item ?? 'fixture-card', overrides.quantity ?? 2, overrides.amount ?? 40])
const readBound = (id, actor = owner) => call('get_api_partner_bitrefill_bound_invoice', [id, actor])
const readBatch = (ids, actor = owner) => db.query(
  'SELECT public.get_api_partner_bitrefill_bound_invoices($1,$2::uuid[]) result', [actor, ids])
  .then(r => r.rows[0].result)
const finalize = (id, invoice) => call('record_api_partner_external_outcome', [id,
  'accepted', 'bitrefill', invoice,
  JSON.stringify({ invoice_id: invoice, provider_order_id: null }), 'processing', null])
const count = table => db.query(`SELECT count(*)::integer n FROM ${table}`).then(r => r.rows[0].n)

try {
  const sql = fixture[1].replaceAll('${user}', customer)
    .replaceAll('${prepaid}', partner).replaceAll('${prepaidKey}', key)
    .replaceAll('${unlimited}', '10000000-0000-4000-8000-000000000002')
    .replaceAll('${unlimitedKey}', '20000000-0000-4000-8000-000000000002')
  await db.exec(sql)
  await db.exec(`ALTER TABLE public.profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN account_suspended boolean NOT NULL DEFAULT false;
    INSERT INTO public.profiles(id,wallet_balance,is_admin) VALUES('${owner}',0,true);
    UPDATE public.api_partners SET allowed_sections=ARRAY['giftcards'] WHERE id='${partner}';`)
  await db.exec(read('../supabase/migrations/20261005012000_partner_local_product_purchase.sql')
    .split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  for (const name of ['20261005020000_partner_external_purchase_journal.sql',
    '20261005021000_partner_external_reads_and_rate_limits.sql',
    '20261005021100_partner_dispatch_lock_order.sql',
    '20261005024000_partner_external_dispatch_receipts.sql',
    '20261005025000_partner_receipt_reconciliation.sql',
    '20261005026000_partner_bitrefill_invoice_binding.sql']) {
    await db.exec(read(`../supabase/migrations/${name}`))
  }
  const first = await reserve('bitrefill-binding-0001')
  assert.equal(first.success, true)
  assert.equal((await bind(first.order_id)).code, 'DISPATCH_NOT_ELIGIBLE', 'invoice cannot bind before claim')
  assert.equal((await claim(first.order_id)).send_allowed, true)
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-A', { partner: '10000000-0000-4000-8000-000000000002' })).code, 'BINDING_MISMATCH')
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-A', { item: 'foreign-card' })).code, 'BINDING_MISMATCH')
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-A', { quantity: 1 })).code, 'BINDING_MISMATCH')
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-A', { amount: 41 })).code, 'BINDING_MISMATCH')
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-A', { status: 'complete' })).code, 'INVALID_INVOICE')
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [key])
  assert.equal((await bind(first.order_id)).code, 'DISPATCH_NOT_ELIGIBLE', 'revoked key cannot authorize payment')
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', [key])
  const beforeBalance = Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partner])).rows[0].balance_ngn)
  const created = await bind(first.order_id)
  assert.deepEqual({ success: created.success, replay: created.idempotent_replay, pay: created.pay_allowed },
    { success: true, replay: false, pay: true })
  assert.deepEqual({ replay: (await bind(first.order_id)).idempotent_replay,
    pay: (await bind(first.order_id)).pay_allowed }, { replay: true, pay: false },
  'replay cannot authorize another paid request')
  assert.equal((await bind(first.order_id, 'TEST-INVOICE-260-B')).code, 'INVOICE_BINDING_CONFLICT')
  assert.equal((await readBound(first.order_id)).invoice_id, 'TEST-INVOICE-260-A')
  assert.deepEqual((await readBatch([first.order_id, first.order_id])).cases,
    [{ order_id: first.order_id, invoice_id: 'TEST-INVOICE-260-A' }], 'batch deduplicates requested IDs')
  assert.equal((await readBatch([first.order_id], customer)).code, 'OWNER_DENIED')
  assert.equal((await readBatch(Array(51).fill(first.order_id))).code, 'INVALID_REQUEST')
  assert.equal((await readBound(first.order_id, customer)).code, 'OWNER_DENIED')
  assert.equal(await count('private.api_partner_bitrefill_invoice_bindings'), 1)
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partner])).rows[0].balance_ngn), beforeBalance)
  assert.equal(await count('public.api_partner_obligations'), 0)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [customer])).rows[0].wallet_balance), 777)
  await assert.rejects(db.query('UPDATE private.api_partner_bitrefill_invoice_bindings SET invoice_id=$1 WHERE order_id=$2',
    ['OTHER', first.order_id]), /immutable/)
  await assert.rejects(db.query('DELETE FROM private.api_partner_bitrefill_invoice_bindings WHERE order_id=$1', [first.order_id]), /immutable/)

  const wrongReceipt = () => call('record_api_partner_dispatch_receipt', [first.order_id, key, partner,
    fingerprint, 40, 'accepted', 'bitrefill', 'TEST-INVOICE-260-B', 'processing', null,
    JSON.stringify({ invoice_id: 'TEST-INVOICE-260-B' })])
  await assert.rejects(wrongReceipt(), /bitrefill_invoice_binding_required/)
  await assert.rejects(finalize(first.order_id, 'TEST-INVOICE-260-A'), /bitrefill_invoice_receipt_required/,
    'direct financial finalizer requires the matching durable receipt')
  assert.equal(await count('public.api_partner_obligations'), 0)
  const correctReceipt = await call('record_api_partner_dispatch_receipt', [first.order_id, key, partner,
    fingerprint, 40, 'accepted', 'bitrefill', 'TEST-INVOICE-260-A', 'processing', null,
    JSON.stringify({ invoice_id: 'TEST-INVOICE-260-A', provider_order_id: null })])
  assert.equal(correctReceipt.success, true)
  await assert.rejects(finalize(first.order_id, 'TEST-INVOICE-260-B'), /bitrefill_invoice_receipt_required/)
  await assert.rejects(call('record_api_partner_external_outcome', [first.order_id,
    'accepted', 'bitrefill', 'TEST-INVOICE-260-A',
    JSON.stringify({ invoice_id: 'TEST-INVOICE-260-A', provider_order_id: 'UNVERIFIED' }),
    'processing', null]), /bitrefill_invoice_receipt_required/,
  'financial result must match the durable normalized receipt exactly')
  assert.equal((await finalize(first.order_id, 'TEST-INVOICE-260-A')).success, true)
  await assert.rejects(db.query('UPDATE public.api_partner_external_orders SET fulfillment_id=$1 WHERE order_id=$2',
    ['OTHER', first.order_id]), /bitrefill_accepted_identity_immutable/)
  await db.query('UPDATE public.api_partner_orders SET fulfillment_id=$1 WHERE id=$2', ['OTHER', first.order_id])
  assert.equal((await readBound(first.order_id)).code, 'BINDING_MISMATCH')
  assert.equal((await readBatch([first.order_id])).cases.length, 0, 'batch hides conflicting persisted provider identity')
  await db.query('UPDATE public.api_partner_orders SET fulfillment_id=$1 WHERE id=$2', ['TEST-INVOICE-260-A', first.order_id])

  const second = await reserve('bitrefill-binding-0002')
  assert.equal((await claim(second.order_id)).send_allowed, true)
  await db.query('UPDATE public.api_partner_orders SET request_payload=$1 WHERE id=$2', ['{}', second.order_id])
  assert.equal((await bind(second.order_id, 'TEST-INVOICE-260-C')).code, 'BINDING_MISMATCH',
    'missing original product and quantity cannot bind')
  await db.query('UPDATE public.api_partner_orders SET request_payload=$1 WHERE id=$2',
    [JSON.stringify({ product_id: 'fixture-card', quantity: 2, value: 10 }), second.order_id])
  await assert.rejects(bind(second.order_id), /unique/, 'one provider invoice cannot bind two orders')
  assert.equal((await readBound(second.order_id)).bound, false)

  await db.query('UPDATE public.api_partners SET balance_ngn=100 WHERE id=$1', [partner])
  const legacy = await reserve('bitrefill-legacy-status-0003')
  assert.equal((await claim(legacy.order_id)).send_allowed, true)
  await db.exec('ALTER TABLE public.api_partner_external_orders DISABLE TRIGGER api_partner_bitrefill_financial_outcome_requires_receipt')
  assert.equal((await finalize(legacy.order_id, 'LEGACY-INVOICE-260')).success, true)
  await db.exec('ALTER TABLE public.api_partner_external_orders ENABLE TRIGGER api_partner_bitrefill_financial_outcome_requires_receipt')
  await db.query('UPDATE public.api_partner_keys SET scopes=$1 WHERE id=$2', [['orders:create', 'orders:read'], key])
  assert.equal((await call('update_api_partner_external_status', [key, legacy.order_id,
    'bitrefill', 'LEGACY-INVOICE-260', 'processing', JSON.stringify({ provider_status: 'pending' })])).success, true,
  'historical accepted journal status can progress without new binding')
  await db.exec('SET ROLE authenticated')
  await assert.rejects(bind(second.order_id, 'OTHER'), /permission denied/)
  await assert.rejects(readBound(first.order_id), /permission denied/)
  await assert.rejects(readBatch([first.order_id]), /permission denied/)
  await assert.rejects(db.query('SELECT * FROM private.api_partner_bitrefill_invoice_bindings'), /permission denied/)
  await db.exec('RESET ROLE')
  await db.exec('BEGIN')
  await db.exec(read('./catalog/partner-bitrefill-binding-live-probe.sql'))
  await db.exec('ROLLBACK')
  console.log('Partner Bitrefill binding: unpaid claimed-only invoice, immutable one-use pay authorization, receipt identity, owner read, wallet isolation and browser denial passed.')
} finally { await db.close() }
