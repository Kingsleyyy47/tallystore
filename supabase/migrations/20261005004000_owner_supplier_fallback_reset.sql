-- Only the verified owner Edge action may request this service operation.
-- Lock the same product row used by supplier authorization/dispatch before
-- testing pending outcomes; no check-then-update window can reopen a circuit.
CREATE OR REPLACE FUNCTION public.reset_supplier_product_fallback(p_product_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.product_groups WHERE id=p_product_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PRODUCT_NOT_FOUND'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_attempts attempt
    JOIN public.orders pending_order ON pending_order.id=attempt.order_id
    WHERE pending_order.product_group_id=p_product_group_id AND (
      attempt.status IN ('sending','unknown')
      OR (attempt.status='succeeded' AND pending_order.status='processing')
    )
  ) THEN RETURN jsonb_build_object('success',false,'code','SUPPLIER_RECONCILIATION_PENDING'); END IF;
  UPDATE public.product_groups SET supplier_fallback_blocked=false,supplier_fallback_ready=false
    WHERE id=p_product_group_id;
  RETURN jsonb_build_object('success',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_supplier_product_fallback(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_supplier_product_fallback(uuid) TO service_role;
