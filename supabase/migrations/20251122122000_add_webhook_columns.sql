-- Add webhook-specific columns for NowPayments
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS payout_hash TEXT;
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS payment_extra_ids TEXT; -- JSON array stored as text
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS parent_payment_id TEXT;
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS origin_type TEXT;
ALTER TABLE crypto_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
