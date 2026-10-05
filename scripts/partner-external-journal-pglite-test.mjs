import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const prepaid = '10000000-0000-4000-8000-000000000001'
const unlimited = '10000000-0000-4000-8000-000000000002'
const prepaidKey = '20000000-0000-4000-8000-000000000001'
const unlimitedKey = '20000000-0000-4000-8000-000000000002'
const user = '30000000-0000-4000-8000-000000000001'
const fingerprint = 'a'.repeat(64)
const migration = readFileSync(new URL('../supabase/migrations/20261005020000_partner_external_purchase_journal.sql', import.meta.url), 'utf8')
const localMigration = readFileSync(new URL('../supabase/migrations/20261005012000_partner_local_product_purchase.sql', import.meta.url), 'utf8')
async function call(name, args) {
  const placeholders = args.map((_, index) => `$${index+1}`).join(',')
  return (await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)).rows[0].result
}
const reserve = (key, idem, amount, expected = amount, fp = fingerprint, section = 'sms') => call(
  'reserve_api_partner_external_order',
  [key, section, section, 'telegram', 'Telegram SMS', 1, amount, expected,
    idem, fp, JSON.stringify({ service_id: 'telegram' }), null, null, null],
)
const claim = (orderId, key = prepaidKey) => call('claim_api_partner_external_dispatch', [orderId, key])
const record = (orderId, outcome, source, fulfillmentId, payload, status, reason) => call(
  'record_api_partner_external_outcome', [orderId, outcome, source, fulfillmentId,
    JSON.stringify(payload), status, reason],
)
const count = table => db.query(`SELECT count(*)::integer AS n FROM public.${table}`).then(result => result.rows[0].n)
const balance = partnerId => db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1', [partnerId])
  .then(result => Number(result.rows[0].balance_ngn))
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,wallet_balance numeric NOT NULL DEFAULT 0);
    CREATE TABLE public.api_partners(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,
      contact_email text,is_active boolean NOT NULL DEFAULT true,allowed_sections text[] NOT NULL,
      markup_percent numeric NOT NULL DEFAULT 0,balance_ngn numeric NOT NULL DEFAULT 0,
      unlimited_credit boolean NOT NULL DEFAULT false,owner_reviewed_at timestamptz,
      webhook_url text,webhook_secret text,notes text,created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.api_partner_keys(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_id uuid NOT NULL REFERENCES public.api_partners(id),
      key_name text,key_prefix text,key_hash text UNIQUE,scopes text[] NOT NULL,
      last_used_at timestamptz,revoked_at timestamptz,created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.api_partner_orders(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_id uuid NOT NULL REFERENCES public.api_partners(id),
      partner_reference text,idempotency_key text NOT NULL,item_type text NOT NULL,
      item_id text NOT NULL,item_name text,quantity integer NOT NULL DEFAULT 1,
      amount_ngn numeric NOT NULL DEFAULT 0,currency text NOT NULL DEFAULT 'NGN',
      status text NOT NULL DEFAULT 'pending',customer_email text,customer_phone text,
      request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      fulfillment_source text,fulfillment_id text,error_message text,refunded_at timestamptz,
      refund_amount_ngn numeric,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      UNIQUE(partner_id,idempotency_key)
    );
    INSERT INTO public.profiles(id,wallet_balance) VALUES('${user}',777);
    INSERT INTO public.api_partners(id,name,balance_ngn,unlimited_credit,owner_reviewed_at,allowed_sections)
      VALUES('${prepaid}','Prepaid',100,false,now(),ARRAY['sms','social_boost']),
        ('${unlimited}','Unlimited',0,true,now(),ARRAY['sms']);
    INSERT INTO public.api_partner_keys(id,partner_id,scopes)
      VALUES('${prepaidKey}','${prepaid}',ARRAY['orders:create']),
        ('${unlimitedKey}','${unlimited}',ARRAY['orders:create']);
  `)
  await db.exec(localMigration.split('CREATE FUNCTION public.purchase_api_partner_local_product')[0])
  await db.exec(migration)

  assert.equal((await reserve(prepaidKey, 'insufficient-funds-001', 120)).code, 'INSUFFICIENT_PARTNER_BALANCE')
  assert.equal((await reserve(prepaidKey, 'price-conflict-001', 40, 39)).code, 'PRICE_CHANGED')
  assert.equal(await count('api_partner_orders'), 0)
  assert.equal(await count('api_partner_external_events'), 0)
  assert.equal(await balance(prepaid), 100)

  const first = await reserve(prepaidKey, 'prepaid-accepted-001', 40)
  assert.equal(first.success, true)
  assert.equal(first.dispatch_state, 'prepared')
  assert.equal(await balance(prepaid), 60)
  assert.equal((await reserve(prepaidKey, 'prepaid-accepted-001', 40)).idempotent_replay, true)
  assert.equal((await reserve(prepaidKey, 'prepaid-accepted-001', 40, 40, 'b'.repeat(64))).code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(await balance(prepaid), 60)
  assert.equal(await count('api_partner_external_events'), 1)

  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1', [prepaidKey])
  assert.equal((await claim(first.order_id)).code, 'DISPATCH_AUTHORIZATION_STALE')
  assert.equal((await db.query('SELECT state FROM public.api_partner_external_orders WHERE order_id=$1',[first.order_id])).rows[0].state, 'prepared')
  await db.query('UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=$1', [prepaidKey])
  assert.equal((await claim(first.order_id)).send_allowed, true)
  assert.equal((await claim(first.order_id)).code, 'DISPATCH_ALREADY_CLAIMED')
  assert.equal((await record(first.order_id,'accepted','daisy',null,{},'active',null)).code,'ACCEPTANCE_EVIDENCE_INVALID')
  assert.equal((await record(first.order_id,'accepted','daisy','daisy-123',{ phone_number:'+12345' },'active',null)).success,true)
  assert.equal((await record(first.order_id,'accepted','daisy','daisy-123',{ phone_number:'+12345' },'active',null)).idempotent_replay,true)
  assert.equal((await record(first.order_id,'rejected',null,null,{},'failed','NO_STOCK')).code,'OUTCOME_CONFLICT')
  assert.equal(await count('api_partner_obligations'),1)
  assert.equal(await count('api_partner_external_events'),2)
  assert.equal(await balance(prepaid),60)

  const second = await reserve(prepaidKey,'prepaid-rejected-002',20)
  assert.equal(await balance(prepaid),40)
  assert.equal((await claim(second.order_id)).send_allowed,true)
  await assert.rejects(record(second.order_id,'accepted','daisy','daisy-123',{},'active',null),/unique/)
  assert.equal((await db.query('SELECT state FROM public.api_partner_external_orders WHERE order_id=$1',[second.order_id])).rows[0].state,'sending')
  assert.equal((await record(second.order_id,'rejected',null,null,{},'failed','PROVIDER_TIMEOUT')).code,'REJECTION_NOT_CONFIRMED')
  assert.equal((await record(second.order_id,'rejected',null,null,{},'failed','NO_STOCK')).success,true)
  assert.equal(await balance(prepaid),60)
  assert.equal((await record(second.order_id,'rejected',null,null,{},'failed','NO_STOCK')).idempotent_replay,true)
  assert.equal(await balance(prepaid),60)
  assert.equal(await count('api_partner_obligations'),1)
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='release'",[second.order_id])).rows[0].n,1)

  const third = await reserve(prepaidKey,'prepaid-unknown-003',10)
  assert.equal(await balance(prepaid),50)
  assert.equal((await claim(third.order_id)).send_allowed,true)
  assert.equal((await record(third.order_id,'unknown',null,null,{},'processing',null)).success,true)
  assert.equal((await record(third.order_id,'unknown',null,null,{},'processing',null)).idempotent_replay,true)
  assert.equal((await record(third.order_id,'accepted','daisy','late-123',{},'active',null)).code,'OUTCOME_CONFLICT')
  assert.equal(await balance(prepaid),50)
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.api_partner_external_events WHERE order_id=$1 AND event_type='release'",[third.order_id])).rows[0].n,0)

  const credit = await reserve(unlimitedKey,'unlimited-accepted-004',500)
  assert.equal(credit.success,true)
  assert.equal(await balance(unlimited),0)
  await db.query('UPDATE public.api_partners SET unlimited_credit=false WHERE id=$1',[unlimited])
  assert.equal((await claim(credit.order_id,unlimitedKey)).code,'DISPATCH_AUTHORIZATION_STALE')
  await db.query('UPDATE public.api_partners SET unlimited_credit=true WHERE id=$1',[unlimited])
  assert.equal((await claim(credit.order_id,unlimitedKey)).send_allowed,true)
  assert.equal((await record(credit.order_id,'accepted','daisy','daisy-credit-1',{},'active',null)).success,true)
  const obligation=(await db.query('SELECT funding_type FROM public.api_partner_obligations WHERE order_id=$1',[credit.order_id])).rows[0]
  assert.equal(obligation.funding_type,'unlimited_credit')
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[user])).rows[0].wallet_balance),777)
  await assert.rejects(db.query('UPDATE public.api_partner_external_events SET amount_ngn=1 WHERE order_id=$1',[credit.order_id]),/partner_external_event_is_immutable/)

  await db.query("INSERT INTO public.api_partner_orders(partner_id,idempotency_key,item_type,item_id,quantity,amount_ngn) VALUES($1,'legacy-external-005','sms','telegram',1,5)",[prepaid])
  assert.equal((await reserve(prepaidKey,'legacy-external-005',5)).code,'LEGACY_ORDER_REVIEW_REQUIRED')
  await db.exec('SET ROLE authenticated')
  await assert.rejects(call('reserve_api_partner_external_order',
    [prepaidKey,'sms','sms','telegram','Telegram SMS',1,1,1,'public-forbidden-006',fingerprint,'{}',null,null,null]),/permission denied/)
  await assert.rejects(db.query('SELECT * FROM public.api_partner_external_orders'),/permission denied/)
  await db.exec('RESET ROLE')
  console.log('partner external reserve/claim/settle and financial isolation checks passed')
} finally { await db.close() }
