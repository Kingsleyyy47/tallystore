-- NOWPayments funding only becomes trusted principal after a new server-created
-- quote and a provider-verified finished payment are bound atomically to one
-- canonical wallet transaction. Existing crypto receipts are not eligible.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.nowpayments_wallet_launch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO private.nowpayments_wallet_launch(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS private.nowpayments_wallet_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crypto_transaction_id uuid NOT NULL UNIQUE REFERENCES public.crypto_transactions(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  payment_id text NOT NULL UNIQUE,
  order_reference text NOT NULL UNIQUE,
  amount_ngn numeric NOT NULL CHECK (amount_ngn > 0 AND amount_ngn <= 1000000000
    AND amount_ngn = round(amount_ngn, 2) AND amount_ngn::text NOT IN ('NaN','Infinity','-Infinity')),
  pay_amount numeric NOT NULL CHECK (pay_amount > 0 AND pay_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  pay_currency text NOT NULL,
  pay_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS private.nowpayments_wallet_proofs (
  quote_id uuid PRIMARY KEY REFERENCES private.nowpayments_wallet_quotes(id),
  payment_id text NOT NULL UNIQUE,
  actual_paid numeric NOT NULL CHECK (actual_paid > 0),
  provider_status text NOT NULL CHECK (provider_status = 'finished'),
  signature_hash text NOT NULL CHECK (signature_hash ~ '^[0-9a-f]{64}$'),
  verification_hash text NOT NULL CHECK (verification_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS private.nowpayments_wallet_revocations (
  quote_id uuid PRIMARY KEY REFERENCES private.nowpayments_wallet_quotes(id),
  payment_id text NOT NULL UNIQUE,
  provider_status text NOT NULL CHECK (provider_status = 'refunded'),
  signature_hash text NOT NULL CHECK (signature_hash ~ '^[0-9a-f]{64}$'),
  verification_hash text NOT NULL CHECK (verification_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON private.nowpayments_wallet_launch,
  private.nowpayments_wallet_quotes, private.nowpayments_wallet_proofs,
  private.nowpayments_wallet_revocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.nowpayments_wallet_quotes,
  private.nowpayments_wallet_proofs,
  private.nowpayments_wallet_revocations TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_nowpayments_quote_one_credit
ON public.transactions ((metadata->>'crypto_quote_id'))
WHERE lower(COALESCE(metadata->>'provider', '')) = 'nowpayments'
  AND COALESCE(metadata->>'crypto_quote_id', '') <> ''
  AND lower(COALESCE(type, '')) IN ('topup','top_up','top-up','wallet_topup','wallet_deposit','deposit')
  AND COALESCE(balance_type, 'wallet') = 'wallet';

CREATE OR REPLACE FUNCTION private.reject_nowpayments_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'nowpayments_evidence_immutable';
END;
$$;
DROP TRIGGER IF EXISTS nowpayments_quote_immutable ON private.nowpayments_wallet_quotes;
CREATE TRIGGER nowpayments_quote_immutable BEFORE UPDATE OR DELETE ON private.nowpayments_wallet_quotes
FOR EACH ROW EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();
CREATE TRIGGER nowpayments_quote_no_truncate BEFORE TRUNCATE ON private.nowpayments_wallet_quotes
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();
DROP TRIGGER IF EXISTS nowpayments_proof_immutable ON private.nowpayments_wallet_proofs;
CREATE TRIGGER nowpayments_proof_immutable BEFORE UPDATE OR DELETE ON private.nowpayments_wallet_proofs
FOR EACH ROW EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();
CREATE TRIGGER nowpayments_proof_no_truncate BEFORE TRUNCATE ON private.nowpayments_wallet_proofs
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();
DROP TRIGGER IF EXISTS nowpayments_revocation_immutable ON private.nowpayments_wallet_revocations;
CREATE TRIGGER nowpayments_revocation_immutable BEFORE UPDATE OR DELETE ON private.nowpayments_wallet_revocations
FOR EACH ROW EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();
CREATE TRIGGER nowpayments_revocation_no_truncate BEFORE TRUNCATE ON private.nowpayments_wallet_revocations
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_nowpayments_evidence_mutation();

DROP POLICY IF EXISTS crypto_transactions_user_insert ON public.crypto_transactions;
DROP POLICY IF EXISTS crypto_transactions_user_update ON public.crypto_transactions;
REVOKE INSERT, UPDATE, DELETE ON public.crypto_transactions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_nowpayments_wallet_quote(
  p_crypto_transaction_id uuid, p_user_id uuid, p_payment_id text,
  p_order_reference text, p_ngn_amount numeric, p_pay_amount numeric,
  p_pay_currency text, p_pay_address text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_receipt public.crypto_transactions%ROWTYPE;
  v_quote private.nowpayments_wallet_quotes%ROWTYPE;
  v_launch timestamptz;
  v_receipt_user_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_crypto_transaction_id IS NULL OR p_user_id IS NULL
    OR p_payment_id IS NULL OR p_payment_id !~ '^[A-Za-z0-9_-]{1,100}$'
    OR p_order_reference IS NULL OR p_order_reference !~ '^[A-Za-z0-9:_-]{8,160}$'
    OR p_ngn_amount IS NULL OR p_ngn_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_ngn_amount <= 0 OR p_ngn_amount > 1000000000 OR p_ngn_amount <> round(p_ngn_amount, 2)
    OR p_pay_amount IS NULL OR p_pay_amount::text IN ('NaN','Infinity','-Infinity') OR p_pay_amount <= 0
    OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,30}$'
    OR p_pay_address IS NULL OR length(p_pay_address) < 8 OR length(p_pay_address) > 300
  THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_QUOTE'); END IF;

  SELECT started_at INTO v_launch FROM private.nowpayments_wallet_launch WHERE singleton;
  SELECT user_id INTO v_receipt_user_id FROM public.crypto_transactions WHERE id = p_crypto_transaction_id;
  IF v_receipt_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'QUOTE_RECEIPT_MISMATCH');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING'); END IF;
  SELECT * INTO v_receipt FROM public.crypto_transactions
    WHERE id = p_crypto_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.created_at < v_launch
    OR v_receipt.user_id IS DISTINCT FROM p_user_id
    OR lower(COALESCE(v_receipt.payment_provider, '')) <> 'nowpayments'
    OR v_receipt.nowpayments_payment_id IS DISTINCT FROM p_payment_id
    OR v_receipt.payment_reference IS DISTINCT FROM p_order_reference
    OR v_receipt.naira_amount IS DISTINCT FROM p_ngn_amount
    OR v_receipt.outcome_amount IS DISTINCT FROM p_pay_amount
    OR lower(COALESCE(v_receipt.outcome_currency, '')) IS DISTINCT FROM p_pay_currency
    OR v_receipt.nowpayments_pay_address IS DISTINCT FROM p_pay_address
    OR lower(COALESCE(v_receipt.status, '')) NOT IN ('pending', 'processing')
    OR v_receipt.credited_at IS NOT NULL
  THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_RECEIPT_MISMATCH'); END IF;

  SELECT * INTO v_quote FROM private.nowpayments_wallet_quotes
    WHERE crypto_transaction_id = p_crypto_transaction_id;
  IF FOUND THEN
    IF v_quote.user_id = p_user_id AND v_quote.payment_id = p_payment_id
      AND v_quote.order_reference = p_order_reference AND v_quote.amount_ngn = p_ngn_amount
      AND v_quote.pay_amount = p_pay_amount AND v_quote.pay_currency = p_pay_currency
      AND v_quote.pay_address = p_pay_address
    THEN RETURN jsonb_build_object('success', true, 'quote_id', v_quote.id, 'idempotency_hit', true); END IF;
    RETURN jsonb_build_object('success', false, 'code', 'QUOTE_CONFLICT');
  END IF;

  INSERT INTO private.nowpayments_wallet_quotes(
    crypto_transaction_id,user_id,payment_id,order_reference,amount_ngn,pay_amount,pay_currency,pay_address
  ) VALUES (p_crypto_transaction_id,p_user_id,p_payment_id,p_order_reference,p_ngn_amount,
    p_pay_amount,p_pay_currency,p_pay_address) RETURNING * INTO v_quote;
  RETURN jsonb_build_object('success', true, 'quote_id', v_quote.id, 'idempotency_hit', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_registered_nowpayments_wallet_quote(p_crypto_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_quote private.nowpayments_wallet_quotes%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT q.* INTO v_quote FROM private.nowpayments_wallet_quotes q
  JOIN public.crypto_transactions c ON c.id = q.crypto_transaction_id
    AND c.user_id = q.user_id AND c.nowpayments_payment_id = q.payment_id
    AND c.payment_reference = q.order_reference AND c.naira_amount = q.amount_ngn
    AND c.outcome_amount = q.pay_amount AND lower(c.outcome_currency) = q.pay_currency
    AND c.nowpayments_pay_address = q.pay_address
  WHERE q.crypto_transaction_id = p_crypto_transaction_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('registered', false); END IF;
  RETURN jsonb_build_object('registered', true, 'quote_id', v_quote.id,
    'crypto_transaction_id', v_quote.crypto_transaction_id, 'user_id', v_quote.user_id,
    'payment_id', v_quote.payment_id, 'order_reference', v_quote.order_reference,
    'amount_ngn', v_quote.amount_ngn, 'pay_amount', v_quote.pay_amount,
    'pay_currency', v_quote.pay_currency, 'pay_address', v_quote.pay_address);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_verified_nowpayments_wallet_credit(
  p_user_id uuid, p_amount numeric, p_reference text,
  p_external_payment_id text, p_metadata jsonb
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.nowpayments_wallet_quotes q
    JOIN private.nowpayments_wallet_proofs e ON e.quote_id = q.id AND e.payment_id = q.payment_id
    JOIN public.crypto_transactions c ON c.id = q.crypto_transaction_id
    WHERE q.id::text = COALESCE(p_metadata->>'crypto_quote_id', '')
      AND q.user_id = p_user_id AND q.amount_ngn = p_amount
      AND q.order_reference = p_reference
      AND p_external_payment_id = 'nowpayments:' || q.payment_id
      AND COALESCE(p_metadata->>'provider', '') = 'nowpayments'
      AND c.user_id = q.user_id AND c.nowpayments_payment_id = q.payment_id
      AND c.payment_reference = q.order_reference AND c.naira_amount = q.amount_ngn
      AND c.outcome_amount = q.pay_amount AND lower(c.outcome_currency) = q.pay_currency
      AND c.nowpayments_pay_address = q.pay_address
      AND e.actual_paid >= q.pay_amount AND e.provider_status = 'finished'
      AND NOT EXISTS (SELECT 1 FROM private.nowpayments_wallet_revocations r WHERE r.quote_id = q.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.settle_nowpayments_wallet_quote(
  p_payment_id text, p_order_reference text, p_pay_amount numeric,
  p_pay_currency text, p_pay_address text, p_actual_paid numeric,
  p_provider_status text, p_signature_hash text, p_verification_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_quote private.nowpayments_wallet_quotes%ROWTYPE;
  v_receipt public.crypto_transactions%ROWTYPE;
  v_result jsonb;
  v_wallet_transaction_id uuid;
  v_user_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_provider_status IS DISTINCT FROM 'finished'
    OR p_signature_hash IS NULL OR p_signature_hash !~ '^[0-9a-f]{64}$'
    OR p_verification_hash IS NULL OR p_verification_hash !~ '^[0-9a-f]{64}$'
    OR p_actual_paid IS NULL OR p_actual_paid::text IN ('NaN','Infinity','-Infinity')
    OR p_actual_paid <= 0
  THEN RETURN jsonb_build_object('success', false, 'code', 'VERIFICATION_REQUIRED'); END IF;

  SELECT user_id INTO v_user_id FROM private.nowpayments_wallet_quotes WHERE payment_id = p_payment_id;
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISSING'); END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING'); END IF;
  SELECT * INTO v_quote FROM private.nowpayments_wallet_quotes
    WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_quote.order_reference IS DISTINCT FROM p_order_reference
    OR v_quote.pay_amount IS DISTINCT FROM p_pay_amount
    OR v_quote.pay_currency IS DISTINCT FROM p_pay_currency
    OR v_quote.pay_address IS DISTINCT FROM p_pay_address
    OR p_actual_paid < v_quote.pay_amount
  THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISMATCH_OR_UNDERPAID'); END IF;

  SELECT * INTO v_receipt FROM public.crypto_transactions
    WHERE id = v_quote.crypto_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.user_id IS DISTINCT FROM v_quote.user_id
    OR v_receipt.nowpayments_payment_id IS DISTINCT FROM v_quote.payment_id
    OR v_receipt.payment_reference IS DISTINCT FROM v_quote.order_reference
    OR v_receipt.naira_amount IS DISTINCT FROM v_quote.amount_ngn
    OR v_receipt.outcome_amount IS DISTINCT FROM v_quote.pay_amount
    OR lower(COALESCE(v_receipt.outcome_currency, '')) IS DISTINCT FROM v_quote.pay_currency
    OR v_receipt.nowpayments_pay_address IS DISTINCT FROM v_quote.pay_address
  THEN RETURN jsonb_build_object('success', false, 'code', 'RECEIPT_MISMATCH'); END IF;
  IF EXISTS (SELECT 1 FROM private.nowpayments_wallet_revocations WHERE quote_id = v_quote.id)
    OR lower(COALESCE(v_receipt.status, '')) = 'refunded'
  THEN RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REVOKED'); END IF;

  SELECT t.id INTO v_wallet_transaction_id FROM public.transactions t
  WHERE t.idempotency_key = 'nowpayments:wallet:' || v_quote.payment_id
    AND t.user_id = v_quote.user_id
    AND t.external_payment_id = 'nowpayments:' || v_quote.payment_id
    AND t.reference = v_quote.order_reference
    AND t.amount = v_quote.amount_ngn
    AND t.metadata->>'crypto_quote_id' = v_quote.id::text;
  IF EXISTS (SELECT 1 FROM private.nowpayments_wallet_proofs WHERE quote_id = v_quote.id) THEN
    IF v_wallet_transaction_id IS NULL OR v_receipt.credited_at IS NULL
    THEN RETURN jsonb_build_object('success', false, 'code', 'SETTLEMENT_REVIEW_REQUIRED'); END IF;
    RETURN jsonb_build_object('success', true, 'credited', true, 'idempotency_hit', true,
      'amount_ngn', v_quote.amount_ngn, 'transaction_id', v_wallet_transaction_id,
      'crypto_transaction_id', v_quote.crypto_transaction_id);
  END IF;
  IF v_wallet_transaction_id IS NOT NULL OR v_receipt.credited_at IS NOT NULL
  THEN RETURN jsonb_build_object('success', false, 'code', 'SETTLEMENT_REVIEW_REQUIRED'); END IF;

  INSERT INTO private.nowpayments_wallet_proofs(
    quote_id,payment_id,actual_paid,provider_status,signature_hash,verification_hash
  ) VALUES (v_quote.id,v_quote.payment_id,p_actual_paid,p_provider_status,p_signature_hash,p_verification_hash);

  SELECT public.apply_wallet_transaction(
    p_user_id := v_quote.user_id,
    p_type := 'topup',
    p_amount := v_quote.amount_ngn,
    p_reference := v_quote.order_reference,
    p_description := 'NOWPayments crypto wallet deposit',
    p_idempotency_key := 'nowpayments:wallet:' || v_quote.payment_id,
    p_metadata := jsonb_build_object('provider','nowpayments','verified_amount_ngn',v_quote.amount_ngn,
      'crypto_quote_id',v_quote.id),
    p_currency := 'NGN', p_balance_type := 'wallet',
    p_external_payment_id := 'nowpayments:' || v_quote.payment_id,
    p_created_by := NULL::uuid
  ) INTO v_result;
  IF COALESCE((v_result->>'success')::boolean, false) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'nowpayments_wallet_credit_rejected'; END IF;
  v_wallet_transaction_id := NULLIF(v_result->'transaction'->>'id', '')::uuid;
  IF v_wallet_transaction_id IS NULL THEN RAISE EXCEPTION 'nowpayments_wallet_ledger_missing'; END IF;

  UPDATE public.crypto_transactions SET status = 'completed', credited_at = clock_timestamp(),
    confirmed_at = COALESCE(confirmed_at, clock_timestamp()),
    actually_paid = p_actual_paid, nowpayments_amount_received = p_actual_paid
  WHERE id = v_quote.crypto_transaction_id;
  RETURN jsonb_build_object('success', true, 'credited', true, 'idempotency_hit', false,
    'amount_ngn', v_quote.amount_ngn, 'transaction_id', v_wallet_transaction_id,
    'crypto_transaction_id', v_quote.crypto_transaction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_nowpayments_wallet_quote(
  p_payment_id text, p_order_reference text, p_pay_amount numeric,
  p_pay_currency text, p_pay_address text, p_actual_paid numeric,
  p_provider_status text, p_signature_hash text, p_verification_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_quote private.nowpayments_wallet_quotes%ROWTYPE;
  v_receipt public.crypto_transactions%ROWTYPE;
  v_user_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_provider_status IS DISTINCT FROM 'refunded'
    OR p_signature_hash IS NULL OR p_signature_hash !~ '^[0-9a-f]{64}$'
    OR p_verification_hash IS NULL OR p_verification_hash !~ '^[0-9a-f]{64}$'
    OR (p_actual_paid IS NOT NULL AND (p_actual_paid::text IN ('NaN','Infinity','-Infinity') OR p_actual_paid < 0))
  THEN RETURN jsonb_build_object('success', false, 'code', 'VERIFICATION_REQUIRED'); END IF;

  SELECT user_id INTO v_user_id FROM private.nowpayments_wallet_quotes WHERE payment_id = p_payment_id;
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISSING'); END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING'); END IF;
  SELECT * INTO v_quote FROM private.nowpayments_wallet_quotes
    WHERE payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_quote.order_reference IS DISTINCT FROM p_order_reference
    OR v_quote.pay_amount IS DISTINCT FROM p_pay_amount
    OR v_quote.pay_currency IS DISTINCT FROM p_pay_currency
    OR v_quote.pay_address IS DISTINCT FROM p_pay_address
  THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISMATCH'); END IF;
  SELECT * INTO v_receipt FROM public.crypto_transactions
    WHERE id = v_quote.crypto_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.user_id IS DISTINCT FROM v_quote.user_id
    OR v_receipt.nowpayments_payment_id IS DISTINCT FROM v_quote.payment_id
    OR v_receipt.payment_reference IS DISTINCT FROM v_quote.order_reference
    OR v_receipt.naira_amount IS DISTINCT FROM v_quote.amount_ngn
    OR v_receipt.outcome_amount IS DISTINCT FROM v_quote.pay_amount
    OR lower(COALESCE(v_receipt.outcome_currency, '')) IS DISTINCT FROM v_quote.pay_currency
    OR v_receipt.nowpayments_pay_address IS DISTINCT FROM v_quote.pay_address
  THEN RETURN jsonb_build_object('success', false, 'code', 'RECEIPT_MISMATCH'); END IF;
  IF EXISTS (SELECT 1 FROM private.nowpayments_wallet_revocations WHERE quote_id = v_quote.id) THEN
    RETURN jsonb_build_object('success', true, 'revoked', true, 'idempotency_hit', true,
      'crypto_transaction_id', v_quote.crypto_transaction_id);
  END IF;
  INSERT INTO private.nowpayments_wallet_revocations(
    quote_id,payment_id,provider_status,signature_hash,verification_hash
  ) VALUES (v_quote.id,v_quote.payment_id,p_provider_status,p_signature_hash,p_verification_hash);
  UPDATE public.crypto_transactions SET status = 'refunded'
    WHERE id = v_quote.crypto_transaction_id;
  RETURN jsonb_build_object('success', true, 'revoked', true,
    'was_credited', v_receipt.credited_at IS NOT NULL, 'idempotency_hit', false,
    'crypto_transaction_id', v_quote.crypto_transaction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_nowpayments_wallet_status(
  p_payment_id text, p_order_reference text, p_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid;
  v_quote private.nowpayments_wallet_quotes%ROWTYPE;
  v_receipt public.crypto_transactions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_status NOT IN ('processing','partially_paid','failed','expired') OR p_status IS NULL
  THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS'); END IF;
  SELECT user_id INTO v_user_id FROM private.nowpayments_wallet_quotes WHERE payment_id = p_payment_id;
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISSING'); END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING'); END IF;
  SELECT * INTO v_quote FROM private.nowpayments_wallet_quotes WHERE payment_id = p_payment_id FOR UPDATE;
  IF v_quote.order_reference IS DISTINCT FROM p_order_reference
  THEN RETURN jsonb_build_object('success', false, 'code', 'QUOTE_MISMATCH'); END IF;
  SELECT * INTO v_receipt FROM public.crypto_transactions
    WHERE id = v_quote.crypto_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.user_id IS DISTINCT FROM v_quote.user_id
    OR v_receipt.nowpayments_payment_id IS DISTINCT FROM v_quote.payment_id
    OR v_receipt.payment_reference IS DISTINCT FROM v_quote.order_reference
  THEN RETURN jsonb_build_object('success', false, 'code', 'RECEIPT_MISMATCH'); END IF;
  IF v_receipt.credited_at IS NOT NULL
    OR lower(COALESCE(v_receipt.status, '')) IN ('completed','refunded')
    OR EXISTS (SELECT 1 FROM private.nowpayments_wallet_proofs WHERE quote_id = v_quote.id)
  THEN RETURN jsonb_build_object('success', true, 'status', v_receipt.status,
    'idempotency_hit', true, 'credited', v_receipt.credited_at IS NOT NULL); END IF;
  IF v_receipt.status IS DISTINCT FROM p_status THEN
    UPDATE public.crypto_transactions SET status = p_status
    WHERE id = v_quote.crypto_transaction_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'status', p_status,
    'idempotency_hit', v_receipt.status = p_status, 'credited', false);
END;
$$;

REVOKE ALL ON FUNCTION public.register_nowpayments_wallet_quote(uuid,uuid,text,text,numeric,numeric,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_nowpayments_wallet_quote(uuid,uuid,text,text,numeric,numeric,text,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_registered_nowpayments_wallet_quote(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_registered_nowpayments_wallet_quote(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.settle_nowpayments_wallet_quote(text,text,numeric,text,text,numeric,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_nowpayments_wallet_quote(text,text,numeric,text,text,numeric,text,text,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.revoke_nowpayments_wallet_quote(text,text,numeric,text,text,numeric,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_nowpayments_wallet_quote(text,text,numeric,text,text,numeric,text,text,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_nowpayments_wallet_status(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_nowpayments_wallet_status(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.is_verified_nowpayments_wallet_credit(uuid,numeric,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_nowpayments_wallet_credit(uuid,numeric,text,text,jsonb)
  TO service_role;

-- A confirmed provider refund removes verified capacity through the proof
-- predicate. Updating the receipt must not create an unrelated fraud hold.
CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension_from_crypto_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(COALESCE(NEW.payment_provider, '')) = 'nowpayments'
    AND lower(COALESCE(NEW.status, '')) = 'refunded'
    AND EXISTS (
      SELECT 1 FROM private.nowpayments_wallet_quotes q
      JOIN private.nowpayments_wallet_revocations r ON r.quote_id = q.id
      WHERE q.crypto_transaction_id = NEW.id AND q.user_id = NEW.user_id
    )
  THEN RETURN NEW; END IF;
  IF NEW.user_id IS NOT NULL AND NEW.credited_at IS NOT NULL
    AND lower(COALESCE(NEW.transaction_type, 'sell')) IN ('sell','crypto_sell','deposit','crypto_deposit')
  THEN PERFORM public.evaluate_customer_ledger_suspension(NEW.user_id); END IF;
  RETURN NEW;
END;
$$;




-- Live wallet function replacements; exact definitions captured before this migration.
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(p_user_id uuid, p_type text, p_amount numeric, p_reference text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_currency text DEFAULT 'NGN'::text, p_balance_type text DEFAULT 'wallet'::text, p_external_payment_id text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_created_by uuid;
  v_existing public.transactions%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_previous_hash text;
  v_trusted_credits numeric := 0;
  v_previous_wallet_debits numeric := 0;
  v_completed_refunds numeric := 0;
  v_trusted_debit_capacity numeric := 0;
  v_eligible_refunds numeric := 0;
  v_trusted_consumed_spend numeric := 0;
  v_refundable_remaining numeric := 0;
  v_authoritative_available numeric := 0;
  v_pending_payment public.pending_payments%ROWTYPE;
  v_pocketfi_log public.pocketfi_webhook_logs%ROWTYPE;
  v_transaction_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_original_debit public.transactions%ROWTYPE;
  v_original_debit_id uuid;
  v_original_debit_key text;
  v_source_order_id text;
  v_source_order_table text;
  v_original_reference text;
  v_financial_truth jsonb;
  v_own_hold numeric := 0;
  v_refunded_against_original numeric := 0;
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

  v_created_by := COALESCE(p_created_by, auth.uid());

  IF v_type IN (
    'topup',
    'top_up',
    'top-up',
    'wallet_topup',
    'wallet_deposit',
    'deposit',
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
        OR v_existing.created_by IS DISTINCT FROM v_created_by
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

  IF COALESCE(v_profile.account_suspended, false)
    AND v_signed_amount < 0
    AND v_type NOT IN ('chargeback', 'correction_debit')
  THEN
    RAISE EXCEPTION 'wallet_transaction_account_suspended';
  END IF;

  IF v_balance_type = 'crypto' THEN
    v_current_balance := COALESCE(v_profile.crypto_balance, 0);
  ELSIF v_balance_type = 'referral' THEN
    v_current_balance := COALESCE(v_profile.referral_balance, 0);
  ELSE
    v_current_balance := COALESCE(v_profile.wallet_balance, 0);
  END IF;

  IF v_balance_type = 'wallet' THEN
    IF v_type = 'admin_credit'
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = v_created_by
          AND COALESCE(is_admin, false) = true
      )
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'admin_credit_admin_actor_required',
        'code', 'ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED',
        'message', 'Approved admin credits must be created by a current admin profile.'
      );
    END IF;

    IF v_type = 'admin_credit'
      AND (
        COALESCE(p_metadata, '{}'::jsonb)->>'approved_by' IS DISTINCT FROM COALESCE(v_created_by::text, '')
        OR length(btrim(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'approval_reference', ''))) < 8
        OR length(btrim(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'reason', ''))) < 3
      )
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'admin_credit_approval_evidence_required',
        'code', 'ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED',
        'message', 'Approved admin credits must include approved_by, approval_reference, and reason metadata matching the approving admin.'
      );
    END IF;

    IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      AND v_external_payment_id IS NULL
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'payment_evidence_required',
        'code', 'PAYMENT_EVIDENCE_REQUIRED',
        'message', 'Verified gateway deposits must carry a provider payment identity before they can create trusted principal.'
      );
    END IF;

    IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit') THEN
      IF COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'verified_amount_ngn', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        OR (COALESCE(p_metadata, '{}'::jsonb)->>'verified_amount_ngn')::numeric <> v_amount
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'payment_verification_evidence_required',
          'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
          'message', 'Wallet deposits must include provider-verified amount evidence matching the posted credit.'
        );
      END IF;

      IF lower(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'provider', '')) IN ('ercaspay', 'ercas') THEN
        SELECT *
          INTO v_pending_payment
        FROM public.pending_payments pp
        WHERE pp.user_id = p_user_id
          AND pp.amount = v_amount
          AND lower(COALESCE(pp.status, 'pending')) = 'pending'
          AND (
            pp.transaction_reference = v_reference
            OR pp.transaction_reference = v_external_payment_id
            OR pp.ercas_reference = v_external_payment_id
          )
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'Ercas wallet deposits must atomically consume server-created pending payment evidence before they can create trusted principal.'
          );
        END IF;

        UPDATE public.pending_payments
           SET status = 'credited',
               ercas_reference = COALESCE(NULLIF(ercas_reference, ''), v_external_payment_id),
               last_check_at = now(),
               error_message = NULL
         WHERE id = v_pending_payment.id;
      ELSIF lower(COALESCE(COALESCE(p_metadata, '{}'::jsonb)->>'provider', '')) = 'pocketfi' THEN
        IF COALESCE(p_metadata, '{}'::jsonb)->>'webhook_log_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'PocketFi wallet deposits must be tied to a verified webhook log before they can create trusted principal.'
          );
        END IF;

        SELECT *
          INTO v_pocketfi_log
        FROM public.pocketfi_webhook_logs pwl
        WHERE pwl.id = (COALESCE(p_metadata, '{}'::jsonb)->>'webhook_log_id')::uuid
          AND pwl.matched_user_id = p_user_id
          AND pwl.verified_amount_ngn = v_amount
          AND NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN (v_reference, v_external_payment_id)
          AND COALESCE(pwl.processed, false) = false
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
            'message', 'PocketFi wallet deposits must atomically consume matching webhook amount/reference evidence before they can create trusted principal.'
          );
        END IF;

        UPDATE public.pocketfi_webhook_logs
           SET processed = true,
               error_message = NULL
         WHERE id = v_pocketfi_log.id;
      ELSIF lower(COALESCE(p_metadata->>'provider', '')) = 'nowpayments' THEN
        IF NOT public.is_verified_nowpayments_wallet_credit(
          p_user_id, v_amount, v_reference, v_external_payment_id, p_metadata
        ) THEN
          RETURN jsonb_build_object('success', false,
            'error', 'payment_verification_evidence_required',
            'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED');
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'payment_verification_evidence_required',
          'code', 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
          'message', 'Wallet deposits must identify a supported verified payment provider before they can create trusted principal.'
        );
      END IF;
    END IF;

        SELECT public.trusted_principal_for_user(p_user_id)
      INTO v_trusted_credits;

    SELECT COALESCE(SUM(abs(amount)), 0)
      INTO v_previous_wallet_debits
    FROM public.transactions
    WHERE user_id = p_user_id
      AND COALESCE(balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(status, 'completed')) = 'completed'
      AND type IN (
        'purchase',
        'admin_debit',
        'staff_debit',
        'debit',
        'withdrawal',
        'chargeback',
        'correction_debit'
      );

    WITH eligible_refund_matches AS (
      SELECT DISTINCT ON (r.id)
        r.id AS refund_id,
        r.amount AS refund_amount,
        d.id AS debit_id,
        LEAST(
          abs(COALESCE(d.amount, 0)),
          CASE
            WHEN COALESCE(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
            THEN (d.metadata->>'trusted_principal_debit_amount')::numeric
            ELSE 0
          END
        ) AS debit_amount
      FROM public.transactions r
      JOIN public.transactions d
        ON d.user_id = r.user_id
       AND COALESCE(d.balance_type, 'wallet') = 'wallet'
       AND lower(COALESCE(d.status, 'completed')) = 'completed'
       AND d.amount < 0
       AND d.type IN (
         'purchase',
         'admin_debit',
         'staff_debit',
         'debit',
         'withdrawal',
         'chargeback',
         'correction_debit'
       )
       AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
       AND COALESCE(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
       AND (d.metadata->>'trusted_principal_debit_amount')::numeric > 0
       AND (
         NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text
         OR (
           NULLIF(trim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
           AND NULLIF(trim(COALESCE(
             r.metadata->>'source_debit_idempotency_key',
             r.metadata->>'original_purchase_idempotency_key',
             ''
           )), '') = d.idempotency_key
         )
         OR (
           NULLIF(trim(COALESCE(
             r.metadata->>'source_order_id',
             r.metadata->>'order_id',
             r.metadata->>'transaction_id',
             ''
           )), '') IS NOT NULL
           AND NULLIF(trim(COALESCE(
             r.metadata->>'source_order_id',
             r.metadata->>'order_id',
             r.metadata->>'transaction_id',
             ''
           )), '') IN (
             NULLIF(trim(COALESCE(d.metadata->>'source_order_id', '')), ''),
             NULLIF(trim(COALESCE(d.metadata->>'order_id', '')), ''),
             NULLIF(trim(COALESCE(d.metadata->>'transaction_id', '')), '')
           )
           AND (
             NULLIF(trim(COALESCE(r.metadata->>'source_order_table', '')), '') IS NULL
             OR NULLIF(trim(COALESCE(r.metadata->>'source_order_table', '')), '') = NULLIF(trim(COALESCE(d.metadata->>'source_order_table', '')), '')
           )
         )
         OR (
           NULLIF(trim(COALESCE(r.metadata->>'original_reference', '')), '') IS NOT NULL
           AND NULLIF(trim(COALESCE(r.metadata->>'original_reference', '')), '') = NULLIF(trim(COALESCE(d.reference, '')), '')
         )
       )
      WHERE r.user_id = p_user_id
        AND COALESCE(r.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(r.status, 'completed')) = 'completed'
        AND r.amount > 0
        AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
      ORDER BY
        r.id,
        CASE
          WHEN NULLIF(trim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text THEN 0
          WHEN NULLIF(trim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
            AND NULLIF(trim(COALESCE(
              r.metadata->>'source_debit_idempotency_key',
              r.metadata->>'original_purchase_idempotency_key',
              ''
            )), '') = d.idempotency_key THEN 1
          ELSE 2
        END,
        d.created_at DESC,
        d.id DESC
    ),
    capped_refunds_by_debit AS (
      SELECT
        debit_id,
        debit_amount,
        SUM(refund_amount) AS refund_amount
      FROM eligible_refund_matches
      GROUP BY debit_id, debit_amount
    )
    SELECT COALESCE(SUM(LEAST(refund_amount, debit_amount)), 0)
      INTO v_completed_refunds
    FROM capped_refunds_by_debit;

    v_trusted_debit_capacity := LEAST(v_previous_wallet_debits, v_trusted_credits);
    v_eligible_refunds := LEAST(v_completed_refunds, v_trusted_debit_capacity);
    v_trusted_consumed_spend := GREATEST(v_previous_wallet_debits - v_eligible_refunds, 0);
    v_authoritative_available := GREATEST(v_trusted_credits - v_trusted_consumed_spend, 0);
  END IF;

  IF v_balance_type = 'wallet' AND v_type IN ('refund', 'purchase_refund', 'auto_refund') THEN
    v_original_debit_key := NULLIF(trim(COALESCE(
      p_metadata->>'source_debit_idempotency_key',
      p_metadata->>'original_purchase_idempotency_key',
      ''
    )), '');
    v_source_order_id := NULLIF(trim(COALESCE(
      p_metadata->>'source_order_id',
      p_metadata->>'order_id',
      p_metadata->>'transaction_id',
      ''
    )), '');
    v_source_order_table := NULLIF(trim(COALESCE(p_metadata->>'source_order_table', '')), '');
    v_original_reference := NULLIF(trim(COALESCE(p_metadata->>'original_reference', '')), '');

    IF COALESCE(p_metadata->>'source_debit_transaction_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_original_debit_id := (p_metadata->>'source_debit_transaction_id')::uuid;
    END IF;

    SELECT *
      INTO v_original_debit
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(t.status, 'completed')) = 'completed'
      AND t.amount < 0
      AND t.type IN (
        'purchase',
        'admin_debit',
        'staff_debit',
        'debit',
        'withdrawal',
        'chargeback',
        'correction_debit'
      )
      AND public.wallet_refund_links_debit(p_metadata, t.id, t.idempotency_key, t.metadata, t.reference)
    ORDER BY
      CASE
        WHEN v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id THEN 0
        WHEN v_original_debit_key IS NOT NULL AND t.idempotency_key = v_original_debit_key THEN 1
        ELSE 2
      END,
      t.created_at DESC,
      t.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_required',
        'code', 'REFUND_ORIGINAL_DEBIT_REQUIRED',
        'message', 'Refunds must reference the original completed wallet debit by transaction ID, purchase idempotency key, or protected source order metadata.'
      );
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_authorized', '') <> 'true' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_not_trusted',
        'code', 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED',
        'original_debit_id', v_original_debit.id,
        'message', 'Refunds can restore only a prior debit that was authorized from trusted principal.'
      );
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_debit_amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric <= 0
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_original_debit_not_trusted',
        'code', 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED',
        'original_debit_id', v_original_debit.id,
        'message', 'Refunds can restore only a prior debit with wallet-engine trusted-principal amount evidence.'
      );
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_refunded_against_original
    FROM public.transactions r
    WHERE r.user_id = p_user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) = 'completed'
      AND r.amount > 0
      AND r.type IN ('refund', 'purchase_refund', 'auto_refund')
      AND public.wallet_refund_links_debit(
        r.metadata, v_original_debit.id, v_original_debit.idempotency_key,
        v_original_debit.metadata, v_original_debit.reference
      );

    IF v_refunded_against_original + v_amount > LEAST(
      abs(COALESCE(v_original_debit.amount, 0)),
      (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_exceeds_original_debit',
        'code', 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT',
        'original_debit_id', v_original_debit.id,
        'original_debit_amount', abs(COALESCE(v_original_debit.amount, 0)),
        'trusted_original_debit_amount', LEAST(
          abs(COALESCE(v_original_debit.amount, 0)),
          (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
        ),
        'already_refunded', v_refunded_against_original,
        'requested_amount', v_amount
      );
    END IF;

    v_financial_truth := public.wallet_financial_truth_internal(p_user_id);
    v_refundable_remaining := GREATEST(
      (v_financial_truth->>'completed_debits')::numeric
        - (v_financial_truth->>'eligible_refunds')::numeric,
      0
    );

    IF v_amount > v_refundable_remaining THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'refund_exceeds_trusted_original_debit',
        'code', 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT',
        'trusted_principal', v_trusted_credits,
        'previous_completed_debits', v_previous_wallet_debits,
        'trusted_debit_capacity', v_trusted_debit_capacity,
        'completed_refunds', v_completed_refunds,
        'refundable_remaining', v_refundable_remaining,
        'requested_amount', v_amount
      );
    END IF;
  END IF;

  v_new_balance := v_current_balance + v_signed_amount;

  IF v_new_balance < 0 AND v_type NOT IN ('chargeback', 'correction_debit') THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  IF v_balance_type = 'wallet'
    AND v_type IN ('chargeback', 'correction_debit')
    AND v_new_balance < 0
  THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);
    PERFORM set_config('app.tally_request_forensics', COALESCE((p_metadata->'request_forensics')::text, '{}'), true);

    UPDATE public.profiles
       SET account_suspended = true,
           suspension_reason = concat(
             'Wallet frozen: ',
             v_type,
             ' posted a debt balance of ',
             v_new_balance::text,
             '. Review before further spending.'
           ),
           suspended_at = COALESCE(suspended_at, now()),
           updated_at = now()
     WHERE id = p_user_id;

    PERFORM set_config('app.tally_request_forensics', '{}', true);
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
  END IF;


  IF v_balance_type = 'wallet' AND v_type IN (
    'admin_credit', 'staff_credit', 'referral_withdrawal',
    'referral_credit', 'promotion_credit', 'correction_credit'
  ) THEN
    RETURN jsonb_build_object(
      'success', false, 'code', 'VERIFIED_GATEWAY_REQUIRED',
      'error', 'Wallet credits require verified Ercas or PocketFi payment'
    );
  END IF;

  IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN
    IF v_currency <> 'NGN' THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_WALLET_CURRENCY');
    END IF;

    v_financial_truth := public.wallet_financial_truth_internal(p_user_id);
    IF COALESCE((v_financial_truth->>'spending_blocked')::boolean, true) THEN
      RETURN jsonb_build_object(
        'success', false, 'code', 'WALLET_REVIEW_REQUIRED',
        'error', 'wallet_financial_review_required', 'truth', v_financial_truth
      );
    END IF;

    -- A capture consumes its own committed hold. Do not subtract that hold
    -- twice, or let an arbitrary reservation ID increase available funds.
    IF COALESCE(v_transaction_metadata->>'wallet_reservation_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      SELECT r.amount INTO v_own_hold
      FROM public.wallet_reservations r
      WHERE r.id = (v_transaction_metadata->>'wallet_reservation_id')::uuid
        AND r.user_id = p_user_id
        AND r.status = 'active'
        AND r.amount = v_amount
        AND upper(r.currency) = v_currency
        AND r.order_id::text = v_transaction_metadata->>'source_order_id'
        AND r.order_table = v_transaction_metadata->>'source_order_table';
      IF v_own_hold IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_WALLET_RESERVATION');
      END IF;
    ELSIF v_transaction_metadata ? 'wallet_reservation_id' THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_WALLET_RESERVATION');
    END IF;

    v_authoritative_available := GREATEST(
      (v_financial_truth->>'trusted_available_before_holds')::numeric
      - (v_financial_truth->>'active_reservations')::numeric
      + COALESCE(v_own_hold, 0), 0
    );
    IF v_authoritative_available < v_amount THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS',
        'error', 'insufficient_trusted_available_funds',
        'backed_available', v_authoritative_available,
        'requested_amount', v_amount,
        'truth', v_financial_truth
      );
    END IF;

    v_transaction_metadata := v_transaction_metadata || jsonb_build_object(
      'trusted_principal_authorized', true,
      'trusted_principal_debit_amount', v_amount,
      'trusted_available_before', v_authoritative_available,
      'trusted_principal_before', (v_financial_truth->>'trusted_principal')::numeric,
      'trusted_consumed_spend_before', (v_financial_truth->>'net_consumed_spend')::numeric
    );
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
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

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
    v_created_by,
    v_transaction_metadata,
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

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (CASE v_balance_type
        WHEN 'crypto' THEN p.crypto_balance
        WHEN 'referral' THEN p.referral_balance
        ELSE p.wallet_balance
      END) IS NOT DISTINCT FROM v_new_balance
  ) THEN
    RAISE EXCEPTION 'Wallet profile balance did not match posted transaction';
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

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
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
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_request_forensics', '{}', true);

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
    RAISE;
  WHEN OTHERS THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
    PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
    PERFORM set_config('app.tally_request_forensics', '{}', true);
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_trusted_principal_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text := lower(COALESCE(NEW.type, ''));
  v_balance_type text := COALESCE(NEW.balance_type, 'wallet');
  v_status text := lower(COALESCE(NEW.status, 'completed'));
  v_trusted_principal numeric := 0;
  v_completed_debits numeric := 0;
  v_completed_refunds numeric := 0;
  v_trusted_debit_capacity numeric := 0;
  v_eligible_refunds numeric := 0;
  v_trusted_consumed_spend numeric := 0;
  v_trusted_available numeric := 0;
  v_refundable_remaining numeric := 0;
  v_original_debit public.transactions%ROWTYPE;
  v_original_debit_id uuid;
  v_original_debit_key text;
  v_source_order_id text;
  v_source_order_table text;
  v_original_reference text;
  v_refunded_against_original numeric := 0;
  v_financial_truth jsonb;
  v_authorized_available numeric := 0;
  v_own_hold numeric := 0;
BEGIN
  -- Unauthorized direct ledger writes are handled by
  -- guard_transaction_ledger_authority(), which records the attempted row and
  -- skips the mutation. Keep this guard scoped to wallet-engine inserts so it
  -- cannot raise first and roll back that audit path.
  IF COALESCE(current_setting('app.tally_wallet_engine_authorized', true), '') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF v_balance_type <> 'wallet'
    OR v_status <> 'completed'
    OR v_type NOT IN (
      'purchase',
      'refund',
      'purchase_refund',
      'auto_refund',
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'wallet_deposit',
      'deposit'
    )
  THEN
    RETURN NEW;
  END IF;

  IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    AND NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_REQUIRED: verified gateway deposits require external_payment_id';
  END IF;

  IF v_type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit') THEN
    IF COALESCE(NEW.metadata->>'verified_amount_ngn', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR round((NEW.metadata->>'verified_amount_ngn')::numeric, 2) <> round(NEW.amount, 2)
    THEN
      RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: wallet deposits require provider-verified amount evidence matching the posted credit';
    END IF;

    IF lower(COALESCE(NEW.metadata->>'provider', '')) IN ('ercaspay', 'ercas') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.pending_payments pp
        WHERE pp.user_id = NEW.user_id
          AND round(pp.amount, 2) = round(NEW.amount, 2)
          AND lower(COALESCE(pp.status, 'pending')) = 'credited'
          AND (
            pp.transaction_reference = NULLIF(trim(COALESCE(NEW.reference, '')), '')
            OR pp.transaction_reference = NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
            OR pp.ercas_reference = NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
          )
      ) THEN
        RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: Ercas wallet deposits require matching pending payment evidence';
      END IF;
    ELSIF lower(COALESCE(NEW.metadata->>'provider', '')) = 'pocketfi' THEN
      IF COALESCE(NEW.metadata->>'webhook_log_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR NOT EXISTS (
          SELECT 1
          FROM public.pocketfi_webhook_logs pwl
          WHERE pwl.id = (NEW.metadata->>'webhook_log_id')::uuid
            AND pwl.matched_user_id = NEW.user_id
            AND COALESCE(pwl.processed, false) = true
            AND round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(NEW.amount, 2)
            AND NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN (
              NULLIF(trim(COALESCE(NEW.reference, '')), ''),
              NULLIF(trim(COALESCE(NEW.external_payment_id, '')), '')
            )
        )
      THEN
        RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: PocketFi wallet deposits require matching webhook evidence';
      END IF;
    ELSIF lower(COALESCE(NEW.metadata->>'provider', '')) = 'nowpayments' THEN
      IF NOT public.is_verified_nowpayments_wallet_credit(
        NEW.user_id, NEW.amount, NEW.reference, NEW.external_payment_id, NEW.metadata
      ) THEN
        RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: NOWPayments proof does not match the registered quote';
      END IF;
    ELSE
      RAISE EXCEPTION 'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED: wallet deposits require supported verified payment provider evidence';
    END IF;

    RETURN NEW;
  END IF;

  
  v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);
  v_refundable_remaining := GREATEST(
    (v_financial_truth->>'completed_debits')::numeric
      - (v_financial_truth->>'eligible_refunds')::numeric,
    0
  );

  IF v_type = 'purchase' THEN
    IF upper(COALESCE(NEW.currency, 'NGN')) <> 'NGN' THEN
      RAISE EXCEPTION 'UNSUPPORTED_WALLET_CURRENCY: purchase must use NGN';
    END IF;
    v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);
    IF COALESCE((v_financial_truth->>'spending_blocked')::boolean, true) THEN
      RAISE EXCEPTION 'WALLET_REVIEW_REQUIRED: canonical financial truth blocks purchase';
    END IF;

    IF COALESCE(NEW.metadata->>'wallet_reservation_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      SELECT r.amount INTO v_own_hold
      FROM public.wallet_reservations r
      WHERE r.id = (NEW.metadata->>'wallet_reservation_id')::uuid
        AND r.user_id = NEW.user_id
        AND r.status = 'active'
        AND r.amount = abs(NEW.amount)
        AND upper(r.currency) = upper(COALESCE(NEW.currency, 'NGN'))
        AND r.order_id::text = NEW.metadata->>'source_order_id'
        AND r.order_table = NEW.metadata->>'source_order_table';
      IF v_own_hold IS NULL THEN
        RAISE EXCEPTION 'INVALID_WALLET_RESERVATION: purchase hold is not valid';
      END IF;
    ELSIF NEW.metadata ? 'wallet_reservation_id' THEN
      RAISE EXCEPTION 'INVALID_WALLET_RESERVATION: purchase hold ID is malformed';
    END IF;

    v_authorized_available := GREATEST(
      (v_financial_truth->>'trusted_available_before_holds')::numeric
      - (v_financial_truth->>'active_reservations')::numeric
      + COALESCE(v_own_hold, 0), 0
    );
    IF abs(COALESCE(NEW.amount, 0)) > v_authorized_available THEN
      RAISE EXCEPTION 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS: requested % exceeds confirmed spendable %',
        abs(COALESCE(NEW.amount, 0)), v_authorized_available;
    END IF;

    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'trusted_principal_authorized', true,
      'trusted_principal_debit_amount', abs(COALESCE(NEW.amount, 0)),
      'trusted_available_before', v_authorized_available,
      'trusted_principal_before', (v_financial_truth->>'trusted_principal')::numeric,
      'trusted_consumed_spend_before', (v_financial_truth->>'net_consumed_spend')::numeric
    );
  END IF;

  IF v_type IN ('refund', 'purchase_refund', 'auto_refund') THEN
    v_original_debit_key := NULLIF(trim(COALESCE(
      NEW.metadata->>'source_debit_idempotency_key',
      NEW.metadata->>'original_purchase_idempotency_key',
      ''
    )), '');
    v_source_order_id := NULLIF(trim(COALESCE(
      NEW.metadata->>'source_order_id',
      NEW.metadata->>'order_id',
      NEW.metadata->>'transaction_id',
      ''
    )), '');
    v_source_order_table := NULLIF(trim(COALESCE(NEW.metadata->>'source_order_table', '')), '');
    v_original_reference := NULLIF(trim(COALESCE(NEW.metadata->>'original_reference', '')), '');

    IF COALESCE(NEW.metadata->>'source_debit_transaction_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_original_debit_id := (NEW.metadata->>'source_debit_transaction_id')::uuid;
    END IF;

    SELECT *
      INTO v_original_debit
    FROM public.transactions t
    WHERE t.user_id = NEW.user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(t.status, 'completed')) = 'completed'
      AND t.amount < 0
      AND lower(COALESCE(t.type, '')) IN (
        'purchase',
        'admin_debit',
        'staff_debit',
        'debit',
        'withdrawal',
        'chargeback',
        'correction_debit'
      )
      AND public.wallet_refund_links_debit(NEW.metadata, t.id, t.idempotency_key, t.metadata, t.reference)
    ORDER BY
      CASE
        WHEN v_original_debit_id IS NOT NULL AND t.id = v_original_debit_id THEN 0
        WHEN v_original_debit_key IS NOT NULL AND t.idempotency_key = v_original_debit_key THEN 1
        ELSE 2
      END,
      t.created_at DESC,
      t.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_REQUIRED: refunds must reference an original completed wallet debit';
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_authorized', '') <> 'true' THEN
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED: refunds can restore only a prior trusted-principal-authorized debit';
    END IF;

    IF COALESCE(v_original_debit.metadata->>'trusted_principal_debit_amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      OR (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric <= 0
    THEN
      RAISE EXCEPTION 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED: refunds can restore only a prior debit with wallet-engine trusted-principal amount evidence';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_refunded_against_original
    FROM public.transactions r
    WHERE r.user_id = NEW.user_id
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(r.status, 'completed')) = 'completed'
      AND r.amount > 0
      AND lower(COALESCE(r.type, '')) IN ('refund', 'purchase_refund', 'auto_refund')
      AND public.wallet_refund_links_debit(
        r.metadata, v_original_debit.id, v_original_debit.idempotency_key,
        v_original_debit.metadata, v_original_debit.reference
      );

    IF v_refunded_against_original + COALESCE(NEW.amount, 0) > LEAST(
      abs(COALESCE(v_original_debit.amount, 0)),
      (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
    ) THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT: requested % exceeds original debit remaining %',
        COALESCE(NEW.amount, 0),
        GREATEST(
          LEAST(
            abs(COALESCE(v_original_debit.amount, 0)),
            (v_original_debit.metadata->>'trusted_principal_debit_amount')::numeric
          ) - v_refunded_against_original,
          0
        );
    END IF;

    IF COALESCE(NEW.amount, 0) > v_refundable_remaining THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT: requested % exceeds refundable remaining %',
        COALESCE(NEW.amount, 0),
        v_refundable_remaining;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallet_financial_truth_internal(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_truth jsonb;
  v_legacy_customer boolean := false;
  v_has_recorded_funding boolean := false;
  v_manual_review boolean := false;
  v_policy_available numeric := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_user_required';
  END IF;

  WITH profile AS (
    SELECT p.id, COALESCE(p.wallet_balance, 0)::numeric AS stored_balance,
      COALESCE(p.account_suspended, false) AS account_suspended,
      COALESCE(p.wallet_review_required, false) AS wallet_review_required,
      p.wallet_review_reason, p.wallet_reviewed_by,
      GREATEST(COALESCE(p.financial_security_version, 1), 1) AS security_version
    FROM public.profiles p
    WHERE p.id = p_user_id
  ),
  legacy AS (
    SELECT COALESCE(MAX(f.grandfathered_principal), 0)::numeric AS principal,
      COUNT(f.user_id)::integer AS baseline_rows
    FROM public.wallet_legacy_funding f
    WHERE f.user_id = p_user_id
  ),
  historical_admin AS (
    SELECT COALESCE(SUM(h.amount), 0)::numeric AS amount,
      COUNT(*)::integer AS recovery_rows
    FROM public.wallet_historical_admin_funding h
    WHERE h.user_id = p_user_id
  ),
  ledger AS (
    SELECT t.*,
      lower(COALESCE(t.type, '')) AS movement_type,
      lower(COALESCE(t.status, 'completed')) AS movement_status
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
  ),
  legacy_chronology AS (
    SELECT
      min(t.created_at) FILTER (WHERE t.amount < 0) AS first_debit_at,
      min(t.created_at) FILTER (
        WHERE t.amount > 0
          AND t.movement_type IN (
            'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit',
            'deposit', 'credit', 'admin_credit', 'staff_credit',
            'promotion_credit', 'correction_credit'
          )
          AND NOT (
            t.movement_type = 'admin_credit'
            AND (
              COALESCE(t.metadata->>'source', '') = 'admin-ledger-repair'
              OR COALESCE(t.metadata->>'balance_unchanged', '') = 'true'
              OR COALESCE(t.metadata->>'requires_owner_evidence', '') = 'true'
              OR COALESCE(t.balance_after, 0) <= COALESCE(t.balance_before, 0)
            )
          )
      ) AS first_funding_at
    FROM ledger t
    WHERE t.created_at < public.wallet_legacy_funding_cutoff()
      AND t.movement_status IN (
        'completed', 'success', 'successful', 'credited',
        'complete', 'paid', 'finished'
      )
  ),
  posted AS (
    SELECT t.*
    FROM ledger t
    WHERE (
      t.movement_status IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      OR (
        t.amount < 0
        AND t.balance_before IS NOT NULL
        AND t.balance_after IS NOT NULL
        AND round(t.balance_before - t.balance_after, 2) = round(abs(t.amount), 2)
      )
    )
    AND NOT (
      t.movement_type IN ('admin_credit', 'correction_credit')
      AND t.amount > 0
      AND t.balance_before IS NOT NULL
      AND t.balance_after IS NOT NULL
      AND t.balance_before = t.balance_after
      AND COALESCE(t.metadata->>'source', '') = 'admin-ledger-repair'
      AND COALESCE(t.metadata->>'balance_unchanged', '') = 'true'
      AND COALESCE(t.metadata->>'requires_owner_evidence', '') = 'true'
    )
  ),
  classified AS (
    SELECT t.*,
      t.amount < 0 AS is_debit,
      t.amount > 0 AND
        t.movement_type IN ('refund', 'purchase_refund', 'auto_refund') AS is_refund,
      t.amount > 0 AND
        t.movement_type NOT IN ('refund', 'purchase_refund', 'auto_refund') AS is_credit,
      (
        t.amount > 0 AND t.movement_type IN
          ('purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal',
           'chargeback', 'correction_debit')
      ) OR (
        t.amount < 0 AND t.movement_type IN
          ('refund', 'purchase_refund', 'auto_refund')
      ) AS sign_conflict,
      t.movement_type IN
        ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
        AS is_gateway_type
    FROM posted t
  ),
  funding_rows AS (
    SELECT t.*,
      (
        t.is_gateway_type
        AND t.amount > 0
        AND t.created_at >= public.wallet_legacy_funding_cutoff()
        AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
        AND CASE
          WHEN COALESCE(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
          THEN (t.metadata->>'verified_amount_ngn')::numeric = t.amount
          ELSE false
        END
        AND (
          (
            lower(COALESCE(t.metadata->>'provider', '')) IN ('ercaspay', 'ercas')
            AND EXISTS (
              SELECT 1 FROM public.pending_payments pp
              WHERE pp.user_id = t.user_id
                AND pp.amount = t.amount
                AND lower(COALESCE(pp.status, 'pending')) = 'credited'
                AND (
                  pp.transaction_reference = NULLIF(btrim(COALESCE(t.reference, '')), '')
                  OR pp.transaction_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                  OR pp.ercas_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
            AND COALESCE(t.metadata->>'webhook_log_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.pocketfi_webhook_logs pwl
              WHERE pwl.id = CASE
                  WHEN COALESCE(t.metadata->>'webhook_log_id', '') ~*
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (t.metadata->>'webhook_log_id')::uuid
                  ELSE NULL
                END
                AND pwl.matched_user_id = t.user_id
                AND COALESCE(pwl.processed, false)
                AND pwl.verified_amount_ngn = t.amount
                AND NULLIF(btrim(COALESCE(pwl.verified_reference, '')), '') IN (
                  NULLIF(btrim(COALESCE(t.reference, '')), ''),
                  NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(t.metadata->>'provider', '')) = 'nowpayments'
            AND public.is_verified_nowpayments_wallet_credit(
              t.user_id, t.amount, t.reference, t.external_payment_id, t.metadata
            )
          )
        )
      ) AS verified_gateway,
      (
        t.movement_type = 'admin_credit'
        AND t.amount > 0
        AND t.created_at >= public.wallet_legacy_funding_cutoff()
        AND COALESCE(t.balance_after, 0) > COALESCE(t.balance_before, 0)
        AND COALESCE(t.metadata->>'source', '') <> 'admin-ledger-repair'
        AND COALESCE(t.metadata->>'balance_unchanged', '') <> 'true'
        AND COALESCE(t.metadata->>'requires_owner_evidence', '') <> 'true'
        AND COALESCE(t.metadata->>'approved_by', '') = t.created_by::text
        AND length(btrim(COALESCE(t.metadata->>'approval_reference', ''))) >= 8
        AND length(btrim(COALESCE(t.metadata->>'reason', ''))) >= 3
        AND (
          (COALESCE(t.metadata->>'source', '') = 'admin-adjust-balance'
            AND COALESCE(t.metadata->>'approval_type', '') = 'direct_admin_adjustment')
          OR (COALESCE(t.metadata->>'source', '') = 'manage-staff'
            AND COALESCE(t.metadata->>'approval_type', '') = 'staff_action_review')
        )
      ) AS approved_admin
    FROM classified t
  ),
  funding AS (
    SELECT COALESCE(SUM(amount) FILTER (WHERE verified_gateway), 0)::numeric
        AS verified_gateway_deposits,
      COALESCE(SUM(amount) FILTER (WHERE approved_admin), 0)::numeric
        AS approved_admin_credits,
      COUNT(*) FILTER (WHERE verified_gateway)::integer AS verified_payment_rows,
      COUNT(*) FILTER (WHERE approved_admin)::integer AS approved_admin_rows
    FROM funding_rows
  ),
  recovered_pocketfi AS (
    SELECT COALESCE(SUM(t.amount), 0)::numeric AS amount,
      COUNT(*)::integer AS payment_rows
    FROM public.wallet_provider_confirmations c
    JOIN public.transactions t
      ON t.id = c.transaction_id
      AND t.user_id = c.user_id
      AND t.reference = c.provider_reference
      AND t.amount = c.confirmed_amount
    JOIN public.profiles pc ON pc.id = t.user_id
    WHERE t.user_id = p_user_id
      AND lower(COALESCE(t.type, '')) IN
        ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      AND lower(COALESCE(t.status, '')) IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
      AND COALESCE(t.balance_type, 'wallet') = 'wallet'
      AND t.amount > 0
      AND t.created_at >= public.wallet_legacy_funding_cutoff()
      AND t.created_at < '2026-09-24 00:00:00+00'::timestamptz
      AND NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NULL
      AND c.provider = 'pocketfi'
      AND c.provider_status = 'completed'
      AND c.provider_checked_at >= t.created_at
      AND EXISTS (
        SELECT 1
        FROM public.pocketfi_webhook_logs w
        WHERE w.matched_user_id = t.user_id
          AND w.matched_account_number = pc.pocketfi_account_number
          AND w.processed
          AND w.error_message IS NULL
          AND w.raw_payload::jsonb->'transaction'->>'reference' = t.reference
          AND (w.raw_payload::jsonb->'order'->>'amount')::numeric = t.amount
      )
  ),
  recovered_ercas_missing AS (
    SELECT COALESCE(SUM(c.confirmed_amount), 0)::numeric AS amount,
      COUNT(*)::integer AS payment_rows
    FROM public.wallet_missing_gateway_funding c
    JOIN public.pending_payments pp
      ON pp.id = c.pending_payment_id
      AND pp.user_id = c.user_id
      AND pp.transaction_reference = c.provider_reference
      AND pp.amount = c.confirmed_amount
    WHERE c.user_id = p_user_id
      AND c.provider = 'ercaspay'
      AND c.provider_status = 'SUCCESSFUL'
      AND c.balance_already_includes_amount
      AND c.provider_checked_at >= pp.created_at
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = c.user_id
          AND t.reference = c.provider_reference
          AND lower(COALESCE(t.type, '')) IN
            ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
      )
  ),
  duplicate_payment_identities AS (
    SELECT COUNT(*)::integer AS count
    FROM (
      SELECT 'external:' || lower(COALESCE(t.metadata->>'provider', '')) || ':' ||
        btrim(t.external_payment_id) AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
      GROUP BY 1
      HAVING COUNT(*) > 1

      UNION ALL

      SELECT 'ercas-evidence:' || pp.id::text AS identity
      FROM funding_rows t
      JOIN public.pending_payments pp
        ON pp.user_id = t.user_id
        AND pp.amount = t.amount
        AND lower(COALESCE(pp.status, 'pending')) = 'credited'
        AND (
          pp.transaction_reference = NULLIF(btrim(COALESCE(t.reference, '')), '')
          OR pp.transaction_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          OR pp.ercas_reference = NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
        )
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
      GROUP BY pp.id
      HAVING COUNT(DISTINCT t.id) > 1

      UNION ALL

      SELECT 'pocketfi-evidence:' || (t.metadata->>'webhook_log_id') AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
      GROUP BY t.metadata->>'webhook_log_id'
      HAVING COUNT(DISTINCT t.id) > 1

      UNION ALL

      SELECT DISTINCT 'cross-wallet-reference:' || t.id::text AS identity
      FROM funding_rows t
      JOIN public.transactions other_credit
        ON other_credit.user_id <> t.user_id
        AND COALESCE(other_credit.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(other_credit.type, '')) IN
          ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
        AND lower(COALESCE(other_credit.status, 'completed')) IN
          ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
        AND other_credit.amount > 0
        AND other_credit.created_at >= public.wallet_legacy_funding_cutoff()
        AND NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(other_credit.metadata->>'verified_amount_ngn', '') ~
          '^[0-9]+([.][0-9]{1,2})?$'
        AND (other_credit.metadata->>'verified_amount_ngn')::numeric = other_credit.amount
        AND (
          (
            lower(COALESCE(other_credit.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            AND EXISTS (
              SELECT 1 FROM public.pending_payments other_payment
              WHERE other_payment.user_id = other_credit.user_id
                AND other_payment.amount = other_credit.amount
                AND lower(COALESCE(other_payment.status, 'pending')) = 'credited'
                AND (
                  other_payment.transaction_reference = NULLIF(btrim(COALESCE(other_credit.reference, '')), '')
                  OR other_payment.transaction_reference = NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                  OR other_payment.ercas_reference = NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(other_credit.metadata->>'provider', '')) = 'pocketfi'
            AND COALESCE(other_credit.metadata->>'webhook_log_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.pocketfi_webhook_logs other_log
              WHERE other_log.id = (other_credit.metadata->>'webhook_log_id')::uuid
                AND other_log.matched_user_id = other_credit.user_id
                AND COALESCE(other_log.processed, false)
                AND other_log.verified_amount_ngn = other_credit.amount
                AND NULLIF(btrim(COALESCE(other_log.verified_reference, '')), '') IN (
                  NULLIF(btrim(COALESCE(other_credit.reference, '')), ''),
                  NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                )
            )
          )
        )
        AND CASE
          WHEN lower(COALESCE(other_credit.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(other_credit.metadata->>'provider', ''))
        END = CASE
          WHEN lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(t.metadata->>'provider', ''))
        END
        AND (
          NULLIF(btrim(COALESCE(other_credit.reference, '')), '') IN (
            NULLIF(btrim(COALESCE(t.reference, '')), ''),
            NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          )
          OR NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '') IN (
            NULLIF(btrim(COALESCE(t.reference, '')), ''),
            NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          )
        )
      WHERE t.verified_gateway
    ) duplicates
  ),
  debits AS (
    SELECT t.*,
      LEAST(
        abs(COALESCE(t.amount, 0)),
        CASE
          WHEN COALESCE(t.metadata->>'trusted_principal_debit_amount', '') ~
            '^[0-9]+(\.[0-9]{1,2})?$'
          THEN (t.metadata->>'trusted_principal_debit_amount')::numeric
          ELSE 0
        END
      ) AS trusted_debit_amount
    FROM classified t
    WHERE t.is_debit
  ),
  eligible_refund_matches AS (
    SELECT DISTINCT ON (r.id)
      r.id AS refund_id, d.id AS debit_id,
      abs(COALESCE(r.amount, 0)) AS refund_amount,
      d.trusted_debit_amount AS debit_amount
    FROM classified r
    JOIN debits d ON d.user_id = r.user_id
      AND d.amount < 0
      AND d.trusted_debit_amount > 0
      AND COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'
      AND (
        public.wallet_refund_links_debit(
          r.metadata, d.id, d.idempotency_key, d.metadata, d.reference
        )
        OR (
          COALESCE(r.metadata, '{}'::jsonb) = '{}'::jsonb
          AND r.created_at >= d.created_at
          AND r.created_at < public.wallet_legacy_funding_cutoff()
          AND d.created_at < public.wallet_legacy_funding_cutoff()
          AND r.amount <= abs(d.amount)
          AND r.reference = 'REFUND-' || d.reference
          AND EXISTS (
            SELECT 1
            FROM public.smm_orders o
            WHERE o.user_id = r.user_id
              AND o.reference = d.reference
              AND o.amount_ngn = abs(d.amount)
              AND o.status IN ('cancelled', 'partial')
          )
        )
      )
    WHERE r.is_refund AND r.amount > 0
    ORDER BY r.id,
      CASE
        WHEN NULLIF(btrim(COALESCE(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text THEN 0
        WHEN NULLIF(btrim(COALESCE(d.idempotency_key, '')), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(
            r.metadata->>'source_debit_idempotency_key',
            r.metadata->>'original_purchase_idempotency_key', ''
          )), '') = d.idempotency_key THEN 1
        ELSE 2
      END,
      d.created_at DESC, d.id DESC
  ),
  refunds_by_debit AS (
    SELECT debit_id, debit_amount,
      LEAST(SUM(refund_amount), debit_amount) AS eligible_amount
    FROM eligible_refund_matches
    GROUP BY debit_id, debit_amount
  ),
  refunds AS (
    SELECT COALESCE(SUM(eligible_amount), 0)::numeric AS linked_eligible_refunds
    FROM refunds_by_debit
  ),
  legacy_failed_smm_cycles AS (
    SELECT COALESCE(SUM(r.amount), 0)::numeric AS neutral_refunds
    FROM public.transactions d
    JOIN public.transactions r
      ON r.user_id = d.user_id
      AND r.reference = 'REFUND-' || d.reference
      AND lower(COALESCE(r.type, '')) = 'refund'
      AND lower(COALESCE(r.status, '')) = 'completed'
      AND r.amount = abs(d.amount)
      AND COALESCE(r.metadata, '{}'::jsonb) = '{}'::jsonb
    JOIN public.smm_orders o
      ON o.user_id = d.user_id
      AND o.reference = d.reference
      AND o.status = 'failed'
      AND o.amount_ngn = abs(d.amount)
    WHERE d.user_id = p_user_id
      AND COALESCE(d.balance_type, 'wallet') = 'wallet'
      AND COALESCE(r.balance_type, 'wallet') = 'wallet'
      AND lower(COALESCE(d.type, '')) = 'purchase'
      AND lower(COALESCE(d.status, '')) = 'failed'
      AND d.amount < 0
      AND d.balance_before IS NULL
      AND d.balance_after IS NOT NULL
      AND r.balance_after IS NOT NULL
      AND r.balance_after - d.balance_after = r.amount
      AND d.created_at <= r.created_at
      AND d.created_at < public.wallet_legacy_funding_cutoff()
      AND r.created_at < public.wallet_legacy_funding_cutoff()
  ),
  movements AS (
    SELECT
      COALESCE(SUM(abs(amount)) FILTER (WHERE is_debit), 0)::numeric AS completed_debits,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'purchase' AND amount < 0), 0)::numeric
        AS completed_purchases,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'withdrawal' AND amount < 0), 0)::numeric
        AS withdrawals,
      COALESCE(SUM(abs(amount)) FILTER (WHERE movement_type = 'chargeback' AND amount < 0), 0)::numeric
        AS chargebacks,
      COALESCE(SUM(abs(amount)) FILTER (WHERE is_refund AND amount > 0), 0)::numeric
        AS completed_refunds,
      COALESCE(SUM(
        CASE
          WHEN is_debit THEN -abs(amount)
          WHEN is_credit OR is_refund THEN abs(amount)
          ELSE amount
        END
      ), 0)::numeric AS expected_ledger_balance,
      COUNT(*) FILTER (WHERE amount IS NULL OR amount = 0
        OR sign_conflict)::integer
        AS unclassified_posted_rows,
      COUNT(*) FILTER (WHERE upper(COALESCE(currency, 'NGN')) <> 'NGN')::integer
        AS unsupported_currency_rows,
      COUNT(*) FILTER (WHERE amount < 0 AND movement_status NOT IN
        ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished'))::integer
        AS posted_debits_with_noncompleted_status
    FROM classified
  ),
  holds AS (
    SELECT COALESCE(SUM(r.amount), 0)::numeric AS active_reservations,
      COUNT(*)::integer AS active_reservation_count
    FROM public.wallet_reservations r
    WHERE r.user_id = p_user_id
      AND upper(COALESCE(r.currency, 'NGN')) = 'NGN'
      AND r.status IN ('active', 'review_required')
  ),
  facts AS (
    SELECT p.*, l.principal AS legacy_principal, l.baseline_rows,
      c.first_debit_at AS legacy_first_debit_at,
      c.first_funding_at AS legacy_first_funding_at,
      (f.verified_gateway_deposits + q.amount + e.amount) AS verified_gateway_deposits,
      (f.approved_admin_credits + a.amount) AS approved_admin_credits,
      a.amount AS approved_historical_admin_credits,
      (f.verified_payment_rows + q.payment_rows + e.payment_rows) AS verified_payment_rows,
      (f.approved_admin_rows + a.recovery_rows) AS approved_admin_rows,
      a.recovery_rows AS approved_historical_admin_rows,
      (l.principal + f.verified_gateway_deposits + q.amount + e.amount + f.approved_admin_credits + a.amount)
        AS trusted_principal,
      m.completed_debits, m.completed_purchases, m.withdrawals, m.chargebacks,
      m.completed_refunds,
      (m.expected_ledger_balance - n.neutral_refunds) AS recorded_transaction_balance,
      (m.expected_ledger_balance - n.neutral_refunds + a.amount + e.amount) AS expected_ledger_balance,
      m.unclassified_posted_rows,
      m.unsupported_currency_rows,
      m.posted_debits_with_noncompleted_status,
      LEAST(r.linked_eligible_refunds, m.completed_debits)
        AS eligible_refunds,
      h.active_reservations, h.active_reservation_count,
      d.count AS duplicate_payment_identities
    FROM profile p
    CROSS JOIN legacy l
    CROSS JOIN legacy_chronology c
    CROSS JOIN historical_admin a
    CROSS JOIN funding f
    CROSS JOIN recovered_pocketfi q
    CROSS JOIN recovered_ercas_missing e
    CROSS JOIN movements m
    CROSS JOIN legacy_failed_smm_cycles n
    CROSS JOIN refunds r
    CROSS JOIN holds h
    CROSS JOIN duplicate_payment_identities d
  ),
  balances AS (
    SELECT facts.*,
      (trusted_principal - completed_debits + eligible_refunds) AS trusted_book_balance,
      (stored_balance - expected_ledger_balance) AS unexplained_difference,
      (expected_ledger_balance -
        (trusted_principal - completed_debits + eligible_refunds)) AS explained_difference
    FROM facts
  )
  SELECT jsonb_build_object(
    'user_id', b.id,
    'currency', 'NGN',
    'verified_gateway_deposits', b.verified_gateway_deposits,
    'approved_admin_credits', b.approved_admin_credits,
    'approved_historical_admin_credits', b.approved_historical_admin_credits,
    'legacy_approved_principal', b.legacy_principal,
    'legacy_first_recorded_debit_at', b.legacy_first_debit_at,
    'legacy_first_recorded_funding_at', b.legacy_first_funding_at,
    'legacy_spend_before_recorded_funding',
      b.legacy_first_debit_at IS NOT NULL
      AND (b.legacy_first_funding_at IS NULL
        OR b.legacy_first_debit_at < b.legacy_first_funding_at),
    'trusted_principal', b.trusted_principal,
    'completed_debits', b.completed_debits,
    'completed_purchases', b.completed_purchases,
    'eligible_refunds', b.eligible_refunds,
    'completed_refunds', b.completed_refunds,
    'active_reservations', b.active_reservations,
    'active_reservation_count', b.active_reservation_count,
    'withdrawals', b.withdrawals,
    'chargebacks', b.chargebacks,
    'trusted_book_balance', b.trusted_book_balance,
    'trusted_available_before_holds', GREATEST(LEAST(b.trusted_book_balance, b.stored_balance), 0),
    'net_consumed_spend', GREATEST(b.completed_debits - b.eligible_refunds, 0),
    'spend_exposure', GREATEST(
      b.completed_debits - b.eligible_refunds - b.trusted_principal, 0
    ),
    'confirmed_spendable', CASE
      WHEN b.unclassified_posted_rows > 0 OR b.duplicate_payment_identities > 0
        OR b.unsupported_currency_rows > 0 THEN 0
      ELSE GREATEST(LEAST(b.trusted_book_balance, b.stored_balance) - b.active_reservations, 0)
    END,
    'expected_ledger_balance', b.expected_ledger_balance,
    'recorded_transaction_balance', b.recorded_transaction_balance,
    'stored_wallet_balance', b.stored_balance,
    'explained_difference', b.explained_difference,
    'unexplained_difference', b.unexplained_difference,
    'quarantined_excess', GREATEST(b.stored_balance - b.trusted_book_balance, 0),
    'integrity_status', CASE
      WHEN b.duplicate_payment_identities > 0 THEN 'payment_identity_conflict'
      WHEN b.unsupported_currency_rows > 0 THEN 'unsupported_wallet_currency'
      WHEN b.unclassified_posted_rows > 0 THEN 'unclassified_ledger_movement'
      WHEN b.trusted_book_balance < 0 THEN 'backed_funds_exhausted'
      WHEN b.stored_balance > b.trusted_book_balance THEN 'quarantined_excess'
      WHEN b.stored_balance < b.expected_ledger_balance THEN 'stored_balance_deficit'
      ELSE 'consistent'
    END,
    'evidence_complete', b.unclassified_posted_rows = 0
      AND b.duplicate_payment_identities = 0
      AND b.unsupported_currency_rows = 0,
    'unclassified_posted_rows', b.unclassified_posted_rows,
    'unsupported_currency_rows', b.unsupported_currency_rows,
    'posted_debits_with_noncompleted_status', b.posted_debits_with_noncompleted_status,
    'duplicate_payment_identities', b.duplicate_payment_identities,
    'verified_payment_rows', b.verified_payment_rows,
    'approved_admin_rows', b.approved_admin_rows,
    'approved_historical_admin_rows', b.approved_historical_admin_rows,
    'account_suspended', b.account_suspended,
    'wallet_review_required', b.wallet_review_required,
    'wallet_review_reason', b.wallet_review_reason,
    'spending_blocked',
      b.account_suspended
      OR b.duplicate_payment_identities > 0
      OR b.unsupported_currency_rows > 0
      OR b.unclassified_posted_rows > 0
      OR b.trusted_book_balance < 0
      OR (
        b.wallet_review_required
        AND NOT (
          b.wallet_reviewed_by IS NULL
          AND b.stored_balance > b.trusted_book_balance
          AND (
            b.wallet_review_reason LIKE 'Auto-suspended: displayed wallet balance %'
            OR b.wallet_review_reason LIKE
              'Wallet frozen: requested purchase % exceeds backed available funds %'
            OR b.wallet_review_reason LIKE
              'Wallet financial review: quarantined displayed excess %'
          )
        )
      ),
    'financial_security_version', b.security_version
  ) INTO v_truth
  FROM balances b;

  IF v_truth IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_profile_not_found';
  END IF;
  -- Existing available funds are preserved once. New capacity must come
  -- from verified Ercas/PocketFi evidence already included in canonical truth.
  SELECT COALESCE(p.wallet_review_required, false)
      AND p.wallet_reviewed_by IS NOT NULL
    INTO v_manual_review
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT LEAST(
      GREATEST((v_truth->>'stored_wallet_balance')::numeric, 0),
      GREATEST(LEAST(
        s.baseline_available
          + (v_truth->>'verified_gateway_deposits')::numeric
          - s.gateway_deposits_at_snapshot,
        s.baseline_available
          + (v_truth->>'verified_gateway_deposits')::numeric
          - s.gateway_deposits_at_snapshot
          - ((v_truth->>'completed_debits')::numeric
             - s.completed_debits_at_snapshot)
          + ((v_truth->>'eligible_refunds')::numeric
             - s.eligible_refunds_at_snapshot)
      ), 0)
    ) INTO v_policy_available
  FROM public.wallet_legacy_spend_allowance_snapshot s
  WHERE s.user_id = p_user_id;

  IF NOT FOUND THEN
    -- Accounts with no existing allowance start at zero. A later verified
    -- deposit can be used even if older unverified spending exhausted a
    -- separate historical balance.
    v_policy_available := LEAST(
      GREATEST((v_truth->>'stored_wallet_balance')::numeric, 0),
      GREATEST(LEAST(
        (v_truth->>'verified_gateway_deposits')::numeric,
        (v_truth->>'verified_gateway_deposits')::numeric
          - (v_truth->>'completed_debits')::numeric
          + (v_truth->>'eligible_refunds')::numeric
      ), 0)
    );
  END IF;

  v_truth := v_truth || jsonb_build_object(
    'trusted_available_before_holds', v_policy_available,
    'confirmed_spendable', GREATEST(
      v_policy_available - (v_truth->>'active_reservations')::numeric, 0
    ),
    'authorization_basis', CASE
      WHEN v_policy_available > 0 THEN 'legacy_snapshot_or_verified_gateway'
      ELSE 'verified_gateway_required'
    END
  );

  -- Automatic fraud flags are not customer holds. Deliberate reviewer-set
  -- holds and account suspensions remain enforceable.
  v_truth := v_truth || jsonb_build_object(
    'spending_blocked', (v_truth->>'account_suspended')::boolean OR v_manual_review
  );
  RETURN v_truth;
END;
$function$;
