import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

const db=new PGlite(),user='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64)
const migration=readFileSync(new URL('../supabase/migrations/20261006012000_telegram_customer_api_request_binding.sql',import.meta.url),'utf8')
const readMigration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE ROLE unrelated_writer BYPASSRLS;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,unrelated_writer;
 CREATE TABLE telegram_orders(id uuid PRIMARY KEY,user_id uuid NOT NULL,reference text,order_type text,username text,
 recipient_hash text,recipient_name text,quantity integer,months integer,price_ngn numeric,wallet_type text,status text,istar_order_id text);
 CREATE TABLE telegram_products(id uuid PRIMARY KEY);
 ALTER TABLE telegram_orders ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON telegram_orders TO PUBLIC,anon,authenticated;`)
 await db.exec(readMigration('20260919022000_add_telegram_order_idempotency.sql'))
 await db.exec(readMigration('20260925009000_restrict_telegram_order_browser_reads.sql'))
 await db.query(`INSERT INTO telegram_orders(id,user_id,reference,order_type,username,recipient_hash,quantity,price_ngn,status,idempotency_key)
 VALUES ('20000000-0000-4000-8000-000000000001',$1,'legacy','stars','old','recipient',50,1000,'completed','legacy-key')`,[user])
 // Each reviewed baseline must fail closed when drifted, including exact unique keys.
 await db.exec('ALTER TABLE telegram_orders DISABLE ROW LEVEL SECURITY')
 await assert.rejects(db.exec(migration),/telegram_order_rls_baseline_changed/)
 await db.exec('ALTER TABLE telegram_orders ENABLE ROW LEVEL SECURITY;GRANT SELECT(username) ON telegram_orders TO authenticated')
 await assert.rejects(db.exec(migration),/telegram_order_browser_privacy_baseline_changed/)
 await db.exec('REVOKE SELECT(username) ON telegram_orders FROM authenticated;DROP INDEX idx_telegram_orders_user_idempotency_key_unique;CREATE UNIQUE INDEX idx_telegram_orders_user_idempotency_key_unique ON telegram_orders(reference,idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key<>\'\'')
 await assert.rejects(db.exec(migration),/telegram_order_unique_request_baseline_changed/)
 await db.exec('DROP INDEX idx_telegram_orders_user_idempotency_key_unique')
 await db.exec(readMigration('20260919022000_add_telegram_order_idempotency.sql'))
 await db.exec(migration)
 assert.equal((await db.query("SELECT customer_api_request_hash FROM telegram_orders WHERE reference='legacy'")).rows[0].customer_api_request_hash,null)
 assert.equal((await db.query("SELECT tgenabled FROM pg_trigger WHERE tgname='telegram_api_request_binding_immutable'")).rows[0].tgenabled,'A')
 await db.exec('SET ROLE service_role')
 const insert=`INSERT INTO telegram_orders(id,user_id,reference,order_type,username,recipient_hash,quantity,price_ngn,status,idempotency_key,customer_api_request_hash)
 VALUES ($1,$2,'api-reference','stars','recipient_one','provider-hash',100,1100,'pending','api-key-12345',$3)`
 const id='20000000-0000-4000-8000-000000000002'
 await db.query(insert,[id,user,hash])
 await assert.rejects(db.query(insert,['20000000-0000-4000-8000-000000000003',user,hash]),e=>e.code==='23505')
 for(const sql of ["customer_api_request_hash='"+'b'.repeat(64)+"'",'customer_api_request_hash=NULL',"user_id='10000000-0000-4000-8000-000000000002'",
 "idempotency_key='changed-key'","order_type='premium'","username='changed'","recipient_hash='changed'",'quantity=101','months=3','price_ngn=1200',"reference='changed'"]){
  await assert.rejects(db.query(`UPDATE telegram_orders SET ${sql} WHERE id=$1`,[id]),/telegram_api_request_binding_immutable/)
 }
 await assert.rejects(db.query("UPDATE telegram_orders SET customer_api_request_hash=$1 WHERE reference='legacy'",[hash]),/telegram_api_request_binding_immutable/)
 await db.query("UPDATE telegram_orders SET status='processing',istar_order_id='provider-id' WHERE id=$1",[id])
 await db.exec('RESET ROLE')
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`)
  await assert.rejects(db.query('SELECT customer_api_request_hash FROM telegram_orders'),e=>e.code==='42501')
  await assert.rejects(db.query(insert,['20000000-0000-4000-8000-000000000004',user,hash]),e=>e.code==='42501')
  await assert.rejects(db.query('UPDATE telegram_orders SET customer_api_request_hash=$1',[hash]),e=>e.code==='42501')
  await db.exec('RESET ROLE')
 }
 // Even a future unrelated database writer cannot create service provenance.
 await db.exec('GRANT SELECT,INSERT,UPDATE ON telegram_orders TO unrelated_writer;SET ROLE unrelated_writer')
 await assert.rejects(db.query(insert,['20000000-0000-4000-8000-000000000005',user,hash]),/telegram_api_request_binding_service_only/)
 await db.exec('RESET ROLE')
 console.log('Telegram API binding SQL: exact privacy/RLS/index drift denied; nullable legacy preserved; service-only immutable API hash and request fields, race uniqueness, browser denial passed (offline).')
}finally{await db.close()}
