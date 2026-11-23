import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.sms_product_settings(service_code text PRIMARY KEY,service_name text,is_enabled boolean,is_favorite boolean,price_override_ngn numeric,auto_markup_enabled boolean,margin_ngn numeric);
 INSERT INTO public.sms_product_settings SELECT 'service-'||g||repeat('x',80),'Service '||g,g<>1001,g=1,CASE WHEN g=2 THEN 1200 ELSE NULL END,true,900 FROM generate_series(1,1500) g;`);
 await db.exec(readFileSync('supabase/migrations/20261123000000_sms_catalog_settings_rpc.sql','utf8'));
 const codes=(await db.query('SELECT service_code FROM public.sms_product_settings')).rows.map(row=>row.service_code);
 const result=(await db.query('SELECT public.get_sms_catalog_settings($1) AS value',[codes])).rows[0].value;
 assert.equal(result.length,1500);assert.equal(result.filter(row=>row.is_enabled===false).length,1);assert.equal(result.find(row=>row.service_code===codes[1]).price_override_ngn,1200);
 assert.equal((await db.query("SELECT public.get_sms_catalog_settings('{}') AS value")).rows[0].value.length,0);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.get_sms_catalog_settings(text[])','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
 await assert.rejects(db.query('SELECT public.get_sms_catalog_settings($1)',[Array(5001).fill('code')]),/sms_catalog_too_large/);
 console.log('SMS settings RPC: 1,500 long codes, owner visibility/price controls, bounded input, and browser denial passed without URL selectors or row truncation.');
}finally{await db.close()}
