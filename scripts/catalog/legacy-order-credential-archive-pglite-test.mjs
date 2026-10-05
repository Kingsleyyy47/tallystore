import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
process.on('uncaughtException',error=>{console.error(`Fixture verification failed: ${error.message}`);process.exit(1)})

const migration=readFileSync('supabase/migrations/20261005019000_restore_reviewed_legacy_order_credentials.sql','utf8')
const candidateSelect=migration.match(/CREATE TEMP TABLE reviewed_legacy_credential_candidates ON COMMIT DROP AS\n([\s\S]*?);\n\nDO \$reviewed_snapshot\$/)?.[1]
assert.ok(candidateSelect)
async function fixtureMigration(db) {
  await db.exec("SET TIME ZONE 'UTC'")
  const result=(await db.query(`WITH candidates AS (${candidateSelect}) SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(c) ORDER BY c.order_id)::text,'UTF8')),'hex') AS manifest FROM candidates c`)).rows[0]
  return migration.replace(/v_manifest <> '[^']+'/g,`v_manifest <> '${result.manifest}'`)
}
const owner='10000000-0000-4000-8000-000000000001'
const other='10000000-0000-4000-8000-000000000002'
const admin='10000000-0000-4000-8000-000000000003'
const product='20000000-0000-4000-8000-000000000001'
const id=(prefix,index)=>`${prefix}-0000-4000-8000-${String(index).padStart(12,'0')}`
async function setup(db) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false);
    CREATE TABLE public.categories(id uuid PRIMARY KEY,name text);
    CREATE TABLE public.product_groups(id uuid PRIMARY KEY,name text,price numeric,category_id uuid);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,user_id uuid,product_group_id uuid,amount numeric,status text,created_at timestamptz,account_details jsonb,financial_authorization_status text,wallet_reservation_id uuid,fulfillment_outbox_id uuid,financial_security_version integer);
    CREATE TABLE public.transactions(id uuid PRIMARY KEY,user_id uuid,amount numeric,type text,status text,description text,created_at timestamptz);
    CREATE TABLE public.individual_accounts(id uuid PRIMARY KEY,product_group_id uuid,status text,username text,password text,sold_at timestamptz);
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce((SELECT is_admin FROM profiles WHERE id=auth.uid()),false) $$;
    INSERT INTO public.profiles VALUES('${owner}',false),('${other}',false),('${admin}',true);
    INSERT INTO public.product_groups VALUES('${product}','Fixture product',2000,NULL);`)
  for(let index=1;index<=31;index++) {
    const details={accounts:[{username:`fixture-${index}`,password:`fixture-pass-${index}`}],quantity:1,product_name:'Fixture product',charged_amount_ngn:2000}
    const time=new Date(Date.UTC(2026,8,19,10,0)+index*120000).toISOString()
    await db.query("INSERT INTO public.orders(id,user_id,product_group_id,amount,status,created_at,account_details) VALUES($1,$2,$3,2000,'completed',$4,$5)",[id('30000000',index),owner,product,time,JSON.stringify(details)])
    await db.query("INSERT INTO public.transactions VALUES($1,$2,-2000,'purchase','completed','Purchase: 1x Fixture product',$3::timestamptz-interval '2 seconds')",[id('40000000',index),owner,time])
    await db.query("INSERT INTO public.individual_accounts VALUES($1,$2,'sold',$3,$4,$5::timestamptz-interval '1 second')",[id('50000000',index),product,details.accounts[0].username,details.accounts[0].password,time])
  }
}
const db=new PGlite()
try {
  await setup(db)
  const fixture=await fixtureMigration(db)
  await db.exec("SET TIME ZONE 'Asia/Tokyo'")
  await db.exec(`BEGIN; ${fixture} COMMIT;`)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.reviewed_legacy_order_credentials')).rows[0].n,31)
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='reviewed_legacy_order_credentials'")).rows.map(row=>row.column_name)
  assert.equal(columns.some(column=>['username','password','account_details'].includes(column)),false)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner])
  await db.exec('SET ROLE authenticated')
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.orders_safe_history WHERE jsonb_array_length(account_details->'accounts')=1")).rows[0].n,31)
  await assert.rejects(db.query('SELECT * FROM public.reviewed_legacy_order_credentials'),/permission denied/)
  await assert.rejects(db.query('DELETE FROM public.reviewed_legacy_order_credentials'),/permission denied/)
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other])
  await db.exec('SET ROLE authenticated')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.orders_safe_history')).rows[0].n,0)
  assert.equal((await db.query('SELECT public.is_reviewed_legacy_order_credential_access($1) AS ok',[id('30000000',1)])).rows[0].ok,false)
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[admin])
  await db.exec('SET ROLE authenticated')
  const adminRows=(await db.query('SELECT account_details FROM public.orders_safe_history')).rows
  assert.equal(adminRows.length,31); assert.ok(adminRows.every(row=>!row.account_details.accounts))
  await db.exec('RESET ROLE; SET ROLE service_role')
  await assert.rejects(db.query('SELECT * FROM public.reviewed_legacy_order_credentials'),/permission denied/)
  await assert.rejects(db.query('DELETE FROM public.reviewed_legacy_order_credentials'),/permission denied/)
  await db.exec('RESET ROLE')
  await assert.rejects(db.query('UPDATE public.reviewed_legacy_order_credentials SET reviewed_at=now()'),/archive_is_immutable/)
  await assert.rejects(db.query('DELETE FROM public.reviewed_legacy_order_credentials'),/archive_is_immutable/)
  await assert.rejects(db.query('INSERT INTO public.reviewed_legacy_order_credentials SELECT * FROM public.reviewed_legacy_order_credentials LIMIT 1'),/archive_is_immutable/)
  await assert.rejects(db.query('TRUNCATE public.reviewed_legacy_order_credentials'),/archive_is_immutable/)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner])
  async function approved(index=1) { return (await db.query('SELECT public.is_reviewed_legacy_order_credential_access($1) AS ok',[id('30000000',index)])).rows[0].ok }
  assert.equal(await approved(),true)
  await db.query("UPDATE public.orders SET account_details=account_details||'{\"changed\":true}'::jsonb WHERE id=$1",[id('30000000',1)])
  assert.equal(await approved(),false)
  await db.query("UPDATE public.orders SET account_details=account_details-'changed' WHERE id=$1",[id('30000000',1)])
  assert.equal(await approved(),true)
  for(const [field,value] of [['status','processing'],['financial_authorization_status','funds_held'],['amount',3000],['user_id',other],['product_group_id',id('20000000',2)],['created_at','2026-09-20T11:00:00Z']]) {
    const original=(await db.query(`SELECT ${field} AS value FROM public.orders WHERE id=$1`,[id('30000000',1)])).rows[0].value
    await db.query(`UPDATE public.orders SET ${field}=$1 WHERE id=$2`,[value,id('30000000',1)])
    assert.equal(await approved(),false,`${field} mutation must revoke archived access`)
    await db.query(`UPDATE public.orders SET ${field}=$1 WHERE id=$2`,[original,id('30000000',1)])
  }
  await db.query("UPDATE public.transactions SET status='refunded' WHERE id=$1",[id('40000000',1)])
  assert.equal(await approved(),false)
  await db.query("UPDATE public.transactions SET status='completed' WHERE id=$1",[id('40000000',1)])
  await db.query("INSERT INTO public.orders(id,user_id,product_group_id,amount,status,created_at,account_details) SELECT $1,user_id,product_group_id,amount,status,'2026-09-19T14:00:00Z',account_details FROM public.orders WHERE id=$2",[id('30000000',32),id('30000000',1)])
  assert.equal(await approved(32),false,'Even a new backdated NULL-financial completed row is not archived')
  await db.exec('SET ROLE authenticated')
  const newOrder=(await db.query('SELECT account_details FROM public.orders_safe_history WHERE id=$1',[id('30000000',32)])).rows[0]
  assert.equal(newOrder.account_details.accounts,undefined)
  await db.exec('RESET ROLE')
  await db.query("UPDATE public.orders SET financial_authorization_status='captured' WHERE id=$1",[id('30000000',32)])
  await db.exec('SET ROLE authenticated')
  assert.equal((await db.query('SELECT account_details FROM public.orders_safe_history WHERE id=$1',[id('30000000',32)])).rows[0].account_details.accounts.length,1,'Captured modern order remains readable')
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(db.query('SELECT * FROM public.orders_safe_history'),/permission denied/)
} finally {await db.close()}

const invalid=new PGlite()
try {
  await setup(invalid)
  const originalFixture=await fixtureMigration(invalid)
  await invalid.query("UPDATE public.orders SET account_details=account_details||'{\"review_changed\":true}'::jsonb WHERE id=$1",[id('30000000',1)])
  await assert.rejects(invalid.exec(`BEGIN; ${originalFixture} COMMIT;`),/manifest_does_not_match/)
  await invalid.exec('ROLLBACK')
  await invalid.query("UPDATE public.orders SET account_details=account_details-'review_changed' WHERE id=$1",[id('30000000',1)])
  await invalid.query("INSERT INTO public.transactions SELECT $1,user_id,amount,type,status,description,created_at FROM public.transactions WHERE id=$2",[id('40000000',99),id('40000000',1)])
  await assert.rejects(invalid.exec(`BEGIN; ${originalFixture} COMMIT;`),/snapshot_requires_31_verified_orders/)
  await invalid.exec('ROLLBACK')
  assert.equal((await invalid.query("SELECT to_regclass('public.reviewed_legacy_order_credentials') IS NULL AS absent")).rows[0].absent,true,'Ambiguous proof aborts archive creation atomically')
} finally {await invalid.close()}
console.log('Legacy credential archive: reviewed proof, immutable private snapshot, ownership/admin redaction, payload/debit changes, new unpaid denial and captured access passed.')
