import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = name => read(`../supabase/migrations/${name}.sql`)
const funded = '9a340000-0000-4000-8000-000000000001'
const zero = '9a340000-0000-4000-8000-000000000002'
const fake = '9a340000-0000-4000-8000-000000000003'
const staff = '9a340000-0000-4000-8000-000000000004'
const receipt = '9a340000-0000-4000-8000-000000000011'
const request = { product_id: 'test-gift-us', package_id: 'test-gift-us<&>10', unit_value: 10, quantity: 2, expected_amount_ngn: 40 }
const quote = { product_id: request.product_id, product_name: 'Synthetic gift card', package_id: request.package_id,
  unit_value: 10, currency: 'USD', quantity: 2, amount_ngn: 40, provider_price: 5, billing_currency: 'USD' }
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const authorize = (key, q = quote, r = request, user = funded, expected = r.expected_amount_ngn) =>
  call('authorize_customer_giftcard_purchase', [user, key, JSON.stringify(r), JSON.stringify(q), expected])
const replay = (key, r = request, user = funded) => call('get_customer_giftcard_replay', [user, key, JSON.stringify(r)])
const claimCreate = (id, user = funded) => call('claim_customer_giftcard_dispatch', [user, id])
const bind = (id, invoice, q = quote, status = 'unpaid', user = funded) => call('bind_customer_giftcard_invoice', [user, id, invoice, JSON.stringify(q), status])
const claimPay = (id, invoice, user = funded) => call('claim_customer_giftcard_payment', [user, id, invoice])
const outcome = (id, kind, evidence, user = funded) => call('record_customer_giftcard_outcome', [user, id, kind, JSON.stringify(evidence)])
const order = (id, user = funded) => call('get_customer_giftcard_order', [user, id])
const delivered = (invoice, q = quote) => ({ invoice_id: invoice, item_id: q.product_id, package_id: q.package_id,
  unit_value: q.unit_value, currency: q.currency, quantity: q.quantity, provider_status: 'complete',
  redemptions: Array.from({ length: q.quantity }, (_, i) => ({ order_id: `TEST-${invoice}-UNIT-${i}`,
    code: `SYNTHETIC-CODE-${i}`, pin: '1234', instructions: 'Synthetic test instruction', expiration_date: '2099-01-01' })) })
const truth = async (user = funded) => call('wallet_financial_truth_internal', [user])
const balance = async () => Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [funded])).rows[0].wallet_balance)
const purchases = async () => Number((await db.query("SELECT count(*) n FROM public.transactions WHERE type='purchase'")).rows[0].n)
const preparedToPay = async (key, invoice, q = quote, r = request) => {
  const result = await authorize(key, q, r)
  assert.equal(result.success, true)
  assert.equal((await claimCreate(result.order_id)).send_allowed, true)
  assert.equal((await bind(result.order_id, invoice, q)).bound, true)
  assert.equal((await claimPay(result.order_id, invoice)).pay_allowed, true)
  return result
}

try {
  // Use the same minimal schema fixture as the tested real NOWPayments writer,
  // then load actual reservation, wallet financial truth and capture routines.
  const fixture = read('./catalog/nowpayments-wallet-pglite-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(migration\)/)[1]
  await db.exec(fixture.replaceAll('${user}', funded).replaceAll('${oldReceipt}', receipt).replaceAll('${address}', 'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340'))
  await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN raw_user_meta_data jsonb,ADD COLUMN raw_app_meta_data jsonb,ADD COLUMN aud text,ADD COLUMN role text,ADD COLUMN created_at timestamptz,ADD COLUMN updated_at timestamptz;
    ALTER TABLE public.crypto_transactions ADD COLUMN exchange_rate numeric,ADD COLUMN expires_at timestamptz;
    INSERT INTO auth.users(id) VALUES('${zero}'),('${fake}'),('${staff}');
    INSERT INTO public.profiles(id,wallet_balance,is_staff) VALUES('${zero}',0,false),('${fake}',999999,false),('${staff}',0,true);
    CREATE FUNCTION public.giftcard_fixture_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.profiles(id) VALUES(NEW.id); RETURN NEW; END; $$;
    CREATE TRIGGER giftcard_fixture_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.giftcard_fixture_profile();
    DROP TABLE public.wallet_reservations;`)
  await db.exec(migration('20260919023000_create_wallet_reservations_and_dispatch_outbox'))
  await db.exec(migration('20260919025000_create_wallet_reservation_functions'))
  await db.exec(migration('20261005022000_nowpayments_verified_wallet_credit'))
  await db.exec(migration('20260924008000_route_wallet_gates_through_financial_truth'))
  await db.exec(`CREATE TRIGGER trusted_transaction_guard BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_principal_transaction();`)
  await db.exec(migration('20261005034000_customer_giftcard_verified_wallet'))
  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,nowpayments_pay_address,status,created_at)
    VALUES($1,$2,'nowpayments','999340000000001','TEST-FUNDING-340',10000,1,'usdttrc20',1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340','pending',clock_timestamp())`,
    ['9a340000-0000-4000-8000-000000000012', funded])
  assert.equal((await call('register_nowpayments_wallet_quote', ['9a340000-0000-4000-8000-000000000012', funded, '999340000000001','TEST-FUNDING-340',10000,1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340'])).success, true)
  assert.equal((await call('settle_nowpayments_wallet_quote', ['999340000000001','TEST-FUNDING-340',1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340',1.05,'finished','a'.repeat(64),'b'.repeat(64)])).success, true)
  assert.equal(Number((await truth()).confirmed_spendable), 10000)
  assert.equal((await authorize('zero-wallet-test', quote, request, zero)).success, false)
  assert.equal((await authorize('fake-wallet-test', quote, request, fake)).success, false, 'book balance without verified funding is rejected')
  assert.equal((await authorize('staff-wallet-test', quote, request, staff)).code, 'CUSTOMER_ONLY')
  await db.query('UPDATE public.profiles SET is_admin=true,is_staff=false WHERE id=$1',[staff])
  assert.equal((await authorize('admin-wallet-test', quote, request, staff)).code, 'CUSTOMER_ONLY')
  assert.equal((await authorize('price-mismatch-test', quote, request, funded, 30)).code, 'INVALID_REQUEST')
  for (const bad of [{ ...request, quantity: 0 }, { ...request, quantity: 21 }, { ...request, quantity: 1.1 },
    { ...request, expected_amount_ngn: 41 }, { ...request, unit_value: '10' }, { ...request, unit_value: 10.001 }, { ...request, user_id: funded },
    { ...request, package_id: '' }, { ...request, package_id: 'a'.repeat(181) }, { ...request, package_id: 'café' },
    { ...request, package_id: 'quote"' }, { ...request, package_id: "quote'" }, { ...request, package_id: 'slash\\' },
    { ...request, product_id: 'https://evil.example' }]) {
    assert.equal((await authorize('invalid-request-test', quote, bad)).code, 'INVALID_REQUEST')
  }
  for (const bad of [{ ...quote, provider_price: 1.2, billing_currency: 'BTC' }, { ...quote, provider_price: 0 },
    { ...quote, billing_currency: 'EUR' }, { ...quote, currency: 'usd' }, { ...quote, secret: 'forbidden' },
    { ...quote, quantity: 1 }, { ...quote, product_name: '' }, { ...quote, product_name: 'a'.repeat(121) }, { ...quote, amount_ngn: 50 }]) {
    assert.equal((await authorize('invalid-quote-test', bad)).code, 'INVALID_QUOTE')
  }
  assert.deepEqual(await replay('missing-replay-test'), { success: true, existing: false })
  const first = await authorize('first-giftcard-test')
  assert.equal(first.success, true); assert.equal(first.state, 'prepared')
  assert.equal(await balance(),10000); assert.equal(Number((await truth()).confirmed_spendable),9960)
  assert.equal((await replay('first-giftcard-test')).existing, true)
  // Identical request does not depend on refreshed exchange rate, stock or name.
  assert.equal((await authorize('first-giftcard-test', { ...quote, amount_ngn: 80, product_name: 'Changed' })).idempotent_replay, true)
  for (const changed of [{ ...request, product_id: 'other' }, { ...request, package_id: 'other' },
    { ...request, unit_value: 20 }, { ...request, quantity: 1 }, { ...request, expected_amount_ngn: 50 }]) {
    assert.equal((await replay('first-giftcard-test', changed)).code, 'IDEMPOTENCY_REQUEST_CONFLICT')
    assert.equal((await authorize('first-giftcard-test', quote, changed)).code, 'IDEMPOTENCY_REQUEST_CONFLICT')
  }
  assert.equal((await order(first.order_id,zero)).code,'ORDER_NOT_FOUND')
  assert.equal((await replay('first-giftcard-test',request,zero)).existing,false)
  assert.equal((await claimCreate(first.order_id,zero)).code,'ORDER_NOT_FOUND')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-340-1')).code,'DISPATCH_NOT_ELIGIBLE')
  assert.equal((await claimCreate(first.order_id)).send_allowed,true)
  assert.equal((await claimCreate(first.order_id)).send_allowed,false,'committed creation claim cannot replay')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-340-1',quote,'complete')).code,'INVOICE_BINDING_MISMATCH')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-340-1',{...quote,quantity:1})).code,'INVOICE_BINDING_MISMATCH')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-340-1')).bound,true)
  assert.equal((await bind(first.order_id,'TEST-INVOICE-340-1')).idempotent_replay,true)
  assert.equal((await bind(first.order_id,'FOREIGN-INVOICE')).code,'INVOICE_BINDING_CONFLICT')
  assert.equal((await claimPay(first.order_id,'FOREIGN-INVOICE')).pay_allowed,false)
  assert.equal((await outcome(first.order_id,'completed',delivered('TEST-INVOICE-340-1'))).success,false)
  assert.equal((await claimPay(first.order_id,'TEST-INVOICE-340-1')).pay_allowed,true)
  assert.equal((await claimPay(first.order_id,'TEST-INVOICE-340-1')).pay_allowed,false)
  assert.equal((await outcome(first.order_id,'unknown',{})).funds_held,true)
  assert.equal((await outcome(first.order_id,'rejected',{reason_code:'INSUFFICIENT_BALANCE'})).code,'PAID_OUTCOME_REQUIRES_REVIEW')
  assert.equal(await purchases(),0); assert.equal(await balance(),10000)
  assert.ok(!('redemptions' in await order(first.order_id)))
  const good = delivered('TEST-INVOICE-340-1')
  for (const bad of [{...good,invoice_id:'FOREIGN'}, {...good,item_id:'other'}, {...good,package_id:'other'},
    {...good,unit_value:11}, {...good,currency:'NGN'}, {...good,quantity:1}, {...good,provider_status:'unpaid'}, {...good,extra:true},
    {...good,redemptions:good.redemptions.slice(0,1)}, {...good,redemptions:[good.redemptions[0],good.redemptions[0]]},
    {...good,redemptions:[{order_id:'TEST-A',code:' '},good.redemptions[1]]},
    {...good,redemptions:[{order_id:'TEST-A',link:'https://username:password@example.test/a'},good.redemptions[1]]},
    {...good,redemptions:[{order_id:'TEST-A',link:'http://example.test/a'},good.redemptions[1]]},
    {...good,redemptions:[{...good.redemptions[0],provider_key:'forbidden'},good.redemptions[1]]}]) {
    assert.equal((await outcome(first.order_id,'completed',bad)).success,false)
  }
  assert.equal((await outcome(first.order_id,'completed',good,zero)).code,'ORDER_NOT_FOUND')
  assert.equal((await outcome(first.order_id,'completed',good)).success,true)
  assert.equal((await outcome(first.order_id,'completed',good)).idempotent_replay,true)
  assert.equal(await purchases(),1); assert.equal(await balance(),9960); assert.equal(Number((await truth()).confirmed_spendable),9960)
  assert.deepEqual((await order(first.order_id)).redemptions,good.redemptions)
  assert.equal((await outcome(first.order_id,'rejected',{reason_code:'NO_STOCK'})).success,false)
  const q20={...quote,quantity:20,amount_ngn:400,provider_price:50,billing_currency:'BTC'}
  const r20={...request,quantity:20,expected_amount_ngn:400}
  const twenty=await preparedToPay('twenty-giftcards-test','TEST-INVOICE-340-20',q20,r20)
  const units20=delivered('TEST-INVOICE-340-20',q20)
  units20.redemptions[0]={order_id:units20.redemptions[0].order_id,link:'https://redeem.example.test/card?token=synthetic'}
  assert.equal((await outcome(twenty.order_id,'completed',units20)).success,true)
  assert.equal((await order(twenty.order_id)).redemptions.length,20)
  const prepay=await authorize('prepay-rejection-test')
  await claimCreate(prepay.order_id); await bind(prepay.order_id,'TEST-INVOICE-340-REJECT')
  assert.equal((await outcome(prepay.order_id,'rejected',{reason_code:'NO_STOCK'})).success,true)
  assert.equal((await outcome(prepay.order_id,'rejected',{reason_code:'NO_STOCK'})).idempotent_replay,true)
  assert.equal((await claimPay(prepay.order_id,'TEST-INVOICE-340-REJECT')).pay_allowed,false)
  assert.equal(await purchases(),2); assert.equal(await balance(),9560)
  const boundUnknown=await authorize('bound-unknown-test')
  await claimCreate(boundUnknown.order_id); await bind(boundUnknown.order_id,'TEST-INVOICE-340-UNKNOWN')
  assert.equal((await outcome(boundUnknown.order_id,'unknown',{})).funds_held,true)
  assert.equal((await claimPay(boundUnknown.order_id,'TEST-INVOICE-340-UNKNOWN')).pay_allowed,false)
  assert.equal((await outcome(boundUnknown.order_id,'rejected',{reason_code:'NO_STOCK'})).success,false)
  const failure=await preparedToPay('atomic-failure-test','TEST-INVOICE-340-FAIL')
  await db.exec(`CREATE FUNCTION private.giftcard_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='completed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER giftcard_test_audit_fail BEFORE UPDATE ON private.customer_giftcard_dispatch FOR EACH ROW EXECUTE FUNCTION private.giftcard_test_audit_fail();`)
  assert.equal((await outcome(failure.order_id,'completed',delivered('TEST-INVOICE-340-FAIL'))).code,'CAPTURE_REQUIRES_REVIEW')
  assert.equal(await purchases(),2); assert.equal(await balance(),9560)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1',[failure.reservation_id])).rows[0].status,'active')
  const failedProof=(await db.query('SELECT state,delivery_evidence,capture_transaction_id FROM private.customer_giftcard_dispatch WHERE order_id=$1',[failure.order_id])).rows[0]
  assert.equal(failedProof.state,'paying'); assert.equal(failedProof.delivery_evidence,null); assert.equal(failedProof.capture_transaction_id,null)
  await db.exec('DROP TRIGGER giftcard_test_audit_fail ON private.customer_giftcard_dispatch')
  assert.equal((await outcome(failure.order_id,'completed',delivered('TEST-INVOICE-340-FAIL'))).success,true)
  assert.equal(await purchases(),3)
  // Fresh role and epoch checks happen before each irreversible dispatch claim.
  for (const [column,value] of [['is_staff',true],['is_admin',true],['account_suspended',true]]) {
    const stale=await authorize(`role-stale-${column}`)
    await db.query(`UPDATE public.profiles SET ${column}=$1 WHERE id=$2`,[value,funded])
    assert.equal((await claimCreate(stale.order_id)).code,'WALLET_AUTHORIZATION_STALE')
    await db.query(`UPDATE public.profiles SET ${column}=false WHERE id=$1`,[funded])
  }
  const stalePay=await authorize('pay-role-stale-test')
  await claimCreate(stalePay.order_id); await bind(stalePay.order_id,'TEST-INVOICE-340-STALE')
  await db.query('UPDATE public.profiles SET is_staff=true WHERE id=$1',[funded])
  assert.equal((await claimPay(stalePay.order_id,'TEST-INVOICE-340-STALE')).code,'WALLET_AUTHORIZATION_STALE')
  await db.query('UPDATE public.profiles SET is_staff=false WHERE id=$1',[funded])
  const staleEpoch=await authorize('epoch-stale-test')
  await db.query('UPDATE public.profiles SET financial_security_version=financial_security_version+1 WHERE id=$1',[funded])
  assert.equal((await claimCreate(staleEpoch.order_id)).code,'WALLET_AUTHORIZATION_STALE')
  assert.equal((await claimPay(stalePay.order_id,'TEST-INVOICE-340-STALE')).code,'WALLET_AUTHORIZATION_STALE')
  // Neither manipulated safe order fields nor a changed debit can reveal codes.
  for (const mutation of [
    `UPDATE public.customer_giftcard_orders SET amount_ngn=amount_ngn+10 WHERE id='${first.order_id}'`,
    `UPDATE public.customer_giftcard_orders SET status='failed' WHERE id='${first.order_id}'`,
    `UPDATE public.transactions SET status='pending' WHERE id=(SELECT capture_transaction_id FROM private.customer_giftcard_dispatch WHERE order_id='${first.order_id}')`,
    `UPDATE public.transactions SET metadata=metadata||'{"giftcard_evidence_proof_hash":"invalid"}'::jsonb WHERE id=(SELECT capture_transaction_id FROM private.customer_giftcard_dispatch WHERE order_id='${first.order_id}')`,
  ]) {
    await db.exec('BEGIN'); await db.exec(mutation)
    assert.ok(!('redemptions' in await order(first.order_id)))
    await db.exec('ROLLBACK')
  }
  await db.exec(`SET request.jwt.claim.sub='${funded}'; SET ROLE authenticated`)
  assert.deepEqual((await call('get_my_customer_giftcard_order',[first.order_id])).redemptions,good.redemptions)
  assert.ok((await call('get_my_customer_giftcard_history',[])).length>0)
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM public.customer_giftcard_orders')).rows).includes('SYNTHETIC-CODE'))
  await assert.rejects(replay('browser-denied-test'),e=>e.code==='42501')
  await assert.rejects(call('get_customer_giftcard_reconciliation',[funded,first.order_id]),e=>e.code==='42501')
  await assert.rejects(db.query('SELECT * FROM private.customer_giftcard_dispatch'),e=>e.code==='42501')
  await assert.rejects(db.query('UPDATE public.customer_giftcard_orders SET amount_ngn=10'),e=>e.code==='42501')
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub='${zero}'; SET ROLE authenticated`)
  assert.equal((await call('get_my_customer_giftcard_order',[first.order_id])).code,'ORDER_NOT_FOUND')
  assert.deepEqual(await call('get_my_customer_giftcard_history',[]),[])
  assert.equal((await db.query('SELECT id FROM public.customer_giftcard_orders')).rows.length,0)
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub='${staff}'; SET ROLE authenticated`)
  assert.equal((await call('get_my_customer_giftcard_order',[first.order_id])).code,'ORDER_NOT_FOUND','admin cannot borrow buyer identity')
  assert.equal((await db.query('SELECT id FROM public.customer_giftcard_orders')).rows.length,0)
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(call('get_my_customer_giftcard_order',[first.order_id]),e=>e.code==='42501')
  await assert.rejects(db.query('SELECT * FROM public.customer_giftcard_orders'),e=>e.code==='42501')
  await db.exec('RESET ROLE')
  for(const mutation of ["UPDATE private.customer_giftcard_dispatch SET request_hash=repeat('0',64)",
    "UPDATE private.customer_giftcard_dispatch SET invoice_id='OTHER' WHERE invoice_id IS NOT NULL",
    'DELETE FROM private.customer_giftcard_dispatch','TRUNCATE private.customer_giftcard_dispatch CASCADE']) {
    await assert.rejects(db.exec(mutation),/immutable/)
  }
  const rpcNames=['get_customer_giftcard_replay(uuid,text,jsonb)','authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)',
    'claim_customer_giftcard_dispatch(uuid,uuid)','bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text)',
    'claim_customer_giftcard_payment(uuid,uuid,text)','record_customer_giftcard_outcome(uuid,uuid,text,jsonb)',
    'get_customer_giftcard_order(uuid,uuid)','get_customer_giftcard_reconciliation(uuid,uuid)']
  for(const name of rpcNames) {
    for(const role of ['anon','authenticated']) assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok',[role,`public.${name}`])).rows[0].ok,false)
    assert.equal((await db.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') ok',[`public.${name}`])).rows[0].ok,true)
    assert.ok((await db.query('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',[`public.${name}`])).rows[0].proconfig.includes('search_path=""'))
  }
  for(const role of ['anon','authenticated','service_role']) {
    for(const table of ['private.customer_giftcard_dispatch','public.customer_giftcard_orders']) {
      for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) ok',[role,table,privilege])).rows[0].ok,false)
    }
  }
  await db.exec('RESET ROLE; BEGIN ISOLATION LEVEL REPEATABLE READ')
  const probe = await db.exec(read('./catalog/customer-giftcard-wallet-live-probe.sql'))
  assert.ok(probe.some(result=>result.rows[0]?.passed===true),'actual source rollback probe emits a passed result')
  assert.equal(Number((await db.query("SELECT count(*) n FROM auth.users WHERE id IN ('9a340000-0000-4000-8000-000000000101','9a340000-0000-4000-8000-000000000102')")).rows[0].n),0)
  await db.exec('ROLLBACK')
  console.log('Gift-card340 PGlite: real verified funding/reserve/capture/release, stable request replay, one-use claims, exact 2/20-unit delivery, unknown holds, stale role/epoch denial, atomic audit failure, owned secret recovery, redacted public/admin reads and ACL passed (local serial claims; no live provider calls).')
} catch (error) {
  console.error('Gift-card340 local test failed:', error.message, error.code || '', error.where || '')
  process.exitCode = 1
} finally { await db.close() }
