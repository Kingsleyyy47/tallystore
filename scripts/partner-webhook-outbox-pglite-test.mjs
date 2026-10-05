import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const read=p=>readFileSync(p,'utf8')
const prepaid='10000000-0000-4000-8000-000000000001',unlimited='10000000-0000-4000-8000-000000000002'
const prepaidKey='20000000-0000-4000-8000-000000000001',unlimitedKey='20000000-0000-4000-8000-000000000002',user='30000000-0000-4000-8000-000000000001'
const scaffold=read('scripts/partner-external-journal-pglite-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1]
const setup=scaffold.replaceAll('${prepaid}',prepaid).replaceAll('${unlimited}',unlimited).replaceAll('${prepaidKey}',prepaidKey).replaceAll('${unlimitedKey}',unlimitedKey).replaceAll('${user}',user)
async function call(name,args){return(await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args)).rows[0].r}
const reserve=(idem,key=prepaidKey)=>call('reserve_api_partner_external_order',[key,'sms','sms','fixture','Test',1,10,10,idem,'a'.repeat(64),'{}',null,null,null])
async function complete(id){await call('claim_api_partner_external_dispatch',[id,prepaidKey]);await call('record_api_partner_external_outcome',[id,'accepted','daisy',id,'{}','completed',null]);return(await db.query('SELECT event_id FROM private.partner_webhook_events WHERE order_id=$1',[id])).rows[0]?.event_id}
try {
 await db.exec(setup)
 await db.exec(`CREATE SCHEMA private;
 CREATE TABLE public.product_groups(id uuid PRIMARY KEY,name text,price numeric,is_active boolean,is_sellable boolean,availability_status text,stock_count integer);
 CREATE TABLE public.individual_accounts(id uuid PRIMARY KEY,product_group_id uuid,status text,sold_at timestamptz,username text,password text,email text,email_password text,two_fa_code text,recovery_email text,recovery_email_password text,additional_info text);
 CREATE TABLE public.api_partner_webhook_deliveries(id uuid PRIMARY KEY,partner_id uuid,order_id uuid,event_type text,target_url text,payload jsonb,status text,status_code integer,response_body text,error_message text,attempts integer,delivered_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`)
 for(const p of ['20261005012000_partner_local_product_purchase','20261005020000_partner_external_purchase_journal','20261005021000_partner_external_reads_and_rate_limits','20261005021100_partner_dispatch_lock_order'])await db.exec(read(`supabase/migrations/${p}.sql`))
 const before=(await db.query("SELECT pg_get_functiondef('public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)'::regprocedure) d")).rows[0].d
 await db.exec(read('supabase/migrations/20261005030000_partner_webhook_event_outbox.sql'))
 const after=(await db.query("SELECT pg_get_functiondef('public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)'::regprocedure) d")).rows[0].d
 assert.equal(after,before.replace("'expected_amount_ngn',p_expected_amount)","'expected_amount_ngn',p_expected_amount,'api_key_id',p_key_id)"),'local RPC exact request-only patch')
 await db.exec('BEGIN;')
 const probe=await db.exec(read('scripts/catalog/partner-webhook-outbox-live-probe.sql'))
 assert.ok(Object.values(probe.find(r=>r.rows[0]?.passed)?.rows[0]||{}).every(v=>v===true));assert.ok(probe.find(r=>r.rows[0]?.passed))
 await db.exec('ROLLBACK;')
 await db.query("UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read']")
 await db.query("UPDATE public.api_partners SET allowed_sections=ARRAY['sms','products'],webhook_url='https://callbacks.example.com/tally',webhook_secret=$1,balance_ngn=1000",['tly_whsec_'+'a'.repeat(64)])
 const created=await reserve('outbox-concurrent-claim');const eid=await complete(created.order_id)
 assert.ok(eid)
 const h=createHash('sha256').update(`partner-webhook-v2:${prepaid}:${created.order_id}:partner.order.completed`).digest('hex')
 const expected=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`
 assert.equal(eid,expected,'SQL and JS deterministic event UUIDs agree')
 const race=await Promise.all(Array.from({length:6},()=>call('claim_api_partner_webhook_event',[eid])))
 assert.equal(race.filter(r=>r.send_allowed).length,1)
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.api_partner_webhook_deliveries WHERE id=$1',[eid])).rows[0].n),1)
 const winner=race.find(r=>r.send_allowed)
 assert.deepEqual(Object.keys(winner.order).sort(),['amount_ngn','currency','id','item_type','partner_id','partner_reference','status'])
 assert.equal((await call('finish_api_partner_webhook_event',[eid,winner.claim_nonce,'delivered','provider password',200])).code,'INVALID_OUTCOME')
 assert.equal((await call('finish_api_partner_webhook_event',[eid,winner.claim_nonce,'delivered','WEBHOOK_DELIVERED',200])).success,true)
 assert.equal((await call('claim_api_partner_webhook_event',[eid])).send_allowed,false)
 await assert.rejects(db.exec("UPDATE private.partner_webhook_events SET state='queued'"),/transition_denied/)
 await assert.rejects(db.exec('TRUNCATE private.partner_webhook_start'),/immutable/)
 await assert.rejects(db.exec('DELETE FROM private.partner_webhook_events'),/immutable/)
 const denials=[
  ["UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create'] WHERE id=$1",[prepaidKey],"UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read'] WHERE id=$1",[prepaidKey]],
  ["UPDATE public.api_partners SET is_active=false WHERE id=$1",[prepaid],"UPDATE public.api_partners SET is_active=true WHERE id=$1",[prepaid]],
  ["UPDATE public.api_partners SET owner_reviewed_at=NULL WHERE id=$1",[prepaid],"UPDATE public.api_partners SET owner_reviewed_at=now() WHERE id=$1",[prepaid]],
  ["UPDATE public.api_partners SET allowed_sections=ARRAY['products'] WHERE id=$1",[prepaid],"UPDATE public.api_partners SET allowed_sections=ARRAY['sms','products'] WHERE id=$1",[prepaid]],
  ["UPDATE public.api_partners SET webhook_url='https://username:password@callbacks.example.com/tally' WHERE id=$1",[prepaid],"UPDATE public.api_partners SET webhook_url='https://callbacks.example.com/tally' WHERE id=$1",[prepaid]],
 ]
 for(const [i,[sql,args,restore,restoreArgs]]of denials.entries()){
  const order=await reserve(`outbox-denial-fixture-${i}`);const event=await complete(order.order_id)
  await db.query(sql,args)
  const denied=await call('claim_api_partner_webhook_event',[event])
  assert.equal(denied.code,'WEBHOOK_NOT_AUTHORIZED');assert.equal(denied.send_allowed,false);assert.ok(!('partner' in denied))
  assert.equal(Number((await db.query('SELECT count(*) n FROM public.api_partner_webhook_deliveries WHERE id=$1',[event])).rows[0].n),0)
  await db.query(restore,restoreArgs)
  assert.equal((await call('claim_api_partner_webhook_event',[event])).send_allowed,false,'authorization denial is final, not automatic retry')
 }
 const changed=await reserve('outbox-changed-order-identity');const changedEvent=await complete(changed.order_id)
 await db.query("UPDATE public.api_partner_orders SET partner_reference='changed-after-queue' WHERE id=$1",[changed.order_id])
 assert.equal((await call('claim_api_partner_webhook_event',[changedEvent])).code,'WEBHOOK_NOT_AUTHORIZED')
 const wrongAmount=await reserve('outbox-changed-order-amount');const wrongAmountEvent=await complete(wrongAmount.order_id)
 await db.query('UPDATE public.api_partner_orders SET amount_ngn=11 WHERE id=$1',[wrongAmount.order_id])
 const wrongResult=await call('claim_api_partner_webhook_event',[wrongAmountEvent])
 assert.equal(wrongResult.code,'WEBHOOK_NOT_AUTHORIZED');assert.ok(!('partner' in wrongResult))
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.api_partner_webhook_deliveries WHERE id=$1',[wrongAmountEvent])).rows[0].n),0)
 const wrongProof=await reserve('outbox-changed-journal-proof');const wrongProofEvent=await complete(wrongProof.order_id)
 await db.query('UPDATE public.api_partner_external_orders SET balance_after=balance_after-1 WHERE order_id=$1',[wrongProof.order_id])
 const proofResult=await call('claim_api_partner_webhook_event',[wrongProofEvent])
 assert.equal(proofResult.code,'WEBHOOK_NOT_AUTHORIZED');assert.ok(!('partner' in proofResult))
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.api_partner_webhook_deliveries WHERE id=$1',[wrongProofEvent])).rows[0].n),0)
 const noProof='50000000-0000-4000-8000-000000000001'
 await db.query("INSERT INTO public.api_partner_orders(id,partner_id,idempotency_key,item_type,item_id,quantity,amount_ngn,status,request_payload) VALUES($1,$2,'no-financial-proof-fixture','product','unpaid',1,10,'completed',jsonb_build_object('api_key_id',$3::text))",[noProof,prepaid,prepaidKey])
 assert.equal(Number((await db.query('SELECT count(*) n FROM private.partner_webhook_events WHERE order_id=$1',[noProof])).rows[0].n),0,'completed status without obligation cannot queue')
 const pg='40000000-0000-4000-8000-000000000001'
 await db.query("INSERT INTO public.product_groups VALUES($1,'Test local',10,true,true,'AVAILABLE',2)",[pg])
 await db.query("INSERT INTO public.individual_accounts(id,product_group_id,status,username,password) VALUES(gen_random_uuid(),$1,'available','TEST-ONLY','TEST-ONLY')",[pg])
 const local=await call('purchase_api_partner_local_product',[prepaidKey,pg,1,10,'outbox-local-atomic-fixture',null])
 assert.equal(local.success,true)
 const le=(await db.query("SELECT * FROM private.partner_webhook_events WHERE order_id=$1",[local.data.id])).rows[0]
 assert.equal(le.key_id,prepaidKey)
 assert.equal((await call('claim_api_partner_webhook_event',[le.event_id])).send_allowed,true)
 const listed=await call('list_queued_api_partner_webhook_events',[20])
 assert.equal(listed.success,true)
 for(const row of listed.events)assert.deepEqual(Object.keys(row).sort(),['event_id','event_type','key_id','order_id','partner_id'])
 const ul=await reserve('outbox-unlimited-no-refund',unlimitedKey)
 await call('cancel_prepared_api_partner_external_order',[ul.order_id,unlimitedKey])
 assert.equal(Number((await db.query('SELECT count(*) n FROM private.partner_webhook_events WHERE order_id=$1',[ul.order_id])).rows[0].n),0)
 const defs=(await db.query("SELECT pg_get_functiondef('public.claim_api_partner_webhook_event(uuid)'::regprocedure) d")).rows[0].d
 const offsets=['FROM public.api_partner_keys WHERE id=e.key_id FOR SHARE','FROM public.api_partners WHERE id=e.partner_id FOR UPDATE','FROM public.api_partner_orders WHERE id=e.order_id FOR UPDATE','WHERE event_id=p_event_id FOR UPDATE'].map(s=>defs.indexOf(s))
 assert.ok(offsets.every((n,i)=>n>=0&&(!i||n>offsets[i-1])),'key-partner-order-event locks')
 console.log('Partner300 PGlite: future financial-proof outbox, original-key binding, exact local RPC patch, JS UUID parity, six serialized competing claims/one winner, fresh scope/partner/section and order/proof tamper denial before delivery/secret return, minimal summary, terminal immutability, held unknown/no unlimited refund, role guards and rollback probe passed.')
} catch(error) {console.error(`Partner300 fixture failed: ${error.message}`);process.exitCode=1}
finally {await db.close()}
