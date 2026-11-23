-- Recover only a complete, saved allocation rejection. No supplier request,
-- owner override, direct balance write or caller-supplied provider proof.
CREATE FUNCTION public.recover_sms_saved_no_balance(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  customer_id uuid;
  current_order public.sms_orders%ROWTYPE;
  reply jsonb;
  reply_body jsonb;
  observed timestamptz;
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO customer_id FROM public.sms_orders WHERE id=p_order_id;
  IF customer_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  -- Match the wallet engine and canonical refund lock order.
  PERFORM 1 FROM public.profiles WHERE id=customer_id FOR UPDATE;
  SELECT * INTO current_order FROM public.sms_orders WHERE id=p_order_id FOR UPDATE;
  reply := current_order.last_provider_response->'allocation_reply';
  IF reply->>'provider' IS DISTINCT FROM 'daisysms'
    OR reply->>'action' IS DISTINCT FROM 'getNumber'
    OR reply->'http_status' IS DISTINCT FROM '402'::jsonb
    OR reply->'body_complete' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(reply->'body') IS DISTINCT FROM 'string'
    OR length(reply->>'body') > 512
    OR current_order.status NOT IN ('processing','cancelled') THEN
    RETURN jsonb_build_object('success',false,'code','SAVED_DECLINE_NOT_VERIFIED');
  END IF;
  BEGIN
    reply_body := (reply->>'body')::jsonb;
    observed := (reply->>'observed_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success',false,'code','SAVED_DECLINE_NOT_VERIFIED');
  END;
  IF reply_body IS DISTINCT FROM '{"title":"NO_BALANCE","details":"Payment Required"}'::jsonb
    OR observed IS NULL OR current_order.created_at IS NULL
    OR observed < current_order.created_at
    OR observed > current_order.created_at + interval '60 seconds' THEN
    RETURN jsonb_build_object('success',false,'code','SAVED_DECLINE_NOT_VERIFIED');
  END IF;
  -- This transaction verifies the original debit, undelivered/unallocated
  -- state, existing linked refunds and the posted wallet result atomically.
  result := public.cancel_sms_order_and_refund(p_order_id,'saved_no_balance_recovery',
    jsonb_build_object('phase','allocation','activation_id','','response','NO_MONEY',
      'observed_at',reply->>'observed_at'),NULL,false);
  IF result->>'success' = 'true' THEN
    UPDATE public.sms_orders SET last_provider_response = last_provider_response ||
      jsonb_build_object('allocation_decline_recovery',jsonb_build_object(
        'source','saved_allocation_reply','http_status',402,'title','NO_BALANCE',
        'canonical_response','NO_MONEY','observed_at',reply->>'observed_at'))
    WHERE id=p_order_id;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.recover_sms_saved_no_balance(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_sms_saved_no_balance(uuid) TO service_role;
