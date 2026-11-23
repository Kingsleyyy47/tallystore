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
  await db.exec('ALTER TABLE public.profiles ADD COLUMN is_staff boolean DEFAULT false')
  await db.exec(readFileSync(new URL('supabase/migrations/20261119002000_sms_rental_dispatch.sql',root),'utf8'))
  await seed(1)
  await db.query(`UPDATE public.sms_orders SET order_type='rental',provider_payload='{"rental_supplier":"smsbus"}',created_at=now(),status='active' WHERE id=$1`,[oid(1)])
  const claim=async(name,id)=>(await db.query(`SELECT public.${name}($1) result`,[id])).rows[0].result
  assert.equal((await claim('claim_sms_rental_cancel',oid(1))).send_allowed,true)
  assert.equal((await claim('claim_sms_rental_cancel',oid(1))).send_allowed,false)
  assert.equal((await call(1,confirmed(1))).success,true)
  assert.equal((await call(1,confirmed(1))).idempotent_replay,true)
  assert.equal(Number((await rows(1)).wallet_balance),100)
  await seed(2,{status:'processing'})
  await db.query(`UPDATE public.sms_orders SET order_type='rental',provider_payload='{"rental_supplier":"smsbus"}' WHERE id=$1`,[oid(2)])
  const op=oid(900)
  await db.query(`INSERT INTO public.sms_rental_operations(id,user_id,idempotency_key,order_id,area_code,months,amount_ngn,reference,state) VALUES($1,$2,'rental-test-key',$3,'US',1,100,'SMS-FIXTURE-2','prepared')`,[op,customer,oid(2)])
  assert.equal((await claim('claim_sms_rental_dispatch',op)).send_allowed,true)
  assert.equal((await claim('claim_sms_rental_dispatch',op)).send_allowed,false)
  await seed(3,{status:'processing'})
  await db.query(`UPDATE public.sms_orders SET order_type='rental',provider_payload='{"rental_supplier":"smsbus"}' WHERE id=$1`,[oid(3)])
  await db.query(`INSERT INTO public.sms_rental_operations(id,user_id,idempotency_key,order_id,area_code,months,amount_ngn,reference,state) VALUES($1,$2,'rental-key-two',$3,'US',1,100,'SMS-FIXTURE-3','prepared')`,[oid(901),customer,oid(3)])
  await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1',[customer])
  assert.equal((await claim('claim_sms_rental_dispatch',oid(901))).send_allowed,false)
  await db.query('UPDATE public.profiles SET account_suspended=false WHERE id=$1',[customer])
  await seed(4,{messages:[{code:'123456'}]})
  await db.query(`UPDATE public.sms_orders SET order_type='rental',provider_payload='{"rental_supplier":"smsbus"}',status='active',created_at=now() WHERE id=$1`,[oid(4)])
  assert.equal((await claim('claim_sms_rental_cancel',oid(4))).send_allowed,false)
  await seed(5)
  await db.query(`UPDATE public.sms_orders SET order_type='rental',provider_payload='{"rental_supplier":"different"}' WHERE id=$1`,[oid(5)])
  assert.equal((await call(5,confirmed(5))).success,false)
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.claim_sms_rental_dispatch(uuid)','EXECUTE') allowed")).rows[0].allowed,false)
  console.log('Rental actual SQL: one dispatch, cancellation latch, one refund, suspended-wallet denial, SMS-received denial and supplier proof isolation passed.')
} catch(error){console.error('Rental SQL failed:',error.message,error.detail||'',error.where||'');process.exitCode=1}
finally{await db.close()}
