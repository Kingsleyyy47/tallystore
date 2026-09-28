-- Direct browser reads must not expose redemption or raw provider columns.
DO $preflight$
BEGIN
  IF to_regclass('public.bitrefill_orders') IS NULL THEN
    RAISE EXCEPTION 'bitrefill_orders_required';
  END IF;
END;
$preflight$;

REVOKE SELECT ON TABLE public.bitrefill_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, user_id, reference, idempotency_key, product_id, product_name,
  package_id, quantity, recipient_phone, amount_ngn, amount_original,
  currency, payment_source, status, bitrefill_invoice_id, bitrefill_order_id,
  created_at, completed_at
) ON TABLE public.bitrefill_orders TO authenticated;
GRANT SELECT ON TABLE public.bitrefill_orders TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_bitrefill_order_history()
RETURNS TABLE (
  id uuid,
  reference text,
  product_name text,
  quantity integer,
  amount_ngn numeric,
  payment_source text,
  status text,
  redemption_code text,
  redemption_link text,
  redemption_pin text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.id, o.reference, o.product_name, o.quantity, o.amount_ngn,
    o.payment_source, o.status,
    CASE WHEN o.status = 'successful' THEN o.redemption_code ELSE NULL END,
    CASE WHEN o.status = 'successful' THEN o.redemption_link ELSE NULL END,
    CASE WHEN o.status = 'successful' THEN o.redemption_pin ELSE NULL END,
    o.created_at
  FROM public.bitrefill_orders o
  WHERE o.user_id = (SELECT auth.uid())
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 10;
$function$;

REVOKE ALL ON FUNCTION public.get_my_bitrefill_order_history()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_bitrefill_order_history()
  TO authenticated;
