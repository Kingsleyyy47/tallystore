-- Keep the storefront pointer shape for existing clients, but never expose an
-- inventory username before a completed, authorized purchase.
CREATE OR REPLACE VIEW public.individual_accounts_public AS
SELECT
  id,
  product_group_id,
  CASE WHEN false THEN username ELSE NULL END AS username,
  status,
  created_at
FROM public.individual_accounts
WHERE status = 'available';

-- The view is an intentionally narrow public projection. Its owner must be the
-- migration role; direct base-table reads remain governed by admin-only RLS.
ALTER VIEW public.individual_accounts_public
  SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.individual_accounts_public FROM PUBLIC;
GRANT SELECT ON public.individual_accounts_public TO anon, authenticated;
REVOKE ALL ON public.individual_accounts FROM PUBLIC, anon;
ALTER TABLE public.individual_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read available account pointers" ON public.individual_accounts;

CREATE OR REPLACE FUNCTION public.get_recent_activity_feed(p_limit int DEFAULT 12)
RETURNS TABLE (
  kind text,
  masked_name text,
  amount numeric,
  label text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  (
    SELECT
      'deposit'::text AS kind,
      'Customer'::text AS masked_name,
      t.amount,
      CASE
        WHEN t.description ILIKE '%pocketfi%' THEN 'via PocketFi'
        WHEN t.description ILIKE '%ercas%' THEN 'via Ercas Pay'
        ELSE 'via wallet top-up'
      END AS label,
      t.created_at
    FROM public.transactions t
    JOIN public.profiles p ON p.id = t.user_id
    WHERE lower(COALESCE(t.type, '')) IN ('topup', 'top_up', 'deposit', 'credit')
      AND lower(COALESCE(t.status, '')) IN ('completed', 'success', 'successful', 'credited')
      AND COALESCE(p.is_staff, false) = false
      AND COALESCE(p.is_admin, false) = false
    ORDER BY t.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  UNION ALL
  (
    SELECT
      'order'::text AS kind,
      'Customer'::text AS masked_name,
      o.amount,
      COALESCE(o.account_details->>'product_name', 'an account') AS label,
      o.created_at
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.user_id
    WHERE lower(COALESCE(o.status, '')) IN ('completed', 'success', 'successful')
      AND COALESCE(p.is_staff, false) = false
      AND COALESCE(p.is_admin, false) = false
    ORDER BY o.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  ORDER BY created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50)
$$;

REVOKE ALL ON FUNCTION public.get_recent_activity_feed(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_activity_feed(int) TO anon, authenticated;
