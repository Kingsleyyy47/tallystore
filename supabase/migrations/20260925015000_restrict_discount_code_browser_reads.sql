-- Contract only after the browser uses preview_discount_code() and
-- get_managed_discount_codes(). An ordinary user must not list promo codes.
DO $preflight$
BEGIN
  IF to_regclass('public.discount_codes') IS NULL
    OR to_regprocedure('public.preview_discount_code(text,uuid,numeric)') IS NULL
    OR to_regprocedure('public.get_managed_discount_codes()') IS NULL
    OR to_regprocedure('public.is_admin_profile()') IS NULL
  THEN
    RAISE EXCEPTION 'discount read contract dependencies missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'discount_codes'
      AND policyname = 'Anyone can read active discount codes' AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'discount_codes'
      AND policyname = 'Admin can manage discount codes' AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'expected discount policies missing; review deployed policies first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'discount_codes'
      AND policyname = 'discount_codes_write'
      AND NOT (
        cmd = 'ALL'
        AND roles = ARRAY['authenticated']::name[]
        AND permissive = 'PERMISSIVE'
        AND qual = 'is_staff_or_admin()'
        AND with_check = 'is_staff_or_admin()'
      )
  ) THEN
    RAISE EXCEPTION 'unexpected discount_codes_write policy; review deployed policy first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'discount_codes'
      AND cmd IN ('SELECT', 'ALL')
      AND policyname NOT IN (
        'Anyone can read active discount codes', 'Admin can manage discount codes',
        'discount_codes_write'
      )
  ) THEN
    RAISE EXCEPTION 'additional discount read policy requires review';
  END IF;
END;
$preflight$;

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY "Anyone can read active discount codes" ON public.discount_codes;
DROP POLICY "Admin can manage discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS discount_codes_write ON public.discount_codes;
CREATE POLICY "Admin can manage discount codes" ON public.discount_codes
  FOR ALL TO authenticated
  USING (public.is_admin_profile())
  WITH CHECK (public.is_admin_profile());

REVOKE SELECT ON TABLE public.discount_codes FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.discount_codes TO authenticated;
