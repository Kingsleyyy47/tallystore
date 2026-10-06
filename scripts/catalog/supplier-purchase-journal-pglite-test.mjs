import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../../supabase/migrations/20261005002000_supplier_purchase_journal.sql', import.meta.url), 'utf8')
const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000001'
const localId = '30000000-0000-4000-8000-000000000001'
const supplierMetadata = JSON.stringify({ supplier_configured_providers: ['muabanvia'] })

async function call(name, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)).rows[0].result
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,
      account_suspended boolean DEFAULT false,financial_security_version integer DEFAULT 1);
    CREATE TABLE public.product_groups(id uuid PRIMARY KEY,is_active boolean,is_sellable boolean,
      availability_status text,price numeric,auto_fulfill_enabled boolean,
      muabanvia_product_id text,shopclone_product_id text,shopviaclone_product_id text,
      stock_count integer);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,user_id uuid,product_group_id uuid,amount numeric,
      status text CONSTRAINT orders_status_check CHECK(status IN ('completed','failed','refunded')),
      idempotency_key text,account_details jsonb,wallet_reservation_id uuid,
      financial_authorization_status text,financial_security_version integer,
      financial_authorization_reference text);
    CREATE TABLE public.wallet_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,amount numeric,
      status text,order_table text,order_id uuid,idempotency_key text,metadata jsonb,
      financial_security_version integer,updated_at timestamptz,released_at timestamptz);
    CREATE TABLE public.individual_accounts(id uuid PRIMARY KEY,product_group_id uuid,status text,
      username text,password text,email text,email_password text,two_fa_code text,recovery_email text,
      recovery_email_password text,additional_info jsonb);
    CREATE FUNCTION public.evaluate_customer_ledger_suspension(uuid,integer) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{"success":true,"suspended":false,"review_required":false}'::jsonb $$;
    CREATE FUNCTION public.create_wallet_reservation(uuid,numeric,text,uuid,text,jsonb,text,integer,timestamptz)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_id uuid := gen_random_uuid();
      BEGIN
        INSERT INTO public.wallet_reservations(id,user_id,amount,status,order_table,order_id,idempotency_key,metadata,
          financial_security_version,updated_at)
        VALUES(v_id,$1,$2,'active',$3,$4,$5,$6,$8,now());
        RETURN jsonb_build_object('success',true,'reservation_id',v_id);
      END $$;
    CREATE FUNCTION public.release_wallet_reservation(uuid,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN UPDATE public.wallet_reservations SET status='released',released_at=now() WHERE id=$1 AND status='active';
        IF NOT FOUND THEN RETURN jsonb_build_object('success',false); END IF;
        RETURN jsonb_build_object('success',true); END $$;
    INSERT INTO public.profiles(id) VALUES ('${userId}');
    INSERT INTO public.product_groups VALUES ('${productId}',true,true,'AVAILABLE',100,true,'supplier-42',null,null,1);
    INSERT INTO public.individual_accounts(id,product_group_id,status,username,password)
      VALUES ('${localId}','${productId}','available','local','local-secret');
  `)
  await db.exec(migration)

  const auth = await call('authorize_supplier_product_purchase',
    [userId, productId, 2, 200, 'supplier-order-one', supplierMetadata, 1])
  assert.equal(auth.success, true)
  assert.equal(auth.supplier_quantity, 1)
  assert.deepEqual(auth.account_ids, [localId])
  assert.equal((await db.query('SELECT status FROM public.individual_accounts WHERE id=$1', [localId])).rows[0].status, 'reserved')
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1', [auth.reservation_id])).rows[0].status, 'active')
  const replay = await call('authorize_supplier_product_purchase',
    [userId, productId, 2, 200, 'supplier-order-one', supplierMetadata, 1])
  assert.equal(replay.idempotent_replay, true)
  assert.equal(replay.supplier_quantity, 1)

  const first = await call('begin_supplier_purchase_attempt',
    [auth.order_id, auth.reservation_id, 'muabanvia', 'supplier-42', 'supplier-order-one:muabanvia:0'])
  assert.equal(first.success, true)
  assert.equal(first.quantity, 1)
  await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1', [userId])
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).code, 'CUSTOMER_AUTHORIZATION_STALE')
  await db.query('UPDATE public.profiles SET account_suspended=false,financial_security_version=2 WHERE id=$1', [userId])
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).code, 'CUSTOMER_AUTHORIZATION_STALE')
  await db.query('UPDATE public.profiles SET financial_security_version=1 WHERE id=$1', [userId])
  await db.query('UPDATE public.product_groups SET supplier_fallback_blocked=true WHERE id=$1', [productId])
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).code, 'SUPPLIER_NOT_AVAILABLE')
  await db.query('UPDATE public.product_groups SET supplier_fallback_blocked=false WHERE id=$1', [productId])
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).send_allowed, true)
  assert.equal((await call('authorize_supplier_product_purchase',
    [userId, productId, 1, 100, 'blocked-by-sending', supplierMetadata, 1])).code,
    'SUPPLIER_RECONCILIATION_PENDING')
  assert.equal((await call('mark_supplier_purchase_sending', [first.attempt_id])).success, false)
  assert.equal((await call('begin_supplier_purchase_attempt',
    [auth.order_id, auth.reservation_id, 'muabanvia', 'supplier-42', 'supplier-order-one:muabanvia:1'])).code,
    'SUPPLIER_RECONCILIATION_PENDING')
  assert.equal((await call('cancel_exhausted_supplier_purchase', [auth.order_id, auth.reservation_id])).success, false)
  assert.equal((await call('record_supplier_purchase_outcome',
    [first.attempt_id, 'rejected', null, null, 'no_stock'])).success, true)
  assert.equal((await call('cancel_exhausted_supplier_purchase', [auth.order_id, auth.reservation_id])).code,
    'SUPPLIER_NOT_EXHAUSTED')
  const second = await call('begin_supplier_purchase_attempt',
    [auth.order_id, auth.reservation_id, 'muabanvia', 'supplier-42', 'supplier-order-one:muabanvia:1'])
  assert.equal(second.success, true)
  assert.equal((await call('mark_supplier_purchase_sending', [second.attempt_id])).send_allowed, true)
  const originalLine = 'supplier-user|supplier-secret|mail@example.test|mail-pass|seed|cookie=session%3Dabc|extra'
  const credentials = [{ username: 'supplier-user', password: 'supplier-secret',
    additional_info: { original_line: originalLine } }]
  assert.equal((await call('record_supplier_purchase_outcome',
    [second.attempt_id, 'succeeded', 'provider-123', JSON.stringify(credentials), null])).success, true)
  const attached = await call('attach_supplier_purchase_accounts', [auth.order_id, second.attempt_id])
  assert.equal(attached.success, true)
  assert.equal(attached.account_ids.length, 2)
  assert.equal((await call('attach_supplier_purchase_accounts', [auth.order_id, second.attempt_id])).idempotent_replay, true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.individual_accounts')).rows[0].n, 2)
  assert.equal((await call('cancel_exhausted_supplier_purchase', [auth.order_id, auth.reservation_id])).success, false)
  assert.equal((await db.query('SELECT credentials FROM public.supplier_purchase_attempts WHERE id=$1', [second.attempt_id])).rows[0].credentials[0].password, 'supplier-secret')
  const delivered = (await db.query('SELECT additional_info FROM public.individual_accounts WHERE id=$1', [attached.account_ids[1]])).rows[0]
  assert.equal(delivered.additional_info.original_line, originalLine, 'journal attachment must preserve the entire delivered supplier line')

  assert.equal((await call('authorize_supplier_product_purchase',
    [userId,productId,1,100,'blocked-by-paid-success',supplierMetadata,1])).code,
    'SUPPLIER_RECONCILIATION_PENDING')
  await db.query("UPDATE public.orders SET status='completed',financial_authorization_status='captured' WHERE id=$1", [auth.order_id])
  await db.query("UPDATE public.wallet_reservations SET status='captured' WHERE id=$1", [auth.reservation_id])
  await db.query("UPDATE public.individual_accounts SET status='sold' WHERE id=ANY($1::uuid[])", [attached.account_ids])

  // A confirmed balance rejection can release a different order and return its local stock.
  const nextLocalId = '30000000-0000-4000-8000-000000000002'
  await db.query("INSERT INTO public.individual_accounts(id,product_group_id,status,username,password) VALUES($1,$2,'available','next-local','next-secret')", [nextLocalId,productId])
  await db.query("UPDATE public.product_groups SET shopclone_product_id='shop-42' WHERE id=$1", [productId])
  const exhausted = await call('authorize_supplier_product_purchase',
    [userId, productId, 2, 200, 'supplier-order-two', supplierMetadata, 1])
  assert.equal(exhausted.success, true)
  const failed = await call('begin_supplier_purchase_attempt',
    [exhausted.order_id, exhausted.reservation_id, 'muabanvia', 'supplier-42', 'supplier-order-two:muabanvia:0'])
  assert.equal((await call('mark_supplier_purchase_sending', [failed.attempt_id])).send_allowed, true)
  assert.equal((await call('record_supplier_purchase_outcome',
    [failed.attempt_id, 'rejected', null, null, 'insufficient_balance'])).success, true)
  // The trusted snapshot only named MuaBanVia; a mapped supplier without a live key does not trap the hold.
  const canceled = await call('cancel_exhausted_supplier_purchase', [exhausted.order_id, exhausted.reservation_id])
  assert.equal(canceled.success, true)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1', [exhausted.reservation_id])).rows[0].status, 'released')
  assert.equal((await db.query('SELECT status FROM public.orders WHERE id=$1', [exhausted.order_id])).rows[0].status, 'cancelled')
  assert.equal((await db.query('SELECT supplier_fallback_blocked FROM public.product_groups WHERE id=$1', [productId])).rows[0].supplier_fallback_blocked, true)

  // A fresh, manually reopened supplier route still caps explicit no-stock retries at three.
  await db.query('UPDATE public.product_groups SET supplier_fallback_blocked=false WHERE id=$1', [productId])
  const capped = await call('authorize_supplier_product_purchase',
    [userId, productId, 2, 200, 'supplier-order-capped', supplierMetadata, 1])
  assert.equal(capped.success, true)
  for (let index = 0; index < 3; index += 1) {
    const attempt = await call('begin_supplier_purchase_attempt',
      [capped.order_id, capped.reservation_id, 'muabanvia', 'supplier-42', `supplier-order-capped:muabanvia:${index}`])
    assert.equal(attempt.success, true)
    assert.equal((await call('mark_supplier_purchase_sending', [attempt.attempt_id])).send_allowed, true)
    assert.equal((await call('record_supplier_purchase_outcome',
      [attempt.attempt_id, 'rejected', null, null, 'no_stock'])).success, true)
  }
  assert.equal((await call('begin_supplier_purchase_attempt',
    [capped.order_id, capped.reservation_id, 'muabanvia', 'supplier-42', 'supplier-order-capped:muabanvia:3'])).code,
    'SUPPLIER_ATTEMPT_LIMIT')
  assert.equal((await call('cancel_exhausted_supplier_purchase', [capped.order_id, capped.reservation_id])).success, true)

  const zeroStockProduct = '20000000-0000-4000-8000-000000000002'
  await db.query("INSERT INTO public.product_groups VALUES ($1,true,false,'UNAVAILABLE',100,true,'supplier-43',null,null,0,false)", [zeroStockProduct])
  const enabled = await call('refresh_supplier_product_availability', [zeroStockProduct, true])
  assert.equal(enabled.availability_status, 'UNLIMITED')
  assert.equal((await db.query('SELECT is_sellable FROM public.product_groups WHERE id=$1', [zeroStockProduct])).rows[0].is_sellable, true)
  const unknownAuth = await call('authorize_supplier_product_purchase',
    [userId, zeroStockProduct, 1, 100, 'supplier-order-unknown', supplierMetadata, 1])
  assert.equal(unknownAuth.supplier_quantity, 1)
  const unknownAttempt = await call('begin_supplier_purchase_attempt',
    [unknownAuth.order_id, unknownAuth.reservation_id, 'muabanvia', 'supplier-43', 'supplier-order-unknown:muabanvia:0'])
  assert.equal((await call('mark_supplier_purchase_sending', [unknownAttempt.attempt_id])).send_allowed, true)
  assert.equal((await call('refresh_supplier_product_availability', [zeroStockProduct, true])).availability_status, 'UNAVAILABLE')
  await assert.rejects(call('record_supplier_purchase_outcome',
    [unknownAttempt.attempt_id, 'succeeded', 'provider-123', JSON.stringify([{ username: 'other', password: 'secret' }]), null]), /unique constraint/)
  assert.equal((await call('record_supplier_purchase_outcome',
    [unknownAttempt.attempt_id, 'unknown', null, null, null])).success, true)
  assert.equal((await db.query('SELECT status FROM public.wallet_reservations WHERE id=$1', [unknownAuth.reservation_id])).rows[0].status, 'active')
  assert.equal((await db.query('SELECT supplier_fallback_blocked FROM public.product_groups WHERE id=$1', [zeroStockProduct])).rows[0].supplier_fallback_blocked, true)
  assert.equal((await call('cancel_exhausted_supplier_purchase', [unknownAuth.order_id, unknownAuth.reservation_id])).success, false)
  assert.equal((await call('refresh_supplier_product_availability', [zeroStockProduct, true])).availability_status, 'UNAVAILABLE')
  await db.query("UPDATE public.product_groups SET supplier_fallback_blocked=false,availability_status='PAUSED' WHERE id=$1", [zeroStockProduct])
  assert.equal((await call('refresh_supplier_product_availability', [zeroStockProduct, true])).preserved, true)
  assert.equal((await db.query('SELECT availability_status FROM public.product_groups WHERE id=$1', [zeroStockProduct])).rows[0].availability_status, 'PAUSED')

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`)
    await assert.rejects(call('begin_supplier_purchase_attempt',
      [auth.order_id, auth.reservation_id, 'muabanvia', 'supplier-42', 'probe']), /permission denied/)
    await assert.rejects(db.query('SELECT * FROM public.supplier_purchase_attempts'), /permission denied/)
    await assert.rejects(call('refresh_supplier_product_availability', [zeroStockProduct, true]), /permission denied/)
    await db.exec('RESET ROLE')
  }
} finally { await db.close() }

console.log('Supplier journal: partial stock, no paid replay, confirmed rejection, attach, release and privileges passed.')
