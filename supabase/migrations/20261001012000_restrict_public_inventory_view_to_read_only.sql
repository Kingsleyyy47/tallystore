-- The public inventory view hides credentials but was automatically updatable.
-- Existing direct ALL grants let browser roles change or delete base inventory
-- through the view despite the base table's row-level security.
REVOKE ALL ON TABLE public.individual_accounts_public
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.individual_accounts_public
  TO anon, authenticated;
