-- Retire legacy balance mutation RPCs during the wallet security review.
--
-- Current wallet changes must go through public.apply_wallet_transaction()
-- from server-side Edge Functions. Older helper RPCs should not be callable by
-- browser roles even if they remain in the schema for history/compatibility.

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    to_regprocedure('public.update_wallet_balance(uuid,numeric,text,text,text)'),
    to_regprocedure('public.credit_crypto_balance(uuid,numeric)'),
    to_regprocedure('public.deduct_crypto_balance(uuid,numeric)'),
    to_regprocedure('public.transfer_crypto_to_wallet(uuid,numeric)'),
    to_regprocedure('public.withdraw_referral_balance_to_wallet(uuid)')
  ]
  LOOP
    IF fn IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;
