-- Make profile balances database-authoritative.
--
-- Application code must call public.apply_wallet_transaction(). Direct writes to
-- profiles.wallet_balance/crypto_balance/referral_balance are neutralized by the
-- guard trigger unless the wallet engine has explicitly authorized the write for
-- the current database transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS balance_before numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS external_payment_id text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS balance_type text NOT NULL DEFAULT 'wallet',
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS transaction_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_unique
  ON public.transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS transactions_user_balance_chain_idx
  ON public.transactions (user_id, balance_type, created_at DESC, id DESC);

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_balance_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_balance_type_check
  CHECK (balance_type IN ('wallet', 'crypto', 'referral'));

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_user_id uuid,
  p_type text,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_currency text DEFAULT 'NGN',
  p_balance_type text DEFAULT 'wallet',
  p_external_payment_id text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_type text := lower(trim(COALESCE(p_type, '')));
  v_balance_type text := lower(trim(COALESCE(p_balance_type, 'wallet')));
  v_amount numeric := COALESCE(p_amount, 0);
  v_signed_amount numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_idempotency_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_reference text := NULLIF(trim(COALESCE(p_reference, '')), '');
  v_currency text := upper(COALESCE(NULLIF(trim(p_currency), ''), 'NGN'));
  v_external_payment_id text := NULLIF(trim(COALESCE(p_external_payment_id, '')), '');
  v_existing public.transactions%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_previous_hash text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet_transaction_user_required';
  END IF;

  IF v_type = '' THEN
    RAISE EXCEPTION 'wallet_transaction_type_required';
  END IF;

  IF v_amount::text = 'NaN' THEN
    RAISE EXCEPTION 'wallet_transaction_amount_invalid';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'wallet_transaction_amount_must_be_positive';
  END IF;

  IF v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'wallet_transaction_amount_precision_invalid';
  END IF;

  IF v_amount > 1000000000 THEN
    RAISE EXCEPTION 'wallet_transaction_amount_too_large';
  END IF;

  IF v_currency !~ '^[A-Z]{3,8}$' THEN
    RAISE EXCEPTION 'wallet_transaction_invalid_currency';
  END IF;

  IF v_balance_type NOT IN ('wallet', 'crypto', 'referral') THEN
    RAISE EXCEPTION 'wallet_transaction_invalid_balance_type';
  END IF;

  IF v_type IN (
    'topup',
    'top_up',
    'top-up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
    'credit',
    'admin_credit',
    'staff_credit',
    'refund',
    'purchase_refund',
    'auto_refund',
    'referral_withdrawal',
    'referral_credit',
    'promotion_credit',
    'correction_credit'
  ) THEN
    v_signed_amount := v_amount;
  ELSIF v_type IN (
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'chargeback',
    'withdrawal',
    'correction_debit'
  ) THEN
    v_signed_amount := -v_amount;
  ELSE
    RAISE EXCEPTION 'wallet_transaction_unsupported_type: %', v_type;
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT *
      INTO v_existing
    FROM public.transactions
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.user_id IS DISTINCT FROM p_user_id
        OR lower(trim(COALESCE(v_existing.type, ''))) IS DISTINCT FROM v_type
        OR COALESCE(v_existing.balance_type, 'wallet') IS DISTINCT FROM v_balance_type
        OR COALESCE(v_existing.amount, 0) IS DISTINCT FROM v_signed_amount
        OR NULLIF(trim(COALESCE(v_existing.reference, '')), '') IS DISTINCT FROM v_reference
        OR upper(COALESCE(NULLIF(trim(v_existing.currency), ''), 'NGN')) IS DISTINCT FROM v_currency
        OR NULLIF(trim(COALESCE(v_existing.external_payment_id, '')), '') IS DISTINCT FROM v_external_payment_id
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'idempotent_replay', false,
          'error', 'idempotency_key_reused_with_different_transaction',
          'code', 'IDEMPOTENCY_CONFLICT',
          'existing_transaction_id', v_existing.id
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'transaction', to_jsonb(v_existing),
        'balance_before', v_existing.balance_before,
        'balance_after', v_existing.balance_after
      );
    END IF;
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_transaction_profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_staff, false) OR COALESCE(v_profile.is_admin, false) THEN
    RAISE EXCEPTION 'wallet_transaction_customer_only';
  END IF;

  IF v_balance_type = 'crypto' THEN
    v_current_balance := COALESCE(v_profile.crypto_balance, 0);
  ELSIF v_balance_type = 'referral' THEN
    v_current_balance := COALESCE(v_profile.referral_balance, 0);
  ELSE
    v_current_balance := COALESCE(v_profile.wallet_balance, 0);
  END IF;

  v_new_balance := v_current_balance + v_signed_amount;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  SELECT transaction_hash
    INTO v_previous_hash
  FROM public.transactions
  WHERE user_id = p_user_id
    AND balance_type = v_balance_type
    AND transaction_hash IS NOT NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);

  INSERT INTO public.transactions (
    user_id,
    type,
    amount,
    status,
    balance_before,
    balance_after,
    currency,
    reference,
    description,
    idempotency_key,
    external_payment_id,
    created_by,
    metadata,
    balance_type,
    previous_hash
  )
  VALUES (
    p_user_id,
    v_type,
    v_signed_amount,
    'completed',
    v_current_balance,
    v_new_balance,
    v_currency,
    v_reference,
    p_description,
    v_idempotency_key,
    v_external_payment_id,
    COALESCE(p_created_by, auth.uid()),
    COALESCE(p_metadata, '{}'::jsonb),
    v_balance_type,
    v_previous_hash
  )
  RETURNING *
  INTO v_transaction;

  IF v_balance_type = 'crypto' THEN
    UPDATE public.profiles
       SET crypto_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  ELSIF v_balance_type = 'referral' THEN
    UPDATE public.profiles
       SET referral_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET wallet_balance = v_new_balance,
           updated_at = now()
     WHERE id = p_user_id;
  END IF;

  UPDATE public.transactions
     SET transaction_hash = encode(
       digest(
         concat_ws(
           '|',
           COALESCE(v_previous_hash, ''),
           v_transaction.id::text,
           p_user_id::text,
           v_type,
           v_signed_amount::text,
           v_current_balance::text,
           v_new_balance::text,
           COALESCE(v_reference, ''),
           v_transaction.created_at::text,
           v_balance_type
         ),
         'sha256'
       ),
       'hex'
     )
   WHERE id = v_transaction.id
   RETURNING *
   INTO v_transaction;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'transaction', to_jsonb(v_transaction),
    'balance_before', v_current_balance,
    'balance_after', v_new_balance
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT *
        INTO v_existing
      FROM public.transactions
      WHERE idempotency_key = v_idempotency_key
      LIMIT 1;

      IF FOUND THEN
        IF v_existing.user_id IS DISTINCT FROM p_user_id
          OR lower(trim(COALESCE(v_existing.type, ''))) IS DISTINCT FROM v_type
          OR COALESCE(v_existing.balance_type, 'wallet') IS DISTINCT FROM v_balance_type
          OR COALESCE(v_existing.amount, 0) IS DISTINCT FROM v_signed_amount
          OR NULLIF(trim(COALESCE(v_existing.reference, '')), '') IS DISTINCT FROM v_reference
          OR upper(COALESCE(NULLIF(trim(v_existing.currency), ''), 'NGN')) IS DISTINCT FROM v_currency
          OR NULLIF(trim(COALESCE(v_existing.external_payment_id, '')), '') IS DISTINCT FROM v_external_payment_id
        THEN
          PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
          RETURN jsonb_build_object(
            'success', false,
            'idempotent_replay', false,
            'error', 'idempotency_key_reused_with_different_transaction',
            'code', 'IDEMPOTENCY_CONFLICT',
            'existing_transaction_id', v_existing.id
          );
        END IF;

        PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
        RETURN jsonb_build_object(
          'success', true,
          'idempotent_replay', true,
          'transaction', to_jsonb(v_existing),
          'balance_before', v_existing.balance_before,
          'balance_after', v_existing.balance_after
        );
      END IF;
    END IF;
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    RAISE;
  WHEN OTHERS THEN
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_wallet_transaction(
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  uuid
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_referral_balance_to_wallet(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_amount numeric;
  v_key text;
  v_debit jsonb;
  v_credit jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'referral_withdrawal_user_required';
  END IF;

  SELECT id, referral_balance, is_staff, is_admin
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral_withdrawal_profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_staff, false) OR COALESCE(v_profile.is_admin, false) THEN
    RAISE EXCEPTION 'referral_withdrawal_customer_only';
  END IF;

  v_amount := COALESCE(v_profile.referral_balance, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'referral_withdrawal_empty_balance';
  END IF;

  v_key := 'referral-withdrawal:' || p_user_id::text || ':' || extract(epoch from clock_timestamp())::text;

  v_debit := public.apply_wallet_transaction(
    p_user_id,
    'withdrawal',
    v_amount,
    'REF-OUT-' || substring(v_key from 21 for 18),
    'Referral earnings moved out of referral balance',
    v_key || ':debit',
    jsonb_build_object('source', 'withdraw_referral_balance_to_wallet'),
    'NGN',
    'referral',
    NULL,
    auth.uid()
  );

  v_credit := public.apply_wallet_transaction(
    p_user_id,
    'referral_withdrawal',
    v_amount,
    'REF-IN-' || substring(v_key from 21 for 18),
    'Referral earnings moved to wallet balance',
    v_key || ':credit',
    jsonb_build_object('source', 'withdraw_referral_balance_to_wallet'),
    'NGN',
    'wallet',
    NULL,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_amount,
    'referral_transaction', v_debit->'transaction',
    'wallet_transaction', v_credit->'transaction',
    'wallet_balance_after', v_credit->>'balance_after'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_referral_balance_to_wallet(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_referral_balance_to_wallet(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_profile_balance_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');
  database_role text := current_user;
  balance_changed boolean;
  is_authorized_wallet_engine boolean;
  block_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.wallet_balance := 0;
    NEW.crypto_balance := 0;
    NEW.referral_balance := 0;
    RETURN NEW;
  END IF;

  balance_changed :=
    COALESCE(OLD.wallet_balance, 0) IS DISTINCT FROM COALESCE(NEW.wallet_balance, 0)
    OR COALESCE(OLD.crypto_balance, 0) IS DISTINCT FROM COALESCE(NEW.crypto_balance, 0)
    OR COALESCE(OLD.referral_balance, 0) IS DISTINCT FROM COALESCE(NEW.referral_balance, 0);

  IF NOT balance_changed THEN
    RETURN NEW;
  END IF;

  is_authorized_wallet_engine :=
    current_setting('app.tally_wallet_engine_authorized', true) = 'true';

  IF NOT is_authorized_wallet_engine THEN
    block_reason := CASE
      WHEN database_role = 'postgres' THEN 'Blocked direct Supabase SQL/Table Editor balance edit. Use TallyStore Admin balance adjustment.'
      WHEN request_role = 'service_role' THEN 'Blocked direct service-role balance edit. Use apply_wallet_transaction().'
      WHEN request_role IN ('anon', 'authenticated') THEN 'Blocked browser-authenticated balance edit. Balances are wallet-engine authoritative.'
      ELSE format('Blocked unapproved balance edit from database role %s and request role %s.', database_role, COALESCE(NULLIF(request_role, ''), 'none'))
    END;

    INSERT INTO public.profile_balance_blocked_attempts (
      profile_id,
      email,
      attempted_by,
      attempted_role,
      database_role,
      reason,
      old_wallet_balance,
      attempted_wallet_balance,
      old_crypto_balance,
      attempted_crypto_balance,
      old_referral_balance,
      attempted_referral_balance,
      row_snapshot_old,
      row_snapshot_attempted
    )
    VALUES (
      OLD.id,
      OLD.email,
      auth.uid(),
      NULLIF(request_role, ''),
      database_role,
      block_reason,
      OLD.wallet_balance,
      NEW.wallet_balance,
      OLD.crypto_balance,
      NEW.crypto_balance,
      OLD.referral_balance,
      NEW.referral_balance,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );

    NEW.wallet_balance := OLD.wallet_balance;
    NEW.crypto_balance := OLD.crypto_balance;
    NEW.referral_balance := OLD.referral_balance;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_balance_authority() FROM public, anon, authenticated;
