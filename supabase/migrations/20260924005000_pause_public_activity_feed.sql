-- Exact customer deposit amounts, order products, and event times do not
-- belong in a public social-proof feed. Keep the function for a later
-- aggregate-only redesign, but make it unreachable to browser roles.
REVOKE ALL ON FUNCTION public.get_recent_activity_feed(integer)
  FROM PUBLIC, anon, authenticated;
