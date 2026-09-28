-- A safer replacement signature does not revoke old overloads. Retire every
-- deployed public-schema overload of the known legacy balance writers.
DO $revoke$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'update_wallet_balance', 'credit_crypto_balance',
        'deduct_crypto_balance', 'transfer_crypto_to_wallet',
        'withdraw_referral_balance_to_wallet'
      ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function
    );
  END LOOP;
END;
$revoke$;
