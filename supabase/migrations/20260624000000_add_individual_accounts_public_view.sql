-- The `individual_accounts` table holds plaintext account credentials
-- (password, email_password, two_fa_code, recovery_email_password, etc.)
-- and is correctly locked down by RLS so anon/authenticated clients cannot
-- read it directly. That's the right call security-wise.
--
-- However, the storefront's pre-purchase browsing pages (Product Detail
-- page, "Popular Products" / "Refilled" / "New" tiles on the Products
-- page) only ever need a handful of non-sensitive columns -- the account
-- id (to link to), which product group it belongs to, its status, its
-- username (shown as a preview before purchase), and when it was created.
-- They never need the password/2FA/recovery fields pre-purchase.
--
-- This view exposes ONLY those safe columns. It is the security boundary:
-- since password/email_password/two_fa_code/recovery_* are never selected
-- here, they can never leak through this view no matter who queries it.
-- The underlying `individual_accounts` table keeps its existing strict RLS
-- (no direct anon/authenticated SELECT) untouched.

create or replace view public.individual_accounts_public as
select
  id,
  product_group_id,
  username,
  status,
  created_at
from public.individual_accounts;

-- Let the storefront (anon + logged-in users) read the view. This does NOT
-- grant access to the underlying table or its sensitive columns.
grant select on public.individual_accounts_public to anon, authenticated;
