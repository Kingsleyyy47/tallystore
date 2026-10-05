-- Run inside a transaction containing the reviewed migrations, then ROLLBACK.
-- This exercises actual production wallet authorization without any HTTP call.
CREATE TEMP TABLE supplier_denied_probe (code text, no_order_created boolean, no_hold_created boolean);
DO $$
DECLARE
  v_user uuid;
  v_product public.product_groups%ROWTYPE;
  v_quantity integer;
  v_providers jsonb;
  v_result jsonb;
  v_before_orders bigint;
  v_before_holds bigint;
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p
  CROSS JOIN LATERAL public.wallet_financial_truth_internal(p.id) AS ledger(truth)
  WHERE p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
    AND p.account_suspended IS DISTINCT FROM true AND p.wallet_balance=0
    AND (truth->>'spending_blocked')::boolean=false
    AND (truth->>'confirmed_spendable')::numeric=0
  LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No zero-spendable active customer fixture'; END IF;
  SELECT pg.* INTO v_product FROM public.product_groups pg
  WHERE pg.is_active=true AND pg.is_sellable=true AND pg.auto_fulfill_enabled=true
    AND pg.stock_count BETWEEN 1 AND 98 AND pg.price>0
    AND pg.supplier_fallback_blocked=false
    AND (pg.muabanvia_product_id IS NOT NULL OR pg.shopclone_product_id IS NOT NULL OR pg.shopviaclone_product_id IS NOT NULL)
  ORDER BY pg.stock_count LIMIT 1;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'No mapped local-stock fixture'; END IF;
  SELECT count(*)::integer+1 INTO v_quantity FROM public.individual_accounts
    WHERE product_group_id=v_product.id AND status='available';
  SELECT jsonb_agg(provider) INTO v_providers FROM (VALUES
    ('muabanvia',v_product.muabanvia_product_id), ('shopclone',v_product.shopclone_product_id),
    ('shopviaclone',v_product.shopviaclone_product_id)
  ) mapped(provider,product_id) WHERE NULLIF(btrim(COALESCE(product_id,'')),'') IS NOT NULL;
  SELECT count(*) INTO v_before_orders FROM public.orders;
  SELECT count(*) INTO v_before_holds FROM public.wallet_reservations;
  SELECT public.authorize_supplier_product_purchase(v_user,v_product.id,v_quantity,
    v_product.price*v_quantity,'denied-live-probe-'||gen_random_uuid()::text,
    jsonb_build_object('source','live-denied-probe','supplier_configured_providers',v_providers),
    (SELECT GREATEST(COALESCE(financial_security_version,1),1) FROM public.profiles WHERE id=v_user))
  INTO v_result;
  IF COALESCE((v_result->>'success')::boolean,false) OR v_result->>'code'<>'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS' THEN
    RAISE EXCEPTION 'Zero trusted wallet was not rejected as expected: %',v_result->>'code';
  END IF;
  INSERT INTO supplier_denied_probe VALUES(v_result->>'code',
    (SELECT count(*)=v_before_orders FROM public.orders),
    (SELECT count(*)=v_before_holds FROM public.wallet_reservations));
END;
$$;
SELECT code,no_order_created,no_hold_created,
  has_table_privilege('authenticated','public.supplier_purchase_attempts','SELECT') AS browser_reads_supplier_journal,
  has_function_privilege('authenticated','public.authorize_supplier_product_purchase(uuid,uuid,integer,numeric,text,jsonb,integer)','EXECUTE') AS browser_can_authorize_supplier
FROM supplier_denied_probe;
