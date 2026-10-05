import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const prepaid = '10000000-0000-4000-8000-000000000001'
const unlimited = '10000000-0000-4000-8000-000000000002'
const prepaidKey = '20000000-0000-4000-8000-000000000001'
const unlimitedKey = '20000000-0000-4000-8000-000000000002'
const customer = '30000000-0000-4000-8000-000000000001'
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const fingerprint = 'a'.repeat(64)
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const fixture = read('./partner-external-journal-pglite-test.mjs')
  .match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(localMigration/)
assert.ok(fixture)
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const reserve = (key, idem, amount) => call('reserve_api_partner_external_order',
  [key, 'sms', 'sms', 'fixture', 'Fixture SMS', 1, amount, amount, idem,
    fingerprint, '{}', null, null, null])
const claim = (id, key) => call('claim_api_partner_external_dispatch', [id, key])
const receipt = (id, partner, key, amount, outcome = 'accepted') => call('record_api_partner_dispatch_receipt',
  [id, key, partner, fingerprint, amount, outcome,
    outcome === 'accepted' ? 'daisy' : null,
    outcome === 'accepted' ? `provider-${id.slice(-4)}` : null,
    outcome === 'accepted' ? 'active' : outcome === 'rejected' ? 'failed' : 'processing',
    outcome === 'rejected' ? 'NO_STOCK' : null,
    JSON.stringify(outcome === 'accepted' ? { provider_order_id: `provider-${id.slice(-4)}` } : {})])
const recover = (id, hash, actor = owner) => call('reconcile_api_partner_dispatch_receipt', [id, actor, hash])
const review = (ids, actor = owner) => db.query(
  'SELECT public.get_api_partner_dispatch_receipt_review($1,$2::uuid[]) result', [actor, ids])
  .then(r => r.rows[0].result)
const count = (table, id) => db.query(`SELECT count(*)::integer n FROM ${table} WHERE order_id=$1`, [id]).then(r => r.rows[0].n)
const balance = id => db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [id]).then(r => Number(r.rows[0].balance_ngn))

try {
  const sql = fixture[1].replaceAll('${user}', customer)
    .replaceAll('${prepaid}', prepaid).replaceAll('${prepaidKey}', prepaidKey)
    .replaceAll('${unlimited}', unlimited).replaceAll('${unlimitedKey}', unlimitedKey)
  await db.exec(sql)
  await db.exec(`ALTER TABLE public.profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN account_suspended boolean NOT NULL DEFAULT false;
    INSERT INTO public.profiles(id,wallet_balance,is_admin) VALUES('${owner}',0,true);`)
  await db.exec(read('../supabase/migrations/20261005012000_partner_local_product_purchase.sql')
    .split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  for (const name of ['20261005020000_partner_external_purchase_journal.sql',
    '20261005021000_partner_external_reads_and_rate_limits.sql',
    '20261005021100_partner_dispatch_lock_order.sql',
    '20261005024000_partner_external_dispatch_receipts.sql',
    '20261005025000_partner_receipt_reconciliation.sql']) {
    await db.exec(read(`../supabase/migrations/${name}`))
  }
  const unsent = await reserve(prepaidKey, 'recovery-prepared-0001', 5)
  assert.equal((await recover(unsent.order_id, fingerprint)).code, 'BINDING_MISMATCH', 'no receipt cannot settle')
  const first = await reserve(prepaidKey, 'recovery-accepted-0002', 30)
  assert.equal((await claim(first.order_id, prepaidKey)).send_allowed, true)
  const firstReceipt = await receipt(first.order_id, prepaid, prepaidKey, 30)
  assert.equal(firstReceipt.success, true)
  assert.deepEqual((await review([first.order_id])).cases.map(item => Object.keys(item).sort()),
    [['order_id', 'receipt_outcome', 'receipt_proof_hash']])
  assert.equal((await review([first.order_id])).cases[0].receipt_proof_hash, firstReceipt.proof_hash)
  assert.equal((await review([first.order_id], customer)).code, 'OWNER_DENIED')
  assert.equal((await review(Array(51).fill(first.order_id))).code, 'INVALID_REQUEST')
  assert.equal((await recover(first.order_id, firstReceipt.proof_hash, customer)).code, 'OWNER_DENIED')
  await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1', [owner])
  assert.equal((await recover(first.order_id, firstReceipt.proof_hash)).code, 'OWNER_DENIED')
  await db.query('UPDATE public.profiles SET account_suspended=false WHERE id=$1', [owner])
  assert.equal((await recover(first.order_id, 'b'.repeat(64))).code, 'BINDING_MISMATCH')
  assert.equal(await balance(prepaid), 65)
  await db.query('UPDATE public.api_partners SET is_active=false,owner_reviewed_at=NULL WHERE id=$1', [prepaid])
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [prepaidKey])
  assert.equal((await review([first.order_id])).cases.length, 1,
    'revoked key does not hide an earlier recoverable obligation')
  const settled = await recover(first.order_id, firstReceipt.proof_hash)
  assert.equal(settled.success, true, `earlier paid obligation survives partner/key revocation: ${JSON.stringify(settled)}`)
  assert.equal(settled.idempotent_replay, false)
  assert.equal(Object.hasOwn(settled, 'response_payload'), false)
  assert.equal(await balance(prepaid), 65)
  assert.equal(await count('public.api_partner_obligations', first.order_id), 1)
  assert.equal(await count('private.api_partner_receipt_reconciliation_decisions', first.order_id), 1)
  assert.equal(await count('public.api_partner_external_events', first.order_id), 2)
  assert.equal((await recover(first.order_id, firstReceipt.proof_hash)).idempotent_replay, true)
  assert.equal((await review([first.order_id])).cases.length, 0, 'settled case disappears')
  assert.equal(await count('public.api_partner_external_events', first.order_id), 2)
  await assert.rejects(db.query('UPDATE private.api_partner_receipt_reconciliation_decisions SET decision=$1 WHERE order_id=$2',
    ['rejected', first.order_id]), /immutable/)
  await assert.rejects(db.query('DELETE FROM private.api_partner_receipt_reconciliation_decisions WHERE order_id=$1',
    [first.order_id]), /immutable/)
  await assert.rejects(db.exec('TRUNCATE private.api_partner_receipt_reconciliation_decisions'), /immutable/)

  await db.query('UPDATE public.api_partners SET is_active=true,owner_reviewed_at=now() WHERE id=$1', [prepaid])
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL,scopes=$1 WHERE id=$2',
    [['orders:create', 'orders:read'], prepaidKey])
  const progressed = await call('update_api_partner_external_status', [prepaidKey, first.order_id,
    'daisy', `provider-${first.order_id.slice(-4)}`, 'completed', JSON.stringify({ code: 'TEST-ONLY-CODE' })])
  assert.equal(progressed.success, true, 'legitimate status polling can complete after recovery')
  assert.equal((await recover(first.order_id, firstReceipt.proof_hash)).idempotent_replay, true,
    'financial decision replay survives later fulfillment fields')
  assert.equal(await count('public.api_partner_external_events', first.order_id), 2)
  await db.query('UPDATE public.api_partner_external_orders SET fulfillment_id=$1 WHERE order_id=$2',
    ['foreign-provider', first.order_id])
  assert.equal((await recover(first.order_id, firstReceipt.proof_hash)).code, 'DECISION_CONFLICT')
  await db.query('UPDATE public.api_partner_external_orders SET fulfillment_id=$1 WHERE order_id=$2',
    [`provider-${first.order_id.slice(-4)}`, first.order_id])
  const second = await reserve(prepaidKey, 'recovery-rejected-0003', 20)
  assert.equal((await claim(second.order_id, prepaidKey)).send_allowed, true)
  const secondReceipt = await receipt(second.order_id, prepaid, prepaidKey, 20, 'rejected')
  assert.equal(await balance(prepaid), 45)
  await db.query('UPDATE public.api_partner_orders SET amount_ngn=21 WHERE id=$1', [second.order_id])
  assert.equal((await recover(second.order_id, secondReceipt.proof_hash)).code, 'BINDING_MISMATCH')
  assert.equal((await review([second.order_id])).cases.length, 0, 'contradictory binding is hidden')
  await db.query('UPDATE public.api_partner_orders SET amount_ngn=20 WHERE id=$1', [second.order_id])
  await db.exec(`CREATE FUNCTION public.reject_fixture_decision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture_decision_block'; END $$;
    CREATE TRIGGER reject_fixture_decision BEFORE INSERT ON private.api_partner_receipt_reconciliation_decisions
    FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_decision();`)
  assert.equal((await recover(second.order_id, secondReceipt.proof_hash)).code, 'FINALIZATION_FAILED')
  assert.equal(await balance(prepaid), 45, 'decision failure rolls back a prepaid refund')
  assert.equal(await count('public.api_partner_external_events', second.order_id), 1)
  assert.equal((await db.query('SELECT state FROM public.api_partner_external_orders WHERE order_id=$1',
    [second.order_id])).rows[0].state, 'sending')
  await db.exec('DROP TRIGGER reject_fixture_decision ON private.api_partner_receipt_reconciliation_decisions; DROP FUNCTION public.reject_fixture_decision();')
  assert.equal((await recover(second.order_id, secondReceipt.proof_hash)).success, true)
  assert.equal(await balance(prepaid), 65, 'prepaid release credits once')
  assert.equal((await recover(second.order_id, secondReceipt.proof_hash)).idempotent_replay, true)
  assert.equal(await balance(prepaid), 65)
  assert.equal(await count('public.api_partner_obligations', second.order_id), 0)
  assert.equal(await count('public.api_partner_external_events', second.order_id), 2)

  const third = await reserve(prepaidKey, 'recovery-unknown-0004', 10)
  assert.equal((await claim(third.order_id, prepaidKey)).send_allowed, true)
  const thirdReceipt = await receipt(third.order_id, prepaid, prepaidKey, 10, 'unknown')
  assert.equal((await recover(third.order_id, thirdReceipt.proof_hash)).code, 'UNKNOWN_REQUIRES_REVIEW')
  assert.equal((await review([third.order_id])).cases.length, 0, 'unknown receipt cannot invite settlement')
  assert.equal(await count('public.api_partner_external_events', third.order_id), 1)

  const credit = await reserve(unlimitedKey, 'recovery-unlimited-0005', 200)
  assert.equal((await claim(credit.order_id, unlimitedKey)).send_allowed, true)
  const creditReceipt = await receipt(credit.order_id, unlimited, unlimitedKey, 200)
  await db.query('UPDATE public.api_partners SET is_active=false,owner_reviewed_at=NULL WHERE id=$1', [unlimited])
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [unlimitedKey])
  assert.equal((await recover(credit.order_id, creditReceipt.proof_hash)).success, true)
  assert.equal(await balance(unlimited), 0)
  assert.equal((await db.query('SELECT funding_type FROM public.api_partner_obligations WHERE order_id=$1',
    [credit.order_id])).rows[0].funding_type, 'unlimited_credit')
  await db.query('UPDATE public.api_partners SET is_active=true,owner_reviewed_at=now() WHERE id=$1', [unlimited])
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', [unlimitedKey])
  const creditRejected = await reserve(unlimitedKey, 'recovery-unlimited-rejected-0006', 100)
  assert.equal((await claim(creditRejected.order_id, unlimitedKey)).send_allowed, true)
  const creditRejectedReceipt = await receipt(creditRejected.order_id, unlimited, unlimitedKey, 100, 'rejected')
  assert.equal((await recover(creditRejected.order_id, creditRejectedReceipt.proof_hash)).success, true)
  assert.equal(await balance(unlimited), 0, 'unlimited rejection never grants cash credit')
  assert.equal(await count('public.api_partner_external_events', creditRejected.order_id), 2)
  assert.equal(await count('public.api_partner_obligations', creditRejected.order_id), 0)
  assert.equal((await recover(creditRejected.order_id, creditRejectedReceipt.proof_hash)).idempotent_replay, true)
  assert.equal(await count('public.api_partner_external_events', creditRejected.order_id), 2,
    'unlimited rejection replay never creates a second release')
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [customer])).rows[0].wallet_balance), 777)

  await db.exec('SET ROLE authenticated')
  await assert.rejects(call('reconcile_api_partner_dispatch_receipt', [first.order_id, owner, firstReceipt.proof_hash]), /permission denied/)
  await assert.rejects(review([first.order_id]), /permission denied/)
  await assert.rejects(db.query('SELECT * FROM private.api_partner_receipt_reconciliation_decisions'), /permission denied/)
  await db.exec('RESET ROLE')
  await db.exec('BEGIN')
  await db.exec(read('./catalog/partner-receipt-reconciliation-live-probe.sql'))
  await db.exec('ROLLBACK')
  console.log('Partner receipt recovery: exact proof, owner, prepaid capture/release, unlimited capture/rejection without cash credit, immutable audit, unknown hold, revoked authority, replay and browser denial passed.')
} finally { await db.close() }
