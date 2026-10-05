import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA private; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,aud text,role text,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,wallet_balance numeric DEFAULT 0,is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,account_suspended boolean DEFAULT false,financial_security_version integer DEFAULT 1);
 CREATE FUNCTION public.bound_fixture_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.profiles(id) VALUES(NEW.id); RETURN NEW; END $$;
 CREATE TRIGGER bound_fixture_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.bound_fixture_profile();
 CREATE TABLE public.transactions(id uuid PRIMARY KEY,user_id uuid,type text,status text,amount numeric,balance_type text,currency text,idempotency_key text,metadata jsonb);
 CREATE TABLE public.wallet_reservations(id uuid PRIMARY KEY,user_id uuid,amount numeric,currency text,status text,order_table text,order_id uuid,idempotency_key text,financial_security_version integer,metadata jsonb,expires_at timestamptz);`)
 await db.exec(read('../supabase/migrations/20261005028000_customer_bitrefill_airtime_wallet.sql'))
 const before=(await db.query("SELECT pg_get_functiondef('public.record_customer_airtime_outcome(uuid,uuid,text,jsonb)'::regprocedure) d")).rows[0].d
 await db.exec(read('../supabase/migrations/20261005028100_customer_airtime_bound_review_state.sql'))
 const after=(await db.query("SELECT pg_get_functiondef('public.record_customer_airtime_outcome(uuid,uuid,text,jsonb)'::regprocedure) d")).rows[0].d
 assert.equal(after,before.replace("j.state NOT IN ('creating','paying','unknown')","j.state NOT IN ('creating','bound','paying','unknown')"),'only the intended state predicate changes')
 await db.exec('BEGIN;')
 const results=await db.exec(read('./catalog/customer-airtime-bound-review-live-probe.sql'))
 const checks=results.find(r=>r.rows[0]?.passed===true)?.rows[0]
 assert.ok(checks); assert.ok(Object.values(checks).every(v=>v===true))
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.customer_airtime_orders')).rows[0].n),0)
 await db.exec('ROLLBACK;')
 console.log('Airtime281 PGlite: exact predicate-only patch; bound unknown displays review, preserves hold, denies payment/refund, unchanged wallet; rollback probe passed.')
} finally { await db.close() }
