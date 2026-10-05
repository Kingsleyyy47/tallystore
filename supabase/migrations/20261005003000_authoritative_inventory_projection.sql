-- Inventory is authoritative. A service must verify configured supplier keys
-- before granting fallback readiness; browser stock/status edits cannot do so.
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS supplier_fallback_ready boolean NOT NULL DEFAULT false;
-- Preserve existing explicit public-column grants; a broad SELECT grant would
-- otherwise expose every newly added private column.
REVOKE SELECT ON public.product_groups FROM PUBLIC, anon, authenticated;
REVOKE SELECT (supplier_fallback_ready), INSERT (supplier_fallback_ready), UPDATE (supplier_fallback_ready)
  ON public.product_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT (supplier_fallback_ready), INSERT (supplier_fallback_ready), UPDATE (supplier_fallback_ready)
  ON public.product_groups TO service_role;

CREATE OR REPLACE FUNCTION public.guard_supplier_fallback_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Table-level UPDATE grants can supersede column revokes. Check the actual
  -- database role, including calls from our trusted SECURITY DEFINER functions.
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
    AND ((TG_OP='INSERT' AND NEW.supplier_fallback_ready)
      OR (TG_OP='UPDATE' AND NEW.supplier_fallback_ready IS DISTINCT FROM OLD.supplier_fallback_ready)) THEN
    RAISE EXCEPTION 'supplier_readiness_requires_service_verification' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_catalog_inventory(
  p_product public.product_groups, p_requested_ready boolean
)
RETURNS TABLE(stock_count integer,supplier_fallback_ready boolean,is_sellable boolean,availability_status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stock integer;
  v_ready boolean;
  v_valid_price boolean;
BEGIN
  v_valid_price := COALESCE(p_product.price,0)>0 AND p_product.price::text NOT IN ('NaN','Infinity','-Infinity');
  SELECT count(*)::integer INTO v_stock FROM public.individual_accounts
    WHERE product_group_id=p_product.id AND status='available';
  v_ready := COALESCE(p_requested_ready,false)
    AND p_product.is_active IS TRUE
    AND v_valid_price
    AND upper(COALESCE(p_product.availability_status,'')) <> 'PAUSED'
    AND COALESCE(p_product.auto_fulfill_enabled,false)
    AND NOT COALESCE(p_product.supplier_fallback_blocked,false)
    AND (NULLIF(btrim(COALESCE(p_product.muabanvia_product_id,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(p_product.shopclone_product_id,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(p_product.shopviaclone_product_id,'')),'') IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_purchase_attempts attempt
      JOIN public.orders pending_order ON pending_order.id=attempt.order_id
      WHERE pending_order.product_group_id=p_product.id AND (attempt.status IN ('sending','unknown')
        OR (attempt.status='succeeded' AND pending_order.status='processing'))
    );
  supplier_fallback_ready := v_ready;
  stock_count := v_stock;
  is_sellable := p_product.is_active IS TRUE AND v_valid_price AND (v_stock>0 OR v_ready);
  IF p_product.is_active IS NOT TRUE OR upper(COALESCE(p_product.availability_status,''))='PAUSED' THEN
    is_sellable := false;
    availability_status := 'PAUSED';
  ELSIF NOT v_valid_price THEN
    availability_status := 'UNAVAILABLE';
  ELSE
    -- UNLIMITED also permits purchases larger than the remaining local stock.
    availability_status := CASE WHEN v_ready THEN 'UNLIMITED'
      WHEN v_stock>3 THEN 'AVAILABLE' WHEN v_stock>0 THEN 'LOW_STOCK' ELSE 'UNAVAILABLE' END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.derive_catalog_inventory(public.product_groups,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_catalog_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_config_changed boolean := false; v_projection record;
BEGIN
  IF TG_OP='UPDATE' THEN
    v_config_changed := NEW.auto_fulfill_enabled IS DISTINCT FROM OLD.auto_fulfill_enabled
      OR NEW.muabanvia_product_id IS DISTINCT FROM OLD.muabanvia_product_id
      OR NEW.shopclone_product_id IS DISTINCT FROM OLD.shopclone_product_id
      OR NEW.shopviaclone_product_id IS DISTINCT FROM OLD.shopviaclone_product_id;
  END IF;
  SELECT * INTO v_projection FROM public.derive_catalog_inventory(NEW,NEW.supplier_fallback_ready AND NOT v_config_changed);
  NEW.stock_count := v_projection.stock_count;
  NEW.supplier_fallback_ready := v_projection.supplier_fallback_ready;
  NEW.is_sellable := v_projection.is_sellable;
  NEW.availability_status := v_projection.availability_status;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_guard_supplier_fallback_ready ON public.product_groups;
CREATE TRIGGER aa_guard_supplier_fallback_ready BEFORE INSERT OR UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_fallback_ready();
DROP TRIGGER IF EXISTS zz_project_catalog_inventory ON public.product_groups;
CREATE TRIGGER zz_project_catalog_inventory BEFORE INSERT OR UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.project_catalog_inventory();
REVOKE ALL ON FUNCTION public.guard_supplier_fallback_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.project_catalog_inventory() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_supplier_product_availability(
  p_product_group_id uuid, p_fallback_enabled boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_product public.product_groups%ROWTYPE; v_projection record; v_updated boolean := false;
BEGIN
  SELECT * INTO v_product FROM public.product_groups WHERE id=p_product_group_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PRODUCT_NOT_FOUND'); END IF;
  SELECT * INTO v_projection FROM public.derive_catalog_inventory(v_product,p_fallback_enabled);
  -- Unchanged periodic verification must not generate catalog realtime events.
  IF (v_product.stock_count,v_product.supplier_fallback_ready,v_product.is_sellable,v_product.availability_status)
    IS DISTINCT FROM (v_projection.stock_count,v_projection.supplier_fallback_ready,v_projection.is_sellable,v_projection.availability_status) THEN
    UPDATE public.product_groups SET supplier_fallback_ready=v_projection.supplier_fallback_ready,
      stock_count=v_projection.stock_count,is_sellable=v_projection.is_sellable,availability_status=v_projection.availability_status
      WHERE id=p_product_group_id RETURNING * INTO v_product;
    v_updated := true;
  END IF;
  RETURN jsonb_build_object('success',true,'stock_count',v_product.stock_count,
    'supplier_fallback_enabled',v_product.supplier_fallback_ready,
    'availability_status',v_product.availability_status,'updated',v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_supplier_product_availability(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_supplier_product_availability(uuid,boolean) TO service_role;

-- This is the legacy trigger verified on the live inventory table. Preserve
-- update_stock_count() and any unrelated callers of that function.
DROP TRIGGER IF EXISTS update_stock_count_trigger ON public.individual_accounts;

CREATE OR REPLACE FUNCTION public.refresh_inventory_statement_groups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids uuid[]; v_id uuid; v_ready boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT array_agg(DISTINCT product_group_id ORDER BY product_group_id) INTO v_ids FROM new_inventory;
  ELSIF TG_OP='DELETE' THEN
    SELECT array_agg(DISTINCT product_group_id ORDER BY product_group_id) INTO v_ids FROM old_inventory;
  ELSE
    SELECT array_agg(product_group_id ORDER BY product_group_id) INTO v_ids FROM (
      SELECT product_group_id FROM new_inventory UNION SELECT product_group_id FROM old_inventory
    ) affected;
  END IF;
  FOREACH v_id IN ARRAY COALESCE(v_ids,ARRAY[]::uuid[]) LOOP
    IF v_id IS NULL THEN CONTINUE; END IF;
    -- Inventory writes hold account rows first. Purchase functions hold product
    -- rows first and use SKIP LOCKED for new reservations. NOWAIT prevents
    -- deadlocks with later settlement/release paths that own reserved rows.
    -- A busy admin inventory batch rolls back atomically and can be retried.
    SELECT supplier_fallback_ready INTO v_ready FROM public.product_groups
      WHERE id=v_id FOR NO KEY UPDATE NOWAIT;
    IF FOUND THEN PERFORM public.refresh_supplier_product_availability(v_id,v_ready); END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_inventory_statement_groups() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refresh_inventory_after_insert ON public.individual_accounts;
CREATE TRIGGER refresh_inventory_after_insert AFTER INSERT ON public.individual_accounts
  REFERENCING NEW TABLE AS new_inventory FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_inventory_statement_groups();
DROP TRIGGER IF EXISTS refresh_inventory_after_update ON public.individual_accounts;
CREATE TRIGGER refresh_inventory_after_update AFTER UPDATE ON public.individual_accounts
  REFERENCING OLD TABLE AS old_inventory NEW TABLE AS new_inventory FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_inventory_statement_groups();
DROP TRIGGER IF EXISTS refresh_inventory_after_delete ON public.individual_accounts;
CREATE TRIGGER refresh_inventory_after_delete AFTER DELETE ON public.individual_accounts
  REFERENCING OLD TABLE AS old_inventory FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_inventory_statement_groups();

-- Reconcile existing cached counts while readiness starts disabled. This never
-- buys stock or enables an unverified supplier.
UPDATE public.product_groups SET supplier_fallback_ready=false;
