import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const read = path => readFileSync(new URL(path,import.meta.url),'utf8')
const migration = read('../supabase/migrations/20261005029000_customer_bitrefill_owner_pricing.sql')
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const other = '9a290000-0000-4000-8000-000000000001'
const call = async (name,args) => (await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result
const get = (kind='airtime',product='test-product',pkg=null,value=10,currency='GBP') => call('get_customer_bitrefill_pricing',[kind,product,pkg,value,currency])
const set = (kind,scope,mode,value,{product=null,pkg=null,unit=null,currency=null,remove=false,actor=owner}={}) =>
  call('set_customer_bitrefill_pricing',[actor,kind,scope,product,pkg,unit,currency,mode,value,remove])
const auditCount = async () => Number((await db.query('SELECT count(*) n FROM private.customer_bitrefill_pricing_audit')).rows[0].n)
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA private;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false,account_suspended boolean DEFAULT false);
 CREATE TABLE public.app_settings(key text PRIMARY KEY,value text);
 INSERT INTO public.profiles VALUES('${owner}',true,false),('${other}',true,false);
 INSERT INTO public.app_settings VALUES('bitrefill_markup_pct','7.5'),('sms_default_margin_ngn','725.5');`)
 await db.exec(migration)
 assert.deepEqual(await get(),{success:true,mode:'percent',value:7.5,source:'global'})
 assert.deepEqual(await get('gift_card'),{success:true,mode:'percent',value:7.5,source:'global'})
 assert.deepEqual(await get('sms'),{success:true,mode:'amount',value:726,source:'global',legacy_pricing:true})
 const smsBatch = async selectors=>call('get_customer_bitrefill_pricing_batch',['sms',JSON.stringify(selectors)])
 const smsOne={product_id:'telegram',package_id:null,unit_value:0.5,currency:'USD'}
 assert.equal((await smsBatch([smsOne])).prices[0].legacy_pricing,true)
 for(const invalid of [[smsOne,smsOne],[{...smsOne,secret:'denied'}],[{...smsOne,unit_value:0}],[{...smsOne,unit_value:'0.5'}],Array.from({length:501},(_,i)=>({...smsOne,product_id:`product-${i}`}))]) {
  const result=await smsBatch(invalid); assert.equal(result.success,false); assert.equal(result.prices,undefined)
 }
 const smsSelector={product:'daisy:187:telegram',unit:1,currency:'NGN'}
 assert.equal((await set('sms','product','percent',10,{product:smsSelector.product})).changed,true)
 assert.deepEqual(await get('sms',smsSelector.product,null,1,'NGN'),{success:true,mode:'percent',value:10,source:'product',legacy_pricing:false})
 assert.equal((await get('sms','daisy:187:whatsapp',null,1,'NGN')).legacy_pricing,true)
 assert.equal((await set('sms','product',null,null,{product:smsSelector.product,remove:true})).changed,true)
 assert.equal((await get('sms',smsSelector.product,null,1,'NGN')).legacy_pricing,true)
 const smsAuditBefore=await auditCount()
 assert.equal((await set('sms','global','amount',726)).changed,true,'same seeded value still explicitly activates SMS')
 assert.equal((await set('sms','global','amount',726)).changed,false)
 assert.equal(await auditCount(),smsAuditBefore+1)
 assert.equal((await get('sms')).legacy_pricing,false)
 const activeBatch=await smsBatch([smsOne,{...smsOne,product_id:'whatsapp'}])
 assert.equal(activeBatch.prices.length,2); assert.ok(activeBatch.prices.every(row=>row.legacy_pricing===false))
 assert.deepEqual(Object.keys(activeBatch.prices[0]).sort(),['legacy_pricing','mode','product_id','source','value'])
 const smsActivation=(await db.query("SELECT old_config,new_config FROM private.customer_bitrefill_pricing_audit WHERE kind='sms' AND selector->>'scope'='global'")).rows[0]
 assert.equal(smsActivation.old_config.owner_configured,false); assert.equal(smsActivation.new_config.owner_configured,true)
 assert.equal((await set('airtime','global','amount',20,{actor:other})).code,'OWNER_DENIED')
 await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1',[owner])
 assert.equal((await set('airtime','global','amount',20)).code,'OWNER_DENIED')
 await db.query('UPDATE public.profiles SET account_suspended=false,is_admin=false WHERE id=$1',[owner])
 assert.equal((await set('airtime','global','amount',20)).code,'OWNER_DENIED')
 await db.query('UPDATE public.profiles SET is_admin=true WHERE id=$1',[owner])
 for (const [mode,value] of [['amount',-1],['amount',1.001],['amount',1000000001],['percent',1000.01],['unknown',10]]) {
  assert.equal((await set('airtime','global',mode,value)).code,'INVALID_PRICING')
 }
 assert.equal((await set('unknown','global','amount',10)).code,'INVALID_PRICING')
 assert.equal((await set('airtime','global','amount',10,{remove:true})).code,'INVALID_PRICING')
 assert.equal((await set('airtime','denomination','amount',10,{product:'test-product',unit:10,currency:'gbp'})).code,'INVALID_PRICING')
 assert.equal((await set('airtime','denomination','amount',10,{product:'test-product',unit:0,currency:'GBP'})).code,'INVALID_PRICING')
 assert.equal((await set('airtime','denomination','amount',10,{product:'test-product',pkg:'bad\npackage',unit:10,currency:'GBP'})).code,'INVALID_PRICING')
 const existingAudit=await auditCount()
 assert.equal((await set('airtime','global','amount',20)).changed,true)
 assert.deepEqual(await get(),{success:true,mode:'amount',value:20,source:'global'})
 assert.deepEqual(await get('gift_card'),{success:true,mode:'percent',value:7.5,source:'global'})
 assert.equal((await set('airtime','global','amount',20)).changed,false)
 assert.equal(await auditCount(),existingAudit+1)
 assert.equal((await set('airtime','product','percent',50,{product:'test-product'})).changed,true)
 assert.deepEqual(await get(),{success:true,mode:'percent',value:50,source:'product'})
 assert.deepEqual(await get('airtime','other-product'),{success:true,mode:'amount',value:20,source:'global'})
 const selector={product:'test-product',pkg:'at-t-usa<&>25',unit:10,currency:'GBP'}
 assert.equal((await set('airtime','denomination','amount',5.25,selector)).changed,true)
 assert.deepEqual(await get('airtime',selector.product,selector.pkg,10,'GBP'),{success:true,mode:'amount',value:5.25,source:'denomination'})
 assert.deepEqual(await get('airtime',selector.product,selector.pkg,11,'GBP'),{success:true,mode:'percent',value:50,source:'product'})
 assert.deepEqual(await get('airtime',selector.product,selector.pkg,10,'EUR'),{success:true,mode:'percent',value:50,source:'product'})
 assert.deepEqual(await get('airtime',selector.product,null,10,'GBP'),{success:true,mode:'percent',value:50,source:'product'})
 assert.equal((await set('gift_card','denomination','percent',30,selector)).changed,true)
 assert.deepEqual(await get('gift_card',selector.product,selector.pkg,10,'GBP'),{success:true,mode:'percent',value:30,source:'denomination'})
 assert.deepEqual(await get('airtime',selector.product,selector.pkg,10,'GBP'),{success:true,mode:'amount',value:5.25,source:'denomination'})
 const list=await call('list_customer_bitrefill_pricing',[owner,'airtime'])
 assert.equal(list.success,true); assert.deepEqual(list.global,{mode:'amount',value:20}); assert.equal(list.overrides.length,2)
 assert.equal((await call('list_customer_bitrefill_pricing',[other,'airtime'])).code,'OWNER_DENIED')
 assert.equal((await get('unknown')).code,'INVALID_PRICING_IDENTITY')
 const beforeAudit=await auditCount()
 await db.exec(`CREATE FUNCTION public.pricing_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
 CREATE TRIGGER pricing_test_fail BEFORE INSERT ON private.customer_bitrefill_pricing_audit FOR EACH ROW EXECUTE FUNCTION public.pricing_test_fail();`)
 assert.equal((await set('airtime','global','percent',15)).code,'PRICING_UPDATE_FAILED')
 assert.deepEqual((await call('list_customer_bitrefill_pricing',[owner,'airtime'])).global,{mode:'amount',value:20})
 assert.equal(await auditCount(),beforeAudit)
 await db.exec('DROP TRIGGER pricing_test_fail ON private.customer_bitrefill_pricing_audit;')
 assert.equal((await set('airtime','denomination',null,null,{...selector,remove:true})).changed,true)
 assert.equal((await set('airtime','denomination',null,null,{...selector,remove:true})).changed,false)
 assert.deepEqual(await get('airtime',selector.product,selector.pkg,10,'GBP'),{success:true,mode:'percent',value:50,source:'product'})
 const deletion=(await db.query('SELECT owner_user_id,kind,old_config,new_config FROM private.customer_bitrefill_pricing_audit ORDER BY changed_at DESC LIMIT 1')).rows[0]
 assert.equal(deletion.owner_user_id,owner); assert.equal(deletion.kind,'airtime'); assert.deepEqual(deletion.old_config,{mode:'amount',value:5.25}); assert.equal(deletion.new_config,null)
 await assert.rejects(db.exec('UPDATE private.customer_bitrefill_pricing_audit SET old_config=NULL'),/immutable/)
 await assert.rejects(db.exec('DELETE FROM private.customer_bitrefill_pricing_audit'),/immutable/)
 await assert.rejects(db.exec('TRUNCATE private.customer_bitrefill_pricing_audit'),/immutable/)
 for(const role of ['anon','authenticated','service_role']) {
  for(const table of ['global','overrides','audit']) {
   const grants=(await db.query("SELECT has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE') d",[role,`private.customer_bitrefill_pricing_${table}`])).rows[0]
   assert.deepEqual(grants,{i:false,u:false,d:false})
   if(role!=='service_role') assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') s",[role,`private.customer_bitrefill_pricing_${table}`])).rows[0].s,false)
  }
 }
 await db.exec('SET ROLE authenticated;')
 await assert.rejects(get(),e=>e.code==='42501')
 await assert.rejects(set('airtime','global','amount',10),e=>e.code==='42501')
 await assert.rejects(call('list_customer_bitrefill_pricing',[owner,'airtime']),e=>e.code==='42501')
 await assert.rejects(smsBatch([smsOne]),e=>e.code==='42501')
 await db.exec('RESET ROLE; BEGIN;')
 const probe=await db.exec(read('./catalog/customer-bitrefill-pricing-live-probe.sql'))
 const checks=probe.find(result=>result.rows[0]?.passed===true)?.rows[0]
 assert.ok(checks); assert.ok(Object.values(checks).every(value=>value===true))
 await db.exec('ROLLBACK;')
 console.log('Bitrefill owner pricing PGlite: independent kinds, global amount/percent, exact/product fallback, bounded values, owner-only changes, immutable atomic audit and rollback probe passed.')
} finally { await db.close() }
