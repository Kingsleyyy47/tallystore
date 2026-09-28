-- Financial history is written by server-side workflows. RLS and row-write
-- triggers do not protect TRUNCATE, and revoking a role grant does not remove
-- a grant inherited through PUBLIC.
DO $restrict$
DECLARE
  v_table text;
BEGIN
  IF to_regclass('public.transactions') IS NULL
    OR to_regclass('public.pending_payments') IS NULL
  THEN
    RAISE EXCEPTION 'financial_history_required_table_missing';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'transactions', 'pending_payments', 'orders', 'bitrefill_orders',
    'crypto_transactions', 'smm_orders', 'telegram_orders', 'bills_transactions'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_table
      );
    END IF;
  END LOOP;

  -- Profile reads and harmless allowlisted edits remain available through
  -- their existing grants and guards; no browser may truncate all profiles.
  EXECUTE 'REVOKE TRUNCATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated';
END;
$restrict$;
