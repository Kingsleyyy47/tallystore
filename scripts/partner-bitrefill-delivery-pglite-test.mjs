import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const db = new PGlite()
const partner = '10000000-0000-4000-8000-000000000001'
const unlimited = '10000000-0000-4000-8000-000000000002'
const key = '20000000-0000-4000-8000-000000000001'
const unlimitedKey = '20000000-0000-4000-8000-000000000002'
const customer = '30000000-0000-4000-8000-000000000001'
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const fingerprint = 'a'.repeat(64)
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const count = async (table, order) => Number((await db.query(`SELECT count(*) n FROM ${table}${order ? ' WHERE order_id=$1' : ''}`, order ? [order] : [])).rows[0].n)
const fixture = read('./partner-external-journal-pglite-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(localMigration/)[1]
let serial = 0
const delivery = (suffix = 'A') => ({ item_id: 'fixture-card', quantity: 2, unit_value: 10, currency: 'USD', provider_status: 'complete',
  redemptions: [{ order_id: `TEST-UNIT-${suffix}-1`, code: 'SYNTHETIC-CODE-1' }, { order_id: `TEST-UNIT-${suffix}-2`, link: 'https://example.invalid/redeem/test', pin: 'TEST-PIN' }] })
const prepare = async (k = key, p = partner, payload = { product_id: 'fixture-card', quantity: 2, value: 10, provider_currency: 'USD' }) => {
  const r = await call('reserve_api_partner_external_order', [k, 'giftcards', 'giftcards', 'fixture-card', 'Fixture card', 2, 40, 40,
    `delivery-test-${++serial}`.padEnd(20, 'x'), fingerprint, JSON.stringify(payload), null, null, null])
  assert.equal(r.success, true)
  assert.equal((await call('claim_api_partner_external_dispatch', [r.order_id, k])).send_allowed, true)
  const invoice = `TEST-INVOICE-270-${serial}`
  assert.equal((await call('bind_api_partner_bitrefill_invoice', [r.order_id, p, invoice, 'unpaid', 'fixture-card', 2, 40])).success, true)
  return { id: r.order_id, invoice }
}
const evidence = (order, d = delivery(), actor = owner, invoice = order.invoice) => call('record_api_partner_bitrefill_delivery_evidence', [order.id, actor, invoice, JSON.stringify(d)])
const confirm = (order, proof, actor = owner) => call('reconcile_api_partner_bitrefill_delivery', [order.id, actor, proof])
const assertHeld = async id => {
  assert.equal(await count('public.api_partner_obligations', id), 0)
  assert.equal(Number((await db.query("SELECT count(*) n FROM public.api_partner_external_events WHERE order_id=$1 AND event_type IN ('capture','release')", [id])).rows[0].n), 0)
  assert.equal((await db.query('SELECT status FROM public.api_partner_orders WHERE id=$1', [id])).rows[0].status, 'processing')
}

try {
  await db.exec(fixture.replaceAll('${user}', customer).replaceAll('${prepaid}', partner).replaceAll('${prepaidKey}', key).replaceAll('${unlimited}', unlimited).replaceAll('${unlimitedKey}', unlimitedKey))
  await db.exec(`ALTER TABLE public.profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN account_suspended boolean NOT NULL DEFAULT false;
    INSERT INTO public.profiles(id,wallet_balance,is_admin) VALUES('${owner}',0,true);
    UPDATE public.api_partners SET allowed_sections=ARRAY['giftcards'],balance_ngn=10000;`)
  await db.exec(read('../supabase/migrations/20261005012000_partner_local_product_purchase.sql').split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  for (const migration of ['20000_partner_external_purchase_journal', '21000_partner_external_reads_and_rate_limits', '21100_partner_dispatch_lock_order',
    '24000_partner_external_dispatch_receipts', '25000_partner_receipt_reconciliation', '26000_partner_bitrefill_invoice_binding', '27000_partner_bitrefill_delivery_recovery']) {
    await db.exec(read(`../supabase/migrations/202610050${migration}.sql`))
  }
  const first = await prepare()
  assert.equal((await evidence(first, delivery(), customer)).code, 'OWNER_DENIED')
  assert.equal((await confirm(first, 'b'.repeat(64))).code, 'EVIDENCE_MISMATCH')
  const invalid = [
    { ...delivery(), extra: true }, { ...delivery(), quantity: 1 }, { ...delivery(), quantity: '2' },
    { ...delivery(), unit_value: 11 }, { ...delivery(), currency: 'NGN' }, { ...delivery(), item_id: 'foreign' },
    { ...delivery(), provider_status: 'completed' }, { ...delivery(), redemptions: [delivery().redemptions[0]] },
    { ...delivery(), redemptions: [delivery().redemptions[0], delivery().redemptions[0]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', code: ' ' }, delivery().redemptions[1]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', link: 'https://user:password@example.invalid/x' }, delivery().redemptions[1]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', link: 'http://example.invalid/x' }, delivery().redemptions[1]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', code: 'TEST', secret: 'DENIED' }, delivery().redemptions[1]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', code: true }, delivery().redemptions[1]] },
    { ...delivery(), redemptions: [{ order_id: 'UNIT-A', code: 'TEST', instructions: 'x'.repeat(17000) }, delivery().redemptions[1]] },
  ]
  for (const d of invalid) assert.equal((await evidence(first, d)).success, false)
  assert.equal((await evidence(first, delivery(), owner, 'FOREIGN-INVOICE')).code, 'BINDING_MISMATCH')
  await assertHeld(first.id)
  assert.equal(await count('private.api_partner_bitrefill_delivery_evidence'), 0)
  const missingQuote = await prepare(key, partner, { product_id: 'fixture-card', quantity: 2, value: 10 })
  assert.equal((await evidence(missingQuote)).code, 'BINDING_MISMATCH')
  await assertHeld(missingQuote.id)
  const result = await evidence(first)
  assert.equal(result.success, true)
  assert.equal(result.quantity, 2)
  assert.equal(result.amount_ngn, 40)
  assert.equal(result.funding_type, 'prepaid')
  assert.match(result.evidence_proof_hash, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(result).includes('SYNTHETIC-CODE'), false)
  assert.equal((await evidence(first)).idempotent_replay, true)
  assert.equal((await evidence(first, delivery('CHANGED'))).code, 'EVIDENCE_CONFLICT')
  await assertHeld(first.id)
  await assert.rejects(call('record_api_partner_external_outcome', [first.id, 'accepted', 'bitrefill', first.invoice,
    JSON.stringify({ invoice_id: first.invoice, provider_status: 'complete', redemptions: delivery().redemptions }), 'completed', null]), /bitrefill_invoice_receipt_required/,
  'evidence without immutable owner decision cannot finalize')
  assert.equal((await confirm(first, 'b'.repeat(64))).code, 'EVIDENCE_MISMATCH')
  assert.equal((await confirm(first, result.evidence_proof_hash, customer)).code, 'OWNER_DENIED')
  // Revocation and disablement after payment cannot erase a held delivery.
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [key])
  await db.query('UPDATE public.api_partners SET is_active=false WHERE id=$1', [partner])
  const balance = Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partner])).rows[0].balance_ngn)
  const completed = await confirm(first, result.evidence_proof_hash)
  assert.deepEqual(completed, { success: true, order_id: first.id, idempotent_replay: false, decision: 'accepted', status: 'completed' })
  assert.equal((await confirm(first, result.evidence_proof_hash)).idempotent_replay, true)
  assert.equal((await evidence(first)).idempotent_replay, true)
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partner])).rows[0].balance_ngn), balance)
  assert.equal(await count('public.api_partner_obligations', first.id), 1)
  assert.equal(Number((await db.query("SELECT count(*) n FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='capture'", [first.id])).rows[0].n), 1)
  assert.equal(Number((await db.query("SELECT count(*) n FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='release'", [first.id])).rows[0].n), 0)
  const stored = (await db.query('SELECT status,response_payload FROM public.api_partner_orders WHERE id=$1', [first.id])).rows[0]
  assert.equal(stored.status, 'completed'); assert.equal(stored.response_payload.redemptions.length, 2)
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', [key])
  await db.query('UPDATE public.api_partners SET is_active=true WHERE id=$1', [partner])
  // Unknown outcome has no receipt, capture, or release and can be recovered.
  const unknown = await prepare(unlimitedKey, unlimited)
  await call('record_api_partner_external_outcome', [unknown.id, 'unknown', null, null, '{}', 'processing', null])
  assert.equal((await confirm(unknown, 'b'.repeat(64))).code, 'EVIDENCE_MISMATCH')
  await assertHeld(unknown.id)
  const ub = Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [unlimited])).rows[0].balance_ngn)
  const up = await evidence(unknown, delivery('UNKNOWN'))
  assert.equal(up.success, true)
  assert.equal((await confirm(unknown, up.evidence_proof_hash)).success, true)
  assert.equal((await confirm(unknown, up.evidence_proof_hash)).idempotent_replay, true)
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [unlimited])).rows[0].balance_ngn), ub)
  // A definitive rejection is contradictory independent evidence, never refunded.
  const rejected = await prepare()
  const rr = await call('record_api_partner_dispatch_receipt', [rejected.id, key, partner, fingerprint, 40, 'rejected', null, null, 'failed', 'NO_STOCK', '{}'])
  assert.equal(rr.success, true); assert.equal((await evidence(rejected)).code, 'RECEIPT_CONFLICT'); await assertHeld(rejected.id)
  const lateRejected = await prepare()
  const lateProof = await evidence(lateRejected, delivery('LATE'))
  assert.equal((await call('record_api_partner_dispatch_receipt', [lateRejected.id, key, partner, fingerprint, 40, 'rejected', null, null, 'failed', 'NO_STOCK', '{}'])).success, true)
  assert.equal((await confirm(lateRejected, lateProof.evidence_proof_hash)).code, 'EVIDENCE_MISMATCH')
  await assertHeld(lateRejected.id)
  // Atomic failure after decision/capture inserts rolls everything back.
  const failed = await prepare()
  const fp = await evidence(failed, delivery('FAIL'))
  await db.exec(`CREATE FUNCTION public.delivery_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$;
    CREATE TRIGGER delivery_test_fail BEFORE UPDATE ON public.api_partner_orders FOR EACH ROW EXECUTE FUNCTION public.delivery_test_fail();`)
  assert.equal((await confirm(failed, fp.evidence_proof_hash)).code, 'FINALIZATION_FAILED')
  await assertHeld(failed.id); assert.equal(await count('private.api_partner_bitrefill_delivery_decisions', failed.id), 0)
  await db.exec('DROP TRIGGER delivery_test_fail ON public.api_partner_orders;')
  assert.equal((await confirm(failed, fp.evidence_proof_hash)).success, true)
  // Replay checks original financial proof instead of simply returning success.
  await assert.rejects(db.query("UPDATE public.api_partner_obligations SET amount_ngn=41 WHERE order_id=$1", [failed.id]), /immutable/)
  await db.query('UPDATE public.api_partner_orders SET refund_amount_ngn=41 WHERE id=$1', [failed.id])
  assert.equal((await confirm(failed, fp.evidence_proof_hash)).code, 'DECISION_CONFLICT')
  await db.query('UPDATE public.api_partner_orders SET request_payload=request_payload || $1::jsonb WHERE id=$2', [JSON.stringify({ value: 11 }), failed.id])
  assert.equal((await confirm(failed, fp.evidence_proof_hash)).code, 'EVIDENCE_MISMATCH')
  for (const table of ['private.api_partner_bitrefill_delivery_evidence', 'private.api_partner_bitrefill_delivery_decisions']) {
    await assert.rejects(db.exec(`UPDATE ${table} SET owner_user_id=owner_user_id`), /immutable/)
    await assert.rejects(db.exec(`DELETE FROM ${table}`), /immutable/)
    await assert.rejects(db.exec(`TRUNCATE ${table} CASCADE`), /immutable/)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const grants = (await db.query("SELECT has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE') d", [role, table])).rows[0]
      assert.deepEqual(grants, { i: false, u: false, d: false })
      if (role !== 'service_role') {
        assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') s", [role, table])).rows[0].s, false)
        assert.equal((await db.query("SELECT has_function_privilege($1,'public.record_api_partner_bitrefill_delivery_evidence(uuid,uuid,text,jsonb)','EXECUTE') s", [role])).rows[0].s, false)
        assert.equal((await db.query("SELECT has_function_privilege($1,'public.reconcile_api_partner_bitrefill_delivery(uuid,uuid,text)','EXECUTE') s", [role])).rows[0].s, false)
      }
    }
  }
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [customer])).rows[0].wallet_balance), 777)
  // Both original 260 receipt branch and historical accepted guard remain.
  const old = await prepare()
  assert.equal((await call('record_api_partner_dispatch_receipt', [old.id, key, partner, fingerprint, 40, 'accepted', 'bitrefill', old.invoice, 'processing', null, JSON.stringify({ invoice_id: old.invoice })])).success, true)
  assert.equal((await call('record_api_partner_external_outcome', [old.id, 'accepted', 'bitrefill', old.invoice, JSON.stringify({ invoice_id: old.invoice }), 'processing', null])).success, true)
  await assert.rejects(db.query("UPDATE public.api_partner_external_orders SET fulfillment_id='FOREIGN' WHERE order_id=$1", [old.id]), /bitrefill_accepted_identity_immutable/)
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ;')
  const probe = await db.exec(read('./catalog/partner-bitrefill-delivery-live-probe.sql'))
  const checks = probe.find(result => result.rows[0]?.passed === true)?.rows[0]
  assert.ok(checks, 'rollback source probe produces fixed boolean checks')
  assert.ok(Object.values(checks).every(value => value === true))
  assert.equal(Number((await db.query("SELECT count(*) n FROM public.api_partners WHERE id='9a270000-0000-4000-8000-000000000001'")).rows[0].n), 0)
  await db.exec('ROLLBACK;')
  console.log('Bitrefill delivery recovery PGlite: passed (strict delivery, owner decision, exact held capture, unknown recovery, unchanged balances, atomic rollback, immutable proofs, ACL, original receipt guard)')
} finally { await db.close() }
