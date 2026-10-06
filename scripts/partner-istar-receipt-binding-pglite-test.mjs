import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const prepaid = '10000000-0000-4000-8000-000000000001'
const unlimited = '10000000-0000-4000-8000-000000000002'
const prepaidKey = '20000000-0000-4000-8000-000000000001'
const unlimitedKey = '20000000-0000-4000-8000-000000000002'
const user = '30000000-0000-4000-8000-000000000001'
const fingerprint = 'a'.repeat(64)
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migrationPath = '../supabase/migrations/20261006040000_partner_istar_receipt_binding.sql'
const migration = read(migrationPath)
const fixture = read('./partner-external-journal-pglite-test.mjs')
  .match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(localMigration/)
assert.ok(fixture)
const call = async (name, args) => (await db.query(
  `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const json = JSON.stringify
const request = (premium = false) => ({ telegram_type: premium ? 'premium' : 'stars',
  username: 'fixture_user', recipient_hash: 'fixture_recipient', quantity: premium ? 1 : 50,
  wallet_type: premium ? 'TON' : 'USDT', ...(premium ? { months: 3 } : {}) })
const receipt = (id, premium = false) => ({ order_id: id, status: 'processing',
  order_type: premium ? 'premium' : 'star', username: 'fixture_user',
  ...(premium ? { months: 3 } : { quantity: 50 }), amount: premium ? '9.123456789123456789' : '2.5000',
  wallet_type: premium ? 'TON' : 'USDT', recipient_hash: 'fixture_recipient' })
let seq = 0
const reserve = async (key = prepaidKey, premium = false, amount = 5) => {
  const r = request(premium)
  const result = await call('reserve_api_partner_external_order', [key, 'telegram_stars',
    'telegram_stars', premium ? 'premium-fixture' : 'stars:50', 'Fixture Telegram', r.quantity,
    amount, amount, `istar-fixture-order-${++seq}`, fingerprint, json(r), null, null, null])
  assert.equal(result.success, true)
  return result.order_id
}
const claim = id => call('claim_api_partner_external_dispatch', [id, prepaidKey])
const bind = (id, r, partner = prepaid) => call('bind_api_partner_istar_receipt', [id, partner, json(r)])
const get = (id, key = prepaidKey) => call('get_api_partner_istar_receipt', [key, id])
const complete = (id, r, key = prepaidKey) => call('complete_api_partner_istar_order', [key, id, json(r)])
const finance = async () => {
  const result = {}
  for (const [name, table, order] of [
    ['wallets', 'public.profiles', 'id'], ['partners', 'public.api_partners', 'id'],
    ['events', 'public.api_partner_external_events', 'id'], ['obligations', 'public.api_partner_obligations', 'order_id'],
  ]) result[name] = (await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY ${order}`)).rows
  return result
}
const accept = async (id, provider, key = prepaidKey, partner = prepaid, amount = 5, premium = false) => {
  const payload = { provider_order_id: provider, provider_status: 'processing', telegram_type: premium ? 'premium' : 'stars' }
  assert.equal((await call('record_api_partner_dispatch_receipt', [id, key, partner, fingerprint,
    amount, 'accepted', 'istar', provider, 'processing', null, json(payload)])).success, true)
  const args = [id, 'accepted', 'istar', provider, json(payload), 'processing', null]
  assert.equal((await call('record_api_partner_external_outcome', args)).success, true)
  assert.equal((await call('record_api_partner_external_outcome', args)).idempotent_replay, true)
  const evidence = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='capture') captures,
    (SELECT count(*)::int FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='release') releases,
    (SELECT count(*)::int FROM public.api_partner_obligations WHERE order_id=$1) obligations`, [id])).rows[0]
  assert.deepEqual(evidence, { captures: 1, releases: 0, obligations: 1 })
}
let assertions = 0
const checkpoint = () => { assertions++ }
try {
  let sql = fixture[1]
  for (const [name, value] of Object.entries({ prepaid, unlimited, prepaidKey, unlimitedKey, user }))
    sql = sql.replaceAll('${' + name + '}', value)
  await db.exec(sql)
  await db.exec(`ALTER TABLE public.profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN account_suspended boolean NOT NULL DEFAULT false;
    UPDATE public.api_partners SET allowed_sections=ARRAY['telegram_stars'];
    UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read'];`)
  await db.exec(read('../supabase/migrations/20261005012000_partner_local_product_purchase.sql')
    .split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  for (const name of ['20261005020000_partner_external_purchase_journal.sql',
    '20261005021000_partner_external_reads_and_rate_limits.sql',
    '20261005021100_partner_dispatch_lock_order.sql',
    '20261005024000_partner_external_dispatch_receipts.sql',
    '20261005025000_partner_receipt_reconciliation.sql',
    '20261005026000_partner_bitrefill_invoice_binding.sql',
    '20261005027000_partner_bitrefill_delivery_recovery.sql'])
    await db.exec(read(`../supabase/migrations/${name}`))
  const genericBefore = (await db.query(`SELECT pg_get_functiondef(oid) body FROM pg_proc
    WHERE proname IN('record_api_partner_external_outcome','update_api_partner_external_status') ORDER BY proname`)).rows
  await db.exec(migration)
  assert.deepEqual((await db.query(`SELECT pg_get_functiondef(oid) body FROM pg_proc
    WHERE proname IN('record_api_partner_external_outcome','update_api_partner_external_status') ORDER BY proname`)).rows, genericBefore)
  checkpoint()

  // Malformed shapes fail closed without PostgreSQL coercion exceptions.
  for (const value of [null, [], 'not-an-object', 1, {}, { ...receipt('1'), amount: null }]) {
    const result = (await db.query('SELECT private.normalize_api_partner_istar_receipt($1::jsonb,$2::jsonb,$3,false) result',
      [json(value), json(request()), 50])).rows[0].result
    assert.equal(result, null)
  }
  for (const months of ['3', 1, 120, 3.5, null, {}, 'bad']) {
    const result = (await db.query('SELECT private.normalize_api_partner_istar_receipt($1::jsonb,$2::jsonb,$3,false) result',
      [json(receipt('1', true)), json({ ...request(true), months }), 1])).rows[0].result
    assert.equal(result, null)
  }
  checkpoint()

  const first = await reserve(prepaidKey, false, 30)
  const r = receipt('12345')
  assert.equal((await bind(first, r)).code, 'DISPATCH_NOT_ELIGIBLE')
  assert.equal((await claim(first)).send_allowed, true)
  assert.equal((await claim(first)).code, 'DISPATCH_ALREADY_CLAIMED')
  const beforeBind = await finance()
  assert.equal((await bind(first, r)).idempotent_replay, false)
  assert.deepEqual(await finance(), beforeBind)
  assert.equal((await bind(first, { ...r, amount: '0002.500000000000000000', order_id: '00012345' })).idempotent_replay, true)
  assert.equal((await get(first)).provider_receipt.amount, '2.5')
  assert.equal((await bind(first, r, unlimited)).success, false)
  assert.equal((await complete(first, { ...r, status: 'completed' })).code, 'ACCEPTANCE_REQUIRED')
  checkpoint()

  const invalid = [{ order_id: 'unsafe:123' }, { order_id: '0' }, { order_id: '1e6' }, { order_id: 12345 },
    { amount: 2.5 }, { amount: '0' }, { amount: '1e-9' }, { amount: '-1' }, { amount: '2.5.0' },
    { amount: '0.0000000000000000001' }, { username: 'other_user' }, { quantity: 51 },
    { order_type: 'premium' }, { wallet_type: 'TON' }, { months: 3 }, { recipient_hash: 'other' },
    { status: 'failed' }, { arbitrary: true }]
  for (const delta of invalid) {
    assert.equal((await bind(first, { ...r, ...delta })).success, false, `bind rejected ${Object.keys(delta)}`)
  }
  assert.equal((await bind(first, { ...r, amount: '2.500000000000000001' })).code, 'ISTAR_RECEIPT_CONFLICT')
  const second = await reserve()
  assert.equal((await claim(second)).send_allowed, true)
  assert.equal((await bind(second, r)).code, 'ISTAR_RECEIPT_CONFLICT')
  checkpoint()

  await accept(first, '12345', prepaidKey, prepaid, 30)
  const captured = await finance()
  for (const delta of [...invalid, { order_id: '54321' }, { amount: '2.500000000000000001' }, { status: 'pending' }])
    assert.equal((await complete(first, { ...r, status: 'completed', ...delta })).success, false,
      `completion rejected ${Object.keys(delta)}`)
  assert.deepEqual(await finance(), captured)
  assert.equal((await complete(first, { ...r, status: 'completed', amount: '2.50' })).success, true)
  assert.equal((await complete(first, { ...r, status: 'completed' })).success, true)
  assert.deepEqual(await finance(), captured)
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [prepaid])).rows[0].balance_ngn), 65)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [user])).rows[0].wallet_balance), 777)
  checkpoint()

  const premium = await reserve(unlimitedKey, true, 500)
  const pr = receipt('AABBCCDD-1111-4111-8111-001122334455', true)
  const canonicalId = pr.order_id.toLowerCase()
  assert.equal((await call('claim_api_partner_external_dispatch', [premium, unlimitedKey])).send_allowed, true)
  assert.equal((await bind(premium, { ...pr, months: 6 }, unlimited)).code, 'INVALID_RECEIPT')
  assert.equal((await bind(premium, { ...pr, quantity: 1 }, unlimited)).code, 'INVALID_RECEIPT')
  assert.equal((await bind(premium, pr, unlimited)).success, true)
  assert.equal((await get(premium, unlimitedKey)).provider_receipt.order_id, canonicalId)
  await accept(premium, canonicalId, unlimitedKey, unlimited, 500, true)
  const creditCaptured = await finance()
  assert.equal((await complete(premium, { ...pr, months: 6, status: 'completed' }, unlimitedKey)).success, false)
  assert.equal((await complete(premium, { ...pr, status: 'completed' }, unlimitedKey)).success, true)
  assert.equal((await complete(premium, { ...pr, status: 'completed' }, unlimitedKey)).success, true)
  assert.deepEqual(await finance(), creditCaptured)
  const obligation = (await db.query('SELECT funding_type,amount_ngn FROM public.api_partner_obligations WHERE order_id=$1', [premium])).rows[0]
  assert.deepEqual(obligation, { funding_type: 'unlimited_credit', amount_ngn: '500.00' })
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [unlimited])).rows[0].balance_ngn), 0)
  checkpoint()

  const authCases = [
    ['UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', 'UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', prepaidKey, 'INVALID_KEY'],
    ["UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create'] WHERE id=$1", "UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read'] WHERE id=$1", prepaidKey, 'SCOPE_DENIED'],
    ['UPDATE public.api_partners SET is_active=false WHERE id=$1', 'UPDATE public.api_partners SET is_active=true WHERE id=$1', prepaid, 'PARTNER_DISABLED'],
    ['UPDATE public.api_partners SET owner_reviewed_at=NULL WHERE id=$1', 'UPDATE public.api_partners SET owner_reviewed_at=now() WHERE id=$1', prepaid, 'PARTNER_DISABLED'],
    ["UPDATE public.api_partners SET allowed_sections=ARRAY['sms'] WHERE id=$1", "UPDATE public.api_partners SET allowed_sections=ARRAY['telegram_stars'] WHERE id=$1", prepaid, 'PARTNER_DISABLED'],
  ]
  for (const [deny, restore, id, code] of authCases) {
    await db.query(deny, [id])
    assert.equal((await get(first)).code, code)
    assert.equal((await complete(first, { ...r, status: 'completed' })).code, code)
    await db.query(restore, [id])
  }
  assert.equal((await get(first, unlimitedKey)).code, 'ORDER_NOT_FOUND')
  await db.query(`INSERT INTO public.api_partner_keys(id,partner_id,scopes) VALUES
    ('20000000-0000-4000-8000-000000000003',$1,ARRAY['orders:create','orders:read'])`, [prepaid])
  assert.equal((await get(first, '20000000-0000-4000-8000-000000000003')).code, 'ORDER_NOT_FOUND')
  checkpoint()

  // A revocation after the one paid POST cannot erase its observation.
  const late = await reserve()
  const lateReceipt = receipt('12346')
  assert.equal((await claim(late)).send_allowed, true)
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [prepaidKey])
  assert.equal((await bind(late, lateReceipt)).success, true)
  assert.equal((await get(late)).code, 'INVALID_KEY')
  await accept(late, '12346')
  assert.equal((await complete(late, { ...lateReceipt, status: 'completed' })).code, 'INVALID_KEY')
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', [prepaidKey])
  assert.equal((await complete(late, { ...lateReceipt, status: 'completed' })).success, true)
  checkpoint()

  const legacy = await reserve()
  assert.equal((await claim(legacy)).send_allowed, true)
  await accept(legacy, '12347')
  assert.equal((await get(legacy)).code, 'ISTAR_RECEIPT_REVIEW_REQUIRED')
  assert.equal((await complete(legacy, { ...receipt('12347'), status: 'completed' })).code, 'ISTAR_RECEIPT_REVIEW_REQUIRED')
  assert.equal((await bind(legacy, receipt('12347'))).code, 'DISPATCH_NOT_ELIGIBLE')
  checkpoint()

  const originalRequest = (await db.query('SELECT request_payload FROM public.api_partner_orders WHERE id=$1', [first])).rows[0].request_payload
  await db.query(`UPDATE public.api_partner_orders SET request_payload=request_payload||'{"username":"changed"}'::jsonb WHERE id=$1`, [first])
  assert.equal((await get(first)).code, 'BINDING_MISMATCH')
  assert.equal((await complete(first, { ...r, status: 'completed' })).code, 'BINDING_MISMATCH')
  await db.query('UPDATE public.api_partner_orders SET request_payload=$2::jsonb WHERE id=$1', [first, json(originalRequest)])
  checkpoint()

  await db.exec('SET session_replication_role=replica')
  for (const query of ['UPDATE private.api_partner_istar_receipt_bindings SET amount_ngn=1',
    'DELETE FROM private.api_partner_istar_receipt_bindings', 'TRUNCATE private.api_partner_istar_receipt_bindings'])
    await assert.rejects(db.query(query), /partner_dispatch_receipt_immutable/)
  await db.exec('SET session_replication_role=origin')
  const meta = (await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,
    pg_get_userbyid(p.proowner) owner FROM pg_proc p WHERE p.proname IN
    ('bind_api_partner_istar_receipt','get_api_partner_istar_receipt','complete_api_partner_istar_order') ORDER BY p.proname`)).rows
  assert.equal(meta.length, 3)
  for (const row of meta) { assert.equal(row.prosecdef, true); assert.deepEqual(row.proconfig, ['search_path=""']); assert.equal(row.owner, 'postgres') }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`SET ROLE ${role}`)
    await assert.rejects(db.query('SELECT * FROM private.api_partner_istar_receipt_bindings'), /permission denied/)
    await assert.rejects(db.query('INSERT INTO private.api_partner_istar_receipt_bindings(order_id) VALUES($1)', [first]), /permission denied/)
    if (role === 'service_role') assert.equal((await get(first)).success, true)
    else for (const [name, args] of [
      ['bind_api_partner_istar_receipt', [first, prepaid, json(r)]],
      ['get_api_partner_istar_receipt', [prepaidKey, first]],
      ['complete_api_partner_istar_order', [prepaidKey, first, json({ ...r, status: 'completed' })]],
    ]) await assert.rejects(call(name, args), /permission denied/)
    await db.exec('RESET ROLE')
  }
  checkpoint()
  console.log(JSON.stringify({ state: 'PASS_LOCAL_ONLY', scenarios: assertions,
    migrationSha256: createHash('sha256').update(migration).digest('hex'),
    actualPartnerFinancialMigrations: 8, providerCalls: 0, productionCalls: 0 }))
} finally { await db.close() }
