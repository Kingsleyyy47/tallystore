import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const userId = '10000000-0000-4000-8000-000000000001'
const productId = '20000000-0000-4000-8000-000000000001'
const localId = '30000000-0000-4000-8000-000000000001'
const other = '20000000-0000-4000-8000-000000000002'
const account2 = '30000000-0000-4000-8000-000000000002'
const setupSource = readFileSync('scripts/catalog/supplier-purchase-journal-pglite-test.mjs','utf8')
const scaffold = setupSource.match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1]
assert.ok(scaffold, 'Supplier journal fixture schema must exist')
const setup = scaffold.replaceAll('${userId}',userId).replaceAll('${productId}',productId).replaceAll('${localId}',localId)
const journal = readFileSync('supabase/migrations/20261005002000_supplier_purchase_journal.sql','utf8')
const migration = readFileSync('supabase/migrations/20261005003000_authoritative_inventory_projection.sql','utf8')
const paidSendReadiness = readFileSync('supabase/migrations/20261005017000_supplier_paid_send_readiness.sql','utf8')
const resetMigration = readFileSync('supabase/migrations/20261005004000_owner_supplier_fallback_reset.sql','utf8')
async function group(id=productId) { return (await db.query('SELECT * FROM public.product_groups WHERE id=$1',[id])).rows[0] }
async function refresh(id=productId, enabled=true) { return (await db.query('SELECT public.refresh_supplier_product_availability($1,$2) AS result',[id,enabled])).rows[0].result }
async function assertState(id,count,status,ready,sellable) {
  const row=await group(id)
  assert.equal(row.stock_count,count); assert.equal(row.availability_status,status)
  assert.equal(row.supplier_fallback_ready,ready); assert.equal(row.is_sellable,sellable)
}
try {
  await db.exec(setup)
  // Ensure the verified legacy per-row count trigger is retired.
  await db.exec(`CREATE FUNCTION public.update_stock_count() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'legacy_stock_trigger_must_be_retired'; END $$;
    CREATE TRIGGER update_stock_count_trigger AFTER INSERT ON public.individual_accounts FOR EACH ROW EXECUTE FUNCTION public.update_stock_count();`)
  await db.exec(journal)
  await db.exec(migration)
  await db.exec(paidSendReadiness)
  await db.exec(resetMigration)
  await assertState(productId,1,'LOW_STOCK',false,true)
  await refresh()
  await assertState(productId,1,'UNLIMITED',true,true)
  await db.query(`INSERT INTO public.product_groups(id,is_active,price,auto_fulfill_enabled,stock_count,availability_status,is_sellable)
    VALUES($1,true,100,false,999,'UNLIMITED',true)`,[other])
  await assertState(other,0,'UNAVAILABLE',false,false)
  await refresh(other)
  await assertState(other,0,'UNAVAILABLE',false,false)

  await db.exec(`CREATE TABLE public.test_projection_updates(id uuid,stock_count integer);
    CREATE FUNCTION public.test_log_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
      INSERT INTO public.test_projection_updates VALUES(NEW.id,NEW.stock_count); RETURN NEW; END $$;
    CREATE TRIGGER test_projection_updates AFTER UPDATE ON public.product_groups FOR EACH ROW EXECUTE FUNCTION public.test_log_projection();`)
  assert.equal((await refresh()).updated,false)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.test_projection_updates')).rows[0].count,0,'Unchanged refresh emits no product update')
  await db.query(`INSERT INTO public.individual_accounts(id,product_group_id,status)
    VALUES($1,$2,'available'),(gen_random_uuid(),$2,'available'),(gen_random_uuid(),$2,'sold')`,[account2,productId])
  await assertState(productId,3,'UNLIMITED',true,true)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.test_projection_updates')).rows[0].count,1,'One group refresh per bulk insert statement')
  await db.exec('TRUNCATE public.test_projection_updates')
  await db.query('UPDATE public.individual_accounts SET product_group_id=$1 WHERE id=$2',[other,account2])
  await assertState(productId,2,'UNLIMITED',true,true)
  await assertState(other,1,'LOW_STOCK',false,true)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.test_projection_updates')).rows[0].count,2,'Both groups refresh once after an account move')
  await db.query("UPDATE public.individual_accounts SET status='reserved' WHERE product_group_id=$1",[productId])
  await assertState(productId,0,'UNLIMITED',true,true)
  await db.query('DELETE FROM public.individual_accounts WHERE product_group_id=$1',[other])
  await assertState(other,0,'UNAVAILABLE',false,false)

  await db.query("UPDATE public.product_groups SET availability_status='PAUSED' WHERE id=$1",[productId])
  await db.query("UPDATE public.individual_accounts SET status='available' WHERE id=$1",[localId])
  await refresh()
  await assertState(productId,1,'PAUSED',false,false)

  // Paid credentials for an unfinished order still require settlement.
  await db.query("UPDATE public.product_groups SET is_active=true,availability_status='AVAILABLE' WHERE id=$1",[productId])
  await refresh()
  const pendingOrder='40000000-0000-4000-8000-000000000001'
  const pendingReservation='50000000-0000-4000-8000-000000000001'
  await db.query("INSERT INTO public.orders(id,product_group_id,status) VALUES($1,$2,'processing')",[pendingOrder,productId])
  await db.query("INSERT INTO public.wallet_reservations(id,status) VALUES($1,'active')",[pendingReservation])
  await db.query(`INSERT INTO public.supplier_purchase_attempts(order_id,reservation_id,provider,provider_product_id,quantity,attempt_number,idempotency_key,status,credentials)
    VALUES($1,$2,'muabanvia','test',1,1,'projection-pending','succeeded','[{"username":"test","password":"test"}]'::jsonb)`,[pendingOrder,pendingReservation])
  await refresh()
  await assertState(productId,1,'LOW_STOCK',false,true)
  await db.query("UPDATE public.orders SET status='completed' WHERE id=$1",[pendingOrder])
  await refresh()
  await assertState(productId,1,'UNLIMITED',true,true)
  await db.query("UPDATE public.supplier_purchase_attempts SET status='unknown',credentials=NULL WHERE order_id=$1",[pendingOrder])
  await refresh()
  await assertState(productId,1,'LOW_STOCK',false,true)
  await db.query("UPDATE public.supplier_purchase_attempts SET status='rejected',rejection_reason='no_stock' WHERE order_id=$1",[pendingOrder])
  await refresh()
  await assertState(productId,1,'UNLIMITED',true,true)
  await db.query("UPDATE public.product_groups SET availability_status='AVAILABLE' WHERE id=$1",[productId])
  await refresh()
  await assertState(productId,1,'UNLIMITED',true,true)
  await db.query("UPDATE public.product_groups SET muabanvia_product_id='changed-provider-id' WHERE id=$1",[productId])
  await assertState(productId,1,'LOW_STOCK',false,true)
  await refresh()
  await db.query('UPDATE public.product_groups SET supplier_fallback_blocked=true WHERE id=$1',[productId])
  await refresh()
  await assertState(productId,1,'LOW_STOCK',false,true)
  for (const status of ['sending','unknown','succeeded']) {
    await db.query("UPDATE public.orders SET status='processing' WHERE id=$1",[pendingOrder])
    await db.query("UPDATE public.supplier_purchase_attempts SET status=$1,rejection_reason=NULL,credentials=CASE WHEN $1='succeeded' THEN '[{\"username\":\"test\",\"password\":\"test\"}]'::jsonb ELSE NULL END WHERE order_id=$2",[status,pendingOrder])
    const result=(await db.query('SELECT public.reset_supplier_product_fallback($1) AS result',[productId])).rows[0].result
    assert.equal(result.success,false); assert.equal(result.code,'SUPPLIER_RECONCILIATION_PENDING')
    assert.equal((await group()).supplier_fallback_blocked,true)
  }
  await db.query("UPDATE public.orders SET status='completed' WHERE id=$1",[pendingOrder])
  assert.equal((await db.query('SELECT public.reset_supplier_product_fallback($1) AS result',[productId])).rows[0].result.success,true)
  await assertState(productId,1,'LOW_STOCK',false,true)
  assert.equal((await group()).supplier_fallback_blocked,false)
  await refresh()
  await assertState(productId,1,'UNLIMITED',true,true)
  await db.query("UPDATE public.product_groups SET availability_status='PAUSED',supplier_fallback_blocked=true WHERE id=$1",[productId])
  assert.equal((await db.query('SELECT public.reset_supplier_product_fallback($1) AS result',[productId])).rows[0].result.success,true)
  await refresh()
  await assertState(productId,1,'PAUSED',false,false)
  assert.equal((await db.query('SELECT public.reset_supplier_product_fallback($1) AS result',[localId])).rows[0].result.code,'PRODUCT_NOT_FOUND')
  await db.query('UPDATE public.product_groups SET supplier_fallback_blocked=false,is_active=false WHERE id=$1',[productId])
  await refresh()
  await assertState(productId,1,'PAUSED',false,false)

  // Deliberately retain table-level browser UPDATE to test the trigger guard,
  // since a column REVOKE alone cannot override a table-level privilege.
  await db.exec('GRANT UPDATE ON public.product_groups TO authenticated; GRANT SELECT(id,stock_count,is_sellable,availability_status) ON public.product_groups TO authenticated; SET ROLE authenticated;')
  await assert.rejects(db.query('UPDATE public.product_groups SET supplier_fallback_ready=true WHERE id=$1',[other]), /supplier_readiness_requires_service_verification/)
  await assert.rejects(db.query('SELECT supplier_fallback_ready FROM public.product_groups'), /permission denied/)
  await assert.rejects(db.query('SELECT public.refresh_supplier_product_availability($1,true)',[other]), /permission denied/)
  await assert.rejects(db.query('SELECT public.reset_supplier_product_fallback($1)',[other]), /permission denied/)
  await db.query("UPDATE public.product_groups SET stock_count=999,is_sellable=true,availability_status='UNLIMITED' WHERE id=$1",[other])
  await db.exec('RESET ROLE')
  await assertState(other,0,'UNAVAILABLE',false,false)
  await db.query("UPDATE public.product_groups SET price='NaN'::numeric WHERE id=$1",[other])
  await assertState(other,0,'UNAVAILABLE',false,false)
} finally { await db.close() }
console.log('Inventory projection: statement batching, moves/deletes/reservations, local+fallback priority, unresolved paid outcomes, pause/inactive/config/circuit preservation and browser authority guards passed.')
