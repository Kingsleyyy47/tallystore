import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const original = readFileSync('supabase/migrations/20261005019000_restore_reviewed_legacy_order_credentials.sql','utf8')
const migration = readFileSync('supabase/migrations/20261006042000_customer_api_product_order_details.sql','utf8')
const oldProofAndView = original.slice(original.indexOf('CREATE FUNCTION public.is_reviewed_legacy_order_credential_access('))
assert.ok(oldProofAndView.startsWith('CREATE FUNCTION'))
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002'
const admin='10000000-0000-4000-8000-000000000003',staff='10000000-0000-4000-8000-000000000004'
const suspended='10000000-0000-4000-8000-000000000005',product='20000000-0000-4000-8000-000000000001'
const order=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const debit='40000000-0000-4000-8000-000000000001'
const credential={product_name:'Fixture product',category:'Products',quantity:1,accounts:[{username:'fixture-user',password:'fixture-secret'}]}
const detail=async (who,id)=>(await db.query('SELECT public.get_customer_api_product_order_detail($1,$2) result',[who,id])).rows[0].result
const view=async id=>(await db.query('SELECT account_details FROM public.orders_safe_history WHERE id=$1',[id])).rows[0]?.account_details
try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,account_suspended boolean DEFAULT false);
    CREATE TABLE public.categories(id uuid PRIMARY KEY,name text);
    CREATE TABLE public.product_groups(id uuid PRIMARY KEY,name text,price numeric,category_id uuid);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,user_id uuid,product_group_id uuid,amount numeric,status text,created_at timestamptz,account_details jsonb,financial_authorization_status text,wallet_reservation_id uuid,fulfillment_outbox_id uuid,financial_security_version integer);
    CREATE TABLE public.transactions(id uuid PRIMARY KEY,user_id uuid,amount numeric,type text,status text,description text,created_at timestamptz);
    CREATE TABLE public.reviewed_legacy_order_credentials(order_id uuid PRIMARY KEY,user_id uuid,product_group_id uuid,order_amount numeric,order_created_at timestamptz,payload_sha256 text,debit_transaction_id uuid UNIQUE,debit_created_at timestamptz,debit_description_sha256 text,sold_account_ids uuid[]);
    ALTER TABLE public.reviewed_legacy_order_credentials ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.reviewed_legacy_order_credentials FROM PUBLIC,anon,authenticated,service_role;
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce((SELECT is_admin FROM profiles WHERE id=auth.uid()),false) $$;`)
  await db.query('INSERT INTO public.profiles(id,is_admin,is_staff,account_suspended) VALUES($1,false,false,false),($2,false,false,false),($3,true,false,false),($4,false,true,false),($5,false,false,true)',[user,other,admin,staff,suspended])
  await db.query('INSERT INTO public.product_groups(id,name,price) VALUES($1,$2,2000)',[product,'Fixture product'])
  const addOrder=async (n,who,date,status='completed',financial=null)=>db.query(`INSERT INTO public.orders(id,user_id,product_group_id,amount,status,created_at,account_details,financial_authorization_status)
    VALUES($1,$2,$3,2000,$4,$5,$6::jsonb,$7)`,[order(n),who,product,status,date,JSON.stringify(credential),financial])
  await addOrder(1,user,'2026-09-20T10:00:00Z') // immutable archive proof
  await addOrder(2,user,'2026-09-18T10:00:00Z') // existing historical cutoff
  await addOrder(3,user,'2026-10-01T10:00:00Z','completed','captured')
  await addOrder(4,user,'2026-09-25T10:00:00Z') // unreviewed later order
  await addOrder(5,user,'2026-10-01T11:00:00Z','processing','captured')
  await addOrder(6,other,'2026-10-01T10:00:00Z','completed','captured')
  await addOrder(7,admin,'2026-10-01T10:00:00Z','completed','captured')
  await addOrder(8,staff,'2026-10-01T10:00:00Z','completed','captured')
  await addOrder(9,suspended,'2026-10-01T10:00:00Z','completed','captured')
  await db.query(`INSERT INTO public.transactions VALUES($1,$2,-2000,'purchase','completed','Purchase: 1x Fixture product','2026-09-20T10:00:02Z')`,[debit,user])
  await db.query(`INSERT INTO public.reviewed_legacy_order_credentials
    SELECT o.id,o.user_id,o.product_group_id,o.amount,o.created_at,
      encode(sha256(convert_to(o.account_details::text,'UTF8')),'hex'),
      t.id,t.created_at,encode(sha256(convert_to(t.description,'UTF8')),'hex'),ARRAY['50000000-0000-4000-8000-000000000001'::uuid]
    FROM public.orders o CROSS JOIN public.transactions t WHERE o.id=$1 AND t.id=$2`,[order(1),debit])
  await db.exec(oldProofAndView)
  const oldView=(await db.query("SELECT pg_get_viewdef('public.orders_safe_history'::regclass) definition")).rows[0].definition
  const oldViewAcl=(await db.query("SELECT relacl::text acl,reloptions::text options FROM pg_class WHERE oid='public.orders_safe_history'::regclass")).rows[0]
  const oldHelperAcl=(await db.query("SELECT proacl::text acl,prosecdef,provolatile,proconfig::text config FROM pg_proc WHERE oid='public.is_reviewed_legacy_order_credential_access(uuid)'::regprocedure")).rows[0]
  const oldHelperDefinition=(await db.query("SELECT pg_get_functiondef('public.is_reviewed_legacy_order_credential_access(uuid)'::regprocedure) definition")).rows[0].definition
  const oldHelperSha=createHash('sha256').update(oldHelperDefinition).digest('hex')
  assert.ok(migration.includes(oldHelperSha),'Migration must pin the exact reviewed legacy proof definition')
  await db.exec('BEGIN; ALTER FUNCTION public.is_reviewed_legacy_order_credential_access(uuid) SET search_path=public')
  await assert.rejects(db.exec(migration),/customer_api_product_history_baseline_changed/)
  await db.exec('ROLLBACK')
  await db.exec(migration)
  assert.equal((await db.query("SELECT pg_get_viewdef('public.orders_safe_history'::regclass) definition")).rows[0].definition,oldView,'authenticated view must be byte-for-byte unchanged')
  assert.deepEqual((await db.query("SELECT relacl::text acl,reloptions::text options FROM pg_class WHERE oid='public.orders_safe_history'::regclass")).rows[0],oldViewAcl,'view ACL/security options remain unchanged')
  assert.deepEqual((await db.query("SELECT proacl::text acl,prosecdef,provolatile,proconfig::text config FROM pg_proc WHERE oid='public.is_reviewed_legacy_order_credential_access(uuid)'::regprocedure")).rows[0],oldHelperAcl,'authenticated helper ACL/security attributes remain unchanged')
  for(const n of [1,2,3]){
    const result=await detail(user,order(n))
    assert.equal(result.success,true)
    assert.equal(result.order.account_details.accounts[0].password,'fixture-secret',`order ${n}`)
    assert.deepEqual(Object.keys(result.order).sort(),['id','status','amount','created_at','product_group_id','account_details'].sort())
    assert.equal(Object.hasOwn(result.order,'user_id'),false)
  }
  for(const n of [4,5]){
    const result=await detail(user,order(n))
    assert.equal(result.success,true)
    assert.equal(result.order.account_details.accounts,undefined,`order ${n} must be redacted`)
    assert.equal(result.order.account_details.product_name,'Fixture product')
  }
  for(const [who,n] of [[user,6],[other,1],[user,7],[admin,7],[staff,8],[suspended,9]]){
    assert.deepEqual(await detail(who,order(n)),{success:false,code:'not_found'})
  }
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user])
  await db.exec('SET ROLE authenticated')
  assert.equal((await view(order(1))).accounts[0].password,'fixture-secret')
  assert.equal((await view(order(4))).accounts,undefined)
  await assert.rejects(db.query('SELECT public.get_customer_api_product_order_detail($1,$2)',[user,order(1)]),/permission denied/)
  await assert.rejects(db.query('SELECT private.reviewed_legacy_order_credential_proof_for_user($1,$2)',[user,order(1)]),/permission denied/)
  await db.exec('RESET ROLE; SET ROLE service_role')
  assert.equal((await detail(user,order(1))).order.account_details.accounts.length,1)
  await assert.rejects(db.query('SELECT * FROM public.reviewed_legacy_order_credentials'),/permission denied/)
  await assert.rejects(db.query('SELECT private.reviewed_legacy_order_credential_proof_for_user($1,$2)',[user,order(1)]),/permission denied/)
  await db.exec('RESET ROLE')
  await db.query('UPDATE public.orders SET account_details=account_details||\'{"changed":true}\'::jsonb WHERE id=$1',[order(1)])
  assert.equal((await detail(user,order(1))).order.account_details.accounts,undefined,'payload hash drift revokes archived credentials')
  await db.query('UPDATE public.orders SET account_details=account_details-\'changed\' WHERE id=$1',[order(1)])
  await db.query("UPDATE public.transactions SET status='refunded' WHERE id=$1",[debit])
  assert.equal((await detail(user,order(1))).order.account_details.accounts,undefined,'debit proof drift revokes archived credentials')
  await db.query("UPDATE public.transactions SET status='completed' WHERE id=$1",[debit])
  assert.equal((await detail(user,order(1))).order.account_details.accounts.length,1)
  for(const [column,value] of [
    ['financial_authorization_status','funds_held'],
    ['wallet_reservation_id','50000000-0000-4000-8000-000000000002'],
    ['fulfillment_outbox_id','50000000-0000-4000-8000-000000000003'],
    ['financial_security_version',2],
  ]){
    await db.query(`UPDATE public.orders SET ${column}=$1 WHERE id=$2`,[value,order(1)])
    assert.equal((await detail(user,order(1))).order.account_details.accounts,undefined,`${column} must revoke reviewed legacy access`)
    await db.query(`UPDATE public.orders SET ${column}=NULL WHERE id=$1`,[order(1)])
  }
  assert.equal((await detail(user,order(1))).order.account_details.accounts.length,1)
  await db.exec('SET ROLE anon')
  await assert.rejects(db.query('SELECT public.get_customer_api_product_order_detail($1,$2)',[user,order(1)]),/permission denied/)
  await db.exec('RESET ROLE')
  console.log('Customer API product history PGlite: pinned original proof, modern captured, historical cutoff, reviewed archive proof, financial/payload/debit tamper redaction, ownership, customer-only, browser/anon/private ACL, unchanged view passed.')
}finally{await db.close()}
