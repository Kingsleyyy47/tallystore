-- Let admins view all service history rows from the browser admin dashboard.
-- Customers still only see their own rows.

DO $$
DECLARE
  history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'sms_orders',
    'crypto_transactions',
    'crypto_withdrawals',
    'bills_transactions',
    'bitrefill_orders',
    'smm_orders'
  ]
  LOOP
    IF to_regclass(format('public.%I', history_table)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Admin can read all history rows" ON public.%I', history_table);
      EXECUTE format(
        'CREATE POLICY "Admin can read all history rows"
          ON public.%I
          FOR SELECT
          TO authenticated
          USING (
            EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.id = auth.uid()
                AND p.is_admin = true
            )
            OR auth.uid() = user_id
          )',
        history_table
      );
    END IF;
  END LOOP;
END $$;
