-- Existing JWTs must not keep access to financial and supplier investigation
-- RPCs after the corresponding administrator account is suspended.
DO $patch$
DECLARE
  v_signature text;
  v_definition text;
  v_old text := 'WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)';
  v_new text := 'WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false) AND NOT COALESCE(p.account_suspended, false)';
BEGIN
  IF to_regclass('public.profiles') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'account_suspended' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'admin_rpc_suspension_required_profile_missing';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_admin_wallet_financial_truth(uuid)',
    'public.get_admin_wallet_financial_truth_page(uuid,integer)',
    'public.get_admin_fraud_latest_visits(uuid[])',
    'public.get_admin_cross_wallet_payment_conflicts_page(text,integer)',
    'public.get_admin_smm_services(text)',
    'public.set_admin_smm_service_active(bigint,text,boolean)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'admin_rpc_suspension_function_missing: %', v_signature;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
      INTO v_definition;
    IF length(v_definition) - length(replace(v_definition, v_old, ''))
      <> length(v_old) THEN
      RAISE EXCEPTION 'admin_rpc_suspension_unexpected_definition: %', v_signature;
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
  END LOOP;
END;
$patch$;
