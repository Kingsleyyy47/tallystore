import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const cryptoMigration = migration('20261005022000_nowpayments_verified_wallet_credit.sql')
const cryptoHelperStart = cryptoMigration.indexOf('CREATE OR REPLACE FUNCTION public.is_verified_nowpayments_wallet_credit(')
const cryptoHelperEnd = cryptoMigration.indexOf('\n$$;', cryptoHelperStart)
assert.ok(cryptoHelperStart >= 0 && cryptoHelperEnd > cryptoHelperStart, 'actual crypto verifier exists')
const cryptoHelper = cryptoMigration.slice(cryptoHelperStart, cryptoHelperEnd + 4)
const owner = '10000000-0000-4000-8000-000000000001'
const staff = '10000000-0000-4000-8000-000000000002'
const referred = (i) => `20000000-0000-4000-8000-${String(i).padStart(12,'0')}`

async function status(id) {
  return (await db.query('SELECT public.get_tally_circle_purchase_status($1::uuid) AS value',[id])).rows[0].value
}
async function qualified(id) {
  return Number((await db.query('SELECT public.tally_circle_qualified_count($1::uuid) AS value',[id])).rows[0].value)
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,referral_code text,referred_by text,
      is_staff boolean DEFAULT false,is_admin boolean DEFAULT false,account_suspended boolean DEFAULT false);
    CREATE TABLE public.app_settings(key text PRIMARY KEY,value text,updated_at timestamptz);
    CREATE TABLE public.transactions(user_id uuid,type text,status text,amount numeric,
      created_at timestamptz,external_payment_id text,reference text,metadata jsonb);
    CREATE TABLE public.pending_payments(user_id uuid,amount numeric,status text,
      transaction_reference text,ercas_reference text);
    CREATE TABLE public.pocketfi_webhook_logs(id uuid PRIMARY KEY,matched_user_id uuid,
      processed boolean,verified_amount_ngn numeric,verified_reference text);
    CREATE SCHEMA private;
    CREATE TABLE public.crypto_transactions(id uuid PRIMARY KEY,user_id uuid,
      nowpayments_payment_id text,payment_reference text,naira_amount numeric,
      outcome_amount numeric,outcome_currency text,nowpayments_pay_address text);
    CREATE TABLE private.nowpayments_wallet_quotes(id uuid PRIMARY KEY,crypto_transaction_id uuid,
      user_id uuid,payment_id text,order_reference text,amount_ngn numeric,pay_amount numeric,
      pay_currency text,pay_address text);
    CREATE TABLE private.nowpayments_wallet_proofs(quote_id uuid,payment_id text,
      actual_paid numeric,provider_status text);
    CREATE TABLE private.nowpayments_wallet_revocations(quote_id uuid);
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    INSERT INTO public.profiles VALUES ('${owner}','TALLY-OWNER',null,false,false,false),
      ('${staff}','TALLY-STAFF',null,true,false,false);
  `)
  await db.exec(cryptoHelper)
  await db.exec(migration('20261005000000_tally_circle_verified_referrals.sql'))
  await db.exec(migration('20261005023000_tally_circle_launch_gate.sql'))
  for (let i=1;i<=5;i++) {
    await db.query('INSERT INTO public.profiles(id,referral_code,referred_by) VALUES($1,$2,$3)',
      [referred(i),`REF-${i}`,owner])
    await db.query("INSERT INTO public.pending_payments VALUES($1,1000,'credited',$2,$2)",
      [referred(i),`payment-${i}`])
    await db.query("INSERT INTO public.transactions VALUES($1,'topup','completed',1000,now(),$2,$2,$3)",
      [referred(i),`payment-${i}`,JSON.stringify({provider:'ercaspay',verified_amount_ngn:'1000'})])
  }
  assert.equal(await qualified(owner),5,'qualification can accumulate during Coming Soon')
  let s = await status(owner)
  assert.equal(s.enabled,false)
  assert.equal(s.discount_percent,0)
  assert.equal(s.is_member,false)
  await db.exec(`SET request.jwt.claim.sub = '${owner}'`)
  let mine = (await db.query('SELECT public.get_my_tally_circle_status() AS value')).rows[0].value
  assert.equal(mine.enabled,false)
  assert.equal(mine.discount_percent,0)
  assert.equal(mine.is_member,false)
  assert.equal(mine.qualified_referrals,0)
  assert.equal((await db.query("SELECT has_table_privilege('service_role','private.tally_circle_launch','UPDATE') AS allowed")).rows[0].allowed,false)
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','private.tally_circle_launch','SELECT') AS allowed")).rows[0].allowed,false)

  await db.exec("UPDATE private.tally_circle_launch SET enabled=true WHERE singleton")
  s = await status(owner)
  assert.equal(s.enabled,true)
  assert.equal(s.discount_percent,3)
  assert.equal(s.is_member,true)
  mine = (await db.query('SELECT public.get_my_tally_circle_status() AS value')).rows[0].value
  assert.equal(mine.discount_active,true)
  assert.equal(mine.qualified_referrals,5)
  assert.equal((await status(staff)).discount_percent,0,'staff never receives customer discount')
  await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1',[owner])
  assert.equal((await status(owner)).discount_percent,0,'suspended customer never receives discount')
  await db.query('UPDATE public.profiles SET account_suspended=false WHERE id=$1',[owner])

  // Replace one bank deposit with one provider-backed crypto wallet deposit.
  await db.query('DELETE FROM public.transactions WHERE user_id=$1',[referred(5)])
  const receiptId = '30000000-0000-4000-8000-000000000005'
  const quoteId = '40000000-0000-4000-8000-000000000005'
  await db.query('INSERT INTO public.crypto_transactions VALUES($1,$2,$3,$4,1000,0.01,$5,$6)',
    [receiptId,referred(5),'crypto-payment-5','crypto-reference-5','usdtbsc','safe-test-address'])
  await db.query('INSERT INTO private.nowpayments_wallet_quotes VALUES($1,$2,$3,$4,$5,1000,0.01,$6,$7)',
    [quoteId,receiptId,referred(5),'crypto-payment-5','crypto-reference-5','usdtbsc','safe-test-address'])
  await db.query("INSERT INTO private.nowpayments_wallet_proofs VALUES($1,$2,0.01,'finished')",
    [quoteId,'crypto-payment-5'])
  await db.query("INSERT INTO public.transactions VALUES($1,'topup','completed',1000,now(),$2,$3,$4)",
    [referred(5),'nowpayments:crypto-payment-5','crypto-reference-5',
      JSON.stringify({provider:'nowpayments',verified_amount_ngn:'1000',crypto_quote_id:quoteId})])
  assert.equal(await qualified(owner),5,'verified NOWPayments wallet credit counts')
  await db.query('UPDATE public.crypto_transactions SET nowpayments_pay_address=$1 WHERE id=$2',
    ['tampered-address',receiptId])
  assert.equal(await qualified(owner),4,'receipt address mismatch invalidates crypto proof')
  await db.query('UPDATE public.crypto_transactions SET nowpayments_pay_address=$1 WHERE id=$2',
    ['safe-test-address',receiptId])
  await db.query('UPDATE private.nowpayments_wallet_proofs SET actual_paid=0.009 WHERE quote_id=$1',[quoteId])
  assert.equal(await qualified(owner),4,'underpaid crypto proof does not qualify')
  await db.query('UPDATE private.nowpayments_wallet_proofs SET actual_paid=0.01 WHERE quote_id=$1',[quoteId])
  assert.equal(await qualified(owner),5)
  await db.query('INSERT INTO private.nowpayments_wallet_revocations VALUES($1)',[quoteId])
  assert.equal(await qualified(owner),4,'revoked provider proof does not qualify')
  assert.equal((await status(owner)).discount_percent,0)

  await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(status(owner),/service_role_required/)
} finally { await db.close() }

console.log('Tally Circle launch: off accumulates but cannot discount; on discounts five verified referrals; staff/suspension/revocation and service-only pricing passed.')
