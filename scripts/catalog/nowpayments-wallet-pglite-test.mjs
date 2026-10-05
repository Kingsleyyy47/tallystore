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

  let result = await rpc('register_nowpayments_wallet_quote', [oldReceipt,user,'old-payment','ORDER-OLD123',100,1.05,'usdttrc20',address])
  assert.equal(result.code,'QUOTE_RECEIPT_MISMATCH','old receipts cannot acquire newly trusted quotes')
  assert.equal((await rpc('get_registered_nowpayments_wallet_quote',[oldReceipt])).registered,false)

  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,
    payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,
    nowpayments_pay_address,status)
    VALUES ($1,$2,'nowpayments','provider-123','ORDER-NEW123',100,1,'usdttrc20',1.05,'usdttrc20',$3,'pending')`,
    [receipt,user,address])
  result = await rpc('register_nowpayments_wallet_quote',[receipt,user,'provider-123','ORDER-NEW123',100,1.05,'usdttrc20',address])
  assert.equal(result.success,true)
  const quoteId = result.quote_id
  assert.equal((await rpc('get_registered_nowpayments_wallet_quote',[receipt])).pay_amount,1.05)
  assert.equal((await rpc('register_nowpayments_wallet_quote',[receipt,user,'provider-123','ORDER-NEW123',100,1.05,'usdttrc20',address])).idempotency_hit,true)
  assert.equal((await rpc('register_nowpayments_wallet_quote',[receipt,user,'provider-123','ORDER-NEW123',100,1,'usdttrc20',address])).code,'QUOTE_RECEIPT_MISMATCH')

  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,
    payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,
    nowpayments_pay_address,status)
    VALUES ($1,$2,'nowpayments','refunded-before-credit','ORDER-REFUND123',75,0.75,'usdttrc20',0.8,'usdttrc20',$3,'pending')`,
    [refundedReceipt,user,address])
  assert.equal((await rpc('register_nowpayments_wallet_quote',[
    refundedReceipt,user,'refunded-before-credit','ORDER-REFUND123',75,0.8,'usdttrc20',address])).success,true)
  const refundBeforeCreditArgs = ['refunded-before-credit','ORDER-REFUND123',0.8,'usdttrc20',address,null,'refunded',hashA,hashB]
  result = await rpc('revoke_nowpayments_wallet_quote',refundBeforeCreditArgs)
  assert.equal(result.success,true)
  assert.equal(result.was_credited,false)
  assert.equal((await rpc('settle_nowpayments_wallet_quote',[
    ...refundBeforeCreditArgs.slice(0,5),0.8,'finished',hashA,hashB])).code,'PAYMENT_REVOKED')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n,0)

  const args = ['provider-123','ORDER-NEW123',1.05,'usdttrc20',address,1.05,'finished',hashA,hashB]
  const failures = [
    ['wrong-provider',...args.slice(1)],
    [args[0],'WRONG-ORDER',...args.slice(2)],
    [args[0],args[1],1.0,...args.slice(3)],
    [args[0],args[1],args[2],'btc',...args.slice(4)],
    [args[0],args[1],args[2],args[3],'wrong-address',...args.slice(5)],
    [args[0],args[1],args[2],args[3],args[4],null,...args.slice(6)],
    [args[0],args[1],args[2],args[3],args[4],1.04,...args.slice(6)],
    [...args.slice(0,6),'confirming',...args.slice(7)],
    [...args.slice(0,7),null,args[8]],
  ]
  for (const invalid of failures) {
    result = await rpc('settle_nowpayments_wallet_quote',invalid)
    assert.equal(result.success,false)
  }
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[user])).rows[0].wallet_balance),0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM private.nowpayments_wallet_proofs')).rows[0].n,0)

  result = await rpc('record_nowpayments_wallet_status',['provider-123','ORDER-NEW123','partially_paid'])
  assert.equal(result.status,'partially_paid')
  result = await rpc('record_nowpayments_wallet_status',['provider-123','ORDER-NEW123','expired'])
  assert.equal(result.status,'expired')
  result = await rpc('settle_nowpayments_wallet_quote',args)
  assert.equal(result.success,true)
  assert.equal(result.idempotency_hit,false)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.evaluation_calls')).rows[0].n,1)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[user])).rows[0].wallet_balance),100)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n,1)
  let truth = (await db.query('SELECT public.wallet_financial_truth_internal($1::uuid) AS value',[user])).rows[0].value
  assert.equal(Number(truth.verified_gateway_deposits),100,'canonical truth must recognize the proof-backed credit')
  assert.equal(Number(truth.confirmed_spendable),100)
  const metadata = { provider:'nowpayments', verified_amount_ngn:100, crypto_quote_id:quoteId }
  assert.equal(await rpc('is_verified_nowpayments_wallet_credit',[user,100,'ORDER-NEW123','nowpayments:provider-123',JSON.stringify(metadata)]),true)
  assert.equal((await rpc('settle_nowpayments_wallet_quote',args)).idempotency_hit,true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n,1)
  await assert.rejects(rpc('apply_wallet_transaction',[
    user,'topup',100,'ORDER-NEW123','duplicate direct credit','nowpayments:duplicate',
    JSON.stringify(metadata),'NGN','wallet','nowpayments:provider-123',null,
  ]), /transactions_nowpayments_quote_one_credit/,
  'even a privileged direct wallet call cannot reuse one proof for another credit')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n,1)
  await assert.rejects(db.query('DELETE FROM private.nowpayments_wallet_proofs WHERE quote_id=$1',[quoteId]),
    /nowpayments_evidence_immutable/)
  assert.equal((await rpc('record_nowpayments_wallet_status',['provider-123','ORDER-NEW123','failed'])).status,'completed')

  result = await rpc('revoke_nowpayments_wallet_quote',[...args.slice(0,6),'refunded',hashA,hashB])
  assert.equal(result.success,true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.evaluation_calls')).rows[0].n,1,
    'refund revocation should reduce canonical capacity without opening a fraud hold')
  assert.equal(await rpc('is_verified_nowpayments_wallet_credit',[user,100,'ORDER-NEW123','nowpayments:provider-123',JSON.stringify(metadata)]),false)
  truth = (await db.query('SELECT public.wallet_financial_truth_internal($1::uuid) AS value',[user])).rows[0].value
  assert.equal(Number(truth.verified_gateway_deposits),0,'refund revocation removes trusted gateway principal')
  assert.equal(Number(truth.confirmed_spendable),0)
  assert.equal((await rpc('revoke_nowpayments_wallet_quote',[...args.slice(0,6),'refunded',hashA,hashB])).idempotency_hit,true)
  assert.equal((await rpc('settle_nowpayments_wallet_quote',args)).code,'PAYMENT_REVOKED')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n,1)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[user])).rows[0].wallet_balance),100,
    'refund revocation removes trusted capacity without an arbitrary ledger debit')

  await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(rpc('get_registered_nowpayments_wallet_quote',[receipt]), /service_role_required/)
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.crypto_transactions','INSERT') AS allowed")).rows[0].allowed,false)
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','private.nowpayments_wallet_proofs','SELECT') AS allowed")).rows[0].allowed,false)
} catch (error) {
  console.error('NOWPayments wallet test failed:', error.message, error.detail || '', error.where || '')
  process.exitCode = 1
} finally { await db.close() }

if (!process.exitCode) console.log('NOWPayments wallet: registration cutoff, exact quote, underpayment denial, one canonical credit, replay, status latch, revocation and browser denial passed.')
