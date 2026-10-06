import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = name => read(`../supabase/migrations/${name}.sql`)
const funded = '9a340000-0000-4000-8000-000000000001'
const staff = '9a340000-0000-4000-8000-000000000004'
const peer = '9a340000-0000-4000-8000-000000000005'
const receipt = '9a340000-0000-4000-8000-000000000011'
const selection = { product_id: 'test-gift-us', package_id: 'test-gift-us-10', unit_value: 10, quantity: 2 }
const request = { ...selection, expected_amount_ngn: 40 }
const quote = { ...selection, product_name: 'Synthetic gift card', currency: 'USD', amount_ngn: 40,
  provider_price: 18.5, billing_currency: 'USD' }
const childIds = ['INVOICE-UNIT-1', 'INVOICE-UNIT-2']
const call = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
const begin = (key, selectionArg = selection, user = funded) =>
  call('begin_customer_giftcard_quote', [user, key, JSON.stringify(selectionArg)])
const finalize = (id, invoice = 'INVOICE-TEST-1', requestArg = request, quoteArg = quote, ids = childIds) =>
  call('finalize_customer_giftcard_quote', [funded, id, JSON.stringify(requestArg), JSON.stringify(quoteArg),
    invoice, JSON.stringify(ids), new Date(Date.now() + 5 * 60 * 1000).toISOString()])
const authorize = (key, id, requestArg = request, quoteArg = quote) =>
  call('authorize_customer_giftcard_purchase', [funded, key, JSON.stringify(requestArg), JSON.stringify(quoteArg),
    requestArg.expected_amount_ngn, id])
const replay = (key, id, requestArg = request) =>
  call('get_customer_giftcard_replay', [funded, key, JSON.stringify(requestArg), id])

try {
  const fixture = read('./catalog/nowpayments-wallet-pglite-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(migration\)/)[1]
  await db.exec(fixture.replaceAll('${user}', funded).replaceAll('${oldReceipt}', receipt)
    .replaceAll('${address}', 'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340'))
  await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN raw_user_meta_data jsonb,ADD COLUMN raw_app_meta_data jsonb,ADD COLUMN aud text,ADD COLUMN role text,ADD COLUMN created_at timestamptz,ADD COLUMN updated_at timestamptz;
    ALTER TABLE public.crypto_transactions ADD COLUMN exchange_rate numeric,ADD COLUMN expires_at timestamptz;
    INSERT INTO auth.users(id) VALUES('${staff}'),('${peer}');
    INSERT INTO public.profiles(id,wallet_balance,is_staff) VALUES('${staff}',0,true),('${peer}',0,false);
    DROP TABLE public.wallet_reservations;`)
  await db.exec(migration('20260919023000_create_wallet_reservations_and_dispatch_outbox'))
  await db.exec(migration('20260919025000_create_wallet_reservation_functions'))
  await db.exec(migration('20261005022000_nowpayments_verified_wallet_credit'))
  await db.exec(migration('20260924008000_route_wallet_gates_through_financial_truth'))
  await db.exec(`CREATE TRIGGER trusted_transaction_guard BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_principal_transaction();`)
  const baseline = migration('20261005034000_customer_giftcard_verified_wallet')
  const invoiceMigration = migration('20261006020000_customer_giftcard_invoice_quotes')
  await db.exec(baseline)
  // Drift must fail before adding columns or replacing any financial routine.
  const originalReplay = baseline.match(/CREATE FUNCTION public\.get_customer_giftcard_replay\(p_user_id uuid,p_idempotency_key text,p_request jsonb\)[\s\S]*?\n\$\$;/)[0]
  await db.exec(`CREATE OR REPLACE FUNCTION public.get_customer_giftcard_replay(p_user_id uuid,p_idempotency_key text,p_request jsonb)
    RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$;`)
  await assert.rejects(() => db.exec(invoiceMigration), /customer_giftcard_baseline_function_drift/)
  assert.equal((await db.query(`SELECT count(*) n FROM information_schema.columns WHERE table_schema='private'
    AND table_name='customer_giftcard_dispatch' AND column_name='quote_id'`)).rows[0].n,0)
  await db.exec(originalReplay.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
  await db.exec(`ALTER FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb) SECURITY INVOKER`)
  await assert.rejects(() => db.exec(invoiceMigration), /customer_giftcard_baseline_function_security_drift/)
  await db.exec(`ALTER FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb) SECURITY DEFINER`)
  await db.exec(`GRANT EXECUTE ON FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb) TO authenticated`)
  await assert.rejects(() => db.exec(invoiceMigration), /customer_giftcard_baseline_rpc_acl_drift/)
  await db.exec(`REVOKE EXECUTE ON FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb) FROM authenticated`)
  await db.exec(`ALTER TABLE public.customer_giftcard_orders DROP CONSTRAINT customer_giftcard_orders_quantity_check;
    ALTER TABLE public.customer_giftcard_orders ADD CONSTRAINT customer_giftcard_orders_quantity_check CHECK(quantity BETWEEN 1 AND 100)`)
  await assert.rejects(() => db.exec(invoiceMigration), /customer_giftcard_baseline_constraint_definition_drift/)
  await db.exec(`ALTER TABLE public.customer_giftcard_orders DROP CONSTRAINT customer_giftcard_orders_quantity_check;
    ALTER TABLE public.customer_giftcard_orders ADD CONSTRAINT customer_giftcard_orders_quantity_check CHECK(quantity BETWEEN 1 AND 20)`)
  await db.exec(`ALTER TABLE private.customer_giftcard_dispatch ADD COLUMN deliberate_drift text`)
  await assert.rejects(() => db.exec(invoiceMigration), /customer_giftcard_dispatch_columns_drift/)
  await db.exec(`ALTER TABLE private.customer_giftcard_dispatch DROP COLUMN deliberate_drift`)
  await db.exec(invoiceMigration)
  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,nowpayments_pay_address,status,created_at)
    VALUES($1,$2,'nowpayments','999340000000001','TEST-FUNDING-340',10000,1,'usdttrc20',1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340','pending',clock_timestamp())`,
  ['9a340000-0000-4000-8000-000000000012', funded])
  assert.equal((await call('register_nowpayments_wallet_quote', ['9a340000-0000-4000-8000-000000000012', funded,
    '999340000000001','TEST-FUNDING-340',10000,1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340'])).success, true)
  assert.equal((await call('settle_nowpayments_wallet_quote', ['999340000000001','TEST-FUNDING-340',1.05,'usdttrc20',
    'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_340',1.05,'finished','a'.repeat(64),'b'.repeat(64)])).success, true)
  assert.equal((await call('authorize_customer_giftcard_purchase', [funded,'legacy-intent',JSON.stringify(request),
    JSON.stringify(quote),40])).code, 'INVOICE_QUOTE_REQUIRED')
  assert.equal((await call('get_customer_giftcard_replay', [funded,'legacy-intent',JSON.stringify(request)])).code,
    'INVOICE_QUOTE_REQUIRED')
  for (const old of ['public.get_customer_giftcard_replay(uuid,text,jsonb)',
    'public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('service_role',$1,'EXECUTE') ok`,[old])).rows[0].ok,false)
  }
  assert.equal((await begin('staff-customer-intent',selection,staff)).code,'CUSTOMER_ONLY')
  const concurrent = await Promise.all([begin('peer-invoice-intent-1',selection,peer),
    begin('peer-invoice-intent-2',selection,peer)])
  assert.equal(concurrent.filter(r => r.create_allowed).length,1)
  assert.equal(concurrent.filter(r => r.code==='QUOTE_OUTCOME_UNKNOWN').length,1)
  const unresolved = concurrent.find(r => r.create_allowed)
  const unresolvedKey = concurrent.indexOf(unresolved)===0?'peer-invoice-intent-1':'peer-invoice-intent-2'
  assert.equal((await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgname='customer_giftcard_invoice_quote_immutable'`)).rows[0].tgenabled,'A')
  await db.exec(`ALTER TABLE private.customer_giftcard_invoice_quotes DISABLE TRIGGER customer_giftcard_invoice_quote_immutable`)
  await db.query(`UPDATE private.customer_giftcard_invoice_quotes SET created_at=clock_timestamp()-interval '11 minutes'
    WHERE quote_id=$1`,[unresolved.quote_id])
  await db.exec(`ALTER TABLE private.customer_giftcard_invoice_quotes ENABLE ALWAYS TRIGGER customer_giftcard_invoice_quote_immutable`)
  assert.equal((await begin(unresolvedKey,selection,peer)).code,'QUOTE_OUTCOME_UNKNOWN')
  assert.equal((await begin('peer-invoice-intent-3',selection,peer)).create_allowed,true)
  assert.equal((await call('finalize_customer_giftcard_quote',[peer,unresolved.quote_id,JSON.stringify(request),
    JSON.stringify(quote),'PEER-STALE-INVOICE',JSON.stringify(childIds),
    new Date(Date.now()+5*60*1000).toISOString()])).code,'INVALID_INVOICE_QUOTE')
  const started = await begin('invoice-quote-intent-1')
  assert.equal(started.create_allowed, true)
  assert.equal((await begin('invoice-quote-intent-1')).code,'QUOTE_OUTCOME_UNKNOWN')
  assert.equal((await begin('invoice-quote-intent-2')).code,'QUOTE_OUTCOME_UNKNOWN')
  assert.equal((await finalize(started.quote_id,'INVOICE-BAD',
    {...request,product_id:'different-gift'},quote)).code,'INVALID_INVOICE_QUOTE')
  assert.equal((await finalize(started.quote_id,'INVOICE-BAD',request,quote,['DUP','DUP'])).code,'INVALID_INVOICE_QUOTE')
  assert.equal((await finalize(started.quote_id,'INVOICE-TEST-1')).success,true)
  assert.equal((await begin('invoice-quote-intent-1')).create_allowed,false)
  assert.equal((await begin('invoice-quote-intent-1',{...selection,quantity:1})).code,'QUOTE_INTENT_CONFLICT')
  const stored = await call('get_customer_giftcard_invoice_quote',[funded,started.quote_id])
  assert.equal(stored.invoice_id,'INVOICE-TEST-1')
  assert.deepEqual(stored.child_order_ids,childIds)
  assert.equal((await call('get_customer_giftcard_invoice_quote',[staff,started.quote_id])).code,'QUOTE_NOT_FOUND')
  assert.equal((await replay('purchase-intent-1',started.quote_id)).existing,false)
  assert.equal((await authorize('purchase-intent-1',started.quote_id,request,{...quote,provider_price:19})).code,'INVOICE_QUOTE_MISMATCH')
  const order = await authorize('purchase-intent-1',started.quote_id)
  assert.equal(order.success,true)
  assert.equal((await replay('purchase-intent-1',started.quote_id)).existing,true)
  assert.equal((await authorize('purchase-intent-1',started.quote_id)).idempotent_replay,true)
  assert.equal((await authorize('purchase-intent-2',started.quote_id)).code,'INVOICE_QUOTE_NOT_AVAILABLE')
  assert.equal((await call('claim_customer_giftcard_dispatch',[funded,order.order_id])).send_allowed,true)
  assert.equal((await call('bind_customer_giftcard_invoice',[funded,order.order_id,'DIFFERENT-INVOICE',
    JSON.stringify(quote),'unpaid'])).code,'INVOICE_BINDING_MISMATCH')
  assert.equal((await call('bind_customer_giftcard_invoice',[funded,order.order_id,'INVOICE-TEST-1',
    JSON.stringify(quote),'unpaid'])).bound,true)
  assert.equal((await call('claim_customer_giftcard_payment',[funded,order.order_id,'INVOICE-TEST-1'])).pay_allowed,true)
  assert.equal((await call('claim_customer_giftcard_payment',[funded,order.order_id,'INVOICE-TEST-1'])).pay_allowed,false)
  const delivery = { invoice_id:'INVOICE-TEST-1',item_id:quote.product_id,package_id:quote.package_id,
    unit_value:quote.unit_value,currency:quote.currency,quantity:quote.quantity,provider_status:'complete',
    redemptions:childIds.map((id,i) => ({ order_id:id,code:`SYNTHETIC-CODE-${i}` })) }
  assert.equal((await call('record_customer_giftcard_outcome',[funded,order.order_id,'completed',
    JSON.stringify(delivery)])).state,'completed')
  assert.equal((await call('get_customer_giftcard_order',[funded,order.order_id])).state,'completed')
  // Six invoices per hour is a hard ceiling, regardless of distinct intent keys.
  for (let i=2;i<=6;i++) {
    const next = await begin(`invoice-quote-intent-${i}`)
    assert.equal(next.create_allowed,true)
    assert.equal((await finalize(next.quote_id,`INVOICE-TEST-${i}`)).success,true)
  }
  const racing = await Promise.all([begin('invoice-quote-intent-7'),begin('invoice-quote-intent-8')])
  assert.deepEqual(racing.map(r => r.code),['QUOTE_RATE_LIMITED','QUOTE_RATE_LIMITED'])
  const access = (await db.query(`SELECT grantee,privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='private' AND table_name='customer_giftcard_invoice_quotes'
    AND grantee IN ('anon','authenticated','service_role')`)).rows
  assert.equal(access.length,0)
  for (const signature of ['begin_customer_giftcard_quote(uuid,text,jsonb)',
    'finalize_customer_giftcard_quote(uuid,uuid,jsonb,jsonb,text,jsonb,timestamp with time zone)',
    'get_customer_giftcard_invoice_quote(uuid,uuid)',
    'get_customer_giftcard_replay(uuid,text,jsonb,uuid)',
    'authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric,uuid)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated',$1,'EXECUTE') ok`,
      [`public.${signature}`])).rows[0].ok,false)
    assert.equal((await db.query(`SELECT has_function_privilege('service_role',$1,'EXECUTE') ok`,
      [`public.${signature}`])).rows[0].ok,true)
  }
  await db.exec('SET ROLE authenticated')
  await assert.rejects(() => db.query('SELECT * FROM private.customer_giftcard_invoice_quotes'))
  await assert.rejects(() => begin('untrusted-quote-intent'))
  await db.exec('RESET ROLE')
  console.log('customer gift-card invoice quote SQL: passed')
} finally { await db.close() }
