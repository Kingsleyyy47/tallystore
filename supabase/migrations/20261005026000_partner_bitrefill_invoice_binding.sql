-- A Bitrefill balance invoice is created unpaid, then durably bound to the
-- already-claimed partner journal before POST /invoices/{id}/pay. This table
-- does not pay, capture, release, or alter any customer wallet.
CREATE TABLE private.api_partner_bitrefill_invoice_bindings (
  order_id uuid PRIMARY KEY REFERENCES public.api_partner_external_orders(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn>0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  invoice_id text NOT NULL UNIQUE CHECK (invoice_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  created_status text NOT NULL CHECK (created_status='unpaid'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.api_partner_bitrefill_invoice_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_partner_bitrefill_invoice_bindings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.api_partner_bitrefill_invoice_bindings TO service_role;
CREATE TRIGGER api_partner_bitrefill_invoice_binding_immutable
  BEFORE UPDATE OR DELETE ON private.api_partner_bitrefill_invoice_bindings
  FOR EACH ROW EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER api_partner_bitrefill_invoice_binding_no_truncate
  BEFORE TRUNCATE ON private.api_partner_bitrefill_invoice_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();

CREATE FUNCTION public.bind_api_partner_bitrefill_invoice(
  p_order_id uuid, p_partner_id uuid, p_invoice_id text,
  p_invoice_status text, p_item_id text, p_quantity integer,
  p_amount_ngn numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_discovery public.api_partner_external_orders%ROWTYPE;
  v_key public.api_partner_keys%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_existing private.api_partner_bitrefill_invoice_bindings%ROWTYPE;
  v_invoice_id text:=nullif(btrim(coalesce(p_invoice_id,'')),'');
BEGIN
  IF p_order_id IS NULL OR p_partner_id IS NULL OR v_invoice_id IS NULL
    OR v_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
    OR p_invoice_status IS DISTINCT FROM 'unpaid'
    OR p_item_id IS NULL OR length(p_item_id)>180
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20
    OR p_amount_ngn IS NULL OR p_amount_ngn::text IN('NaN','Infinity','-Infinity')
    OR p_amount_ngn<=0 OR p_amount_ngn>1000000000
    OR p_amount_ngn<>round(p_amount_ngn,2) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_INVOICE');
  END IF;
  SELECT * INTO v_discovery FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  -- The applied claim path locks key, then partner, journal and order.
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=v_discovery.key_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_discovery.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id
    OR v_journal.key_id IS DISTINCT FROM v_key.id
    OR v_journal.section IS DISTINCT FROM 'giftcards'
    OR v_partner.id IS DISTINCT FROM p_partner_id
    OR v_key.partner_id IS DISTINCT FROM v_partner.id THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id IS DISTINCT FROM v_partner.id
    OR v_order.item_type IS DISTINCT FROM 'giftcards'
    OR v_order.item_id IS DISTINCT FROM p_item_id
    OR v_order.quantity IS DISTINCT FROM p_quantity
    OR v_order.amount_ngn IS DISTINCT FROM p_amount_ngn
    OR v_journal.amount_ngn IS DISTINCT FROM p_amount_ngn
    OR v_order.request_payload->>'product_id' IS DISTINCT FROM p_item_id
    OR v_order.request_payload->'quantity' IS DISTINCT FROM to_jsonb(p_quantity) THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  SELECT * INTO v_existing FROM private.api_partner_bitrefill_invoice_bindings WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_existing.partner_id=v_partner.id AND v_existing.key_id=v_key.id
      AND v_existing.request_fingerprint=v_journal.request_fingerprint
      AND v_existing.item_id=p_item_id AND v_existing.quantity=p_quantity
      AND v_existing.amount_ngn=p_amount_ngn
      AND v_existing.funding_type=v_journal.funding_type
      AND v_existing.invoice_id=v_invoice_id
      AND v_existing.created_status='unpaid' THEN
      RETURN jsonb_build_object('success',true,'idempotent_replay',true,
        'pay_allowed',false,'order_id',p_order_id);
    END IF;
    RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_CONFLICT');
  END IF;
  IF v_journal.state<>'sending' OR v_journal.claimed_at IS NULL
    OR v_order.status<>'processing'
    OR v_journal.request_fingerprint !~ '^[a-f0-9]{64}$'
    OR v_journal.funding_type IS DISTINCT FROM
      (CASE WHEN v_partner.unlimited_credit IS TRUE THEN 'unlimited_credit' ELSE 'prepaid' END)
    OR v_key.revoked_at IS NOT NULL OR NOT ('orders:create'=ANY(v_key.scopes))
    OR v_partner.is_active IS DISTINCT FROM true
    OR v_partner.owner_reviewed_at IS NULL
    OR NOT ('giftcards'=ANY(v_partner.allowed_sections))
    OR NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e
      WHERE e.order_id=p_order_id AND e.partner_id=v_partner.id
        AND e.event_type='reserve' AND e.amount_ngn=v_journal.amount_ngn
        AND e.funding_type=v_journal.funding_type
        AND e.balance_before=v_journal.balance_before
        AND e.balance_after=v_journal.balance_after)
    OR EXISTS(SELECT 1 FROM public.api_partner_external_events e
      WHERE e.order_id=p_order_id AND e.event_type IN('capture','release'))
    OR EXISTS(SELECT 1 FROM public.api_partner_obligations o WHERE o.order_id=p_order_id) THEN
    RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_ELIGIBLE');
  END IF;
  INSERT INTO private.api_partner_bitrefill_invoice_bindings(order_id,partner_id,key_id,
    request_fingerprint,item_id,quantity,amount_ngn,funding_type,invoice_id,created_status)
  VALUES(p_order_id,v_partner.id,v_key.id,v_journal.request_fingerprint,p_item_id,
    p_quantity,p_amount_ngn,v_journal.funding_type,v_invoice_id,'unpaid');
  RETURN jsonb_build_object('success',true,'idempotent_replay',false,
    'pay_allowed',true,'order_id',p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bind_api_partner_bitrefill_invoice(
  uuid,uuid,text,text,text,integer,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_api_partner_bitrefill_invoice(
  uuid,uuid,text,text,text,integer,numeric) TO service_role;

-- A future service-only owner probe can read the bound invoice even when the
-- paid response was lost and the ordinary journal has no fulfillment ID.
CREATE FUNCTION public.get_api_partner_bitrefill_bound_invoice(
  p_order_id uuid, p_owner_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_binding private.api_partner_bitrefill_invoice_bindings%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_key public.api_partner_keys%ROWTYPE;
BEGIN
  IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_owner_user_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('success',false,'code','OWNER_DENIED');
  END IF;
  SELECT * INTO v_binding FROM private.api_partner_bitrefill_invoice_bindings WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'bound',false); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=v_binding.key_id;
  IF v_journal.order_id IS NULL OR v_order.id IS NULL
    OR v_key.id IS NULL OR v_key.partner_id IS DISTINCT FROM v_binding.partner_id
    OR v_journal.section IS DISTINCT FROM 'giftcards'
    OR v_journal.partner_id IS DISTINCT FROM v_binding.partner_id
    OR v_journal.key_id IS DISTINCT FROM v_binding.key_id
    OR v_journal.request_fingerprint IS DISTINCT FROM v_binding.request_fingerprint
    OR v_journal.amount_ngn IS DISTINCT FROM v_binding.amount_ngn
    OR v_journal.funding_type IS DISTINCT FROM v_binding.funding_type
    OR v_order.partner_id IS DISTINCT FROM v_binding.partner_id
    OR v_order.item_type IS DISTINCT FROM 'giftcards'
    OR v_order.item_id IS DISTINCT FROM v_binding.item_id
    OR v_order.quantity IS DISTINCT FROM v_binding.quantity
    OR v_order.amount_ngn IS DISTINCT FROM v_binding.amount_ngn
    OR v_order.request_payload->>'product_id' IS DISTINCT FROM v_binding.item_id
    OR v_order.request_payload->'quantity' IS DISTINCT FROM to_jsonb(v_binding.quantity)
    OR (((v_journal.fulfillment_source IS NULL AND v_journal.fulfillment_id IS NULL
      AND v_order.fulfillment_source IS NULL AND v_order.fulfillment_id IS NULL)
      OR (v_journal.fulfillment_source='bitrefill'
        AND v_journal.fulfillment_id=v_binding.invoice_id
        AND v_order.fulfillment_source='bitrefill'
        AND v_order.fulfillment_id=v_binding.invoice_id)) IS DISTINCT FROM true)
    OR v_journal.state NOT IN('sending','unknown','accepted') THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  RETURN jsonb_build_object('success',true,'bound',true,
    'order_id',p_order_id,'invoice_id',v_binding.invoice_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_api_partner_bitrefill_bound_invoice(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_partner_bitrefill_bound_invoice(uuid,uuid)
  TO service_role;

CREATE FUNCTION public.get_api_partner_bitrefill_bound_invoices(
  p_owner_user_id uuid, p_order_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_cases jsonb;
BEGIN
  IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_owner_user_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('success',false,'code','OWNER_DENIED');
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids)<1 OR cardinality(p_order_ids)>50
    OR array_position(p_order_ids,NULL::uuid) IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('order_id',q.order_id,
    'invoice_id',q.invoice_id) ORDER BY q.order_id),'[]'::jsonb) INTO v_cases
  FROM (
    SELECT b.order_id,b.invoice_id
    FROM private.api_partner_bitrefill_invoice_bindings b
    JOIN public.api_partner_external_orders j ON j.order_id=b.order_id
    JOIN public.api_partner_orders o ON o.id=b.order_id
    JOIN public.api_partner_keys k ON k.id=b.key_id AND k.partner_id=b.partner_id
    JOIN public.api_partners p ON p.id=b.partner_id
    WHERE b.order_id=ANY(p_order_ids)
      AND j.section='giftcards' AND j.partner_id=b.partner_id
      AND j.key_id=b.key_id AND j.request_fingerprint=b.request_fingerprint
      AND j.amount_ngn=b.amount_ngn AND j.funding_type=b.funding_type
      AND j.state IN('sending','unknown','accepted')
      AND o.partner_id=b.partner_id AND o.item_type='giftcards'
      AND o.item_id=b.item_id AND o.quantity=b.quantity
      AND o.amount_ngn=b.amount_ngn
      AND o.request_payload->>'product_id'=b.item_id
      AND o.request_payload->'quantity'=to_jsonb(b.quantity)
      AND ((j.fulfillment_source IS NULL AND j.fulfillment_id IS NULL
        AND o.fulfillment_source IS NULL AND o.fulfillment_id IS NULL)
        OR (j.fulfillment_source='bitrefill' AND j.fulfillment_id=b.invoice_id
          AND o.fulfillment_source='bitrefill' AND o.fulfillment_id=b.invoice_id))
  ) q;
  RETURN jsonb_build_object('success',true,'cases',v_cases);
END;
$$;
REVOKE ALL ON FUNCTION public.get_api_partner_bitrefill_bound_invoices(uuid,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_partner_bitrefill_bound_invoices(uuid,uuid[])
  TO service_role;

CREATE FUNCTION private.require_bound_bitrefill_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_section text; v_bound text;
BEGIN
  SELECT section INTO v_section FROM public.api_partner_external_orders WHERE order_id=NEW.order_id;
  IF NEW.outcome='accepted' AND v_section='giftcards' THEN
    SELECT invoice_id INTO v_bound FROM private.api_partner_bitrefill_invoice_bindings
      WHERE order_id=NEW.order_id;
    IF v_bound IS NULL OR v_bound IS DISTINCT FROM NEW.fulfillment_id THEN
      RAISE EXCEPTION 'bitrefill_invoice_binding_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER api_partner_bitrefill_receipt_requires_binding
  BEFORE INSERT ON private.api_partner_dispatch_receipts
  FOR EACH ROW EXECUTE FUNCTION private.require_bound_bitrefill_receipt();
REVOKE ALL ON FUNCTION private.require_bound_bitrefill_receipt()
  FROM PUBLIC, anon, authenticated, service_role;

-- The ordinary financial outcome RPC also writes the journal directly. It
-- must not transition a new giftcard send into accepted using a different or
-- missing invoice/receipt. Existing accepted rows may still receive the
-- legitimate status-only updates from migration 210.
CREATE FUNCTION private.guard_bound_bitrefill_financial_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bound text; v_receipt private.api_partner_dispatch_receipts%ROWTYPE;
BEGIN
  IF NEW.section='giftcards' THEN
    IF OLD.state='accepted' THEN
      IF NEW.state IS DISTINCT FROM 'accepted'
        OR NEW.fulfillment_source IS DISTINCT FROM OLD.fulfillment_source
        OR NEW.fulfillment_id IS DISTINCT FROM OLD.fulfillment_id THEN
        RAISE EXCEPTION 'bitrefill_accepted_identity_immutable';
      END IF;
    ELSIF NEW.state='accepted' THEN
      SELECT invoice_id INTO v_bound FROM private.api_partner_bitrefill_invoice_bindings
        WHERE order_id=NEW.order_id;
      SELECT * INTO v_receipt FROM private.api_partner_dispatch_receipts
        WHERE order_id=NEW.order_id;
      IF v_bound IS NULL OR NEW.fulfillment_source IS DISTINCT FROM 'bitrefill'
        OR NEW.fulfillment_id IS DISTINCT FROM v_bound
        OR v_receipt.order_id IS NULL OR v_receipt.outcome IS DISTINCT FROM 'accepted'
        OR v_receipt.fulfillment_source IS DISTINCT FROM 'bitrefill'
        OR v_receipt.fulfillment_id IS DISTINCT FROM v_bound
        OR v_receipt.outcome_status IS DISTINCT FROM NEW.outcome_status
        OR v_receipt.reason_code IS DISTINCT FROM NEW.reason_code
        OR v_receipt.public_payload IS DISTINCT FROM NEW.public_payload
        OR v_receipt.partner_id IS DISTINCT FROM NEW.partner_id
        OR v_receipt.key_id IS DISTINCT FROM NEW.key_id
        OR v_receipt.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint
        OR v_receipt.amount_ngn IS DISTINCT FROM NEW.amount_ngn
        OR v_receipt.funding_type IS DISTINCT FROM NEW.funding_type THEN
        RAISE EXCEPTION 'bitrefill_invoice_receipt_required';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER api_partner_bitrefill_financial_outcome_requires_receipt
  BEFORE UPDATE ON public.api_partner_external_orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_bound_bitrefill_financial_outcome();
REVOKE ALL ON FUNCTION private.guard_bound_bitrefill_financial_outcome()
  FROM PUBLIC, anon, authenticated, service_role;
