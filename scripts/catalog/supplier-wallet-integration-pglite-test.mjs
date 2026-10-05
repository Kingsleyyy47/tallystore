import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const fake = '10000000-0000-4000-8000-000000000001'
const buyer = '10000000-0000-4000-8000-000000000002'
const failedBuyer = '10000000-0000-4000-8000-000000000003'
const heldBuyer = '10000000-0000-4000-8000-000000000004'
const product = '20000000-0000-4000-8000-000000000001'
const local = '30000000-0000-4000-8000-000000000001'
const metadata = JSON.stringify({ supplier_configured_providers: ['muabanvia'] })

async function call(name, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)).rows[0].result
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,wallet_balance numeric DEFAULT 0,
      is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,account_suspended boolean DEFAULT false);
    CREATE TABLE public.product_groups(id uuid PRIMARY KEY,is_active boolean,is_sellable boolean,
      availability_status text,price numeric,auto_fulfill_enabled boolean,
      muabanvia_product_id text,shopclone_product_id text,shopviaclone_product_id text,stock_count integer);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,user_id uuid,product_group_id uuid,amount numeric,
      status text CONSTRAINT orders_status_check CHECK(status IN ('completed','failed','refunded')),
      idempotency_key text,account_details jsonb,wallet_reservation_id uuid,
      financial_authorization_status text,financial_security_version integer,
      financial_authorization_reference text);
    CREATE TABLE public.individual_accounts(id uuid PRIMARY KEY,product_group_id uuid,status text,
      username text,password text,email text,email_password text,two_fa_code text,recovery_email text,
      recovery_email_password text,additional_info jsonb,sold_at timestamptz);
    CREATE TABLE public.trusted_funding(user_id uuid PRIMARY KEY,principal numeric NOT NULL,spent numeric NOT NULL DEFAULT 0);
    CREATE TABLE public.posted_purchases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,amount numeric,
      idempotency_key text UNIQUE);
    CREATE FUNCTION public.evaluate_customer_ledger_suspension(p_user_id uuid,p_unused integer)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_available numeric;
      BEGIN SELECT principal-spent INTO v_available FROM public.trusted_funding WHERE user_id=p_user_id;
        RETURN jsonb_build_object('success',true,'suspended',false,'review_required',false,
          'trusted_available',COALESCE(v_available,0)); END $$;
    CREATE FUNCTION public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_available numeric; v_id uuid;
      BEGIN
        SELECT principal-spent INTO v_available FROM public.trusted_funding WHERE user_id=$1 FOR UPDATE;
        IF v_available IS NULL OR v_available<$3 THEN RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_TRUSTED_FUNDS'); END IF;
        IF EXISTS (SELECT 1 FROM public.posted_purchases WHERE idempotency_key=$6) THEN
          RETURN jsonb_build_object('success',true,'idempotent_replay',true);
        END IF;
        UPDATE public.trusted_funding SET spent=spent+$3 WHERE user_id=$1;
        UPDATE public.profiles SET wallet_balance=wallet_balance-$3 WHERE id=$1;
        INSERT INTO public.posted_purchases(user_id,amount,idempotency_key) VALUES($1,$3,$6) RETURNING id INTO v_id;
        RETURN jsonb_build_object('success',true,'transaction',jsonb_build_object('id',v_id),
          'balance_after',v_available-$3);
      END $$;
    INSERT INTO public.profiles(id,wallet_balance) VALUES
      ('${fake}',500),('${buyer}',200),('${failedBuyer}',100),('${heldBuyer}',150);
    INSERT INTO public.trusted_funding VALUES ('${buyer}',200,0),('${failedBuyer}',100,0),('${heldBuyer}',150,0);
    INSERT INTO public.product_groups VALUES ('${product}',true,true,'UNLIMITED',100,true,'supplier-42',null,null,1);
    INSERT INTO public.individual_accounts(id,product_group_id,status,username,password)
      VALUES('${local}','${product}','available','local-user','local-secret');
  `)
  await db.exec(migration('20260919023000_create_wallet_reservations_and_dispatch_outbox.sql'))
  await db.exec(migration('20260919025000_create_wallet_reservation_functions.sql'))
  await db.exec(migration('20260919028000_migrate_product_purchase_reserve_capture.sql'))
  await db.exec(migration('20261005002000_supplier_purchase_journal.sql'))

  // A fake stored balance cannot authorize a supplier call: the real wallet reservation reads trusted_available.
  const unfunded = await call('authorize_supplier_product_purchase', [fake,product,2,200,'fake-stored-balance',metadata,1])
  assert.equal(unfunded.code, 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.wallet_reservations')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.orders')).rows[0].n, 0)

  const authorized = await call('authorize_supplier_product_purchase', [buyer,product,2,200,'backed-supplier-order',metadata,1])
  assert.equal(authorized.success, true)
  assert.equal(authorized.supplier_quantity, 1)
  assert.deepEqual(authorized.account_ids,[local])
  const attempt = await call('begin_supplier_purchase_attempt',
    [authorized.order_id,authorized.reservation_id,'muabanvia','supplier-42','backed-supplier-order:mua:0'])
  assert.equal((await call('mark_supplier_purchase_sending',[attempt.attempt_id])).send_allowed,true)
  assert.equal((await call('record_supplier_purchase_outcome',
    [attempt.attempt_id,'succeeded','supplier-paid-1',JSON.stringify([{ username:'supplier-user',password:'supplier-secret' }]),null])).success,true)
  const attached = await call('attach_supplier_purchase_accounts',[authorized.order_id,attempt.attempt_id])
  assert.equal(attached.account_ids.length,2)
  const details = JSON.stringify({ accounts:[{ username:'local-user' },{ username:'supplier-user' }] })
  const completed = await call('complete_product_purchase',[
    buyer,authorized.order_id,authorized.reservation_id,attached.account_ids,details,
    'capture:backed-supplier-order','PUR-backed-supplier-order','Product purchase',null,
  ])
  assert.equal(completed.success,true)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1',[authorized.reservation_id])).rows[0].status,'captured')
  assert.equal(Number((await db.query('SELECT spent FROM public.trusted_funding WHERE user_id=$1',[buyer])).rows[0].spent),200)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.individual_accounts WHERE status='sold'")).rows[0].n,2)
  const completionReplay = await call('complete_product_purchase',[
    buyer,authorized.order_id,authorized.reservation_id,attached.account_ids,details,
    'capture:backed-supplier-order','PUR-backed-supplier-order','Product purchase',null,
  ])
  assert.equal(completionReplay.idempotent_replay,true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.posted_purchases')).rows[0].n,1)

  // Two queued authorizations cannot both spend the same trusted capacity.
  const simultaneousHolds = await Promise.all([
    call('authorize_supplier_product_purchase',[heldBuyer,product,1,100,'overbudget-one',metadata,1]),
    call('authorize_supplier_product_purchase',[heldBuyer,product,1,100,'overbudget-two',metadata,1]),
  ])
  assert.equal(simultaneousHolds.filter(result => result.success).length,1)
  const rejectedHold = simultaneousHolds.find(result => !result.success)
  assert.equal(rejectedHold.code,'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS')
  assert.equal(Number(rejectedHold.active_reserved),100)

  // Confirmed supplier rejection releases the real reservation and returns partial local stock.
  await db.query("UPDATE public.individual_accounts SET status='available' WHERE id=$1",[local])
  const released = await call('authorize_supplier_product_purchase',
    [failedBuyer,product,2,100,'confirmed-failure-order',metadata,1])
  assert.equal(released.success,true)
  const failedAttempt = await call('begin_supplier_purchase_attempt',
    [released.order_id,released.reservation_id,'muabanvia','supplier-42','confirmed-failure-order:mua:0'])
  assert.equal((await call('mark_supplier_purchase_sending',[failedAttempt.attempt_id])).send_allowed,true)
  assert.equal((await call('record_supplier_purchase_outcome',
    [failedAttempt.attempt_id,'rejected',null,null,'insufficient_balance'])).success,true)
  assert.equal((await call('cancel_exhausted_supplier_purchase',[released.order_id,released.reservation_id])).success,true)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1',[released.reservation_id])).rows[0].status,'released')
  assert.equal(Number((await db.query('SELECT spent FROM public.trusted_funding WHERE user_id=$1',[failedBuyer])).rows[0].spent),0)
  assert.equal((await db.query('SELECT status FROM public.individual_accounts WHERE id=$1',[local])).rows[0].status,'available')
} finally { await db.close() }

console.log('Supplier wallet integration: actual reserve/capture/release/completion, trusted funding, replay and held-budget checks passed.')
