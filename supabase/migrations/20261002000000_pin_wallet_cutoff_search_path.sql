-- Keep the historical funding cutoff independent of the caller's search path.
-- The function contains only a fixed timestamp; its value and grants stay intact.
ALTER FUNCTION public.wallet_legacy_funding_cutoff() SET search_path = '';
