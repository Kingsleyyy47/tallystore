-- Supplier catalogue rates can exceed $9,999.999999. Keep six decimal places
-- while allowing the full validated quote and its recorded order cost.
-- This changes capacity only; existing prices, balances and order amounts stay exact.
ALTER TABLE public.smm_services
  ALTER COLUMN rate_usd TYPE numeric(20,6);
ALTER TABLE public.smm_orders
  ALTER COLUMN cost_usd TYPE numeric(20,6);
