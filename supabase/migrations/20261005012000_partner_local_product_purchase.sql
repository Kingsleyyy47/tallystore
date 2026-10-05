-- Local-stock partner product purchases commit inventory, partner funding, an
-- immutable obligation, and the delivered order in one database transaction.
-- Supplier-backed services remain outside this function.
CREATE TABLE public.api_partner_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES public.api_partner_orders(id) ON DELETE RESTRICT,
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  balance_before numeric(18,2),
  balance_after numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_partner_obligations_partner_created_idx
  ON public.api_partner_obligations(partner_id, created_at DESC);
ALTER TABLE public.api_partner_obligations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_partner_obligations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.api_partner_obligations TO service_role;

CREATE FUNCTION public.guard_api_partner_obligation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'partner_obligation_is_immutable';
END;
$$;
CREATE TRIGGER api_partner_obligation_immutable
BEFORE UPDATE OR DELETE ON public.api_partner_obligations
FOR EACH ROW EXECUTE FUNCTION public.guard_api_partner_obligation_immutable();
REVOKE ALL ON FUNCTION public.guard_api_partner_obligation_immutable()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.purchase_api_partner_local_product(
  p_key_id uuid, p_product_group_id uuid, p_quantity integer,
  p_expected_amount numeric, p_idempotency_key text,
  p_partner_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key public.api_partner_keys%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_existing public.api_partner_orders%ROWTYPE;
  v_order_id uuid := gen_random_uuid();
  v_account_ids uuid[];
  v_accounts jsonb;
  v_amount numeric;
  v_count integer;
  v_balance_before numeric;
  v_balance_after numeric;
  v_funding_type text;
BEGIN
  IF p_product_group_id IS NULL OR p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 500
    OR p_expected_amount IS NULL OR p_expected_amount <= 0
    OR p_expected_amount <> round(p_expected_amount, 2)
    OR length(btrim(coalesce(p_idempotency_key,''))) < 10
    OR length(p_idempotency_key) > 160
    OR length(coalesce(p_partner_reference,'')) > 180 THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST');
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id = p_key_id FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL
    OR NOT ('orders:create' = ANY(v_key.scopes)) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_KEY');
  END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id = v_key.partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.is_active IS DISTINCT FROM true
    OR NOT ('products' = ANY(v_partner.allowed_sections)) THEN
    RETURN jsonb_build_object('success',false,'code','PARTNER_DISABLED');
  END IF;
  SELECT * INTO v_existing FROM public.api_partner_orders
    WHERE partner_id = v_partner.id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.item_type IS DISTINCT FROM 'product'
      OR v_existing.item_id IS DISTINCT FROM p_product_group_id::text
      OR v_existing.quantity IS DISTINCT FROM p_quantity
      OR v_existing.amount_ngn IS DISTINCT FROM p_expected_amount
      OR v_existing.partner_reference IS DISTINCT FROM p_partner_reference THEN
      RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_CONFLICT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.api_partner_obligations
      WHERE order_id = v_existing.id AND partner_id = v_partner.id) THEN
      RETURN jsonb_build_object('success',false,'code','LEGACY_ORDER_REVIEW_REQUIRED');
    END IF;
    RETURN jsonb_build_object('success',true,'idempotency_hit',true,
      'data',jsonb_build_object('id',v_existing.id,'status',v_existing.status,
        'amount_ngn',v_existing.amount_ngn,'response_payload',v_existing.response_payload));
  END IF;
  SELECT * INTO v_product FROM public.product_groups
    WHERE id = p_product_group_id FOR UPDATE;
  IF NOT FOUND OR v_product.is_active IS DISTINCT FROM true
    OR v_product.is_sellable IS DISTINCT FROM true
    OR upper(coalesce(v_product.availability_status,'')) IN ('UNAVAILABLE','PAUSED') THEN
    RETURN jsonb_build_object('success',false,'code','PRODUCT_UNAVAILABLE');
  END IF;
  v_amount := ceil(coalesce(v_product.price,0) * p_quantity *
    (1 + greatest(coalesce(v_partner.markup_percent,0),0) / 100));
  IF v_amount <= 0 OR v_amount > 1000000000
    OR p_expected_amount IS DISTINCT FROM v_amount THEN
    RETURN jsonb_build_object('success',false,'code','PRICE_CHANGED');
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_account_ids
  FROM (SELECT id FROM public.individual_accounts
    WHERE product_group_id = p_product_group_id AND status = 'available'
    ORDER BY id LIMIT p_quantity FOR UPDATE SKIP LOCKED) available;
  IF cardinality(v_account_ids) <> p_quantity THEN
    RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_STOCK');
  END IF;

  v_balance_before := v_partner.balance_ngn;
  IF v_partner.unlimited_credit IS TRUE THEN
    v_funding_type := 'unlimited_credit';
    v_balance_after := v_balance_before;
  ELSE
    IF v_balance_before < v_amount THEN
      RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_PARTNER_BALANCE');
    END IF;
    v_funding_type := 'prepaid';
    v_balance_after := v_balance_before - v_amount;
    UPDATE public.api_partners SET balance_ngn = v_balance_after,
      updated_at = now() WHERE id = v_partner.id;
  END IF;

  UPDATE public.individual_accounts SET status = 'sold', sold_at = now()
    WHERE id = ANY(v_account_ids) AND status = 'available';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> p_quantity THEN RAISE EXCEPTION 'partner_inventory_conflict'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'username',a.username,'password',a.password,'email',a.email,
    'email_password',a.email_password,'two_fa_code',a.two_fa_code,
    'recovery_email',a.recovery_email,
    'recovery_email_password',a.recovery_email_password,
    'additional_info',a.additional_info
  ) ORDER BY a.id),'[]'::jsonb) INTO v_accounts
  FROM public.individual_accounts a WHERE a.id = ANY(v_account_ids);

  INSERT INTO public.api_partner_orders(
    id,partner_id,partner_reference,idempotency_key,item_type,item_id,
    item_name,quantity,amount_ngn,status,request_payload,response_payload
  ) VALUES (
    v_order_id,v_partner.id,p_partner_reference,p_idempotency_key,'product',
    p_product_group_id::text,v_product.name,p_quantity,v_amount,'completed',
    jsonb_build_object('product_group_id',p_product_group_id,'quantity',p_quantity,
      'expected_amount_ngn',p_expected_amount),
    jsonb_build_object('product_name',v_product.name,'accounts',v_accounts,
      'partner_balance_after',v_balance_after,'funding_type',v_funding_type)
  );
  INSERT INTO public.api_partner_obligations(partner_id,order_id,amount_ngn,
    funding_type,balance_before,balance_after)
    VALUES(v_partner.id,v_order_id,v_amount,v_funding_type,v_balance_before,v_balance_after);
  SELECT count(*) INTO v_count FROM public.individual_accounts
    WHERE product_group_id = p_product_group_id AND status = 'available';
  UPDATE public.product_groups SET stock_count = v_count,
    availability_status = CASE WHEN v_count = 0 THEN 'UNAVAILABLE'
      WHEN v_count <= 3 THEN 'LOW_STOCK' ELSE 'AVAILABLE' END,
    is_sellable = v_count > 0 WHERE id = p_product_group_id;
  RETURN jsonb_build_object('success',true,'idempotency_hit',false,
    'data',jsonb_build_object('id',v_order_id,'status','completed',
      'amount_ngn',v_amount,'response_payload',jsonb_build_object(
        'product_name',v_product.name,'accounts',v_accounts,
        'partner_balance_after',v_balance_after,'funding_type',v_funding_type)));
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_api_partner_local_product(uuid,uuid,integer,numeric,text,text)
  TO service_role;
