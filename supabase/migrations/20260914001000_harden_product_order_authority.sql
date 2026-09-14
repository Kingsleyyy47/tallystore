-- Product orders are purchase authority records. Customers may read their own
-- order history through RLS, but browser clients must not create, edit, or
-- delete product orders directly. Completed product orders are created by the
-- process-purchase Edge Function after the server-side wallet debit succeeds.

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can update orders" ON public.orders';
  END IF;
END $$;
