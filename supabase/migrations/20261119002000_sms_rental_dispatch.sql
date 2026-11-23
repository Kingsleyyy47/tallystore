BEGIN;
CREATE TABLE public.sms_rental_operations (
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.profiles(id),
  idempotency_key text NOT NULL,parent_order_id uuid REFERENCES public.sms_orders(id),
  order_id uuid NOT NULL,area_code text NOT NULL,months integer NOT NULL CHECK(months BETWEEN 1 AND 12),
  amount_ngn numeric NOT NULL CHECK(amount_ngn>0),reference text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('prepared','sending','bound')),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,idempotency_key)
);
ALTER TABLE public.sms_rental_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_rental_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sms_rental_operations TO service_role;
CREATE FUNCTION public.claim_sms_rental_dispatch(p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.sms_rental_operations%ROWTYPE; parent public.sms_orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO op FROM public.sms_rental_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.state <> 'prepared' THEN RETURN jsonb_build_object('send_allowed',false); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=op.user_id AND p.is_admin IS DISTINCT FROM true
    AND p.is_staff IS DISTINCT FROM true AND p.account_suspended IS DISTINCT FROM true)
    OR EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id=op.user_id AND t.type IN ('refund','purchase_refund','auto_refund')
      AND (t.reference='REFUND-'||op.reference OR t.metadata->>'source_order_id'=op.order_id::text))
  THEN RETURN jsonb_build_object('send_allowed',false); END IF;
  IF op.parent_order_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sms_orders WHERE id=op.parent_order_id AND user_id=op.user_id FOR UPDATE;
    IF NOT FOUND OR parent.status <> 'active' OR parent.refunded_at IS NOT NULL
      OR parent.provider_payload->>'rental_supplier' IS DISTINCT FROM 'smsbus'
      OR EXISTS(SELECT 1 FROM public.sms_rental_operations other WHERE other.parent_order_id=parent.id AND other.id<>op.id AND other.state='sending')
    THEN RETURN jsonb_build_object('send_allowed',false); END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id=op.user_id AND t.reference=op.reference
    AND t.type='purchase' AND t.status='completed' AND t.amount=-op.amount_ngn)
    OR NOT EXISTS(SELECT 1 FROM public.sms_orders o WHERE o.id=op.order_id AND o.user_id=op.user_id AND o.status='processing')
  THEN RETURN jsonb_build_object('send_allowed',false); END IF;
  UPDATE public.sms_rental_operations SET state='sending' WHERE id=op.id;
  RETURN jsonb_build_object('send_allowed',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_sms_rental_dispatch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_rental_dispatch(uuid) TO service_role;
CREATE FUNCTION public.claim_sms_rental_cancel(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.sms_orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO o FROM public.sms_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.order_type IS DISTINCT FROM 'rental' OR o.status IS DISTINCT FROM 'active'
    OR o.provider_payload->>'rental_supplier' IS DISTINCT FROM 'smsbus' OR o.refunded_at IS NOT NULL
    OR o.created_at < now()-interval '20 minutes' OR jsonb_array_length(COALESCE(o.messages,'[]'))<>0
    OR EXISTS(SELECT 1 FROM public.sms_rental_operations WHERE parent_order_id=o.id)
  THEN RETURN jsonb_build_object('send_allowed',false); END IF;
  UPDATE public.sms_orders SET status='processing' WHERE id=o.id;
  RETURN jsonb_build_object('send_allowed',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_sms_rental_cancel(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_rental_cancel(uuid) TO service_role;
DO $patch$
DECLARE source text;
BEGIN
  source:=pg_get_functiondef('public.cancel_sms_order_and_refund(uuid,text,jsonb,uuid,boolean)'::regprocedure);
  IF strpos(source,$old$v_order.order_type IS DISTINCT FROM 'otp'$old$)=0 THEN RAISE EXCEPTION 'SMS refund contract differs; review migration'; END IF;
  source:=replace(source,$old$v_order.order_type IS DISTINCT FROM 'otp'$old$,
    $new$(v_order.order_type NOT IN ('otp','rental') OR (v_order.order_type='rental' AND v_order.provider_payload->>'rental_supplier' IS DISTINCT FROM 'smsbus'))$new$);
  EXECUTE source;
END $patch$;
COMMIT;
