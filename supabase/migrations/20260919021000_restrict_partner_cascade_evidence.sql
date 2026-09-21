-- Partner/API incident evidence must survive partner-record deletion attempts.
-- The partner API is paused during wallet-integrity review, so deleting a
-- partner must not cascade-delete keys, customer references, webhook delivery
-- records, or other linked evidence.

DO $$
DECLARE
  fk record;
  constraint_def text;
  restricted_def text;
BEGIN
  FOR fk IN
    SELECT
      con.oid,
      nsp.nspname AS table_schema,
      rel.relname AS table_name,
      con.conname AS constraint_name,
      refrel.relname AS referenced_table
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class refrel ON refrel.oid = con.confrelid
    JOIN pg_namespace refnsp ON refnsp.oid = refrel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND refnsp.nspname = 'public'
      AND refrel.relname IN (
        'api_partners',
        'api_partner_keys',
        'api_partner_orders',
        'api_partner_logs',
        'api_partner_customers',
        'api_partner_webhook_deliveries'
      )
      AND con.confdeltype = 'c'
  LOOP
    constraint_def := pg_get_constraintdef(fk.oid);
    restricted_def := regexp_replace(
      constraint_def,
      'ON[[:space:]]+DELETE[[:space:]]+CASCADE',
      ' ON DELETE RESTRICT',
      'i'
    );

    IF restricted_def = constraint_def THEN
      RAISE EXCEPTION 'Could not rewrite cascading partner foreign key %.% constraint % referencing %',
        fk.table_schema,
        fk.table_name,
        fk.constraint_name,
        fk.referenced_table;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.table_schema,
      fk.table_name,
      fk.constraint_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s NOT VALID',
      fk.table_schema,
      fk.table_name,
      fk.constraint_name,
      restricted_def
    );
  END LOOP;
END;
$$;
