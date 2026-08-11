ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS payment_provider TEXT;
