-- Payment recovery evidence is read by service workflows and protected
-- database functions. A customer's own-row RLS policy does not prevent old
-- provider error_message or payment references from being selected directly.
DO $preflight$
BEGIN
  IF to_regclass('public.pending_payments') IS NULL THEN
    RAISE EXCEPTION 'pending_payments_required_for_read_restriction';
  END IF;
END;
$preflight$;

REVOKE SELECT ON TABLE public.pending_payments FROM PUBLIC, anon, authenticated;
DO $revoke_columns$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.pending_payments'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.pending_payments FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$revoke_columns$;

GRANT SELECT ON TABLE public.pending_payments TO service_role;
