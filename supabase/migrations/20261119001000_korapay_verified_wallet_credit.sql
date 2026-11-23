-- Kora evidence is registered before checkout and verified before credit. No
-- historical deposits or balances are changed by this migration.
BEGIN;
CREATE TABLE public.korapay_checkouts (
  reference text PRIMARY KEY CHECK (reference ~ '^KORA-[a-f0-9-]{36}$'),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  idempotency_key text NOT NULL,
  amount_ngn numeric NOT NULL CHECK (amount_ngn >= 100 AND amount_ngn <= 1000000 AND amount_ngn = trunc(amount_ngn)),
  state text NOT NULL CHECK (state IN ('prepared','sending','pending','credited')),
  checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,idempotency_key)
);
ALTER TABLE public.korapay_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.korapay_checkouts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.korapay_checkouts TO service_role;
CREATE TABLE private.korapay_wallet_proofs (
  reference text PRIMARY KEY REFERENCES public.korapay_checkouts(reference),
  user_id uuid NOT NULL,
  amount_ngn numeric NOT NULL,
  currency text NOT NULL CHECK (currency = 'NGN'),
  provider_status text NOT NULL CHECK (provider_status = 'success'),
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.korapay_wallet_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.korapay_wallet_proofs FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.reject_korapay_proof_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'korapay_evidence_immutable'; END $$;
CREATE TRIGGER korapay_proof_immutable BEFORE UPDATE OR DELETE ON private.korapay_wallet_proofs
FOR EACH ROW EXECUTE FUNCTION private.reject_korapay_proof_mutation();
CREATE TRIGGER korapay_proof_no_truncate BEFORE TRUNCATE ON private.korapay_wallet_proofs
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_korapay_proof_mutation();
CREATE FUNCTION public.is_verified_gateway_wallet_credit(uuid,numeric,text,text,jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN $5->>'provider' = 'korapay' THEN EXISTS (
    SELECT 1 FROM private.korapay_wallet_proofs e
    JOIN public.korapay_checkouts q USING (reference)
    WHERE e.reference = $3 AND e.user_id = $1 AND q.user_id = $1
      AND e.amount_ngn = $2 AND q.amount_ngn = $2 AND e.currency = 'NGN'
      AND e.provider_status = 'success' AND $4 = 'korapay:' || $3
      AND $5->>'korapay_reference' = $3
  ) ELSE public.is_verified_nowpayments_wallet_credit($1,$2,$3,$4,$5) END
$$;
REVOKE ALL ON FUNCTION public.is_verified_gateway_wallet_credit(uuid,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_gateway_wallet_credit(uuid,numeric,text,text,jsonb) TO service_role;

-- Extend the three canonical evidence consumers without replacing unrelated
-- wallet fixes. Fail the whole migration if the deployed definitions differ.
DO $patch$
DECLARE fn record; source text; patched text;
BEGIN
  FOR fn IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('apply_wallet_transaction','guard_trusted_principal_transaction','wallet_financial_truth_internal')
  LOOP
    source := pg_get_functiondef(fn.oid);
    IF strpos(source,'public.is_verified_nowpayments_wallet_credit(') = 0 THEN
      RAISE EXCEPTION 'Kora migration precondition failed: % lacks current evidence contract',fn.proname;
    END IF;
    patched := replace(source,'public.is_verified_nowpayments_wallet_credit(','public.is_verified_gateway_wallet_credit(');
    IF fn.proname='wallet_financial_truth_internal' THEN
      patched := replace(patched, $old$lower(COALESCE(t.metadata->>'provider', '')) = 'nowpayments'$old$,
        $new$lower(COALESCE(t.metadata->>'provider', '')) IN ('nowpayments','korapay')$new$);
    ELSIF fn.proname='guard_trusted_principal_transaction' THEN
      patched := replace(patched, $old$lower(COALESCE(NEW.metadata->>'provider', '')) = 'nowpayments'$old$,
        $new$lower(COALESCE(NEW.metadata->>'provider', '')) IN ('nowpayments','korapay')$new$);
    ELSE
      patched := replace(patched, $old$lower(COALESCE(p_metadata->>'provider', '')) = 'nowpayments'$old$,
        $new$lower(COALESCE(p_metadata->>'provider', '')) IN ('nowpayments','korapay')$new$);
    END IF;
    IF strpos(patched,$check$IN ('nowpayments','korapay')$check$)=0 THEN
      RAISE EXCEPTION 'Kora migration precondition failed: % has unknown provider branch',fn.proname;
    END IF;
    EXECUTE patched;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('apply_wallet_transaction','guard_trusted_principal_transaction','wallet_financial_truth_internal')) <> 3 THEN
    RAISE EXCEPTION 'Kora migration requires all three canonical wallet functions';
  END IF;
END $patch$;
CREATE UNIQUE INDEX transactions_korapay_one_credit ON public.transactions(external_payment_id)
WHERE metadata->>'provider'='korapay' AND type IN ('topup','top_up','top-up','wallet_topup','wallet_deposit','deposit');

CREATE FUNCTION public.settle_korapay_checkout(p_reference text,p_verified_amount numeric,p_currency text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.korapay_checkouts%ROWTYPE; result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO q FROM public.korapay_checkouts WHERE reference=p_reference;
  IF NOT FOUND OR p_currency IS DISTINCT FROM 'NGN' OR p_status IS DISTINCT FROM 'success'
    OR p_verified_amount IS DISTINCT FROM q.amount_ngn THEN RETURN jsonb_build_object('success',false,'code','PAYMENT_EVIDENCE_MISMATCH'); END IF;
  PERFORM 1 FROM public.profiles WHERE id=q.user_id FOR UPDATE;
  SELECT * INTO q FROM public.korapay_checkouts WHERE reference=p_reference FOR UPDATE;
  INSERT INTO private.korapay_wallet_proofs(reference,user_id,amount_ngn,currency,provider_status)
    VALUES(q.reference,q.user_id,q.amount_ngn,'NGN','success') ON CONFLICT(reference) DO NOTHING;
  result := public.apply_wallet_transaction(p_user_id:=q.user_id,p_type:='topup',p_amount:=q.amount_ngn,
    p_reference:=q.reference,p_description:='Wallet top-up via Kora',p_idempotency_key:='korapay:'||q.reference,
    p_metadata:=jsonb_build_object('provider','korapay','source','korapay-webhook','verified_amount_ngn',q.amount_ngn,
      'verified_currency','NGN','korapay_reference',q.reference),p_currency:='NGN',p_balance_type:='wallet',
    p_external_payment_id:='korapay:'||q.reference,p_created_by:=NULL);
  IF COALESCE((result->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'korapay_credit_unconfirmed'; END IF;
  UPDATE public.korapay_checkouts SET state='credited' WHERE reference=q.reference;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.settle_korapay_checkout(text,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_korapay_checkout(text,numeric,text,text) TO service_role;
COMMIT;
