-- Financial and incident evidence must survive account-deletion attempts.
-- Earlier migrations block auth.users/profile deletes by trigger, but older
-- public tables still carried auth.users ON DELETE CASCADE references.
-- Replace those cascades with restrictive foreign keys as defense in depth.

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
      con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class refrel ON refrel.oid = con.confrelid
    JOIN pg_namespace refnsp ON refnsp.oid = refrel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND refnsp.nspname = 'auth'
      AND refrel.relname = 'users'
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
      RAISE EXCEPTION 'Could not rewrite cascading auth.users foreign key %.% constraint %',
        fk.table_schema,
        fk.table_name,
        fk.constraint_name;
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
