-- Table-level revocation does not remove separately granted column writes.
-- Keep customer/admin history reads, but require server-owned mutation paths.
DO $restrict$
DECLARE
  v_table text;
  v_column text;
BEGIN
  IF to_regclass('public.sms_orders') IS NULL
    OR to_regclass('public.crypto_withdrawals') IS NULL
  THEN
    RAISE EXCEPTION 'paid_history_required_table_missing';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'transactions', 'pending_payments', 'orders', 'bitrefill_orders',
    'crypto_transactions', 'crypto_withdrawals', 'smm_orders', 'sms_orders',
    'telegram_orders', 'bills_transactions'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',
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
        'REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_column, v_column, v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$restrict$;
