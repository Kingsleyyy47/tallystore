import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.product_groups(id uuid PRIMARY KEY);`)
 await db.exec(read('../supabase/migrations/20261005001000_supplier_balance_alerts.sql'))
 await db.exec(`SELECT public.record_supplier_balance_alert('muabanvia',NULL,'auto-restock');`)
 const snapshot=(await db.query('SELECT to_jsonb(a) row FROM public.supplier_balance_alerts a ORDER BY provider')).rows
 const rpcBefore=(await db.query(`SELECT oid::regprocedure::text identity,pg_get_functiondef(oid) body,proacl::text grants
 FROM pg_proc WHERE proname IN('record_supplier_balance_alert','resolve_supplier_balance_alert') ORDER BY proname`)).rows
 await db.exec(read('../supabase/migrations/20261005029100_bitrefill_airtime_supplier_balance_alerts.sql'))
 assert.deepEqual((await db.query('SELECT to_jsonb(a) row FROM public.supplier_balance_alerts a ORDER BY provider')).rows,snapshot)
 assert.deepEqual((await db.query(`SELECT oid::regprocedure::text identity,pg_get_functiondef(oid) body,proacl::text grants
 FROM pg_proc WHERE proname IN('record_supplier_balance_alert','resolve_supplier_balance_alert') ORDER BY proname`)).rows,rpcBefore)
 await db.exec('BEGIN;')
 const results=await db.exec(read('./catalog/bitrefill-airtime-supplier-alert-live-probe.sql'))
 const checks=results.find(r=>r.rows[0]?.passed===true)?.rows[0]
 assert.ok(checks);assert.ok(Object.values(checks).every(v=>v===true))
 assert.deepEqual((await db.query('SELECT to_jsonb(a) row FROM public.supplier_balance_alerts a ORDER BY provider')).rows,snapshot)
 await db.exec('ROLLBACK;')
 // A live probe must preserve a pre-existing operational warning too.
 await db.exec(`SELECT public.record_supplier_balance_alert('bitrefill',NULL,'customer-airtime');
 SELECT public.resolve_supplier_balance_alert('bitrefill',now()+interval '1 second');`)
 const existing=(await db.query('SELECT to_jsonb(a) row FROM public.supplier_balance_alerts a ORDER BY provider')).rows
 await db.exec('BEGIN;')
 await db.exec(read('./catalog/bitrefill-airtime-supplier-alert-live-probe.sql'))
 assert.deepEqual((await db.query('SELECT to_jsonb(a) row FROM public.supplier_balance_alerts a ORDER BY provider')).rows,existing)
 await db.exec('ROLLBACK;')
 assert.equal((await db.query(`SELECT count(*)=8 minimal_schema FROM information_schema.columns
 WHERE table_schema='public' AND table_name='supplier_balance_alerts'`)).rows[0].minimal_schema,true)
 console.log('Bitrefill291 PGlite: constraints only; original alerts/RPCs/grants unchanged; redacted service warning/replay/resolution and browser denial passed; rollback probe left no alerts.')
} finally {await db.close()}
