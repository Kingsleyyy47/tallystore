-- Browser admins may acknowledge an alert, but must not rewrite the evidence
-- or forge its acknowledgement actor/time. Service-owned resolution remains.
DO $preflight$
BEGIN
  IF to_regclass('public.admin_alerts') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.admin_alerts'::regclass
        AND attname = 'acknowledged_by' AND NOT attisdropped
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.admin_alerts'::regclass
        AND attname = 'acknowledged_at' AND NOT attisdropped
    )
  THEN
    RAISE EXCEPTION 'admin_alerts acknowledgement schema must be reviewed first';
  END IF;
END;
$preflight$;

REVOKE UPDATE ON TABLE public.admin_alerts FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT attname
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.admin_alerts'::regclass
      AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE UPDATE (%I) ON TABLE public.admin_alerts FROM PUBLIC, anon, authenticated',
      v_column.attname
    );
  END LOOP;
END;
$columns$;
GRANT UPDATE (acknowledged) ON TABLE public.admin_alerts TO authenticated;
GRANT UPDATE ON TABLE public.admin_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.guard_admin_alert_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.acknowledged, false)
    OR NEW.acknowledged IS DISTINCT FROM true
    OR (
      to_jsonb(NEW) - 'acknowledged' - 'acknowledged_at'
        - 'acknowledged_by' - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - 'acknowledged' - 'acknowledged_at'
        - 'acknowledged_by' - 'updated_at'
    )
  THEN
    RAISE EXCEPTION 'admin_alert_acknowledgement_only' USING ERRCODE = '42501';
  END IF;

  NEW.acknowledged_at := clock_timestamp();
  NEW.acknowledged_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_admin_alert_acknowledgement()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_admin_alert_acknowledgement ON public.admin_alerts;
CREATE TRIGGER trg_guard_admin_alert_acknowledgement
BEFORE UPDATE ON public.admin_alerts
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_alert_acknowledgement();
