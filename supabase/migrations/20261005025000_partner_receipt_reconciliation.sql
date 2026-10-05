-- Owner-authorized recovery for a paid dispatch whose normalized receipt was
-- saved but the ordinary financial finalizer did not complete. Unknown and
-- receipt-free sends stay held for independent provider evidence.
CREATE TABLE private.api_partner_receipt_reconciliation_decisions (
  order_id uuid PRIMARY KEY REFERENCES private.api_partner_dispatch_receipts(order_id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES public.api_partner_keys(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  receipt_proof_hash text NOT NULL CHECK (receipt_proof_hash ~ '^[a-f0-9]{64}$'),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  funding_type text NOT NULL CHECK (funding_type IN ('prepaid','unlimited_credit')),
  decision text NOT NULL CHECK (decision IN ('accepted','rejected')),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.api_partner_receipt_reconciliation_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_partner_receipt_reconciliation_decisions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.api_partner_receipt_reconciliation_decisions TO service_role;
CREATE TRIGGER api_partner_receipt_reconciliation_immutable
  BEFORE UPDATE OR DELETE ON private.api_partner_receipt_reconciliation_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();
CREATE TRIGGER api_partner_receipt_reconciliation_no_truncate
  BEFORE TRUNCATE ON private.api_partner_receipt_reconciliation_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION private.reject_api_partner_dispatch_receipt_mutation();

CREATE FUNCTION public.reconcile_api_partner_dispatch_receipt(
  p_order_id uuid, p_owner_user_id uuid, p_receipt_proof_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_discovery public.api_partner_external_orders%ROWTYPE;
  v_partner public.api_partners%ROWTYPE;
  v_journal public.api_partner_external_orders%ROWTYPE;
  v_order public.api_partner_orders%ROWTYPE;
  v_key public.api_partner_keys%ROWTYPE;
  v_receipt private.api_partner_dispatch_receipts%ROWTYPE;
  v_decision private.api_partner_receipt_reconciliation_decisions%ROWTYPE;
  v_reserve_count integer;
  v_capture_count integer;
  v_capture_proof_count integer;
  v_release_count integer;
  v_release_proof_count integer;
  v_obligation_count integer;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR p_receipt_proof_hash IS NULL OR p_receipt_proof_hash !~ '^[a-f0-9]{64}$'
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner_user_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('success',false,'code','OWNER_DENIED');
  END IF;
  -- Preserve the applied 211 lock order, including inactive partners and
  -- revoked keys that may still owe fulfillment or a refund.
  SELECT * INTO v_discovery FROM public.api_partner_external_orders WHERE order_id=p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id=v_discovery.partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
  SELECT * INTO v_journal FROM public.api_partner_external_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_journal.partner_id IS DISTINCT FROM v_partner.id THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  SELECT * INTO v_order FROM public.api_partner_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.partner_id IS DISTINCT FROM v_journal.partner_id
    OR v_order.item_type IS DISTINCT FROM v_journal.section
    OR v_order.amount_ngn IS DISTINCT FROM v_journal.amount_ngn THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  SELECT * INTO v_key FROM public.api_partner_keys WHERE id=v_journal.key_id;
  SELECT * INTO v_receipt FROM private.api_partner_dispatch_receipts WHERE order_id=p_order_id;
  IF v_key.id IS NULL OR v_key.partner_id IS DISTINCT FROM v_partner.id
    OR v_receipt.order_id IS NULL OR v_receipt.partner_id IS DISTINCT FROM v_partner.id
    OR v_receipt.key_id IS DISTINCT FROM v_journal.key_id
    OR v_receipt.request_fingerprint IS DISTINCT FROM v_journal.request_fingerprint
    OR v_receipt.amount_ngn IS DISTINCT FROM v_journal.amount_ngn
    OR v_receipt.funding_type IS DISTINCT FROM v_journal.funding_type
    OR v_receipt.proof_hash IS DISTINCT FROM p_receipt_proof_hash
    OR v_receipt.observed_at < v_journal.claimed_at THEN
    RETURN jsonb_build_object('success',false,'code','BINDING_MISMATCH');
  END IF;
  -- Receipt rows are immutable and the hash was generated by the service-only
  -- writer. Re-encoding a numeric(18,2) column would change the JSONB text of
  -- input values such as 30 to 30.00, so compare the stored proof exactly.
  IF v_receipt.outcome NOT IN ('accepted','rejected') THEN
    RETURN jsonb_build_object('success',false,'code','UNKNOWN_REQUIRES_REVIEW');
  END IF;
  SELECT count(*) INTO v_reserve_count FROM public.api_partner_external_events e
    WHERE e.order_id=p_order_id AND e.partner_id=v_partner.id
      AND e.event_type='reserve' AND e.amount_ngn=v_journal.amount_ngn
      AND e.funding_type=v_journal.funding_type
      AND e.balance_before=v_journal.balance_before
      AND e.balance_after=v_journal.balance_after;
  SELECT count(*) INTO v_capture_count FROM public.api_partner_external_events e
    WHERE e.order_id=p_order_id AND e.event_type='capture';
  SELECT count(*) INTO v_capture_proof_count FROM public.api_partner_external_events e
    WHERE e.order_id=p_order_id AND e.partner_id=v_partner.id
      AND e.event_type='capture' AND e.amount_ngn=v_journal.amount_ngn
      AND e.funding_type=v_journal.funding_type
      AND e.balance_before=v_journal.balance_before
      AND e.balance_after=v_journal.balance_after;
  SELECT count(*) INTO v_release_count FROM public.api_partner_external_events e
    WHERE e.order_id=p_order_id AND e.event_type='release';
  SELECT count(*) INTO v_release_proof_count FROM public.api_partner_external_events e
    WHERE e.order_id=p_order_id AND e.partner_id=v_partner.id
      AND e.event_type='release' AND e.amount_ngn=v_journal.amount_ngn
      AND e.funding_type=v_journal.funding_type
      AND ((v_journal.funding_type='prepaid'
        AND e.balance_after=e.balance_before+v_journal.amount_ngn)
        OR (v_journal.funding_type='unlimited_credit'
          AND e.balance_after=e.balance_before));
  SELECT count(*) INTO v_obligation_count FROM public.api_partner_obligations o
    WHERE o.order_id=p_order_id AND o.partner_id=v_partner.id
      AND o.amount_ngn=v_journal.amount_ngn AND o.funding_type=v_journal.funding_type
      AND o.balance_before=v_journal.balance_before AND o.balance_after=v_journal.balance_after;
  SELECT * INTO v_decision FROM private.api_partner_receipt_reconciliation_decisions
    WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_decision.owner_user_id=p_owner_user_id
      AND v_decision.partner_id=v_partner.id AND v_decision.key_id=v_journal.key_id
      AND v_decision.request_fingerprint=v_journal.request_fingerprint
      AND v_decision.receipt_proof_hash=p_receipt_proof_hash
      AND v_decision.amount_ngn=v_journal.amount_ngn
      AND v_decision.funding_type=v_journal.funding_type
      AND v_decision.decision=v_receipt.outcome
      AND v_journal.state=v_receipt.outcome
      AND v_journal.fulfillment_source IS NOT DISTINCT FROM v_receipt.fulfillment_source
      AND v_journal.fulfillment_id IS NOT DISTINCT FROM v_receipt.fulfillment_id
      AND v_journal.reason_code IS NOT DISTINCT FROM v_receipt.reason_code
      AND v_order.fulfillment_source IS NOT DISTINCT FROM v_receipt.fulfillment_source
      AND v_order.fulfillment_id IS NOT DISTINCT FROM v_receipt.fulfillment_id
      AND v_order.status=v_journal.outcome_status
      AND v_order.response_payload IS NOT DISTINCT FROM v_journal.public_payload
      AND v_reserve_count=1
      AND ((v_receipt.outcome='accepted' AND v_capture_count=1
        AND v_capture_proof_count=1
        AND v_release_count=0 AND v_obligation_count=1
        AND ((v_journal.section='sms' AND v_journal.outcome_status IN ('active','completed'))
          OR (v_journal.section='social_boost' AND v_journal.outcome_status IN ('processing','completed'))
          OR (v_journal.section='bills_airtime' AND v_journal.outcome_status='completed')
          OR (v_journal.section='giftcards' AND v_journal.outcome_status IN ('processing','completed'))
          OR (v_journal.section='telegram_stars' AND v_journal.outcome_status IN ('processing','completed')))
        AND v_order.refunded_at IS NULL AND v_order.refund_amount_ngn IS NULL)
        OR (v_receipt.outcome='rejected' AND v_capture_count=0
          AND v_release_count=1 AND v_release_proof_count=1
          AND v_obligation_count=0
          AND v_journal.outcome_status='failed'
          AND v_journal.public_payload='{}'::jsonb
          AND ((v_journal.funding_type='prepaid'
            AND v_order.refunded_at IS NOT NULL
            AND v_order.refund_amount_ngn=v_journal.amount_ngn)
            OR (v_journal.funding_type='unlimited_credit'
              AND v_order.refunded_at IS NULL
              AND v_order.refund_amount_ngn IS NULL)))) THEN
      RETURN jsonb_build_object('success',true,'idempotent_replay',true,
        'order_id',p_order_id,'decision',v_receipt.outcome);
    END IF;
    RETURN jsonb_build_object('success',false,'code','DECISION_CONFLICT');
  END IF;
  IF v_journal.state<>'sending' OR v_journal.claimed_at IS NULL
    OR v_order.status<>'processing' OR v_reserve_count<>1
    OR v_capture_count<>0 OR v_release_count<>0 OR v_obligation_count<>0 THEN
    RETURN jsonb_build_object('success',false,'code','NOT_RECOVERABLE');
  END IF;
  -- The existing finalizer performs exactly one capture or release. Its call
  -- and the immutable decision insert are one database transaction. A failed
  -- insert rolls back the finalizer, including a prepaid release.
  BEGIN
    v_result:=public.record_api_partner_external_outcome(p_order_id,v_receipt.outcome,
      v_receipt.fulfillment_source,v_receipt.fulfillment_id,v_receipt.public_payload,
      v_receipt.outcome_status,v_receipt.reason_code);
    IF v_result->>'success' IS DISTINCT FROM 'true'
      OR v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
      OR v_result->>'dispatch_state' IS DISTINCT FROM v_receipt.outcome THEN
      RAISE EXCEPTION 'partner_receipt_finalization_failed';
    END IF;
    INSERT INTO private.api_partner_receipt_reconciliation_decisions(
      order_id,partner_id,key_id,owner_user_id,request_fingerprint,
      receipt_proof_hash,amount_ngn,funding_type,decision)
    VALUES(p_order_id,v_partner.id,v_journal.key_id,p_owner_user_id,
      v_journal.request_fingerprint,p_receipt_proof_hash,v_journal.amount_ngn,
      v_journal.funding_type,v_receipt.outcome);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success',false,'code','FINALIZATION_FAILED');
  END;
  RETURN jsonb_build_object('success',true,'idempotent_replay',false,
    'order_id',p_order_id,'decision',v_receipt.outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_api_partner_dispatch_receipt(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_api_partner_dispatch_receipt(uuid,uuid,text)
  TO service_role;

CREATE FUNCTION public.get_api_partner_dispatch_receipt_review(
  p_owner_user_id uuid, p_order_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_cases jsonb;
BEGIN
  IF p_owner_user_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_owner_user_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('success',false,'code','OWNER_DENIED');
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids)<1 OR cardinality(p_order_ids)>50
    OR array_position(p_order_ids,NULL::uuid) IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'order_id',q.order_id,'receipt_outcome',q.outcome,
    'receipt_proof_hash',q.proof_hash) ORDER BY q.observed_at DESC),'[]'::jsonb)
  INTO v_cases
  FROM (
    SELECT r.order_id,r.outcome,r.proof_hash,r.observed_at
    FROM private.api_partner_dispatch_receipts r
    JOIN public.api_partner_external_orders j ON j.order_id=r.order_id
    JOIN public.api_partner_orders o ON o.id=r.order_id
    JOIN public.api_partner_keys k ON k.id=j.key_id AND k.partner_id=j.partner_id
    JOIN public.api_partners p ON p.id=j.partner_id
    WHERE r.order_id=ANY(p_order_ids)
      AND r.outcome IN ('accepted','rejected')
      AND j.state='sending' AND j.claimed_at IS NOT NULL
      AND o.status='processing' AND o.partner_id=j.partner_id
      AND o.item_type=j.section AND o.amount_ngn=j.amount_ngn
      AND r.partner_id=j.partner_id AND r.key_id=j.key_id
      AND r.request_fingerprint=j.request_fingerprint
      AND r.amount_ngn=j.amount_ngn AND r.funding_type=j.funding_type
      AND r.observed_at>=j.claimed_at
      AND EXISTS(SELECT 1 FROM public.api_partner_external_events e
        WHERE e.order_id=r.order_id AND e.partner_id=j.partner_id
          AND e.event_type='reserve' AND e.amount_ngn=j.amount_ngn
          AND e.funding_type=j.funding_type
          AND e.balance_before=j.balance_before AND e.balance_after=j.balance_after)
      AND NOT EXISTS(SELECT 1 FROM public.api_partner_external_events e
        WHERE e.order_id=r.order_id AND e.event_type IN ('capture','release'))
      AND NOT EXISTS(SELECT 1 FROM public.api_partner_obligations b WHERE b.order_id=r.order_id)
  ) q;
  RETURN jsonb_build_object('success',true,'cases',v_cases);
END;
$$;
REVOKE ALL ON FUNCTION public.get_api_partner_dispatch_receipt_review(uuid,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_partner_dispatch_receipt_review(uuid,uuid[])
  TO service_role;
