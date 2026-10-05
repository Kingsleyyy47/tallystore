import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261005032000_referral_attribution_funding_boundary.sql', import.meta.url), 'utf8')
const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`
const code = (n) => `CODE${n}`
async function refer(target, referrer) {
  const referralCode = referrer === null ? null
    : (await db.query('SELECT referral_code FROM public.profiles WHERE id=$1',[id(referrer)])).rows[0].referral_code
  return (await db.query('SELECT public.apply_profile_referral_attribution($1::uuid,$2::text) AS result',
    [id(target), referralCode])).rows[0].result
}
async function referredBy(n) {
  return (await db.query('SELECT referred_by FROM public.profiles WHERE id=$1',[id(n)])).rows[0].referred_by
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,referral_code text UNIQUE,referred_by text,
      is_staff boolean DEFAULT false,is_admin boolean DEFAULT false,
      account_suspended boolean DEFAULT false,wallet_balance numeric DEFAULT 0,
      updated_at timestamptz DEFAULT now());
    CREATE TABLE public.trusted_funding_fixture(user_id uuid PRIMARY KEY,payment_rows integer DEFAULT 0,
      admin_rows integer DEFAULT 0,principal numeric DEFAULT 0,legacy_funding_at timestamptz);
    CREATE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'verified_payment_rows',COALESCE((SELECT payment_rows FROM public.trusted_funding_fixture WHERE user_id=p_user_id),0),
        'approved_admin_rows',COALESCE((SELECT admin_rows FROM public.trusted_funding_fixture WHERE user_id=p_user_id),0),
        'trusted_principal',COALESCE((SELECT principal FROM public.trusted_funding_fixture WHERE user_id=p_user_id),0),
        'legacy_first_recorded_funding_at',(SELECT legacy_funding_at FROM public.trusted_funding_fixture WHERE user_id=p_user_id)) $$;
  `)
  for (let n=1;n<=9;n++) await db.query('INSERT INTO public.profiles(id,referral_code) VALUES($1,$2)',[id(n),code(n)])
  await db.exec(migration)

  const first = await refer(2,1)
  assert.equal(first.attribution_status,'attributed','unfunded signup/onboarding may attribute')
  assert.equal(await referredBy(2),id(1))
  await db.query('INSERT INTO public.trusted_funding_fixture(user_id,payment_rows,principal) VALUES($1,1,1000)',[id(2)])
  const replay = await refer(2,3)
  assert.equal(replay.attribution_status,'already_attributed','funded existing referral is retained')
  assert.equal(await referredBy(2),id(1),'existing attribution never switches')

  await db.query('INSERT INTO public.trusted_funding_fixture(user_id,payment_rows,principal) VALUES($1,1,1000)',[id(3)])
  assert.equal((await refer(3,1)).attribution_status,'funded_before_referral')
  assert.equal(await referredBy(3),null,'funding-first user cannot attach referral')
  await db.query('UPDATE public.trusted_funding_fixture SET principal=0 WHERE user_id=$1',[id(3)])
  assert.equal((await refer(3,1)).attribution_status,'funded_before_referral',
    'spent current balance cannot erase verified funding history')

  await db.query('INSERT INTO public.trusted_funding_fixture(user_id,legacy_funding_at) VALUES($1,now())',[id(4)])
  assert.equal((await refer(4,1)).attribution_status,'funded_before_referral',
    'legacy funding history is authoritative even with zero current principal')
  await db.query('INSERT INTO public.trusted_funding_fixture(user_id,admin_rows) VALUES($1,1)',[id(5)])
  assert.equal((await refer(5,1)).attribution_status,'funded_before_referral',
    'approved admin funding blocks retroactive attribution')
  await db.query('UPDATE public.profiles SET wallet_balance=9000 WHERE id=$1',[id(6)])
  assert.equal((await refer(6,1)).attribution_status,'attributed',
    'client/stored profile balance does not decide trusted funding')

  await db.query('UPDATE public.profiles SET referred_by=upper(referred_by) WHERE id=$1',[id(2)])
  assert.equal((await refer(1,2)).attribution_status,'referral_cycle_denied',
    'indirect A-to-B-to-A cycle denied')
  assert.equal(await referredBy(1),null)
  assert.equal((await refer(7,7)).attribution_status,'no_referrer','self referral denied')
  await db.query('UPDATE public.profiles SET is_staff=true WHERE id=$1',[id(7)])
  assert.equal((await refer(7,1)).attribution_status,'customer_not_eligible')
  await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1',[id(8)])
  assert.equal((await refer(8,1)).attribution_status,'customer_not_eligible')
  await db.query('UPDATE public.profiles SET is_admin=true WHERE id=$1',[id(9)])
  assert.equal((await refer(9,1)).attribution_status,'customer_not_eligible')

  await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(refer(3,1),/service_role_required/)
} finally { await db.close() }

console.log('Referral attribution boundary: unfunded onboarding, funded-first/spent/legacy/admin denial, existing links, self/cycle, roles, and service-only guard passed. PGlite serializes requests; source rollback verifies the deployed engine separately.')
