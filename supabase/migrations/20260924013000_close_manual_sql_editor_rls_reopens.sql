-- An old, standalone SQL Editor repair script could recreate permissive
-- policies after the ordered migrations. Remove its known public data and
-- forged-analytics access without changing existing customer wallet state.
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can insert site visits" ON public.site_visits;

DO $close_optional_analytics$
BEGIN
  IF to_regclass('public.cro_outcomes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Clients can insert own cro outcomes" ON public.cro_outcomes';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can select own cro outcomes" ON public.cro_outcomes';
    EXECUTE 'REVOKE INSERT, SELECT, UPDATE, DELETE, TRUNCATE ON public.cro_outcomes FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.cro_interventions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Clients can insert own cro interventions" ON public.cro_interventions';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can update own cro interventions" ON public.cro_interventions';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can read own cro interventions" ON public.cro_interventions';
    EXECUTE 'REVOKE INSERT, SELECT, UPDATE, DELETE, TRUNCATE ON public.cro_interventions FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.chat_interventions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Clients can insert chat interventions" ON public.chat_interventions';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can select own chat interventions" ON public.chat_interventions';
    EXECUTE 'REVOKE INSERT, SELECT, UPDATE, DELETE, TRUNCATE ON public.chat_interventions FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.chat_sessions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Clients can insert chat sessions" ON public.chat_sessions';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can update chat sessions" ON public.chat_sessions';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can select chat sessions" ON public.chat_sessions';
    EXECUTE 'REVOKE INSERT, SELECT, UPDATE, DELETE, TRUNCATE ON public.chat_sessions FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.revenue_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Clients can select own revenue events" ON public.revenue_events';
    EXECUTE 'DROP POLICY IF EXISTS "Customers can select own revenue events" ON public.revenue_events';
    EXECUTE 'CREATE POLICY "Customers can select own revenue events" ON public.revenue_events FOR SELECT TO authenticated USING (auth.uid() = user_id)';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can update non-financial revenue events" ON public.revenue_events';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.revenue_events FROM PUBLIC, anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can record revenue events" ON public.revenue_events';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can record own revenue events" ON public.revenue_events';
    EXECUTE 'DROP POLICY IF EXISTS "Clients can record non-financial revenue events" ON public.revenue_events';
    EXECUTE $policy$CREATE POLICY "Clients can record non-financial revenue events"
      ON public.revenue_events FOR INSERT TO anon, authenticated
      WITH CHECK (
        (user_id IS NULL OR auth.uid() = user_id)
        AND COALESCE(metadata->>'authoritative', 'false') <> 'true'
        AND COALESCE(metadata->>'server_authoritative', 'false') <> 'true'
        AND event_type NOT IN (
          'PAYMENT_STARTED', 'PAYMENT_ATTEMPTED', 'PAYMENT_COMPLETED',
          'PRODUCT_PURCHASED', 'PRODUCT_PURCHASE_REVERSED',
          'SMS_ORDER_CANCELLED', 'SMS_ORDER_COMPLETED', 'SMS_ORDER_REFUNDED'
        )
      )$policy$;
  END IF;
END;
$close_optional_analytics$;
