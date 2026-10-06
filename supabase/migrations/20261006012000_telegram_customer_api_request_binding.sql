-- Nullable provenance for new Telegram API orders only. Historical and website
-- orders remain unchanged; no legacy binding is inferred or backfilled.
DO $$
DECLARE v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.telegram_orders'::regclass AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'telegram_order_rls_baseline_changed';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF pg_catalog.has_table_privilege(v_role,'public.telegram_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.telegram_orders'::regclass
        AND a.attnum>0 AND NOT a.attisdropped AND pg_catalog.has_column_privilege(v_role,a.attrelid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'telegram_order_browser_privacy_baseline_changed';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid='public.idx_telegram_orders_user_idempotency_key_unique'::regclass
    AND i.indrelid='public.telegram_orders'::regclass AND i.indisunique AND i.indisvalid AND i.indnkeyatts=2 AND i.indnatts=2
    AND i.indexprs IS NULL AND i.indkey[0]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='user_id')
    AND i.indkey[1]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='idempotency_key')
    AND pg_catalog.pg_get_expr(i.indpred,i.indrelid)='((idempotency_key IS NOT NULL) AND (idempotency_key <> ''''::text))')
    THEN RAISE EXCEPTION 'telegram_order_unique_request_baseline_changed'; END IF;
END $$;

ALTER TABLE public.telegram_orders ADD COLUMN customer_api_request_hash text;
ALTER TABLE public.telegram_orders ADD CONSTRAINT telegram_orders_customer_api_request_hash_check
  CHECK(customer_api_request_hash IS NULL OR customer_api_request_hash ~ '^[a-f0-9]{64}$');
REVOKE ALL(customer_api_request_hash) ON public.telegram_orders FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_telegram_api_request_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.customer_api_request_hash IS NOT NULL AND current_user NOT IN ('postgres','service_role') THEN
      RAISE EXCEPTION 'telegram_api_request_binding_service_only';
    END IF;
  ELSIF NEW.customer_api_request_hash IS DISTINCT FROM OLD.customer_api_request_hash
    OR (OLD.customer_api_request_hash IS NOT NULL AND (
      NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.reference IS DISTINCT FROM OLD.reference
      OR NEW.order_type IS DISTINCT FROM OLD.order_type OR NEW.username IS DISTINCT FROM OLD.username
      OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.months IS DISTINCT FROM OLD.months
      OR NEW.price_ngn IS DISTINCT FROM OLD.price_ngn OR NEW.recipient_hash IS DISTINCT FROM OLD.recipient_hash)) THEN
    RAISE EXCEPTION 'telegram_api_request_binding_immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_telegram_api_request_binding() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER telegram_api_request_binding_immutable BEFORE INSERT OR UPDATE ON public.telegram_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_telegram_api_request_binding();
ALTER TABLE public.telegram_orders ENABLE ALWAYS TRIGGER telegram_api_request_binding_immutable;
