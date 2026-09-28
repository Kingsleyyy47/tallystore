-- Apply with the matching process-purchase build while local-product
-- fulfillment is paused. Old Edge builds increment used_count after delivery;
-- running one alongside these triggers would count a completion twice.
DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
    OR to_regclass('public.discount_codes') IS NULL
    OR to_regclass('public.product_groups') IS NULL
  THEN
    RAISE EXCEPTION 'discount order reservation dependencies missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('orders', 'discount_code_id'), ('orders', 'account_details'),
      ('orders', 'product_group_id'), ('orders', 'amount'),
      ('orders', 'status'), ('orders', 'user_id'),
      ('product_groups', 'price'), ('product_groups', 'category_id'),
      ('discount_codes', 'user_id'), ('discount_codes', 'max_order_amount'),
      ('discount_codes', 'max_uses'), ('discount_codes', 'used_count')
    ) required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = format('public.%I', required.table_name)::regclass
        AND a.attname = required.column_name AND NOT a.attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'discount order reservation columns missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_order_discount_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metadata_id text;
  v_code_id uuid;
  v_code public.discount_codes%ROWTYPE;
  v_product public.product_groups%ROWTYPE;
  v_quantity_text text;
  v_quantity integer;
  v_original_amount numeric;
  v_expected_amount numeric;
  v_pending_count bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.discount_code_id IS DISTINCT FROM OLD.discount_code_id THEN
      RAISE EXCEPTION 'discount_order_link_immutable';
    END IF;
    IF NEW.discount_code_id IS NOT NULL
      AND lower(COALESCE(NEW.status, '')) = 'completed'
      AND lower(COALESCE(OLD.status, '')) <> 'completed'
      AND lower(COALESCE(OLD.status, '')) <> 'processing'
    THEN
      RAISE EXCEPTION 'discount_order_completion_state_invalid';
    END IF;
    RETURN NEW;
  END IF;

  v_metadata_id := NULLIF(btrim(COALESCE(NEW.account_details->>'discount_code_id', '')), '');
  IF v_metadata_id IS NOT NULL
    AND v_metadata_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'discount_order_identity_invalid';
  END IF;
  v_code_id := COALESCE(NEW.discount_code_id, v_metadata_id::uuid);
  IF v_code_id IS NULL THEN RETURN NEW; END IF;
  IF v_metadata_id IS NOT NULL AND v_code_id::text <> lower(v_metadata_id) THEN
    RAISE EXCEPTION 'discount_order_identity_mismatch';
  END IF;
  IF lower(COALESCE(NEW.status, '')) NOT IN ('processing', 'completed') THEN
    RAISE EXCEPTION 'discount_order_initial_state_invalid';
  END IF;

  SELECT * INTO v_code FROM public.discount_codes
  WHERE id = v_code_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_code.is_active, false)
    OR (v_code.expires_at IS NOT NULL AND v_code.expires_at <= now())
    OR (v_code.user_id IS NOT NULL AND v_code.user_id <> NEW.user_id)
  THEN
    RAISE EXCEPTION 'discount_code_unavailable';
  END IF;
  SELECT * INTO v_product FROM public.product_groups
  WHERE id = NEW.product_group_id;
  IF NOT FOUND
    OR (v_code.product_group_id IS NOT NULL
        AND v_code.product_group_id <> NEW.product_group_id)
    OR (v_code.product_group_id IS NULL AND v_code.category_id IS NOT NULL
        AND v_code.category_id <> v_product.category_id)
  THEN
    RAISE EXCEPTION 'discount_code_unavailable';
  END IF;

  v_quantity_text := NEW.account_details->>'quantity';
  IF COALESCE(v_quantity_text, '') !~ '^[1-9][0-9]{0,3}$' THEN
    RAISE EXCEPTION 'discount_order_quantity_invalid';
  END IF;
  v_quantity := v_quantity_text::integer;
  v_original_amount := v_product.price * v_quantity;
  v_expected_amount := round(v_original_amount * (100 - v_code.percent_off) / 100);
  IF v_expected_amount <= 0 OR NEW.amount IS DISTINCT FROM v_expected_amount
    OR (v_code.max_order_amount IS NOT NULL
        AND v_original_amount > v_code.max_order_amount)
  THEN
    RAISE EXCEPTION 'discount_order_amount_invalid';
  END IF;

  IF v_code.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_pending_count FROM public.orders o
    WHERE o.discount_code_id = v_code_id
      AND lower(COALESCE(o.status, '')) NOT IN
        ('completed', 'failed', 'cancelled', 'canceled', 'refunded');
    IF v_code.used_count + v_pending_count >= v_code.max_uses THEN
      RAISE EXCEPTION 'discount_code_capacity_exhausted';
    END IF;
  END IF;

  NEW.discount_code_id := v_code_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_completed_order_discount_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.discount_code_id IS NOT NULL
    AND lower(COALESCE(NEW.status, '')) = 'completed'
    AND (TG_OP = 'INSERT' OR lower(COALESCE(OLD.status, '')) <> 'completed')
  THEN
    UPDATE public.discount_codes
       SET used_count = used_count + 1
     WHERE id = NEW.discount_code_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'discount_code_missing_during_completion'; END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS guard_order_discount_capacity ON public.orders;
CREATE TRIGGER guard_order_discount_capacity
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_discount_capacity();

DROP TRIGGER IF EXISTS post_completed_order_discount_use ON public.orders;
CREATE TRIGGER post_completed_order_discount_use
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.post_completed_order_discount_use();

REVOKE ALL ON FUNCTION public.guard_order_discount_capacity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_completed_order_discount_use()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.discount_code_capacity_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN count(*) = 2 THEN 1 ELSE 0 END
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid = 'public.orders'::regclass
    AND t.tgname IN (
      'guard_order_discount_capacity', 'post_completed_order_discount_use'
    )
    AND t.tgenabled <> 'D'
    AND NOT t.tgisinternal;
$function$;

REVOKE ALL ON FUNCTION public.discount_code_capacity_version()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discount_code_capacity_version() TO service_role;
