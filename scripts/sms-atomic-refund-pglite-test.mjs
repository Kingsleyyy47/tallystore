import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const migration = readFileSync(new URL('supabase/migrations/20261018001000_atomic_sms_cancellation_refund.sql', root), 'utf8')
const link = readFileSync(new URL('supabase/migrations/20260924012000_refund_link_precedence_in_financial_truth.sql', root), 'utf8').split('REVOKE ALL')[0]
const db = new PGlite()
const customer = '11111111-1111-4111-8111-111111111111'
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const other = '22222222-2222-4222-8222-222222222222'
const oid = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`
let checks = 0
let stage = 'setup'

async function call(n, evidence, override = false, actor = null, reason = 'reviewed_cancellation') {
  const q = await db.query('SELECT public.cancel_sms_order_and_refund($1,$2,$3::jsonb,$4,$5) result',
    [oid(n), reason, JSON.stringify(evidence), actor, override])
  return q.rows[0].result
}
async function rows(n) {
  const q = await db.query(`SELECT o.status,o.refunded_at,o.refund_amount_ngn,o.refund_reference,
    p.wallet_balance,(SELECT count(*)::int FROM public.transactions t WHERE t.user_id=o.user_id
    AND t.type='refund') refunds FROM public.sms_orders o JOIN public.profiles p ON p.id=o.user_id WHERE o.id=$1`, [oid(n)])
  return q.rows[0]
}
async function seed(n, options = {}) {
  const ref = `SMS-FIXTURE-${n}`
  await db.query(`INSERT INTO public.sms_orders
    (id,user_id,reference,order_type,provider,status,messages,price_ngn,provider_request_id,
      provider_order_id,phone_number,raw_phone_number,created_at,expires_at,last_provider_response,provider_payload)
    VALUES ($1,$2,$3,'otp','smsbus',$4,$5::jsonb,100,$6,NULL,$7,$8,now()-interval '2 days',now()-interval '1 day','{}',$9::jsonb)`,
    [oid(n), customer, ref, options.status || 'waiting', JSON.stringify(options.messages || []),
      options.activation === undefined ? `activation-${n}` : options.activation,
      options.phone === undefined ? '+15550000000' : options.phone,
      options.phone === undefined ? '15550000000' : options.phone,
      JSON.stringify(options.activation === null ? {pending_provider_allocation:true} : {})])
  await db.query(`INSERT INTO public.transactions
    (id,user_id,type,amount,status,currency,balance_type,reference,idempotency_key,metadata)
    VALUES ($1,$2,'purchase',-100,'completed','NGN','wallet',$3,$4,$5::jsonb)`,
    [oid(n + 100), customer, ref, options.legacy ? null : `sms:purchase:${n}`,
      JSON.stringify(options.untrusted ? {} : {trusted_principal_authorized:'true',trusted_principal_debit_amount:'100'})])
}
const confirmed = (n) => ({provider_response:'ACCESS_CANCEL',activation_id:`activation-${n}`})
const noActivation = (n) => ({kind:'OWNER_UNDELIVERED_NO_ACTIVATION',provider_response:'NO_ACTIVATION',probe_source:'daisysms_status',activation_id:`activation-${n}`,probed_at:new Date().toISOString()})

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false,
      account_suspended boolean DEFAULT false,wallet_balance numeric DEFAULT 0);
    CREATE TABLE public.sms_orders(
      id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.profiles(id),reference text UNIQUE,
      order_type text,provider text,status text,messages jsonb,price_ngn numeric,
      provider_request_id text,provider_order_id text,phone_number text,raw_phone_number text,
      created_at timestamptz,expires_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,
      provider_payload jsonb,
      refunded_at timestamptz,refund_amount_ngn numeric,refund_reference text,last_provider_response jsonb);
    CREATE TABLE public.transactions(
      id uuid PRIMARY KEY,user_id uuid NOT NULL,type text,amount numeric,status text,
      currency text,balance_type text,reference text,idempotency_key text UNIQUE,
      metadata jsonb,created_at timestamptz DEFAULT now());
    INSERT INTO public.profiles(id,is_admin,wallet_balance) VALUES
      ('${customer}',false,0),('${owner}',true,0),('${other}',true,0);
  `)
  stage = 'link function'
  await db.exec(link)
  // The real wallet engine is independently protected and tested. This small
  // stub enforces its refund proof/idempotency contract, allowing this test to
  // exercise actual SQL transaction rollback and exactly-once order writes.
  await db.exec(`
    CREATE FUNCTION public.apply_wallet_transaction(
      p_user_id uuid,p_type text,p_amount numeric,p_reference text,p_description text,
      p_idempotency_key text,p_metadata jsonb,p_currency text,p_balance_type text,
      p_external_payment_id text,p_created_by uuid) RETURNS jsonb
    LANGUAGE plpgsql AS $$
    DECLARE d public.transactions%ROWTYPE; existing public.transactions%ROWTYPE;
    BEGIN
      IF current_setting('test.wallet_failure',true)='true' THEN
        RETURN jsonb_build_object('success',false,'code','WALLET_REJECTED');
      END IF;
      SELECT * INTO existing FROM public.transactions WHERE idempotency_key=p_idempotency_key;
      IF FOUND THEN RETURN jsonb_build_object('success',true,'idempotent_replay',true); END IF;
      SELECT * INTO d FROM public.transactions WHERE id=(p_metadata->>'source_debit_transaction_id')::uuid;
      IF NOT FOUND OR d.user_id<>p_user_id OR d.amount<>-p_amount
        OR d.metadata->>'trusted_principal_authorized' IS DISTINCT FROM 'true'
        OR COALESCE((d.metadata->>'trusted_principal_debit_amount')::numeric,0)<p_amount
        OR NOT public.wallet_refund_links_debit(p_metadata,d.id,d.idempotency_key,d.metadata,d.reference)
      THEN RETURN jsonb_build_object('success',false,'code','UNTRUSTED_DEBIT'); END IF;
      INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
        reference,idempotency_key,metadata)
      VALUES(gen_random_uuid(),p_user_id,p_type,p_amount,'completed',p_currency,p_balance_type,
        p_reference,p_idempotency_key,p_metadata);
      UPDATE public.profiles SET wallet_balance=wallet_balance+p_amount WHERE id=p_user_id;
      RETURN jsonb_build_object('success',true);
    END $$;
  `)
  stage = 'migration'
  await db.exec(migration)
  stage = 'fixtures'
  const grants = await db.query(`SELECT
    has_function_privilege('anon','public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)','EXECUTE') a,
    has_function_privilege('authenticated','public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)','EXECUTE') u,
    has_function_privilege('service_role','public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)','EXECUTE') s`)
  assert.deepEqual(grants.rows[0], {a:false,u:false,s:true}); checks++
  await db.query('SET ROLE authenticated')
  await assert.rejects(() => call(1, confirmed(1)), e => e.code === '42501'); checks++
  await db.query('RESET ROLE')

  await seed(1)
  let r = await call(1, confirmed(1))
  assert.equal(r.success,true)
  assert.equal((await rows(1)).refunds,1)
  assert.equal(Number((await rows(1)).wallet_balance),100)
  assert.equal((await call(1, {}, false)).idempotent_replay,true)
  assert.equal((await rows(1)).refunds,1); checks++

  await seed(2)
  assert.equal((await call(2,{provider_response:'ACCESS_CANCEL',activation_id:'foreign'})).code,'PROVIDER_CANCELLATION_REQUIRED')
  assert.equal((await rows(2)).refunds,1) // only the first order's refund exists
  assert.equal((await rows(2)).status,'waiting'); checks++

  await seed(3,{messages:[{code:'123456'}]})
  assert.equal((await call(3,confirmed(3))).code,'ORDER_REVIEW_REQUIRED')
  assert.equal((await rows(3)).status,'waiting'); checks++

  await seed(4,{legacy:true})
  assert.equal((await call(4,confirmed(4))).success,true)
  assert.equal((await rows(4)).status,'cancelled'); checks++

  await seed(5,{legacy:true,untrusted:true})
  await assert.rejects(() => call(5,confirmed(5)), /sms_wallet_refund_rejected/)
  assert.equal((await rows(5)).status,'waiting'); checks++

  await seed(6,{status:'processing',activation:null,phone:null})
  assert.equal((await call(6,{kind:'OWNER_UNDELIVERED_ALLOCATION'},true,other)).code,'OWNER_OVERRIDE_REVIEW_REQUIRED')
  assert.equal((await call(6,{kind:'OWNER_UNDELIVERED_ALLOCATION'},true,owner)).success,true)
  assert.equal((await rows(6)).status,'cancelled'); checks++

  await seed(7)
  assert.equal((await call(7,noActivation(7),false,owner)).code,'PROVIDER_CANCELLATION_REQUIRED')
  assert.equal((await call(7,{...noActivation(7),activation_id:'wrong'},true,owner)).code,'OWNER_OVERRIDE_REVIEW_REQUIRED')
  assert.equal((await call(7,{...noActivation(7),probed_at:new Date(Date.now()-61*60_000).toISOString()},true,owner)).code,'OWNER_OVERRIDE_REVIEW_REQUIRED')
  assert.equal((await call(7,noActivation(7),true,owner)).success,true); checks++

  await seed(8)
  await db.query("SELECT set_config('test.wallet_failure','true',false)")
  await assert.rejects(() => call(8,confirmed(8)), /sms_wallet_refund_rejected/)
  assert.equal((await rows(8)).status,'waiting')
  await db.query("SELECT set_config('test.wallet_failure','false',false)"); checks++

  await seed(9,{status:'cancelled'})
  await db.query(`INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
    reference,idempotency_key,metadata)
    VALUES($1,$2,'refund',100,'completed','NGN','wallet','REFUND-SMS-FIXTURE-9',
      'staff:sms-refund:9',$3::jsonb)`,[oid(900),customer,JSON.stringify({source_debit_transaction_id:oid(109)})])
  const beforeRepairBalance = Number((await rows(9)).wallet_balance)
  r=await call(9,{})
  assert.equal(r.success,true)
  assert.equal(r.idempotent_replay,true)
  assert.ok((await rows(9)).refunded_at)
  assert.equal(Number((await rows(9)).wallet_balance),beforeRepairBalance)
  assert.equal((await rows(9)).refunds,5) // orders 1,4,6,7 and this existing row, with no repair credit
  checks++

  await seed(10)
  await db.query(`INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
    reference,idempotency_key,metadata)
    VALUES($1,$2,'refund',50,'completed','NGN','wallet','REFUND-SMS-FIXTURE-10',
      'staff:sms-refund:10',$3::jsonb)`,[oid(901),customer,JSON.stringify({source_debit_transaction_id:oid(110)})])
  assert.equal((await call(10,confirmed(10))).code,'REFUND_LEDGER_REVIEW_REQUIRED')
  assert.equal((await rows(10)).status,'waiting'); checks++

  await seed(11,{status:'processing',activation:null,phone:null})
  const declined = {phase:'allocation',activation_id:'',response:'NO_NUMBERS'}
  assert.equal((await call(11,declined)).success,true)
  assert.equal((await rows(11)).status,'cancelled'); checks++
  await seed(12,{status:'processing',activation:null,phone:null})
  assert.equal((await call(12,{...declined,response:'UNRECOGNIZED'})).code,'PROVIDER_CANCELLATION_REQUIRED')
  assert.equal((await rows(12)).status,'processing'); checks++

  await seed(13)
  await db.query('UPDATE public.transactions SET amount=-90 WHERE id=$1',[oid(113)])
  assert.equal((await call(13,confirmed(13))).code,'PURCHASE_DEBIT_REVIEW_REQUIRED')
  assert.equal((await rows(13)).status,'waiting'); checks++

  await seed(14,{status:'processing',activation:null,phone:null})
  await db.query(`UPDATE public.sms_orders SET provider_payload='{}'::jsonb WHERE id=$1`,[oid(14)])
  assert.equal((await call(14,{kind:'OWNER_UNDELIVERED_ALLOCATION'},true,owner)).code,'OWNER_OVERRIDE_REVIEW_REQUIRED')
  assert.equal((await rows(14)).status,'processing'); checks++

  await seed(15,{status:'processing',activation:null,phone:null})
  await db.query(`UPDATE public.profiles SET account_suspended=true WHERE id=$1`,[owner])
  assert.equal((await call(15,{kind:'OWNER_UNDELIVERED_ALLOCATION'},true,owner)).code,'OWNER_OVERRIDE_REVIEW_REQUIRED')
  await db.query(`UPDATE public.profiles SET account_suspended=false WHERE id=$1`,[owner]); checks++

  await seed(16)
  await db.query(`INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
    reference,idempotency_key,metadata)
    VALUES($1,$2,'refund',100,'completed','NGN','wallet','REFUND-SMS-FIXTURE-16',
      'staff:sms-refund:16',$3::jsonb)`,[oid(902),customer,JSON.stringify({source_debit_transaction_id:oid(116)})])
  const beforeExistingBalance = Number((await rows(16)).wallet_balance)
  assert.equal((await call(16,confirmed(16))).success,true)
  assert.equal(Number((await rows(16)).wallet_balance),beforeExistingBalance)
  assert.equal((await rows(16)).status,'cancelled'); checks++

  // Old staff refund: order ID wins inside wallet_refund_links_debit(), while
  // the original debit predates order creation and lacks order metadata.
  await seed(17,{status:'cancelled',legacy:true})
  const legacyStaffMetadata = {source_order_id:oid(17),order_id:oid(17),
    source_order_table:'sms_orders',original_reference:'SMS-FIXTURE-17'}
  assert.equal((await db.query(`SELECT public.wallet_refund_links_debit($1::jsonb,$2,NULL,$3::jsonb,$4) linked`,
    [JSON.stringify(legacyStaffMetadata),oid(117),JSON.stringify({trusted_principal_authorized:'true'}),'SMS-FIXTURE-17'])).rows[0].linked,false)
  await db.query(`INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
    reference,idempotency_key,metadata)
    VALUES($1,$2,'refund',100,'completed','NGN','wallet','REFUND-SMS-FIXTURE-17',
      'staff:sms-refund:17',$3::jsonb)`,[oid(903),customer,JSON.stringify(legacyStaffMetadata)])
  const beforeLegacyRepair = Number((await rows(17)).wallet_balance)
  assert.equal((await call(17,{})).idempotent_replay,true)
  assert.ok((await rows(17)).refunded_at)
  assert.equal(Number((await rows(17)).wallet_balance),beforeLegacyRepair); checks++

  await seed(18,{status:'cancelled'})
  await db.query(`INSERT INTO public.transactions(id,user_id,type,amount,status,currency,balance_type,
    reference,idempotency_key,metadata)
    VALUES($1,$2,'refund',100,'completed','NGN','wallet','REFUND-SMS-FIXTURE-18',
      'staff:sms-refund:18',$3::jsonb)`,[oid(904),customer,JSON.stringify({
        source_order_id:oid(18),original_reference:'SMS-FIXTURE-18',source_debit_transaction_id:oid(101)})])
  assert.equal((await call(18,{})).code,'REFUND_LEDGER_REVIEW_REQUIRED')
  assert.equal((await rows(18)).refunded_at,null); checks++

  console.log(`sms atomic refund PGlite: ${checks} focused assertions passed`)
} catch (error) {
  console.error('sms atomic refund test failed:', stage, error.code || '', error.message, 'position', error.position, 'where', String(error.where || '').slice(0,300))
  process.exitCode = 1
} finally {
  await db.close()
}
