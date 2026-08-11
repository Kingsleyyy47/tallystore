-- Referral balance bank withdrawal migration
-- Run this once in the Supabase SQL editor.
-- Lets the create-withdrawal-request edge function track whether a withdrawal
-- drew from crypto_balance or referral_balance (both now flow through the same
-- SageCloud bank-transfer function, distinguished by a "source" request field).

ALTER TABLE crypto_withdrawals
  ADD COLUMN IF NOT EXISTS balance_source TEXT NOT NULL DEFAULT 'crypto';

-- Backfill: anything already in the table predates this feature and was a crypto withdrawal.
UPDATE crypto_withdrawals SET balance_source = 'crypto' WHERE balance_source IS NULL;
