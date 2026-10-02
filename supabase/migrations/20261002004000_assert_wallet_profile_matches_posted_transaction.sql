-- A payment transaction must never be reported as successful while its
-- corresponding profile balance still holds the old value. A past PocketFi
-- credit exposed this failure mode, so make the wallet RPC fail atomically.
DO $patch$
DECLARE
  v_signature constant regprocedure :=
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure;
  v_definition text;
  v_anchor constant text := E'  UPDATE public.transactions\n     SET transaction_hash = encode(';
  v_guard constant text := $guard$  IF NOT EXISTS (
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

$guard$;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF current_user <> 'postgres'
    OR v_definition IS NULL
    OR (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1
    OR strpos(v_definition, 'Wallet profile balance did not match posted transaction') > 0
  THEN
    RAISE EXCEPTION 'Wallet function changed; refusing unsafe patch';
  END IF;

  EXECUTE replace(v_definition, v_anchor, v_guard || v_anchor);

  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF strpos(v_definition, 'Wallet profile balance did not match posted transaction') = 0 THEN
    RAISE EXCEPTION 'Wallet profile persistence guard was not installed';
  END IF;
END;
$patch$;
