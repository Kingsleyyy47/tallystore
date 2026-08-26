-- Global real activity feed for public widgets.
-- Returns only masked, completed customer deposits and completed product orders.

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
      COALESCE(substring(split_part(p.email, '@', 1) FROM 1 FOR 3), 'Use') || '***' AS masked_name,
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
      COALESCE(substring(split_part(p.email, '@', 1) FROM 1 FOR 3), 'Use') || '***' AS masked_name,
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
