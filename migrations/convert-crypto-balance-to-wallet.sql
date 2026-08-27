-- ============================================================
-- Crypto Balance → Wallet Balance Conversion
-- Run this AFTER the 7-day notice period expires.
-- Moves every user's crypto_balance into their wallet_balance
-- and zeros out crypto_balance.
-- ============================================================

-- Preview first (read-only) — check who will be affected
SELECT
  id,
  email,
  crypto_balance,
  wallet_balance,
  wallet_balance + crypto_balance AS new_wallet_balance
FROM public.profiles
WHERE crypto_balance > 0
ORDER BY crypto_balance DESC;

-- ============================================================
-- Run the actual conversion (uncomment when ready)
-- ============================================================
/*
UPDATE public.profiles
SET
  wallet_balance = wallet_balance + crypto_balance,
  crypto_balance = 0,
  updated_at = now()
WHERE crypto_balance > 0;

-- Confirm
SELECT COUNT(*) AS affected_users,
       SUM(wallet_balance) AS total_converted
FROM public.profiles
WHERE updated_at > now() - interval '5 minutes';
*/
