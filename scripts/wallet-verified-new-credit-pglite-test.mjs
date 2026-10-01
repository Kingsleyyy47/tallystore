import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261001007000_freeze_legacy_allowance_require_verified_new_credits.sql', import.meta.url), 'utf8')
const reviewedMigration = readFileSync(new URL('../supabase/migrations/20261001008000_review_owner_confirmed_legacy_wallet_allowance.sql', import.meta.url), 'utf8')
const existing = '11111111-1111-4111-8111-111111111111'
const exhausted = '22222222-2222-4222-8222-222222222222'
const newcomer = '33333333-3333-4333-8333-333333333333'
const owner = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const reviewed = '54299aee-1e4a-4e02-b335-94eea91ede70'

async function truth(id) {
  const { rows } = await db.query('SELECT public.wallet_financial_truth_internal($1::uuid) AS value', [id])
  return rows[0].value
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, wallet_balance numeric NOT NULL DEFAULT 0,
      wallet_review_required boolean NOT NULL DEFAULT false,
      wallet_reviewed_by uuid, email text, is_admin boolean NOT NULL DEFAULT false,
      is_staff boolean NOT NULL DEFAULT false,
      account_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.transactions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL
    );
    CREATE TABLE public.wallet_reservations (user_id uuid);
    CREATE TABLE public.wallet_test_facts (
      user_id uuid PRIMARY KEY, gateway numeric NOT NULL DEFAULT 0,
      debits numeric NOT NULL DEFAULT 0, refunds numeric NOT NULL DEFAULT 0,
      reservations numeric NOT NULL DEFAULT 0
    );
    CREATE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE
      v_truth jsonb;
      v_legacy_customer boolean := true;
      v_has_recorded_funding boolean := true;
      v_manual_review boolean := false;
      v_policy_available numeric := 0;
    BEGIN
      SELECT jsonb_build_object(
        'stored_wallet_balance', p.wallet_balance,
        'verified_gateway_deposits', f.gateway,
        'completed_debits', f.debits,
        'eligible_refunds', f.refunds,
        'active_reservations', f.reservations,
        'trusted_available_before_holds', p.wallet_balance,
        'confirmed_spendable', GREATEST(p.wallet_balance - f.reservations, 0),
        'account_suspended', false,
        'spending_blocked', false,
        'evidence_complete', true,
        'duplicate_payment_identities', 0
      ) INTO v_truth
      FROM public.profiles p JOIN public.wallet_test_facts f ON f.user_id = p.id
      WHERE p.id = p_user_id;
      IF v_truth IS NULL THEN RAISE EXCEPTION 'wallet_financial_truth_profile_not_found'; END IF;
      -- legacy_purchase_policy_20260928: do not auto-hold established customers
      SELECT COALESCE(p.wallet_review_required, false)
        AND p.wallet_reviewed_by IS NOT NULL INTO v_manual_review
      FROM public.profiles p WHERE p.id = p_user_id;
      v_policy_available := (v_truth->>'stored_wallet_balance')::numeric;
      v_truth := v_truth || jsonb_build_object(
        'trusted_available_before_holds', v_policy_available,
        'confirmed_spendable', GREATEST(v_policy_available -
          (v_truth->>'active_reservations')::numeric, 0)
      );
      -- Automatic fraud flags are not customer holds.
      v_truth := v_truth || jsonb_build_object(
        'spending_blocked', (v_truth->>'account_suspended')::boolean OR v_manual_review
      );
      RETURN v_truth;
    END;
    $$;
    CREATE FUNCTION public.apply_wallet_transaction(
      p_user_id uuid, p_type text, p_amount numeric, p_reference text,
      p_description text, p_idempotency_key text, p_metadata jsonb,
      p_currency text, p_balance_type text, p_external_payment_id text,
      p_created_by uuid
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE
      v_type text := lower(p_type);
      v_balance_type text := p_balance_type;
    BEGIN
      IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN
        RETURN jsonb_build_object('success', true);
      END IF;
      RETURN jsonb_build_object('success', true);
    END;
    $$;
    CREATE FUNCTION public.guard_historical_wallet_evidence_immutable()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Historical wallet evidence is append-only';
    END;
    $$;
    INSERT INTO public.profiles (id, wallet_balance) VALUES
      ('${existing}', 100), ('${exhausted}', 0);
    INSERT INTO public.profiles (id, wallet_balance, email) VALUES
      ('${reviewed}', 57268, 'tallystoreorg@gmail.com');
    INSERT INTO public.profiles (id, is_admin, email) VALUES
      ('${owner}', true, 'wisdomthedev@gmail.com');
    INSERT INTO public.wallet_test_facts (user_id, gateway, debits) VALUES
      ('${existing}', 0, 0), ('${exhausted}', 0, 500),
      ('${reviewed}', 0, 1614622);
    INSERT INTO public.transactions (id, user_id) VALUES
      ('44444444-4444-4444-8444-444444444444', '${exhausted}');
  `)

  await db.exec('BEGIN')
  await db.exec(migration)
  await db.exec('COMMIT')
  assert.equal(Number((await truth(existing)).confirmed_spendable), 100)
  assert.equal(Number((await truth(exhausted)).confirmed_spendable), 0)
  const { rows: snapshotRows } = await db.query('SELECT count(*)::integer AS count FROM public.wallet_legacy_spend_allowance_snapshot')
  assert.equal(snapshotRows[0].count, 3)

  // A direct, unverified balance increase never raises the available amount.
  await db.exec(`UPDATE public.profiles SET wallet_balance = 150 WHERE id = '${existing}'`)
  assert.equal(Number((await truth(existing)).confirmed_spendable), 100)

  // A verified provider credit increases only the authorized portion.
  await db.exec(`UPDATE public.wallet_test_facts SET gateway = 50 WHERE user_id = '${existing}'`)
  assert.equal(Number((await truth(existing)).confirmed_spendable), 150)
  await db.exec(`UPDATE public.wallet_test_facts SET debits = 30 WHERE user_id = '${existing}'`)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 120 WHERE id = '${existing}'`)
  assert.equal(Number((await truth(existing)).confirmed_spendable), 120)
  await db.exec(`UPDATE public.wallet_test_facts SET refunds = 20 WHERE user_id = '${existing}'`)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 140 WHERE id = '${existing}'`)
  assert.equal(Number((await truth(existing)).confirmed_spendable), 140)

  // Earlier unverified spending does not consume a later verified payment.
  await db.exec(`UPDATE public.wallet_test_facts SET gateway = 50, debits = 530 WHERE user_id = '${exhausted}'`)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 20 WHERE id = '${exhausted}'`)
  assert.equal(Number((await truth(exhausted)).confirmed_spendable), 20)

  // New users have no legacy allowance. Other balance additions stay unusable.
  await db.exec(`INSERT INTO public.profiles (id, wallet_balance) VALUES ('${newcomer}', 100)`)
  await db.exec(`INSERT INTO public.wallet_test_facts (user_id, gateway) VALUES ('${newcomer}', 0)`)
  assert.equal(Number((await truth(newcomer)).confirmed_spendable), 0)
  await db.exec(`UPDATE public.wallet_test_facts SET gateway = 30 WHERE user_id = '${newcomer}'`)
  assert.equal(Number((await truth(newcomer)).confirmed_spendable), 30)

  const { rows: denied } = await db.query(`
    SELECT public.apply_wallet_transaction($1::uuid, 'admin_credit', 100,
      null, null, null, '{}'::jsonb, 'NGN', 'wallet', null, null) AS result
  `, [existing])
  assert.equal(denied[0].result.code, 'VERIFIED_GATEWAY_REQUIRED')

  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${existing}', false)`)
  const { rows: visible } = await db.query('SELECT public.get_my_wallet_available() AS amount')
  assert.equal(Number(visible[0].amount), 140)
  await db.exec(`UPDATE public.profiles SET wallet_review_required = true, wallet_reviewed_by = '${newcomer}' WHERE id = '${existing}'`)
  const { rows: held } = await db.query('SELECT public.get_my_wallet_available() AS amount')
  assert.equal(Number(held[0].amount), 0)

  // Only the owner-confirmed balance already present at the snapshot is
  // released. Later unverified increases remain unavailable.
  await db.exec(`UPDATE public.wallet_legacy_spend_allowance_snapshot
    SET baseline_available = 0 WHERE user_id = '${reviewed}'`)
  assert.equal(Number((await truth(reviewed)).confirmed_spendable), 0)
  await db.exec('BEGIN')
  await db.exec(reviewedMigration)
  await db.exec('COMMIT')
  assert.equal(Number((await truth(reviewed)).confirmed_spendable), 57268)
  const { rows: approvals } = await db.query('SELECT count(*)::integer AS count FROM public.wallet_legacy_spend_approvals')
  assert.equal(approvals[0].count, 1)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 57368 WHERE id = '${reviewed}'`)
  assert.equal(Number((await truth(reviewed)).confirmed_spendable), 57268)
  await db.exec(`UPDATE public.wallet_test_facts SET debits = 1615622 WHERE user_id = '${reviewed}'`)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 56368 WHERE id = '${reviewed}'`)
  assert.equal(Number((await truth(reviewed)).confirmed_spendable), 56268)
  await db.exec(`UPDATE public.wallet_test_facts SET gateway = 500 WHERE user_id = '${reviewed}'`)
  await db.exec(`UPDATE public.profiles SET wallet_balance = 56868 WHERE id = '${reviewed}'`)
  assert.equal(Number((await truth(reviewed)).confirmed_spendable), 56768)
  await assert.rejects(
    db.exec('UPDATE public.wallet_legacy_spend_approvals SET evidence_note = evidence_note'),
    /append-only/,
  )

  console.log('Verified new-credit policy and owner-reviewed legacy allowance: snapshot, unverified increase, provider increase, debit, refund, later payment, new account, engine denial, manual hold, capped historical release, and immutable audit passed')
} finally {
  await db.close()
}
