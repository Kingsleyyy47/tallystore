import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const otherAdmin = '10000000-0000-4000-8000-000000000003'
const legacy = '20000000-0000-4000-8000-000000000001'
const keyHash = 'a'.repeat(64)
const secret = `tly_whsec_${'b'.repeat(64)}`
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_admin boolean, account_suspended boolean);
    CREATE TABLE public.api_partners (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      contact_email text, is_active boolean DEFAULT true, allowed_sections text[],
      markup_percent numeric DEFAULT 0, balance_ngn numeric DEFAULT 0,
      unlimited_credit boolean DEFAULT false, credit_granted_by uuid,
      credit_granted_at timestamptz, webhook_url text, webhook_secret text,
      notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.api_partner_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid REFERENCES public.api_partners(id),
      key_name text, key_prefix text, key_hash text UNIQUE, scopes text[],
      revoked_at timestamptz, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.api_partner_logs (
      partner_id uuid, key_id uuid, action text, method text, status_code integer,
      success boolean, metadata jsonb
    );
    CREATE TABLE public.api_partner_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005015000_partner_owner_admin_actions.sql', import.meta.url), 'utf8'))
  await db.query('INSERT INTO public.profiles(id,is_admin) VALUES ($1,true),($2,true)', [owner, otherAdmin])
  await db.query("INSERT INTO public.api_partners(id,name,is_active) VALUES ($1,'Legacy',false)", [legacy])
  const create = (actor, unlimited, reason = null) => db.query(
    'SELECT public.create_api_partner_owner($1,$2,$3,$4,$5,$6) AS result',
    ['Reviewed', 'https://example.com/webhook', ['products','sms','social_boost'], unlimited, reason, actor],
  ).then(result => result.rows[0].result)
  await assert.rejects(create(otherAdmin, false), /partner_owner_required/)
  await assert.rejects(create(owner, true, 'short'), /partner_credit_decision_requires_reason/)
  const prepaid = await create(owner, false)
  assert.equal(prepaid.unlimited_credit, false)
  assert.ok(prepaid.owner_reviewed_at)
  const unlimited = await create(owner, true, 'approved trusted reseller')
  assert.equal(unlimited.unlimited_credit, true)
  assert.equal((await db.query('SELECT credit_granted_by FROM public.api_partners WHERE id=$1', [unlimited.id])).rows[0].credit_granted_by, owner)
  const generate = (partnerId, actor = owner) => db.query(
    'SELECT public.create_api_partner_key_owner($1,$2,$3,$4,$5,$6,$7) AS result',
    [partnerId, 'Website key', 'tly_live_abcdef0', keyHash, ['catalogue:read','orders:create'], secret, actor],
  ).then(result => result.rows[0].result)
  await assert.rejects(generate(legacy), /partner_not_owner_reviewed/)
  await assert.rejects(generate(prepaid.id, otherAdmin), /partner_owner_required/)
  const key = await generate(prepaid.id)
  assert.equal(key.key_prefix, 'tly_live_abcdef0')
  assert.equal((await db.query('SELECT webhook_secret FROM public.api_partners WHERE id=$1', [prepaid.id])).rows[0].webhook_secret, secret)
  await assert.rejects(db.query('SELECT public.revoke_api_partner_key_owner($1,$2)', [key.id, otherAdmin]), /partner_owner_required/)
  const revoked = await db.query('SELECT public.revoke_api_partner_key_owner($1,$2) AS result', [key.id, owner])
  assert.ok(revoked.rows[0].result.revoked_at)
  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT public.revoke_api_partner_key_owner($1,$2)', [key.id, owner]), /permission denied/)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.api_partner_logs')).rows[0].count, 4)
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_partners,
      public.api_partner_keys, public.api_partner_orders,
      public.api_partner_logs TO authenticated;
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005016000_partner_table_lockdown.sql', import.meta.url), 'utf8'))
  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT id FROM public.api_partners LIMIT 1'), /permission denied/)
  await assert.rejects(db.query("INSERT INTO public.api_partners(name) VALUES ('Bypass')"), /permission denied/)
  await db.exec('RESET ROLE')
  console.log('partner owner admin SQL checks passed')
} finally { await db.close() }
