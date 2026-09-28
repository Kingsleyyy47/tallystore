-- Provider responses are server evidence, not customer-facing order history.
-- The browser still reads its own safe bills columns under existing RLS.
DO $preflight$
BEGIN
  IF to_regclass('public.bills_transactions') IS NULL THEN
    RAISE EXCEPTION 'bills_transactions_required';
  END IF;
END;
$preflight$;

REVOKE SELECT ON TABLE public.bills_transactions
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (sagecloud_response) ON TABLE public.bills_transactions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, user_id, reference, transaction_type, amount, status,
  service_provider, service_code, beneficiary_phone, payment_source,
  sagecloud_reference, created_at, completed_at
) ON TABLE public.bills_transactions TO authenticated;
GRANT SELECT ON TABLE public.bills_transactions TO service_role;
