-- Keep the BEFORE INSERT purchase guard aligned with the canonical purchase
-- authorization reader. The earlier trigger still enforces refund linkage.
DO $patch$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.guard_trusted_principal_transaction()'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition,
    'v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);') > 0
  THEN
    RETURN;
  END IF;

  IF pg_catalog.strpos(v_definition, '  v_refunded_against_original numeric := 0;') = 0 THEN
    RAISE EXCEPTION 'Unexpected trusted-principal guard declaration';
  END IF;
  v_definition := pg_catalog.replace(
    v_definition,
    '  v_refunded_against_original numeric := 0;',
    '  v_refunded_against_original numeric := 0;' || chr(10) ||
    '  v_financial_truth jsonb;' || chr(10) ||
    '  v_authorized_available numeric := 0;' || chr(10) ||
    '  v_own_hold numeric := 0;'
  );

  v_start := pg_catalog.strpos(v_definition, '  IF v_type = ''purchase'' THEN');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Unexpected trusted-principal purchase guard';
  END IF;
  v_end := pg_catalog.strpos(pg_catalog.substr(v_definition, v_start),
    '  IF v_type IN (''refund'', ''purchase_refund'', ''auto_refund'') THEN');
  IF v_end = 0 THEN
    RAISE EXCEPTION 'Unexpected trusted-principal refund boundary';
  END IF;
  v_end := v_start + v_end - 1;

  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) ||
    $body$
  IF v_type = 'purchase' THEN
    IF upper(COALESCE(NEW.currency, 'NGN')) <> 'NGN' THEN
      RAISE EXCEPTION 'UNSUPPORTED_WALLET_CURRENCY: purchase must use NGN';
    END IF;
    v_financial_truth := public.wallet_financial_truth_internal(NEW.user_id);
    IF COALESCE((v_financial_truth->>'spending_blocked')::boolean, true) THEN
      RAISE EXCEPTION 'WALLET_REVIEW_REQUIRED: canonical financial truth blocks purchase';
    END IF;

    IF COALESCE(NEW.metadata->>'wallet_reservation_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      SELECT r.amount INTO v_own_hold
      FROM public.wallet_reservations r
      WHERE r.id = (NEW.metadata->>'wallet_reservation_id')::uuid
        AND r.user_id = NEW.user_id
        AND r.status = 'active'
        AND r.amount = abs(NEW.amount)
        AND upper(r.currency) = upper(COALESCE(NEW.currency, 'NGN'))
        AND r.order_id::text = NEW.metadata->>'source_order_id'
        AND r.order_table = NEW.metadata->>'source_order_table';
      IF v_own_hold IS NULL THEN
        RAISE EXCEPTION 'INVALID_WALLET_RESERVATION: purchase hold is not valid';
      END IF;
    ELSIF NEW.metadata ? 'wallet_reservation_id' THEN
      RAISE EXCEPTION 'INVALID_WALLET_RESERVATION: purchase hold ID is malformed';
    END IF;

    v_authorized_available := GREATEST(
      (v_financial_truth->>'trusted_available_before_holds')::numeric
      - (v_financial_truth->>'active_reservations')::numeric
      + COALESCE(v_own_hold, 0), 0
    );
    IF abs(COALESCE(NEW.amount, 0)) > v_authorized_available THEN
      RAISE EXCEPTION 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS: requested % exceeds confirmed spendable %',
        abs(COALESCE(NEW.amount, 0)), v_authorized_available;
    END IF;

    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'trusted_principal_authorized', true,
      'trusted_principal_debit_amount', abs(COALESCE(NEW.amount, 0)),
      'trusted_available_before', v_authorized_available,
      'trusted_principal_before', (v_financial_truth->>'trusted_principal')::numeric,
      'trusted_consumed_spend_before', (v_financial_truth->>'net_consumed_spend')::numeric
    );
  END IF;

$body$ || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;
END;
$patch$;
