-- Preparation for reopening Social Boost. The route remains default-paused.
-- A successful claim is a permanent one-use permission, not a retry lease.
ALTER TABLE public.smm_orders
  ADD COLUMN IF NOT EXISTS dispatch_payload_sha256 text;

ALTER TABLE public.smm_orders
  ADD CONSTRAINT smm_orders_dispatch_payload_sha256_format
  CHECK (dispatch_payload_sha256 IS NULL OR dispatch_payload_sha256 ~ '^[0-9a-f]{64}$');

-- The paused handler already records ambiguous panel outcomes with this value,
-- but the old table constraint rejected it. Existing states remain valid.
ALTER TABLE public.smm_orders DROP CONSTRAINT IF EXISTS smm_orders_status_check;
ALTER TABLE public.smm_orders ADD CONSTRAINT smm_orders_status_check
  CHECK (status IN ('pending','processing','in_progress','completed','partial','cancelled','failed','outcome_unknown'));

CREATE TABLE private.smm_dispatch_claims (
  order_id uuid PRIMARY KEY REFERENCES public.smm_orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  debit_transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  debit_idempotency_key text NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  service_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  amount_ngn numeric NOT NULL CHECK (amount_ngn > 0),
  financial_security_version integer NOT NULL CHECK (financial_security_version > 0),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.smm_dispatch_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.smm_dispatch_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.prevent_smm_dispatch_claim_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'smm_dispatch_claim_immutable';
END;
$$;

CREATE TRIGGER prevent_smm_dispatch_claim_change
BEFORE UPDATE OR DELETE ON private.smm_dispatch_claims
FOR EACH ROW EXECUTE FUNCTION private.prevent_smm_dispatch_claim_change();
ALTER TABLE private.smm_dispatch_claims ENABLE ALWAYS TRIGGER prevent_smm_dispatch_claim_change;

CREATE FUNCTION public.claim_smm_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_debit_transaction_id uuid,
  p_idempotency_key text,
  p_payload_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  o public.smm_orders%ROWTYPE;
  p public.profiles%ROWTYPE;
  t public.transactions%ROWTYPE;
  truth jsonb;
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL OR p_debit_transaction_id IS NULL
    OR NULLIF(btrim(COALESCE(p_idempotency_key,'')),'') IS NULL
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','DISPATCH_IDENTITY_REQUIRED'); END IF;

  -- Match the wallet engine's profile-first lock order.
  SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR p.is_admin IS TRUE OR p.is_staff IS TRUE OR p.account_suspended IS TRUE
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','WALLET_AUTHORIZATION_STALE'); END IF;

  SELECT * INTO o FROM public.smm_orders WHERE id=p_order_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','ORDER_NOT_FOUND'); END IF;

  -- Legacy orders have no payload hash and can never be sent by this function.
  IF o.status IS DISTINCT FROM 'pending' OR o.external_order_id IS NOT NULL
    OR o.idempotency_key IS DISTINCT FROM p_idempotency_key
    OR o.dispatch_payload_sha256 IS DISTINCT FROM p_payload_sha256
    OR o.financial_security_version IS NULL OR o.financial_security_version < 1
    OR o.service_id IS NULL OR o.quantity IS NULL OR o.quantity < 1
    OR o.amount_ngn IS NULL OR o.amount_ngn <= 0
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','ORDER_NOT_ELIGIBLE'); END IF;

  IF EXISTS (SELECT 1 FROM private.smm_dispatch_claims WHERE order_id=o.id)
  THEN RETURN jsonb_build_object('success',true,'send_allowed',false,'code','ALREADY_CLAIMED'); END IF;

  IF p.financial_security_version IS DISTINCT FROM o.financial_security_version
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','WALLET_AUTHORIZATION_STALE'); END IF;
  truth:=public.wallet_financial_truth_internal(p_user_id);
  IF COALESCE((truth->>'spending_blocked')::boolean,true)
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','WALLET_AUTHORIZATION_STALE'); END IF;

  SELECT * INTO t FROM public.transactions
    WHERE id=p_debit_transaction_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR t.type IS DISTINCT FROM 'purchase' OR t.status IS DISTINCT FROM 'completed'
    OR t.balance_type IS DISTINCT FROM 'wallet'
    OR t.amount IS DISTINCT FROM -o.amount_ngn
    OR t.reference IS DISTINCT FROM o.reference
    OR t.idempotency_key IS DISTINCT FROM 'smm:purchase:'||o.idempotency_key
    OR t.metadata->>'source' IS DISTINCT FROM 'smm-create-order'
    OR t.metadata->>'service_id' IS DISTINCT FROM o.service_id::text
    OR t.metadata->>'quantity' IS DISTINCT FROM o.quantity::text
    OR t.metadata->>'dispatch_payload_sha256' IS DISTINCT FROM o.dispatch_payload_sha256
  THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','DEBIT_PROOF_INVALID'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions r
    WHERE r.user_id=p_user_id AND r.amount>0
      AND lower(COALESCE(r.type,'')) IN ('refund','purchase_refund','auto_refund')
      AND lower(COALESCE(r.status,'')) IN ('completed','success','successful','credited','complete','paid','finished')
      AND (
        r.metadata->>'source_debit_transaction_id'=t.id::text
        OR r.metadata->>'source_debit_idempotency_key'=t.idempotency_key
        OR r.metadata->>'original_reference'=t.reference
        OR r.reference='REFUND-'||t.reference
      )
  ) THEN RETURN jsonb_build_object('success',false,'send_allowed',false,'code','DEBIT_ALREADY_REFUNDED'); END IF;

  INSERT INTO private.smm_dispatch_claims(order_id,user_id,debit_transaction_id,debit_idempotency_key,
    payload_sha256,service_id,quantity,amount_ngn,financial_security_version)
  VALUES(o.id,o.user_id,t.id,t.idempotency_key,p_payload_sha256,o.service_id,o.quantity,o.amount_ngn,o.financial_security_version);
  UPDATE public.smm_orders SET financial_authorization_status='dispatch_claimed',updated_at=clock_timestamp()
    WHERE id=o.id;
  RETURN jsonb_build_object('success',true,'send_allowed',true,'order_id',o.id,'code','CLAIMED');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',true,'send_allowed',false,'code','ALREADY_CLAIMED');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_smm_dispatch(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_smm_dispatch(uuid,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION private.prevent_smm_dispatch_claim_change() FROM PUBLIC,anon,authenticated,service_role;
