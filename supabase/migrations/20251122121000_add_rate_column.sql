ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS rate NUMERIC;
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS actually_paid NUMERIC;
