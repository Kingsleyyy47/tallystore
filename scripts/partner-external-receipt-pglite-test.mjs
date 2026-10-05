import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const partner = '10000000-0000-4000-8000-000000000001'
const key = '20000000-0000-4000-8000-000000000001'
const user = '30000000-0000-4000-8000-000000000001'
const fingerprint = 'a'.repeat(64)
const fixtureSource = readFileSync(new URL('./partner-external-journal-pglite-test.mjs', import.meta.url), 'utf8')
const fixture = fixtureSource.match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(localMigration/)
assert.ok(fixture, 'Journal fixture schema changed')
const local = readFileSync(new URL('../supabase/migrations/20261005012000_partner_local_product_purchase.sql', import.meta.url), 'utf8')
const journal = readFileSync(new URL('../supabase/migrations/20261005020000_partner_external_purchase_journal.sql', import.meta.url), 'utf8')
const lockOrder = readFileSync(new URL('../supabase/migrations/20261005021100_partner_dispatch_lock_order.sql', import.meta.url), 'utf8')
const receipts = readFileSync(new URL('../supabase/migrations/20261005024000_partner_external_dispatch_receipts.sql', import.meta.url), 'utf8')
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS result`, args)).rows[0].result
const reserve = (idem, amount = 30, section = 'sms') => call('reserve_api_partner_external_order',
  [key, section, section, 'fixture-item', 'Fixture item', 1, amount, amount, idem,
    fingerprint, '{}', null, null, null])
const claim = id => call('claim_api_partner_external_dispatch', [id, key])
const receipt = (id, overrides = {}) => call('record_api_partner_dispatch_receipt', [
  overrides.order_id ?? id, overrides.key_id ?? key, overrides.partner_id ?? partner,
  overrides.fingerprint ?? fingerprint, overrides.amount ?? 30,
  overrides.outcome ?? 'accepted', overrides.source === undefined ? 'daisy' : overrides.source,
  overrides.provider_id === undefined ? `provider-${id.slice(-4)}` : overrides.provider_id,
  overrides.status === undefined ? 'active' : overrides.status, overrides.reason ?? null,
  JSON.stringify(overrides.payload ?? { provider_order_id: `provider-${id.slice(-4)}` }),
])
const count = table => db.query(`SELECT count(*)::integer n FROM ${table}`).then(r => r.rows[0].n)
const partnerBalance = () => db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partner])
  .then(r => Number(r.rows[0].balance_ngn))

try {
  const sql = fixture[1].replaceAll('${user}', user)
    .replaceAll('${prepaid}', partner).replaceAll('${prepaidKey}', key)
    .replaceAll('${unlimited}', '10000000-0000-4000-8000-000000000002')
    .replaceAll('${unlimitedKey}', '20000000-0000-4000-8000-000000000002')
  await db.exec(sql)
  await db.exec(local.split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  await db.exec(journal)
  await db.exec(lockOrder)
  await db.exec(receipts)
  assert.equal(await count('private.api_partner_dispatch_receipts'), 0)
  const first = await reserve('receipt-prepared-0001')
  assert.equal(first.success, true)
  assert.equal((await receipt(first.order_id)).code, 'DISPATCH_NOT_CLAIMED')
  assert.equal(await count('private.api_partner_dispatch_receipts'), 0)
  assert.equal((await claim(first.order_id)).send_allowed, true)
  await db.query('UPDATE public.api_partner_orders SET status=$1 WHERE id=$2', ['cancelled', first.order_id])
  assert.equal((await receipt(first.order_id)).code, 'DISPATCH_NOT_CLAIMED', 'cancelled order cannot gain a receipt')
  await db.query('UPDATE public.api_partner_orders SET status=$1 WHERE id=$2', ['processing', first.order_id])
  assert.equal((await receipt(first.order_id, { partner_id: '10000000-0000-4000-8000-000000000002' })).code, 'RECEIPT_BINDING_MISMATCH')
  assert.equal((await receipt(first.order_id, { key_id: '20000000-0000-4000-8000-000000000002' })).code, 'RECEIPT_BINDING_MISMATCH')
  assert.equal((await receipt(first.order_id, { fingerprint: 'b'.repeat(64) })).code, 'RECEIPT_BINDING_MISMATCH')
  assert.equal((await receipt(first.order_id, { amount: 31 })).code, 'RECEIPT_BINDING_MISMATCH')
  assert.equal((await receipt(first.order_id, { status: null })).code, 'INVALID_RECEIPT')
  assert.equal((await receipt(first.order_id, { source: 'smm' })).code, 'INVALID_RECEIPT')
  assert.equal((await receipt(first.order_id, { payload: { provider_order_id: 'other' } })).code, 'INVALID_RECEIPT')
  assert.equal((await receipt(first.order_id, { payload: { provider_order_id: `provider-${first.order_id.slice(-4)}`, secret: 'no' } })).code, 'INVALID_RECEIPT')
  assert.equal((await receipt(first.order_id, { payload: { provider_order_id: `provider-${first.order_id.slice(-4)}`, nested: { secret: 'no' } } })).code, 'INVALID_RECEIPT')
  const beforeMoney = await partnerBalance()
  const saved = await receipt(first.order_id)
  assert.equal(saved.success, true)
  assert.match(saved.proof_hash, /^[a-f0-9]{64}$/)
  assert.equal((await receipt(first.order_id)).idempotent_replay, true)
  assert.equal((await receipt(first.order_id, { provider_id: 'other', payload: { provider_order_id: 'other' } })).code, 'RECEIPT_CONFLICT')
  assert.equal(await count('private.api_partner_dispatch_receipts'), 1)
  assert.equal(await partnerBalance(), beforeMoney, 'receipt never moves reserved partner money')
  assert.equal(await count('public.api_partner_obligations'), 0)
  assert.equal((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [user])).rows[0].wallet_balance, '777')
  await assert.rejects(db.query('UPDATE private.api_partner_dispatch_receipts SET outcome=$1 WHERE order_id=$2', ['unknown', first.order_id]), /immutable/)
  await assert.rejects(db.query('DELETE FROM private.api_partner_dispatch_receipts WHERE order_id=$1', [first.order_id]), /immutable/)
  await assert.rejects(db.exec('TRUNCATE private.api_partner_dispatch_receipts'), /immutable/)
  const settled = await call('record_api_partner_external_outcome', [first.order_id, 'accepted', 'daisy',
    `provider-${first.order_id.slice(-4)}`, JSON.stringify({ provider_order_id: `provider-${first.order_id.slice(-4)}` }), 'active', null])
  assert.equal(settled.success, true)
  assert.equal((await receipt(first.order_id)).idempotent_replay, true, 'same proof survives financial settlement')

  const second = await reserve('receipt-rejected-0002', 20)
  assert.equal((await claim(second.order_id)).send_allowed, true)
  const rejected = await receipt(second.order_id, { amount: 20, outcome: 'rejected', source: null,
    provider_id: null, status: 'failed', reason: 'NO_STOCK', payload: {} })
  assert.equal(rejected.success, true)
  assert.equal((await receipt(second.order_id, { amount: 20, outcome: 'rejected', source: null,
    provider_id: null, status: 'failed', reason: 'PROVIDER_TIMEOUT', payload: {} })).code, 'INVALID_RECEIPT')
  const third = await reserve('receipt-unknown-0003', 10)
  assert.equal((await claim(third.order_id)).send_allowed, true)
  assert.equal((await receipt(third.order_id, { amount: 10, outcome: 'unknown', source: null,
    provider_id: null, status: 'processing', payload: {} })).success, true)
  assert.equal(await count('public.api_partner_obligations'), 1, 'unknown and rejection evidence do not create obligations')
  assert.equal(await count('public.api_partner_external_events'), 4, 'receipts add no capture or release events')

  await db.query('UPDATE public.api_partners SET allowed_sections=$1 WHERE id=$2', [['sms', 'giftcards'], partner])
  const gift = await reserve('receipt-giftcard-0004', 5, 'giftcards')
  assert.equal((await claim(gift.order_id)).send_allowed, true)
  assert.equal((await receipt(gift.order_id, { amount: 5, source: 'bitrefill',
    provider_id: 'invoice-1', status: 'processing',
    payload: { invoice_id: 'invoice-1', provider_order_id: null, provider_status: 'created' } })).success, true,
  'Bitrefill invoice may have no order ID before later status polling')

  await db.exec('SET ROLE authenticated')
  await assert.rejects(call('record_api_partner_dispatch_receipt', [first.order_id, key, partner,
    fingerprint, 30, 'accepted', 'daisy', 'forged', 'active', null, '{}']), /permission denied/)
  await assert.rejects(db.query('SELECT * FROM private.api_partner_dispatch_receipts'), /permission denied/)
  await db.exec('RESET ROLE')
  await db.exec('BEGIN')
  await db.exec(readFileSync(new URL('./catalog/partner-dispatch-receipt-live-probe.sql', import.meta.url), 'utf8'))
  console.log('Partner dispatch receipt: claimed-only binding, immutable proof, strict outcome payload, private grants, no money writes, replay after settlement passed.')
} finally { await db.close() }
