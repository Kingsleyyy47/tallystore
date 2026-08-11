-- The `profiles` table is correctly locked down by RLS so users can only
-- read their own row (it holds wallet_balance, referral_balance, email,
-- etc.). That's the right call security-wise.
--
-- But the referral system needs two cross-user reads that RLS silently
-- blocks (returns zero rows, no error, so the bug is invisible client-side):
--   1. At signup: look up WHICH user owns a given referral_code, to set
--      the new signup's `referred_by`.
--   2. On the Referrals page: count how many OTHER users have
--      `referred_by` = me, for the "People Referred" stat.
--
-- This view exposes ONLY the three non-sensitive columns those two lookups
-- need. No balances, no emails, nothing sensitive can leak through it.
-- The underlying `profiles` table keeps its existing strict RLS untouched.

create or replace view public.referral_lookup as
select
  id,
  referral_code,
  referred_by
from public.profiles;

-- Let anon (during signup, before session is fully established in some
-- flows) and authenticated users read the view. This does NOT grant access
-- to the underlying table or its sensitive columns.
grant select on public.referral_lookup to anon, authenticated;
