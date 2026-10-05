import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const admin = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const customer = '10000000-0000-4000-8000-000000000002'
const otherAdmin = '10000000-0000-4000-8000-000000000003'
const partner = '20000000-0000-4000-8000-000000000001'
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean DEFAULT false, account_suspended boolean DEFAULT false,
      wallet_balance numeric NOT NULL DEFAULT 10
    );
    CREATE TABLE public.api_partners (
      id uuid PRIMARY KEY, name text NOT NULL, balance_ngn numeric NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true, allowed_sections text[] NOT NULL DEFAULT '{}',
      markup_percent numeric NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.api_partner_logs (
      partner_id uuid, action text, method text, status_code integer,
      success boolean, metadata jsonb
    );
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005011000_partner_credit_review_gates.sql', import.meta.url), 'utf8'))
  await db.query('INSERT INTO public.profiles(id,is_admin) VALUES ($1,true),($2,false),($3,true)', [admin, customer, otherAdmin])
  await db.query("INSERT INTO public.api_partners(id,name,balance_ngn) VALUES ($1,'Partner',20)", [partner])
  const adjust = (amount, actor = admin) => db.query(
    'SELECT public.adjust_api_partner_balance_atomic($1,$2,$3,$4) AS result',
    [partner, amount, 'reviewed credit', actor],
  )
  await assert.rejects(adjust(1, customer), /partner_adjustment_admin_required/)
  await assert.rejects(adjust(1, otherAdmin), /partner_adjustment_admin_required/)
  await assert.rejects(adjust(-21), /partner_adjustment_negative_balance/)
  const result = await adjust(5)
  assert.equal(Number(result.rows[0].result.balance_ngn), 25)
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.api_partner_logs')).rows[0].count, 1)
  await assert.rejects(db.query('SELECT public.set_api_partner_unlimited_credit($1,true,$2,$3)',
    [partner, customer, 'approved unlimited partner credit']), /partner_credit_admin_required/)
  await assert.rejects(db.query('SELECT public.set_api_partner_unlimited_credit($1,true,$2,$3)',
    [partner, otherAdmin, 'approved unlimited partner credit']), /partner_credit_admin_required/)
  const grant = await db.query('SELECT public.set_api_partner_unlimited_credit($1,true,$2,$3) AS result',
    [partner, admin, 'approved unlimited partner credit'])
  assert.equal(grant.rows[0].result.unlimited_credit, true)
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id = $1', [customer])).rows[0].wallet_balance), 10)
  await db.exec(`
    CREATE TABLE public.api_partner_keys (
      id uuid PRIMARY KEY, partner_id uuid REFERENCES public.api_partners(id),
      revoked_at timestamptz, scopes text[] NOT NULL
    );
    CREATE TABLE public.product_groups (
      id uuid PRIMARY KEY, name text, price numeric, is_active boolean,
      is_sellable boolean, availability_status text, stock_count integer
    );
    CREATE TABLE public.individual_accounts (
      id uuid PRIMARY KEY, product_group_id uuid REFERENCES public.product_groups(id),
      status text, sold_at timestamptz, username text, password text, email text,
      email_password text, two_fa_code text, recovery_email text,
      recovery_email_password text, additional_info text
    );
    CREATE TABLE public.api_partner_orders (
      id uuid PRIMARY KEY, partner_id uuid REFERENCES public.api_partners(id),
      partner_reference text, idempotency_key text NOT NULL,
      item_type text, item_id text, item_name text, quantity integer,
      amount_ngn numeric, status text, request_payload jsonb, response_payload jsonb,
      UNIQUE(partner_id,idempotency_key)
    );
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005012000_partner_local_product_purchase.sql', import.meta.url), 'utf8'))
  const keyId = '30000000-0000-4000-8000-000000000001'
  const productId = '40000000-0000-4000-8000-000000000001'
  await db.query("UPDATE public.api_partners SET allowed_sections=ARRAY['products']::text[], unlimited_credit=false WHERE id=$1", [partner])
  await db.query("INSERT INTO public.api_partner_keys(id,partner_id,scopes) VALUES($1,$2,ARRAY['orders:create']::text[])", [keyId,partner])
  await db.query("INSERT INTO public.product_groups(id,name,price,is_active,is_sellable,availability_status,stock_count) VALUES($1,'Test',10,true,true,'AVAILABLE',3)", [productId])
  for (let i=1; i<=3; i++) await db.query(
    "INSERT INTO public.individual_accounts(id,product_group_id,status,username,password) VALUES($1,$2,'available',$3,'secret')",
    [`50000000-0000-4000-8000-${String(i).padStart(12,'0')}`,productId,`account${i}`],
  )
  await db.query(`INSERT INTO public.api_partner_orders(id,partner_id,idempotency_key,item_type,
    item_id,quantity,amount_ngn,status) VALUES($1,$2,'legacy-order-000','product',$3,1,10,'completed')`,
    ['60000000-0000-4000-8000-000000000001',partner,productId])
  const buy = (quantity, expected, idempotency) => db.query(
    'SELECT public.purchase_api_partner_local_product($1,$2,$3,$4,$5,$6) AS result',
    [keyId,productId,quantity,expected,idempotency,null],
  ).then((result) => result.rows[0].result)
  assert.equal((await buy(1,10,'legacy-order-000')).code,'LEGACY_ORDER_REVIEW_REQUIRED')
  const first = await buy(2,20,'first-purchase-001')
  assert.equal(first.success, true)
  assert.equal(first.data.response_payload.accounts.length, 2)
  assert.equal((await buy(2,20,'first-purchase-001')).idempotency_hit, true)
  assert.equal((await buy(1,10,'first-purchase-001')).code, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await buy(1,10,'second-purchase-002')).code, 'INSUFFICIENT_PARTNER_BALANCE')
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1',[partner])).rows[0].balance_ngn),5)
  await db.query('UPDATE public.api_partners SET unlimited_credit=true WHERE id=$1',[partner])
  assert.equal((await buy(1,10,'second-purchase-002')).success,true)
  assert.equal((await buy(1,10,'third-purchase-003')).code,'PRODUCT_UNAVAILABLE')
  const obligations = (await db.query('SELECT funding_type FROM public.api_partner_obligations ORDER BY created_at')).rows
  assert.deepEqual(obligations.map((item) => item.funding_type).sort(),['prepaid','unlimited_credit'])
  await assert.rejects(db.query("UPDATE public.api_partner_obligations SET amount_ngn=1 WHERE partner_id=$1",[partner]),
    /partner_obligation_is_immutable/)
  assert.equal(Number((await db.query('SELECT balance_ngn FROM public.api_partners WHERE id=$1',[partner])).rows[0].balance_ngn),5)
  await db.query('UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=$1',[keyId])
  assert.equal((await buy(1,10,'fourth-purchase-004')).code,'INVALID_KEY')
  assert.equal(Number((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[customer])).rows[0].wallet_balance),10)
  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT public.purchase_api_partner_local_product($1,$2,$3,$4,$5,$6)',
    [keyId,productId,1,10,'public-call-005',null]), /permission denied/)
  await db.exec('RESET ROLE')
  console.log('partner credit SQL checks passed')
} finally { await db.close() }
