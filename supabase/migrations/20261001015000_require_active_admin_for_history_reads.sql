-- A suspended admin may still read their own orders, but not all customers'
-- purchase history or broadcast jobs merely because is_admin remains true.
DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM (VALUES
    ('bills_transactions', 'Admin can read all history rows'),
    ('bitrefill_orders', 'Admin can read all history rows'),
    ('crypto_transactions', 'Admin can read all history rows'),
    ('crypto_withdrawals', 'Admin can read all history rows'),
    ('smm_orders', 'Admin can read all history rows'),
    ('broadcast_jobs', 'Admins can view broadcast jobs')
  ) AS expected(tablename, policyname)
  JOIN pg_policies p ON p.schemaname = 'public'
    AND p.tablename = expected.tablename
    AND p.policyname = expected.policyname
    AND p.cmd = 'SELECT' AND p.permissive = 'PERMISSIVE'
  WHERE COALESCE(p.qual, '') LIKE '%is_admin = true%';

  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Unexpected legacy admin history policies: % of 6 found', v_count;
  END IF;
END;
$guard$;

DROP POLICY "Admin can read all history rows" ON public.bills_transactions;
CREATE POLICY "Admin can read all history rows" ON public.bills_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

DROP POLICY "Admin can read all history rows" ON public.bitrefill_orders;
CREATE POLICY "Admin can read all history rows" ON public.bitrefill_orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

DROP POLICY "Admin can read all history rows" ON public.crypto_transactions;
CREATE POLICY "Admin can read all history rows" ON public.crypto_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

DROP POLICY "Admin can read all history rows" ON public.crypto_withdrawals;
CREATE POLICY "Admin can read all history rows" ON public.crypto_withdrawals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

DROP POLICY "Admin can read all history rows" ON public.smm_orders;
CREATE POLICY "Admin can read all history rows" ON public.smm_orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_profile());

DROP POLICY "Admins can view broadcast jobs" ON public.broadcast_jobs;
CREATE POLICY "Admins can view broadcast jobs" ON public.broadcast_jobs
  FOR SELECT TO authenticated USING (public.is_admin_profile());
