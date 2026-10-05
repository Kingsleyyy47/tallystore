import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = name => read(`../supabase/migrations/${name}.sql`)
const funded = '9a280000-0000-4000-8000-000000000001'
const zero = '9a280000-0000-4000-8000-000000000002'
const fake = '9a280000-0000-4000-8000-000000000003'
const staff = '9a280000-0000-4000-8000-000000000004'
const receipt = '9a280000-0000-4000-8000-000000000011'
const quote = { product_id: 'test-airtime', product_name: 'Test airtime', operator_id: 'test-operator', operator_name: 'Test operator',
  country_code: 'US', recipient_phone: '+12025550123', package_id: null, unit_value: 10, currency: 'USD', amount_ngn: 40 }
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const authorize = (key, q = quote, user = funded, expected = q.amount_ngn) => call('authorize_customer_airtime_purchase', [user, key, JSON.stringify(q), expected])
const claimCreate = (id, user = funded) => call('claim_customer_airtime_dispatch', [user, id])
const bind = (id, invoice, q = quote, status = 'unpaid') => call('bind_customer_airtime_invoice', [funded, id, invoice, JSON.stringify(q), status])
const claimPay = (id, invoice) => call('claim_customer_airtime_payment', [funded, id, invoice])
const outcome = (id, kind, evidence, user = funded) => call('record_customer_airtime_outcome', [user, id, kind, JSON.stringify(evidence)])
const delivered = invoice => ({ invoice_id: invoice, product_id: quote.product_id, operator_id: quote.operator_id,
  recipient_phone: quote.recipient_phone, package_id: quote.package_id, unit_value: quote.unit_value, currency: quote.currency,
  quantity: 1, provider_order_id: `TEST-UNIT-${invoice}`, provider_status: 'complete' })
const truth = async (user = funded) => call('wallet_financial_truth_internal', [user])
const balance = async (user = funded) => Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1', [user])).rows[0].wallet_balance)
const purchases = async () => Number((await db.query("SELECT count(*) n FROM public.transactions WHERE type='purchase'")).rows[0].n)

try {
  const fixture = read('./catalog/nowpayments-wallet-pglite-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(migration\)/)[1]
  await db.exec(fixture.replaceAll('${user}', funded).replaceAll('${oldReceipt}', receipt).replaceAll('${address}', 'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_280'))
  await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN raw_user_meta_data jsonb,ADD COLUMN raw_app_meta_data jsonb,ADD COLUMN aud text,ADD COLUMN role text,ADD COLUMN created_at timestamptz,ADD COLUMN updated_at timestamptz;
    ALTER TABLE public.crypto_transactions ADD COLUMN exchange_rate numeric,ADD COLUMN expires_at timestamptz;
    CREATE FUNCTION public.airtime_fixture_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.profiles(id) VALUES(NEW.id); RETURN NEW; END; $$;
    CREATE TRIGGER airtime_fixture_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.airtime_fixture_profile();
    INSERT INTO auth.users(id) VALUES('${zero}'),('${fake}'),('${staff}');
    UPDATE public.profiles SET wallet_balance=99999 WHERE id='${fake}';
    UPDATE public.profiles SET is_staff=true WHERE id='${staff}';
    DROP TABLE public.wallet_reservations;`)
  await db.exec(migration('20260919023000_create_wallet_reservations_and_dispatch_outbox'))
  await db.exec(migration('20260919025000_create_wallet_reservation_functions'))
  await db.exec(migration('20261005022000_nowpayments_verified_wallet_credit'))
  await db.exec(migration('20260924008000_route_wallet_gates_through_financial_truth'))
  await db.exec(migration('20261005028000_customer_bitrefill_airtime_wallet'))
  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,nowpayments_pay_address,status,created_at)
    VALUES($1,$2,'nowpayments','999280000000001','TEST-FUNDING-280',500,1,'usdttrc20',1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_280','pending',clock_timestamp())`,
  ['9a280000-0000-4000-8000-000000000012', funded])
  assert.equal((await call('register_nowpayments_wallet_quote', ['9a280000-0000-4000-8000-000000000012', funded, '999280000000001','TEST-FUNDING-280',500,1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_280'])).success, true)
  assert.equal((await call('settle_nowpayments_wallet_quote', ['999280000000001','TEST-FUNDING-280',1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_280',1.05,'finished','a'.repeat(64),'b'.repeat(64)])).success, true)
  assert.equal(Number((await truth()).confirmed_spendable), 500)
  assert.equal((await authorize('zero-wallet-test', quote, zero)).success, false)
  assert.equal((await authorize('fake-wallet-test', quote, fake)).success, false, 'stored balance alone cannot authorize')
  assert.equal((await authorize('staff-wallet-test', quote, staff)).code, 'CUSTOMER_ONLY')
  await db.query('UPDATE public.profiles SET is_admin=true,is_staff=false WHERE id=$1',[staff])
  assert.equal((await authorize('admin-wallet-test', quote, staff)).code, 'CUSTOMER_ONLY')
  assert.equal((await authorize('price-mismatch-test', quote, funded, 39)).code, 'INVALID_QUOTE')
  assert.equal((await authorize('invalid-phone-test', {...quote, recipient_phone:'02025550123'})).code, 'INVALID_QUOTE')
  assert.equal((await authorize('unknown-quote-test', {...quote, api_key:'forbidden'})).code, 'INVALID_QUOTE')
  assert.equal((await authorize('bad-amount-type-test',{...quote,amount_ngn:'not-a-number'},funded,40)).code,'INVALID_QUOTE')
  assert.equal((await authorize('bad-value-type-test',{...quote,unit_value:'not-a-number'})).code,'INVALID_QUOTE')
  const international = await authorize('international-package-test',{...quote,package_id:'at-t-usa<&>25',currency:'EUR',amount_ngn:1})
  assert.equal(international.success,true)
  assert.equal((await outcome(international.order_id,'rejected',{reason_code:'PRICE_CHANGED'})).success,true)
  const first = await authorize('first-airtime-test')
  assert.equal(first.success, true); assert.equal(first.state, 'prepared')
  assert.equal(await balance(),500); assert.equal(Number((await truth()).confirmed_spendable),460)
  assert.equal((await authorize('first-airtime-test')).idempotent_replay, true)
  assert.equal((await call('get_customer_airtime_order',[zero,first.order_id])).code,'ORDER_NOT_FOUND')
  for (const q of [{...quote,recipient_phone:'+12025550124'},{...quote,package_id:'other-package'},{...quote,operator_id:'foreign-operator'},{...quote,amount_ngn:41}]) {
    assert.equal((await authorize('first-airtime-test',q)).code,'IDEMPOTENCY_REQUEST_CONFLICT')
  }
  assert.equal((await authorize('over-budget-test',{...quote,amount_ngn:461})).success,false)
  assert.equal((await claimCreate(first.order_id,zero)).code,'ORDER_NOT_FOUND')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-280-1')).code,'DISPATCH_NOT_ELIGIBLE')
  const claims = await Promise.all([claimCreate(first.order_id),claimCreate(first.order_id)])
  assert.equal(claims.filter(r=>r.send_allowed===true).length,1)
  assert.equal((await bind(first.order_id,'TEST-INVOICE-280-1',quote,'complete')).code,'INVOICE_BINDING_MISMATCH')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-280-1',{...quote,recipient_phone:'+12025550124'})).code,'INVOICE_BINDING_MISMATCH')
  assert.equal((await bind(first.order_id,'TEST-INVOICE-280-1')).bound,true)
  assert.equal((await bind(first.order_id,'TEST-INVOICE-280-1')).idempotent_replay,true)
  assert.equal((await bind(first.order_id,'FOREIGN-INVOICE')).code,'INVOICE_BINDING_CONFLICT')
  assert.equal((await claimPay(first.order_id,'FOREIGN-INVOICE')).pay_allowed,false)
  const pays = await Promise.all([claimPay(first.order_id,'TEST-INVOICE-280-1'),claimPay(first.order_id,'TEST-INVOICE-280-1')])
  assert.equal(pays.filter(r=>r.pay_allowed===true).length,1)
  assert.equal((await outcome(first.order_id,'unknown',{})).funds_held,true)
  assert.equal((await outcome(first.order_id,'rejected',{reason_code:'INSUFFICIENT_BALANCE'})).code,'PAID_OUTCOME_REQUIRES_REVIEW')
  assert.equal((await claimPay(first.order_id,'TEST-INVOICE-280-1')).pay_allowed,false)
  assert.equal(await purchases(),0); assert.equal(await balance(),500)
  const reconciliation = await call('get_customer_airtime_reconciliation',[funded,first.order_id])
  assert.equal(reconciliation.invoice_id,'TEST-INVOICE-280-1'); assert.equal(reconciliation.payment_claimed,true)
  assert.deepEqual(reconciliation.quote,quote)
  assert.equal((await call('get_customer_airtime_reconciliation',[zero,first.order_id])).code,'ORDER_NOT_FOUND')
  const good = delivered('TEST-INVOICE-280-1')
  for (const bad of [{...good,invoice_id:'FOREIGN'}, {...good,recipient_phone:'+12025550124'}, {...good,quantity:2}, {...good,unit_value:11}, {...good,currency:'NGN'},
    {...good,product_id:'foreign'}, {...good,operator_id:'foreign'}, {...good,package_id:'foreign'}, {...good,provider_status:'unpaid'}, {...good,extra:true}, {...good,provider_order_id:''}]) {
    assert.equal((await outcome(first.order_id,'completed',bad)).success,false)
  }
  assert.equal((await outcome(first.order_id,'completed',good,zero)).code,'ORDER_NOT_FOUND')
  assert.equal((await outcome(first.order_id,'completed',good)).success,true)
  assert.equal((await outcome(first.order_id,'completed',good)).idempotent_replay,true)
  assert.equal(await purchases(),1); assert.equal(await balance(),460); assert.equal(Number((await truth()).confirmed_spendable),460)
  assert.equal((await claimPay(first.order_id,'TEST-INVOICE-280-1')).pay_allowed,false)
  assert.equal((await outcome(first.order_id,'rejected',{reason_code:'NO_STOCK'})).success,false)
  const rejected = await authorize('prepay-rejection-test')
  assert.equal((await outcome(rejected.order_id,'rejected',{reason_code:'NO_STOCK'})).success,true)
  assert.equal((await outcome(rejected.order_id,'rejected',{reason_code:'NO_STOCK'})).idempotent_replay,true)
  assert.equal((await claimCreate(rejected.order_id)).send_allowed,false)
  assert.equal(await purchases(),1); assert.equal(await balance(),460); assert.equal(Number((await truth()).confirmed_spendable),460)
  const failure = await authorize('atomic-failure-test')
  await claimCreate(failure.order_id); await bind(failure.order_id,'TEST-INVOICE-280-FAIL'); await claimPay(failure.order_id,'TEST-INVOICE-280-FAIL')
  await db.exec(`CREATE FUNCTION public.airtime_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER airtime_test_fail BEFORE UPDATE ON public.customer_airtime_orders FOR EACH ROW EXECUTE FUNCTION public.airtime_test_fail();`)
  assert.equal((await outcome(failure.order_id,'completed',delivered('TEST-INVOICE-280-FAIL'))).code,'CAPTURE_REQUIRES_REVIEW')
  assert.equal(await purchases(),1); assert.equal(await balance(),460)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1',[failure.reservation_id])).rows[0].status,'active')
  await db.exec('DROP TRIGGER airtime_test_fail ON public.customer_airtime_orders;')
  const stale = await authorize('stale-claim-test')
  await db.query('UPDATE public.profiles SET financial_security_version=financial_security_version+1 WHERE id=$1',[funded])
  assert.equal((await claimCreate(stale.order_id)).code,'WALLET_AUTHORIZATION_STALE')
  await db.exec(`SET request.jwt.claim.sub='${funded}'; SET ROLE authenticated;`)
  assert.ok((await db.query('SELECT id FROM public.customer_airtime_orders')).rows.length>0)
  await assert.rejects(call('authorize_customer_airtime_purchase',[funded,'browser-test-key',JSON.stringify(quote),40]),e=>e.code==='42501')
  await assert.rejects(call('get_customer_airtime_reconciliation',[funded,first.order_id]),e=>e.code==='42501')
  await assert.rejects(db.query('SELECT * FROM private.customer_airtime_dispatch'),e=>e.code==='42501')
  await assert.rejects(db.query("UPDATE public.customer_airtime_orders SET amount_ngn=1"),e=>e.code==='42501')
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub='${zero}'; SET ROLE authenticated;`)
  assert.equal((await db.query('SELECT id FROM public.customer_airtime_orders')).rows.length,0)
  await db.exec('RESET ROLE;')
  await assert.rejects(db.exec("UPDATE private.customer_airtime_dispatch SET quote=quote || '{\"recipient_phone\":\"+12025550124\"}'::jsonb"),/immutable/)
  await assert.rejects(db.exec('DELETE FROM private.customer_airtime_dispatch'),/immutable/)
  await assert.rejects(db.exec('TRUNCATE private.customer_airtime_dispatch CASCADE'),/immutable/)
  for(const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("SELECT has_table_privilege($1,'private.customer_airtime_dispatch','INSERT') w",[role])).rows[0].w,false)
    assert.equal((await db.query("SELECT has_table_privilege($1,'public.customer_airtime_orders','UPDATE') w",[role])).rows[0].w,false)
  }
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ;')
  const probe = await db.exec(read('./catalog/customer-airtime-wallet-live-probe.sql'))
  const checks = probe.find(result=>result.rows[0]?.passed===true)?.rows[0]
  assert.ok(checks,'rollback source probe emits fixed boolean checks')
  assert.ok(Object.values(checks).every(value=>value===true))
  assert.equal(Number((await db.query("SELECT count(*) n FROM auth.users WHERE id IN ('9a280000-0000-4000-8000-000000000101','9a280000-0000-4000-8000-000000000102')")).rows[0].n),0)
  await db.exec('ROLLBACK;')
  console.log('Customer airtime PGlite: actual verified wallet funding, canonical reserve/capture/release, one-use creation/payment, bound quote/phone/operator, unknown holds, exact replay, atomic failure, owner-only reads and ACL passed.')
} finally { await db.close() }
