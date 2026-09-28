-- The partner pause must also remove privileges inherited through PUBLIC and
-- separately granted on columns. Admin inspection uses the server-side Edge
-- Function; browser roles need no direct partner-table access.
DO $restrict$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'api_partners', 'api_partner_keys', 'api_partner_orders',
    'api_partner_logs', 'api_partner_customers',
    'api_partner_webhook_deliveries'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'partner_authority_required_table_missing: %', v_table;
    END IF;

    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );

    FOR v_column IN
      SELECT a.attname
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || v_table)
        AND a.attnum > 0
        AND NOT a.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_column, v_column, v_column, v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$restrict$;
