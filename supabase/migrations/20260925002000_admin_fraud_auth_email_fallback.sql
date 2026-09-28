-- Fraud Review must search the current Auth identity when profile.email is
-- missing or stale. Keep auth.users behind the existing admin-only RPC.
CREATE OR REPLACE FUNCTION public.get_admin_wallet_financial_truth_page(
  p_after_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  is_staff boolean,
  is_admin boolean,
  account_suspended boolean,
  wallet_review_required boolean,
  suspension_reason text,
  suspended_at timestamptz,
  truth jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'wallet_financial_truth_admin_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id,
    COALESCE(NULLIF(btrim(au.email::text), ''), NULLIF(btrim(p.email::text), '')),
    p.full_name::text,
    COALESCE(p.is_staff, false), COALESCE(p.is_admin, false),
    COALESCE(p.account_suspended, false),
    COALESCE(p.wallet_review_required, false),
    p.suspension_reason::text, p.suspended_at,
    public.wallet_financial_truth_internal(p.id)
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE (p_after_user_id IS NULL OR p.id > p_after_user_id)
  ORDER BY p.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_wallet_financial_truth_page(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_wallet_financial_truth_page(uuid, integer)
  TO authenticated;
