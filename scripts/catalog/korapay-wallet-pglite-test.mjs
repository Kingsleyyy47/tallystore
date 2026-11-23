import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../../supabase/migrations/20261005022000_nowpayments_verified_wallet_credit.sql', import.meta.url), 'utf8')
const user = '11111111-1111-4111-8111-111111111111'
const oldReceipt = '22222222-2222-4222-8222-222222222222'
const receipt = '33333333-3333-4333-8333-333333333333'
const refundedReceipt = '44444444-4444-4444-8444-444444444444'
const address = 'TValidProviderAddress123456789'
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)

async function rpc(name, values) {
  const params = values.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query(`SELECT public.${name}(${params}) AS result`, values)).rows[0].result
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'service_role')
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT decode(md5($1),'hex') $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,wallet_balance numeric DEFAULT 0,
      crypto_balance numeric DEFAULT 0,referral_balance numeric DEFAULT 0,
      is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,
      account_suspended boolean DEFAULT false,wallet_review_required boolean DEFAULT false,
      wallet_review_reason text,wallet_reviewed_by uuid,financial_security_version integer DEFAULT 1,
      pocketfi_account_number text,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.crypto_transactions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
      payment_provider text,nowpayments_payment_id text UNIQUE,payment_reference text,
      naira_amount numeric,crypto_amount numeric,crypto_type text,outcome_amount numeric,
      outcome_currency text,nowpayments_pay_address text,deposit_address text,
      status text DEFAULT 'pending',created_at timestamptz DEFAULT now(),credited_at timestamptz,
      confirmed_at timestamptz,actually_paid numeric,nowpayments_amount_received numeric,
      transaction_type text DEFAULT 'sell');
    CREATE TABLE public.transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
      type text,amount numeric,status text,balance_before numeric,balance_after numeric,
      currency text,reference text,description text,idempotency_key text UNIQUE,
      external_payment_id text,created_by uuid,metadata jsonb DEFAULT '{}'::jsonb,
      balance_type text DEFAULT 'wallet',previous_hash text,transaction_hash text,
      created_at timestamptz DEFAULT now());
    CREATE TABLE public.pending_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
      amount numeric,status text,transaction_reference text,ercas_reference text,last_check_at timestamptz,
      error_message text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.pocketfi_webhook_logs(id uuid PRIMARY KEY,matched_user_id uuid,
      verified_amount_ngn numeric,verified_reference text,processed boolean,error_message text,
      matched_account_number text,raw_payload text);
    CREATE TABLE public.wallet_reservations(id uuid PRIMARY KEY,user_id uuid,status text,
      amount numeric,currency text,order_id uuid,order_table text);
    CREATE TABLE public.wallet_legacy_funding(user_id uuid,grandfathered_principal numeric);
    CREATE TABLE public.wallet_historical_admin_funding(user_id uuid,amount numeric);
    CREATE TABLE public.wallet_provider_confirmations(transaction_id uuid,user_id uuid,
      provider_reference text,confirmed_amount numeric,provider text,provider_status text,
      provider_checked_at timestamptz);
    CREATE TABLE public.wallet_missing_gateway_funding(user_id uuid,pending_payment_id uuid,
      provider_reference text,confirmed_amount numeric,provider text,provider_status text,
      balance_already_includes_amount boolean,provider_checked_at timestamptz);
    CREATE TABLE public.wallet_legacy_spend_allowance_snapshot(user_id uuid,baseline_available numeric,
      gateway_deposits_at_snapshot numeric,completed_debits_at_snapshot numeric,
      eligible_refunds_at_snapshot numeric);
    CREATE TABLE public.smm_orders(user_id uuid,reference text,amount_ngn numeric,status text);
    CREATE FUNCTION public.wallet_refund_links_debit(jsonb,uuid,text,jsonb,text)
      RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
    CREATE TABLE public.evaluation_calls(n integer DEFAULT 1);
    CREATE FUNCTION public.evaluate_customer_ledger_suspension(uuid) RETURNS jsonb
      LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.evaluation_calls DEFAULT VALUES;
        RETURN '{}'::jsonb; END $$;
    CREATE FUNCTION public.trusted_principal_for_user(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
      SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    INSERT INTO auth.users(id) VALUES ('${user}');
    INSERT INTO public.profiles(id,wallet_balance) VALUES ('${user}',0);
    INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,
      payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,
      nowpayments_pay_address,status,created_at)
    VALUES ('${oldReceipt}','${user}','nowpayments','old-payment','ORDER-OLD123',100,1,'usdttrc20',
      1.05,'usdttrc20','${address}','pending','2026-09-01 00:00:00+00');
  `)
  await db.exec(migration)
  await db.exec(`CREATE TRIGGER trusted_deposit_guard BEFORE INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_principal_transaction();`)
  await db.exec(`CREATE TRIGGER crypto_review AFTER UPDATE OF status,credited_at,naira_amount
    ON public.crypto_transactions FOR EACH ROW
    EXECUTE FUNCTION public.evaluate_customer_ledger_suspension_from_crypto_transaction();`)

  await db.exec(readFileSync(new URL('../../supabase/migrations/20261119001000_korapay_verified_wallet_credit.sql', import.meta.url),'utf8'))
  const reference='KORA-55555555-5555-4555-8555-555555555555'
  await db.query(`INSERT INTO public.korapay_checkouts(reference,user_id,idempotency_key,amount_ngn,state) VALUES($1,$2,'test-key-12345',1000,'pending')`,[reference,user])
  assert.equal((await rpc('settle_korapay_checkout',[reference,999,'NGN','success'])).success,false)
  assert.equal((await rpc('settle_korapay_checkout',[reference,1000,'USD','success'])).success,false)
  assert.equal((await rpc('settle_korapay_checkout',[reference,1000,'NGN','pending'])).success,false)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.transactions')).rows[0].n,0)
  const result=await rpc('settle_korapay_checkout',[reference,1000,'NGN','success'])
  assert.equal(result.success,true)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[user])).rows[0].wallet_balance),1000)
  const truth=(await db.query('SELECT public.wallet_financial_truth_internal($1) value',[user])).rows[0].value
  assert.equal(Number(truth.verified_gateway_deposits),1000)
  assert.equal(Number(truth.confirmed_spendable),1000)
  assert.equal((await rpc('settle_korapay_checkout',[reference,1000,'NGN','success'])).success,true)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.transactions')).rows[0].n,1)
  const metadata={provider:'korapay',korapay_reference:reference,verified_amount_ngn:1000}
  assert.equal(await rpc('is_verified_gateway_wallet_credit',[user,1000,reference,'korapay:'+reference,JSON.stringify(metadata)]),true)
  assert.equal(await rpc('is_verified_gateway_wallet_credit',['99999999-9999-4999-8999-999999999999',1000,reference,'korapay:'+reference,JSON.stringify(metadata)]),false)
  assert.equal(await rpc('is_verified_gateway_wallet_credit',[user,2000,reference,'korapay:'+reference,JSON.stringify(metadata)]),false)
  await assert.rejects(db.query('DELETE FROM private.korapay_wallet_proofs'),/korapay_evidence_immutable/)
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.korapay_checkouts','SELECT') allowed")).rows[0].allowed,false)
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.settle_korapay_checkout(text,numeric,text,text)','EXECUTE') allowed")).rows[0].allowed,false)
  console.log('Kora actual wallet SQL: amount/currency/status/owner binding, canonical spendable funds, one credit, replay, immutable evidence and browser denial passed.')
} catch(error){console.error('Kora wallet SQL failed:',error.message,error.detail||'',error.where||'');process.exitCode=1}
finally{await db.close()}
