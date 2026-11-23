import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.smm_services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),external_id integer UNIQUE,name text,is_active boolean DEFAULT true,supplier_routing boolean DEFAULT false);
 CREATE TABLE public.supplier_product_routes(family text,product_key text,routes jsonb,PRIMARY KEY(family,product_key));
 INSERT INTO public.smm_services(external_id,name,is_active,supplier_routing) VALUES(123,'Enabled',true,true),(456,'Disabled',false,false);
 INSERT INTO public.supplier_product_routes VALUES('smm','123','[{"provider":"lordofpanels","serviceId":123}]');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261122000000_smm_live_enabled_catalog.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261122001000_compact_smm_allowlist.sql',import.meta.url),'utf8'));
 await db.exec("INSERT INTO public.smm_services(external_id,name) VALUES(777,'New replacement');INSERT INTO public.smm_services(external_id,name) VALUES(123,'Refreshed label') ON CONFLICT(external_id) DO UPDATE SET name=excluded.name;");
 const rows=(await db.query('SELECT external_id,is_active FROM public.smm_services ORDER BY external_id')).rows;
 assert.deepEqual(rows,[{external_id:123,is_active:true},{external_id:456,is_active:false},{external_id:777,is_active:false}]);
 const page=(await db.query('SELECT public.get_enabled_smm_catalog_page(NULL,1000) AS row')).rows;
 assert.equal(page.length,1);assert.equal(page[0].row.name,'Refreshed label');assert.equal(page[0].row.supplier_routes[0].serviceId,123);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.get_enabled_smm_catalog_page(uuid,integer)','EXECUTE') AS allowed`)).rows[0].allowed,false);
 await db.exec("INSERT INTO public.smm_services(external_id,name,is_active) SELECT n,'Bulk enabled',true FROM generate_series(1000,2004) n;");
 const first=(await db.query('SELECT public.get_enabled_smm_catalog_page(NULL,5000) AS row')).rows;assert.equal(first.length,1000);
 const second=(await db.query('SELECT public.get_enabled_smm_catalog_page($1,1000) AS row',[first.at(-1).row.id])).rows;assert.equal(second.length,6);
 assert.equal(new Set([...first,...second].map(item=>item.row.id)).size,1006);
 const compact=(await db.query('SELECT public.get_enabled_smm_catalog() AS rows')).rows[0].rows;
 assert.equal(compact.length,1006);assert.equal(Object.keys(compact[0]).length,5);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.get_enabled_smm_catalog()','EXECUTE') AS allowed`)).rows[0].allowed,false);
 console.log('SMM live catalogue SQL: defaults disabled, owner toggles preserved, private joined routes, keyset pagination and browser denial passed.');
}finally{await db.close()}
