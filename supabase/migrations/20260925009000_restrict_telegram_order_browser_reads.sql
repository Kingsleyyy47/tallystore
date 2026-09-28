-- Telegram order history and retail products are served through the
-- authenticated telegram-stars Edge Function. Browser roles have no direct
-- table read or write use case.
DO $preflight$
BEGIN
  IF to_regclass('public.telegram_orders') IS NULL THEN
    RAISE EXCEPTION 'telegram_order_privacy_required_table_missing';
  END IF;
  IF to_regclass('public.telegram_products') IS NULL THEN
    RAISE EXCEPTION 'telegram_product_privacy_required_table_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.telegram_orders'::regclass
      AND a.attname = 'user_id' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'telegram_order_privacy_user_id_missing';
  END IF;
END;
$preflight$;

DO $columns$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['telegram_orders', 'telegram_products'] LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    FOR v_column IN
      SELECT a.attname
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || v_table)
        AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$columns$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_products TO service_role;
