import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean,is_staff boolean,account_suspended boolean);
 INSERT INTO public.profiles VALUES('${admin}',true,false,false),('${staff}',false,true,false);
 CREATE FUNCTION public.get_sms_provider_routing_state(p_product_key text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"controls":{},"metrics":[]}'::jsonb $$;
 REVOKE ALL ON FUNCTION public.get_sms_provider_routing_state(text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.get_sms_provider_routing_state(text) TO service_role;`);
 await db.exec(readFileSync('supabase/migrations/20261123001000_sms_international_selection.sql','utf8'));
 const state=async()=>(await db.query('SELECT public.get_sms_provider_routing_state() AS v')).rows[0].v;
 assert.equal((await state()).international_provider,'herosms');
 await assert.rejects(db.query('SELECT public.set_sms_international_provider($1,$2)',['smsbus',staff]),/admin_access_required/);
 await db.query('SELECT public.set_sms_international_provider($1,$2)',['smsbus',admin]);assert.equal((await state()).international_provider,'smsbus');
 assert.equal((await db.query('SELECT count(*)::int n FROM public.sms_international_selection_audit')).rows[0].n,1);
 await assert.rejects(db.query('SELECT public.set_sms_international_provider($1,$2)',['getatext',admin]),/invalid_international_provider/);
 for(const role of ['anon','authenticated'])for(const signature of ['get_sms_provider_routing_state(text)','get_sms_provider_delivery_state(text)','set_sms_international_provider(text,uuid)'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,'public.'+signature,'EXECUTE'])).rows[0].allowed,false);
 await db.exec(readFileSync('supabase/migrations/20261123002000_sms_cheapest_funded_routing.sql','utf8'));assert.equal((await state()).international_provider,'auto');assert.equal((await state()).routing_strategy,'cheapest_funded');assert.deepEqual((await state()).markup_by_country,{US:700,CA:600,default:500});
 console.log('International selection SQL: admin-only choice/audit, intact telemetry, safe default, invalid-provider denial and browser denial passed.');
}finally{await db.close()}
