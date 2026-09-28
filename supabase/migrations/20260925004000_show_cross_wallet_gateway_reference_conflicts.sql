-- Include provider-scoped payment references in the admin-only full-history
-- conflict reader. A reference collision is review evidence, not proof that
-- either account committed fraud.
CREATE OR REPLACE FUNCTION public.get_admin_cross_wallet_payment_conflicts_page(
  p_after_payment_identity text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  payment_identity text,
  wallet_ids uuid[],
  funding_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)
  ) THEN
    RAISE EXCEPTION 'cross_wallet_payment_conflicts_admin_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT collisions.payment_identity, collisions.wallet_ids,
    collisions.funding_rows
  FROM (
    SELECT claims.payment_identity,
      array_agg(DISTINCT claims.user_id) AS wallet_ids,
      count(DISTINCT claims.id) AS funding_rows
    FROM (
      SELECT btrim(t.external_payment_id) AS payment_identity, t.user_id, t.id
      FROM public.transactions t
      WHERE NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(t.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(t.type, '')) IN (
          'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'
        )

      UNION ALL

      SELECT 'reference:' || CASE
          WHEN lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(t.metadata->>'provider', ''))
        END || ':' || btrim(t.reference) AS payment_identity,
        t.user_id, t.id
      FROM public.transactions t
      WHERE NULLIF(btrim(COALESCE(t.reference, '')), '') IS NOT NULL
        AND lower(COALESCE(t.metadata->>'provider', '')) IN
          ('ercas', 'ercaspay', 'pocketfi')
        AND COALESCE(t.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(t.type, '')) IN (
          'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'
        )

      UNION ALL

      SELECT 'reference:' || CASE
          WHEN lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(t.metadata->>'provider', ''))
        END || ':' || btrim(t.external_payment_id) AS payment_identity,
        t.user_id, t.id
      FROM public.transactions t
      WHERE NULLIF(btrim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL
        AND lower(COALESCE(t.metadata->>'provider', '')) IN
          ('ercas', 'ercaspay', 'pocketfi')
        AND COALESCE(t.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(t.type, '')) IN (
          'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'
        )
    ) claims
    GROUP BY claims.payment_identity
    HAVING count(DISTINCT claims.user_id) > 1
  ) collisions
  WHERE p_after_payment_identity IS NULL
    OR collisions.payment_identity > p_after_payment_identity
  ORDER BY collisions.payment_identity
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_cross_wallet_payment_conflicts_page(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_cross_wallet_payment_conflicts_page(text, integer)
  TO authenticated;
